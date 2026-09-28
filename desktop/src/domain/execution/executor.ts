/**
 * 本地模拟执行器（M7，`docs/api.md` §3.7.3 / §3.7.4；设计口径 D-10）。
 *
 * ## 它是什么
 *
 * 一个**把「已派发的任务」变成「会动的车」**的定时器：沿任务路线的折线推进车辆、
 * 采样落 `vehicle_tracks`、写任务进度、到位后把任务推到 `finished`。
 * D-10 定了「首期用本地模拟执行器，二期以真实协议替换执行器且不改上层契约」——
 * 因此本类的对外行为只有 `startTask` / `takeover` / `tick` 三个入口，
 * 换成真实设备协议时，改变的是 `tick` 内部的推进方式，接口不变。
 *
 * ## 为什么 `tick()` 是公开的、而且不自己读时间
 *
 * 定时器不可测：`setInterval` 驱动的行为只能靠「跑一会儿再看看」来验证，
 * 而那种测试要么慢、要么不稳。这里把**推进逻辑**与**调度**分开：
 *   - `tick(steps)` 是纯推进（同一输入必得同一输出，可被单测逐帧断言）；
 *   - `startTimer()` 只是「每 tickMs 调一次 tick」。
 *
 * ## 为什么位置事件只发 `vehicle.changed` 而不发 `map.updated`
 *
 * 见 D-23：`map.updated` 会让渲染层重拉整张快照并重建节点/边，
 * 一秒一次的频率下 React Flow 会反复重挂载（实测边间歇性渲染不出来）。
 * 位置类信息走 `vehicle.changed` / `execution.progress`，由渲染层定向 `updateNode`。
 *
 * ## 事务边界
 *
 * 状态迁移（`assigned → running`、`running → paused`、`running → finished`）
 * 一律复用 `operateTask`（它自带一个事务、状态机校验与审计）；
 * 遥测与轨迹写在**另一个**事务里。两者不能合并：`operateTask` 内部有 `tx()`，
 * 而 `tx()` 不支持嵌套 `BEGIN`（会直接抛错）。
 * 因此每个公开方法都**先做完全部前置校验**，再依次调用两者 ——
 * 让「状态已改、遥测没写」只可能因为真正的系统故障（磁盘/权限）而发生。
 */
import { randomUUID } from 'node:crypto';
import {
  ALERT_NEXT_STEPS,
  DomainError,
  type AlertType,
  type AuditContext,
  type ExecutionStartResult,
  type TakeoverResult
} from '@udm/shared';
import { all, nowIso, tx, type Db } from '../../db/index.js';
import {
  findExecutionRoute,
  insertTrack,
  nodePositions,
  updateTaskProgress,
  updateVehicleTelemetry
} from '../../db/repositories/execution.repo.js';
import { findTaskRowById } from '../../db/repositories/task.repo.js';
import { findVehicleById } from '../../db/repositories/vehicle.repo.js';
import { writeAudit } from '../../services/audit.js';
import type { EventBus } from '../../services/event-bus.js';
import { createAlert } from '../alert/alert.service.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { operateTask } from '../task/task.service.js';

/** 每米电量消耗（百分点）。100 m 的演示路线约耗 1%，肉眼可见但不会跑一趟就趴窝。 */
const BATTERY_PERCENT_PER_M = 0.01;

/** 仿真倍速：1.5 m/s 的车按 4 倍推进，100 m 演示路线约 17 秒跑完。 */
const DEFAULT_SPEED_FACTOR = 4;

export interface ExecutorOptions {
  /** 两次推进之间的真实间隔（毫秒）。 */
  tickMs?: number;
  speedFactor?: number;
}

interface RunningExecution {
  taskId: string;
  vehicleId: string;
  routeId: string | null;
  /** 折线顶点（按路线顺序），第一个点是起点。 */
  points: Array<{ x: number; y: number; nodeId: string }>;
  /** 每段长度，与 `points` 等长减一。 */
  segmentLengths: number[];
  totalM: number;
  travelledM: number;
  speedMps: number;
  cargoKg: number;
  startedAt: string;
}

export interface TickResult {
  advanced: string[];
  finished: string[];
  dropped: string[];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** 折线上的位置（`travelledM` 米处），末段之外一律钳到终点。 */
function positionAt(execution: RunningExecution, travelledM: number): { x: number; y: number; nodeId: string } {
  let remaining = travelledM;
  for (let index = 0; index < execution.segmentLengths.length; index += 1) {
    const length = execution.segmentLengths[index]!;
    if (remaining <= length || index === execution.segmentLengths.length - 1) {
      const from = execution.points[index]!;
      const to = execution.points[index + 1]!;
      const ratio = length === 0 ? 1 : Math.min(1, Math.max(0, remaining / length));
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        // 落在哪一段就报到该段的终点节点：`current_node_id` 的语义是「最近经过的节点」，
        // 用四舍五入的中点会报出一个车还没到的节点
        nodeId: ratio >= 1 ? to.nodeId : from.nodeId
      };
    }
    remaining -= length;
  }
  return execution.points[execution.points.length - 1]!;
}

export class ExecutionRunner {
  private readonly tickMs: number;
  private readonly speedFactor: number;
  private readonly running = new Map<string, RunningExecution>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    options: ExecutorOptions = {}
  ) {
    this.tickMs = options.tickMs ?? 1000;
    this.speedFactor = options.speedFactor ?? DEFAULT_SPEED_FACTOR;
  }

  /** 当前在跑的任务数（自检与测试用）。 */
  activeCount(): number {
    return this.running.size;
  }

  private context(actor: AuditContext | null): CrudContext {
    return { db: this.db, actor };
  }

  /**
   * 把一个任务登记为「正在执行」。
   *
   * 前提校验全部走完才改数据：任务必须是 `assigned`、必须有车、车必须存在、
   * 计划必须有路线且路线上的节点坐标都能取到。缺任何一条都**不动数据**并报错 ——
   * 让任务停在 `assigned` 上比让它变成 `running` 却动不了要好得多。
   */
  startTask(actor: AuditContext | null, taskId: string, payload: Record<string, unknown>): ExecutionStartResult {
    const ctx = this.context(actor);
    const task = findTaskRowById(this.db, taskId);
    if (!task) {
      throw new DomainError('TASK.NOT_FOUND', undefined, { id: taskId });
    }
    const vehicleId = task.assigned_vehicle_id;
    if (!vehicleId) {
      throw new DomainError('TASK.STATE_CONFLICT', '任务还没有派发车辆，不能开始执行', {
        id: taskId,
        from: task.status,
        hint: '先在调度中心应用派发'
      });
    }
    const vehicle = findVehicleById(this.db, vehicleId);
    if (!vehicle) {
      throw new DomainError('VEHICLE.NOT_FOUND', undefined, { id: vehicleId });
    }
    const execution = this.buildExecution(taskId, vehicleId, vehicle.maxSpeedMps, task.cargo_kg, Number(task.progress ?? 0));
    if (!execution) {
      throw new DomainError('ROUTE.NOT_FOUND', '任务没有可用的已生效路线，不能开始执行', {
        taskId,
        vehicleId,
        hint: '重新预览并应用派发以生成路线'
      });
    }
    const note = typeof payload['note'] === 'string' ? payload['note'].trim() : '';
    // 状态机在 `operateTask` 里校验（`start` 只允许从 `assigned` 出发）
    operateTask(ctx, taskId, 'start', note ? { reason: note } : {});

    const at = nowIso();
    tx(this.db, () => {
      updateVehicleTelemetry(
        this.db,
        vehicleId,
        {
          status: 'busy',
          loadKg: task.cargo_kg,
          x: execution.points[0]!.x,
          y: execution.points[0]!.y,
          currentNodeId: execution.points[0]!.nodeId,
          heartbeat: true
        },
        at
      );
      insertTrack(this.db, {
        id: randomUUID(),
        vehicleId,
        ts: at,
        x: execution.points[0]!.x,
        y: execution.points[0]!.y,
        status: 'running',
        speedMps: execution.speedMps,
        taskId
      });
    });
    execution.startedAt = at;
    this.running.set(taskId, execution);
    this.emitChange(taskId, vehicleId, 'execution.start', 0);
    return { taskId, vehicleId, status: 'running', startedAt: at };
  }

  /**
   * 从数据库重建一条执行中的轨迹（启动时调用）。
   *
   * 为什么需要它：seed 里有一条 `running` 的演示任务（D-26），而它在**上一次
   * 进程退出时**就存在了 —— 没有这一步，那条任务的车在当前进程里永远不会动，
   * 而界面上它明明显示「执行中」。从 `progress` 反推已行驶距离，续跑即可。
   */
  adoptRunningTasks(): number {
    const tasks = listRunningTasks(this.db);
    let adopted = 0;
    for (const task of tasks) {
      if (this.running.has(task.id)) {
        continue;
      }
      const vehicle = findVehicleById(this.db, task.assigned_vehicle_id);
      if (!vehicle) {
        continue;
      }
      const execution = this.buildExecution(
        task.id,
        task.assigned_vehicle_id,
        vehicle.maxSpeedMps,
        task.cargo_kg,
        task.progress
      );
      if (!execution) {
        continue;
      }
      this.running.set(task.id, execution);
      adopted += 1;
    }
    return adopted;
  }

  /** 折线 + 起始进度 → 可推进的执行体；路线或坐标缺失时返回 `null`（调用方决定报什么错）。 */
  private buildExecution(
    taskId: string,
    vehicleId: string,
    speedMps: number,
    cargoKg: number,
    progress: number
  ): RunningExecution | null {
    const route = findExecutionRoute(this.db, taskId);
    if (!route || route.nodeIds.length < 2) {
      return null;
    }
    const positions = nodePositions(this.db, route.nodeIds);
    const points = route.nodeIds
      .map((nodeId) => {
        const position = positions.get(nodeId);
        return position ? { x: position.x, y: position.y, nodeId } : null;
      })
      .filter((point): point is { x: number; y: number; nodeId: string } => point !== null);
    if (points.length < 2) {
      return null;
    }
    const segmentLengths: number[] = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      segmentLengths.push(distance(points[index]!, points[index + 1]!));
    }
    const totalM = segmentLengths.reduce((sum, value) => sum + value, 0);
    return {
      taskId,
      vehicleId,
      routeId: route.routeId,
      points,
      segmentLengths,
      totalM,
      travelledM: Math.max(0, Math.min(1, progress)) * totalM,
      speedMps: Math.max(0.1, speedMps),
      cargoKg,
      startedAt: nowIso()
    };
  }

  /**
   * 手动接管（`docs/api.md` §3.7.4）。
   *
   * 两件事必须同时发生：任务停下来（`running → paused`，或本来就是 `assigned`
   * 时不动状态）、落一条带建议的告警。只做前者会留下「车停了但没人知道为什么」，
   * 只做后者会让车继续跑而告警说它停了。
   */
  takeover(actor: AuditContext | null, taskId: string, payload: Record<string, unknown>): TakeoverResult {
    const ctx = this.context(actor);
    const task = findTaskRowById(this.db, taskId);
    if (!task) {
      throw new DomainError('TASK.NOT_FOUND', undefined, { id: taskId });
    }
    if (task.status !== 'running' && task.status !== 'assigned') {
      throw new DomainError('TASK.STATE_CONFLICT', `当前状态 ${task.status} 不能接管（只允许 running / assigned）`, {
        id: taskId,
        from: task.status,
        expected: ['running', 'assigned']
      });
    }
    const rawType = payload['alertType'];
    const alertType: AlertType =
      rawType === 'task_timeout' || rawType === 'route_blocked' || rawType === 'task_failed' ? rawType : 'task_timeout';
    const note = typeof payload['note'] === 'string' && payload['note'].trim().length > 0 ? payload['note'].trim() : null;

    if (task.status === 'running') {
      // 先停推进再改状态：反过来的话，状态已是 paused 而内存里还在跑，
      // 下一次 tick 会把进度写回一个「暂停中」的任务（并可能把它推成 finished）
      this.running.delete(taskId);
      operateTask(ctx, taskId, 'pause', { reason: note ?? '人工接管暂停' });
      const at = nowIso();
      tx(this.db, () => {
        updateVehicleTelemetry(this.db, task.assigned_vehicle_id!, { status: 'reserved' }, at);
      });
    }

    const alert = createAlert(ctx, {
      type: alertType,
      level: 'warning',
      objectType: 'task',
      objectId: taskId,
      message: note ? `人工接管：${note}` : `人工接管任务 ${task.code}`,
      detail: {
        taskCode: task.code,
        status: task.status,
        vehicleId: task.assigned_vehicle_id,
        nextSteps: ALERT_NEXT_STEPS[alertType]
      },
      dedupeKey: `takeover:${taskId}`
    });
    writeAudit(this.db, toAuditActor(actor), {
      module: 'execution',
      action: 'takeover',
      objectType: 'task',
      objectId: taskId,
      message: note ?? undefined,
      after: { alertId: alert.id, alertType }
    });

    this.bus.emit('alert.created', { alertId: alert.id, taskId, type: alertType }, { type: 'alert', id: alert.id });
    this.emitChange(taskId, task.assigned_vehicle_id, 'execution.takeover', Number(task.progress ?? 0));
    return { taskId, alertId: alert.id, nextSteps: ALERT_NEXT_STEPS[alertType] };
  }

  /**
   * 推进一帧。**公开且不读系统时间**：单测可以直接连调 N 次得到确定结果。
   *
   * 每帧对每条执行体做四件事：算新位置 → 写遥测与采样 → 发事件 → 到位则收尾。
   * 任务若已被别人改状态（取消 / 暂停 / 转派），本帧**丢弃**它并且不再推进 ——
   * 内存里的执行状态是缓存，数据库才是真相。
   */
  tick(): TickResult {
    const advanced: string[] = [];
    const finished: string[] = [];
    const dropped: string[] = [];
    for (const [taskId, execution] of [...this.running.entries()]) {
      const task = findTaskRowById(this.db, taskId);
      if (!task || task.status !== 'running') {
        this.running.delete(taskId);
        dropped.push(taskId);
        continue;
      }
      const stepM = execution.speedMps * (this.tickMs / 1000) * this.speedFactor;
      execution.travelledM = Math.min(execution.totalM, execution.travelledM + stepM);
      const progress = execution.totalM === 0 ? 1 : execution.travelledM / execution.totalM;
      const position = positionAt(execution, execution.travelledM);
      const at = nowIso();
      const batteryBefore = Number(findVehicleById(this.db, execution.vehicleId)?.battery ?? 100);
      const battery = Math.max(0, batteryBefore - stepM * BATTERY_PERCENT_PER_M);
      const done = execution.travelledM >= execution.totalM;

      tx(this.db, () => {
        updateVehicleTelemetry(
          this.db,
          execution.vehicleId,
          {
            x: position.x,
            y: position.y,
            battery,
            currentNodeId: position.nodeId,
            heartbeat: true,
            ...(done ? { status: 'idle' as const, loadKg: 0 } : {})
          },
          at
        );
        updateTaskProgress(this.db, taskId, Number(progress.toFixed(6)), at);
        insertTrack(this.db, {
          id: randomUUID(),
          vehicleId: execution.vehicleId,
          ts: at,
          x: position.x,
          y: position.y,
          status: done ? 'finished' : 'running',
          speedMps: done ? 0 : execution.speedMps,
          taskId
        });
      });

      if (done) {
        this.running.delete(taskId);
        // 状态迁移放在遥测之后：`complete` 只允许从 `running` 出发，
        // 而此刻数据库里它还是 `running`（本帧只写了遥测与进度）
        operateTask(this.context(null), taskId, 'complete', {});
        finished.push(taskId);
        this.emitChange(taskId, execution.vehicleId, 'execution.finished', 1);
      } else {
        advanced.push(taskId);
        this.emitChange(taskId, execution.vehicleId, 'execution.progress', Number(progress.toFixed(6)));
      }
    }
    return { advanced, finished, dropped };
  }

  /** 启动定时推进（幂等：重复调用不会挂出第二个定时器）。 */
  startTimer(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        // 定时器里抛出的异常会变成 unhandled rejection 并可能带走进程；
        // 这里退化成一条日志：下一帧仍会重试，比整个应用挂掉好
        console.error('[udm] executor tick failed', error);
      }
    }, this.tickMs);
    // Electron 主进程不该因为一个定时器而拒绝退出
    this.timer.unref?.();
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private emitChange(taskId: string, vehicleId: string | null, reason: string, progress: number): void {
    this.bus.emit('task.changed', { taskId, reason, progress });
    if (vehicleId) {
      this.bus.emit('vehicle.changed', { vehicleId, taskId, reason, progress });
    }
    this.bus.emit('execution.progress', { taskId, vehicleId, progress, reason });
  }
}

/**
 * 执行器启动时要在内存里重建的「正在跑」任务（`adoptRunningTasks` 的查询）。
 *
 * 只认 `running`：`assigned`（已派发未开始）与 `paused`（已暂停）都不该自己动起来 ——
 * 前者要等人工点「开始执行」，后者要等人工恢复。
 */
export function listRunningTasks(
  db: Db
): Array<{ id: string; assigned_vehicle_id: string; progress: number; cargo_kg: number }> {
  return all<{ id: string; assigned_vehicle_id: string; progress: number; cargo_kg: number }>(
    db,
    `SELECT id, assigned_vehicle_id, progress, cargo_kg FROM tasks
     WHERE status = 'running' AND assigned_vehicle_id IS NOT NULL`
  );
}
