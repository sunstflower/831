/**
 * 车辆领域服务（M2，`docs/api.md` §3.2.2）。
 *
 * ## 本服务拥有 `idle` / `disabled` / `fault` 三个端点
 *
 * 车辆的七个状态里，`reserved` / `busy` 由调度占用（M4）、`charging` / `offline`
 * 由执行器与心跳维护（M7，`docs/module-M2-base-data.md` §6.1）。管理接口能改的只有三个：
 * 停用（`→ disabled`）、启用（`→ idle`）与**人工报障**（`→ fault`）。
 *
 * 为什么需要 `fault` 这一端：执行器判故障（心跳超时 / 电量耗尽）是 M7 的事，但
 * 「这车坏了」常常是现场先知道的事 —— 没有手动入口，就只能在「什么都不能做」与
 * 「停用（软删，语义更重且不能停在已派发的车上）」之间二选一。见 `AGENTS.md` D-62。
 *
 * 为什么启用时目标状态**固定**是 `idle` 而不是「恢复成停用前的状态」：
 * 「停用前是什么状态」这件事没有被保存过（`status` 是单列、不是历史）。
 * 若去猜，一辆因故障停用的车会在启用后直接被派活；固定为 `idle` 至少是安全的 ——
 * 它只是「可被调度」的候选，真正的可用性由调度约束再筛一遍。
 */
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  MANAGED_VEHICLE_STATUSES,
  vehicleStatusConflictOf,
  validateVehicleInput,
  type VehicleStatus
} from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import { findNodeById } from '../../db/repositories/graph.repo.js';
import {
  insertVehicle,
  setVehicleStatus as setVehicleStatusRow,
  updateVehicleRow,
  findVehicleById
} from '../../db/repositories/vehicle.repo.js';
import { writeAudit } from '../../services/audit.js';
import { BASE_ACTIONS, toAuditActor, type CrudContext } from './context.js';
import { ensureCodeFree, ensureNodeExists, invalid } from './validate.js';

export interface VehicleWriteOptions {
  traceId?: string;
}

function requireVehicle(db: CrudContext['db'], id: string) {
  const vehicle = findVehicleById(db, id);
  if (!vehicle) {
    throw new DomainError('VEHICLE.NOT_FOUND', undefined, { id });
  }
  return vehicle;
}

/**
 * 车辆坐标：优先用请求里给的，其次**跟随所在节点**，最后才是 `(0, 0)`。
 *
 * 与站点的 `resolveXY` 同一口径（`site.service.ts`）：车停在某个节点上时，
 * 它的位置**本来就等于**那个节点的位置，要求调用方把同一个坐标抄两遍
 * 只会制造「两处坐标不一致」的机会。
 *
 * 与站点不同的一处：车辆所在节点**不**在读取时派生。节点只是「停在哪」的声明，
 * 坐标才是地图上画的点；显式存下来，改节点时才能看出「坐标是否跟着改过」。
 */
function resolveVehicleXY(
  db: CrudContext['db'],
  input: { x: number | null; y: number | null; currentNodeId: string | null }
): { x: number; y: number } {
  const node = input.currentNodeId ? findNodeById(db, input.currentNodeId) : undefined;
  return { x: input.x ?? node?.x ?? 0, y: input.y ?? node?.y ?? 0 };
}

export function createVehicle(ctx: CrudContext, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const parsed = validateVehicleInput(raw, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureCodeFree(ctx.db, 'vehicle', input.code);
    if (input.currentNodeId) {
      ensureNodeExists(ctx.db, input.currentNodeId, 'currentNodeId');
    }
    const { x, y } = resolveVehicleXY(ctx.db, input);
    const at = nowIso();
    const id = randomUUID();
    insertVehicle(ctx.db, {
      id,
      code: input.code,
      name: input.name,
      type: input.type,
      capacityKg: input.capacityKg,
      maxSpeedMps: input.maxSpeedMps,
      x,
      y,
      currentNodeId: input.currentNodeId,
      battery: input.battery,
      remark: input.remark,
      at
    });
    const created = requireVehicle(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.create,
      objectType: 'vehicle',
      objectId: id,
      after: created
    });
    return created;
  });
}

export function updateVehicle(
  ctx: CrudContext,
  id: string,
  raw: Record<string, unknown>,
) {
  return tx(ctx.db, () => {
    const before = requireVehicle(ctx.db, id);
    const parsed = validateVehicleInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const patch = { ...parsed.value };
    if (patch.currentNodeId) {
      ensureNodeExists(ctx.db, patch.currentNodeId, 'currentNodeId');
    }
    /*
     * 只给了节点、没给坐标时，坐标跟着节点走 —— 否则会留下一辆
     * 「所在节点是 N13、坐标却在老位置」的车，地图上它并不在 N13 上。
     * 反过来（只给坐标不给节点）**不动** `currentNodeId`：那可能是使用者
     * 想把车挪到路网中间，此时已有节点仍然是它最后一次被声明的停靠点。
     */
    if (patch.currentNodeId !== undefined && patch.x === undefined && patch.y === undefined) {
      const node = patch.currentNodeId ? findNodeById(ctx.db, patch.currentNodeId) : undefined;
      if (node) {
        patch.x = node.x;
        patch.y = node.y;
      }
    }
    const at = nowIso();
    updateVehicleRow(ctx.db, id, patch, at);
    const after = requireVehicle(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.update,
      objectType: 'vehicle',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

export function setVehicleStatus(
  ctx: CrudContext,
  id: string,
  status: VehicleStatus,
) {
  return tx(ctx.db, () => {
    const before = requireVehicle(ctx.db, id);
    // 目标状态必须在白名单里 —— 这是「不是所有枚举值都能从这个接口改」的第一道闸
    if (!(MANAGED_VEHICLE_STATUSES as readonly string[]).includes(status)) {
      throw invalid({
        status: `管理接口只能设置为 ${MANAGED_VEHICLE_STATUSES.join(' / ')}；运行态由执行器维护`
      });
    }
    if (before.status === status) {
      // 幂等：已是目标状态就直接返回，不写审计。否则「重复点两次停用」会在审计里
      // 留下两条 disable，之后按审计追溯「谁停用了它」时会看到重复记录
      return before;
    }
    // 冲突判定（唯一作者在 `shared/src/base-rules.ts`，Mock 适配器调同一个函数）
    const conflict = vehicleStatusConflictOf(before.status, status as (typeof MANAGED_VEHICLE_STATUSES)[number]);
    if (conflict !== null) {
      /*
       * 错误**文案保持目录里的那句话**（`VEHICLE.STATE_CONFLICT`），具体原因放 `detail.hint`：
       * `mock-parity.test.ts` 断言「同一请求两边 message 一字不差」，而 Mock 的 `fail()`
       * 只从 `ERROR_CODES` 取文案 —— 在主进程单方面加一句更具体的话，会让两边
       * 对同一个冲突说两种话（那正是该用例要防的形态）。针对性说明由
       * 渲染层的 `statusBlockedReason` 在**点之前**给出，服务端只保留可机读的原因。
       */
      throw new DomainError('VEHICLE.STATE_CONFLICT', undefined, {
        id,
        status: before.status,
        target: status,
        reason: conflict,
        hint:
          conflict === 'disableOccupied'
            ? '调度占用中（已预留 / 执行中）的车辆不能停用 —— 先取消任务或等它执行结束'
            : '车辆正在执行任务，不能直接标记故障 —— 先在调度中心接管（暂停）这单，再报障'
      });
    }
    const at = nowIso();
    setVehicleStatusRow(ctx.db, id, status, at);
    const after = requireVehicle(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: status === 'disabled' ? BASE_ACTIONS.disable : status === 'fault' ? BASE_ACTIONS.fault : BASE_ACTIONS.enable,
      objectType: 'vehicle',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

