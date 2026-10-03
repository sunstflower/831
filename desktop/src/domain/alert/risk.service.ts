/**
 * 任务风险预检的**取数层**（`docs/api.md` §3.8.3）。
 *
 * ## 分工：本文件只取数，判断在 `@udm/shared`
 *
 * 「什么算一条风险」的唯一作者是 `shared/src/plan-risk.ts` —— 主进程与浏览器 Mock
 * 调的是同一个函数，因此不可能出现「浏览器说有冲突、Electron 说没有」。
 * 这里只做它做不了的事：把 SQLite 的行翻译成那个函数要的输入。
 *
 * ## 「这条任务派给谁、走哪条路」是**两级查法**，与执行器 / 任务详情同源
 *
 * `findExecutionRoute`（`execution.repo.ts`）与 `findTaskRoute`（`task.repo.ts`）都按
 * 「先 `dispatch_plans.status='applied'`，查不到再按 `routes.task_id` 回退」取路线。
 * 本文件必须**用同一套判据**，否则会出现最尴尬的一类不一致：
 * 执行器认为那条演示任务有路线（车真的在跑），而风险预检认为它「有计划没路线」，
 * 于是告警中心为一条正常执行中的任务报一条假红。
 *
 * 回退存在的原因是 D-26 的 seed 演示数据：它写「任务 running + 一条 routes 行」，
 * 但**没有** `dispatch_plans` 行（演示数据不是走调度流程产生的）。回退行没有落库的
 * 占用区间，就按「从开始执行那一刻起、加上路线时长」推导 —— 与执行器推进任务的
 * 时间轴同一个口径（`execution.repo.ts` 的路线时长就是 `routes.duration_s`）。
 *
 * ## 为什么不用 `DispatchSnapshot`
 *
 * 快照组装（`domain/dispatch/snapshot.ts`）会把站点解析成节点并在解析不了时**抛错**。
 * 预检不该因为「某个站点没绑节点」就整份报错 —— 它要回答的正是「现在有哪些问题」，
 * 而站点没绑节点恰恰是其中一条。因此这里用一份更小、更宽容的查询：
 * 取不到关联对象就跳过那一条，不让整体失败。
 */
import {
  buildPlanRiskReport,
  planInputsOf,
  scanPlanRisks,
  type PlanRiskAssignmentSource,
  type PlanRiskReport,
  type PlanRiskTaskInput,
  type PlanRiskVehicleInput,
  type TaskStatus,
  type VehicleStatus
} from '@udm/shared';
import { all, nowIso, type Db } from '../../db/index.js';

/**
 * 参与预检的任务状态。
 *
 * `draft`（草稿）**不在内**：它还没提交，报「未派发」只会给使用者制造噪音 ——
 * 草稿本来就不该被派。`finished/cancelled/failed` 也不在内：它们已经结束，
 * 「会不会超时」对它们没有意义。
 */
const RISK_TASK_STATUSES: readonly TaskStatus[] = ['pending', 'assigned', 'running', 'paused'];

interface RiskRow {
  task_id: string;
  task_code: string;
  task_status: TaskStatus;
  time_window_start: string | null;
  time_window_end: string | null;
  cargo_kg: number;
  created_at: string;
  assigned_at: string | null;
  started_at: string | null;
  vehicle_id: string | null;
  vehicle_code: string | null;
  vehicle_status: VehicleStatus | null;
  vehicle_battery: number | null;
  plan_route_id: string | null;
  occupied_from: string | null;
  occupied_to: string | null;
  fallback_route_id: string | null;
  fallback_duration_s: number | null;
}

/**
 * 一次查询取齐三个视图需要的全部字段。
 *
 * 两条 `LEFT JOIN routes` 是刻意的：`pr` 取**计划那条**路线（`dispatch_plans.route_id`），
 * `fr` 取**该任务最新的**路线（回退用）。用一个 join 只能表达其中一种，
 * 而回退与首选并存时（计划被 superseded、任务仍挂着旧路线）必须能区分。
 */
const RISK_QUERY = (placeholders: string) => `
  SELECT t.id AS task_id, t.code AS task_code, t.status AS task_status,
         t.time_window_start, t.time_window_end, t.cargo_kg,
         t.created_at, t.assigned_at, t.started_at,
         v.id AS vehicle_id, v.code AS vehicle_code, v.status AS vehicle_status, v.battery AS vehicle_battery,
         prv.id AS plan_route_id, p.occupied_from, p.occupied_to,
         fr.id AS fallback_route_id, fr.duration_s AS fallback_duration_s
    FROM tasks t
    LEFT JOIN vehicles v ON v.id = t.assigned_vehicle_id
    LEFT JOIN dispatch_plans p ON p.task_id = t.id AND p.status = 'applied'
    LEFT JOIN routes prv ON prv.id = p.route_id
    LEFT JOIN routes fr ON fr.id = (
      SELECT id FROM routes WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
    )
   WHERE t.status IN (${placeholders})
   ORDER BY t.created_at`;

function toTaskInput(row: RiskRow): PlanRiskTaskInput {
  return {
    id: row.task_id,
    code: row.task_code,
    status: row.task_status,
    timeWindowStart: row.time_window_start,
    timeWindowEnd: row.time_window_end,
    cargoKg: row.cargo_kg
  };
}

/**
 * 行 → 「派给了谁 / 走哪条路」的原始素材。
 *
 * **这里不做任何判断**：计划优先还是回退优先、区间怎么推，全部由
 * `shared` 的 `planInputsOf` 决定（那是业务规则，两边必须同一份）。
 * 本函数只负责把列名对上。
 */
function toAssignmentSource(row: RiskRow): PlanRiskAssignmentSource {
  return {
    taskId: row.task_id,
    taskStatus: row.task_status,
    vehicleId: row.vehicle_id,
    vehicleCode: row.vehicle_code,
    plan:
      row.occupied_from && row.occupied_to
        ? { routeId: row.plan_route_id, occupiedFrom: row.occupied_from, occupiedTo: row.occupied_to }
        : null,
    fallbackRoute:
      row.fallback_route_id && row.fallback_duration_s !== null
        ? { id: row.fallback_route_id, durationS: row.fallback_duration_s }
        : null,
    fallbackFrom: row.started_at ?? row.assigned_at ?? row.created_at
  };
}

/**
 * 扫描一次（`GET /api/alerts/risks` 的实现）。
 *
 * `now` 可注入：用例要用固定时刻断言「逾期 N 秒」，而真实运行用服务端时钟
 * （`nowIso()`）—— 与 `monitorOverview(db, now)` 同一个写法。
 */
export function alertRisks(db: Db, now: string = nowIso()): PlanRiskReport {
  const placeholders = RISK_TASK_STATUSES.map(() => '?').join(',');
  const rows = all<RiskRow>(db, RISK_QUERY(placeholders), [...RISK_TASK_STATUSES]);

  const tasks = rows.map(toTaskInput);
  // 「计划优先、否则按任务路线回退」是业务规则，唯一作者在 `shared`（见 `planInputsOf` 注释）
  const plans = planInputsOf(rows.map(toAssignmentSource));

  /*
   * 车辆取**全量**（而不是只取被指派的那几台）：`VEHICLE_UNAVAILABLE` /
   * `BATTERY_RISK` 要读运行态，而运行态在任务行里只有被指派的那台才有。
   * 全量查询在这里是几十行的量级，换来的是「判断所需的数据一次取齐、不遗漏」。
   */
  const vehicles = all<{ id: string; code: string; status: VehicleStatus; battery: number }>(
    db,
    `SELECT id, code, status, battery FROM vehicles ORDER BY code`
  ).map<PlanRiskVehicleInput>((row) => ({ id: row.id, code: row.code, status: row.status, battery: row.battery }));

  const nowMs = Date.parse(now);
  const items = scanPlanRisks(tasks, plans, vehicles, { nowMs: Number.isNaN(nowMs) ? Date.now() : nowMs });
  // 同一批输入三个视图（风险 / 派发 / 缺口）：报告由 `shared` 拼，这里只把输入原样递过去
  return buildPlanRiskReport(items, now, { tasks, plans });
}
