/**
 * 车辆读取仓库（M2，`GET /api/vehicles`）。
 *
 * 与其他仓库的差别只有一处：`online` 在 SQLite 里是 `INTEGER 0/1`，投影时转成布尔。
 * 不在这里转的话，`0` 会被渲染层当成 truthy —— 一个「离线车显示在线」的静默错误。
 */
import type { VehicleListItem, VehicleStatus, VehicleType } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

interface VehicleRow {
  id: string;
  code: string;
  name: string;
  type: VehicleType;
  status: VehicleStatus;
  capacity_kg: number;
  load_kg: number;
  max_speed_mps: number;
  battery: number;
  x: number;
  y: number;
  current_node_id: string | null;
  online: number;
  last_heartbeat_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

function toVehicle(row: VehicleRow): VehicleListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    capacityKg: row.capacity_kg,
    loadKg: row.load_kg,
    maxSpeedMps: row.max_speed_mps,
    battery: row.battery,
    x: row.x,
    y: row.y,
    currentNodeId: row.current_node_id,
    online: row.online === 1,
    lastHeartbeatAt: row.last_heartbeat_at,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface VehicleListQuery {
  keyword?: string;
  status?: VehicleStatus;
  type?: VehicleType;
  page: number;
  pageSize: number;
}

export function listVehicles(db: Db, query: VehicleListQuery): { records: VehicleListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.keyword) {
    clauses.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }
  if (query.type) {
    clauses.push('type = ?');
    params.push(query.type);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM vehicles ${where}`, params)?.total ?? 0);
  const offset = (query.page - 1) * query.pageSize;
  const rows = all<VehicleRow>(
    db,
    `SELECT * FROM vehicles ${where} ORDER BY code ASC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset]
  );
  return { records: rows.map(toVehicle), total };
}

export function findVehicleById(db: Db, id: string): VehicleListItem | undefined {
  const row = get<VehicleRow>(db, 'SELECT * FROM vehicles WHERE id = ?', [id]);
  return row ? toVehicle(row) : undefined;
}

/*
 * ---- 写入（M2 写路径） ----
 *
 * 与 `site.repo.ts` 同口径：仓库只做受控写入，不判业务合法性。
 * `status` **不在这里改**：车辆的启停与运行态由 `setVehicleStatus` 单独负责，
 * 且运行态（`offline` / `fault` / `charging`）根本不经过管理接口（见 `docs/module-M2-base-data.md` §6.1）。
 */

export interface VehicleWriteRow {
  id: string;
  code: string;
  name: string;
  type: VehicleType;
  capacityKg: number;
  maxSpeedMps: number;
  x: number;
  y: number;
  /** 车辆所在节点：调度算空驶段时用它当出发点（见 `shared/src/dispatch-evaluate.ts`）。 */
  currentNodeId: string | null;
  battery: number;
  remark: string | null;
  at: string;
}

export function insertVehicle(db: Db, row: VehicleWriteRow): void {
  run(
    db,
    `INSERT INTO vehicles (id, code, name, type, status, capacity_kg, load_kg, max_speed_mps, battery, x, y, current_node_id, online, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'idle', ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    // `online = 0`：刚建档的车**还没上线**。心跳是「真实存在的通信事实」，
    // 建档时把它置 1 会让监控台显示一辆从未通信过的车「在线」（§6.1 的同一口径）
    [
      row.id, row.code, row.name, row.type, row.capacityKg, row.maxSpeedMps,
      row.battery, row.x, row.y, row.currentNodeId, row.remark, row.at, row.at
    ]
  );
}

export function updateVehicleRow(
  db: Db,
  id: string,
  patch: {
    name?: string;
    type?: VehicleType;
    capacityKg?: number;
    maxSpeedMps?: number;
    x?: number;
    y?: number;
    /** `null` 是**显式清空**（与可空列的约定一致，见 `base-rules.ts`） */
    currentNodeId?: string | null;
    battery?: number;
    remark?: string | null;
  },
  at: string
): void {
  const assignments: string[] = [];
  const params: SqlParam[] = [];
  if (patch.name !== undefined) {
    assignments.push('name = ?');
    params.push(patch.name);
  }
  if (patch.type !== undefined) {
    assignments.push('type = ?');
    params.push(patch.type);
  }
  if (patch.capacityKg !== undefined) {
    assignments.push('capacity_kg = ?');
    params.push(patch.capacityKg);
  }
  if (patch.maxSpeedMps !== undefined) {
    assignments.push('max_speed_mps = ?');
    params.push(patch.maxSpeedMps);
  }
  if (patch.x !== undefined) {
    assignments.push('x = ?');
    params.push(patch.x);
  }
  if (patch.y !== undefined) {
    assignments.push('y = ?');
    params.push(patch.y);
  }
  if (patch.currentNodeId !== undefined) {
    assignments.push('current_node_id = ?');
    params.push(patch.currentNodeId);
  }
  if (patch.battery !== undefined) {
    assignments.push('battery = ?');
    params.push(patch.battery);
  }
  if (patch.remark !== undefined) {
    assignments.push('remark = ?');
    params.push(patch.remark);
  }
  run(db, `UPDATE vehicles SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`, [...params, at, id]);
}

export function setVehicleStatus(db: Db, id: string, status: VehicleStatus, at: string): void {
  run(db, 'UPDATE vehicles SET status = ?, updated_at = ? WHERE id = ?', [status, at, id]);
}

export function findVehicleByCode(db: Db, code: string): VehicleListItem | undefined {
  const row = get<VehicleRow>(db, 'SELECT * FROM vehicles WHERE code = ?', [code]);
  return row ? toVehicle(row) : undefined;
}
