/**
 * 任务模板仓库（M2，`GET /api/task-templates`）。
 *
 * 与另外四个仓库最不同的一点：它**没有 `status` 列、没有启停、没有删除**。
 * 这不是漏了 —— 契约（`docs/api.md` §3.2.6）就只有 `GET/POST/PUT` 三条。
 * 模板是「填任务的草稿纸」，被任务引用后（`tasks.template_id`）删掉它会让历史任务
 * 失去来源说明；而在 DDL 里补一个 status 列属于结构变更，得先改 `docs/database.md`
 * 并走一个新迁移。当前先按「可编辑、不可删」落地。
 *
 * 投影成 DTO 的理由与 `site.repo.ts` 相同：驼峰字段与可空语义紧挨着产生它们的 SQL。
 * 本层不做业务判断（编码唯一性、站点类型合法性属于领域服务）。
 */
import type { SiteType, TaskPriority, TaskTemplateListItem } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

interface TemplateRow {
  id: string;
  code: string;
  name: string;
  priority: TaskPriority;
  default_cargo_kg: number | null;
  time_window_minutes: number | null;
  from_site_type: SiteType | null;
  to_site_type: SiteType | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

function toTemplate(row: TemplateRow): TaskTemplateListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priority: row.priority,
    defaultCargoKg: row.default_cargo_kg,
    timeWindowMinutes: row.time_window_minutes,
    fromSiteType: row.from_site_type,
    toSiteType: row.to_site_type,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface TemplateListQuery {
  keyword?: string;
  page: number;
  pageSize: number;
}

export function listTemplates(db: Db, query: TemplateListQuery): { records: TaskTemplateListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.keyword) {
    // 与站点/车辆同口径：编码与名称都参与匹配（使用者记的是 `TPL-01` 还是「A 仓到 B 仓」事先不知道）
    clauses.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM task_templates ${where}`, params)?.total ?? 0);
  const offset = (query.page - 1) * query.pageSize;
  // 排序固定为 `code`：分页接口必须有稳定顺序，否则同一行可能在两页里重复出现
  const rows = all<TemplateRow>(
    db,
    `SELECT * FROM task_templates ${where} ORDER BY code ASC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset]
  );
  return { records: rows.map(toTemplate), total };
}

export function findTemplateById(db: Db, id: string): TaskTemplateListItem | undefined {
  const row = get<TemplateRow>(db, 'SELECT * FROM task_templates WHERE id = ?', [id]);
  return row ? toTemplate(row) : undefined;
}

/** 编码唯一性检查用（领域服务的 `ensureCodeFree` 走它）。 */
export function findTemplateByCode(db: Db, code: string): TaskTemplateListItem | undefined {
  const row = get<TemplateRow>(db, 'SELECT * FROM task_templates WHERE code = ?', [code]);
  return row ? toTemplate(row) : undefined;
}

/*
 * ---- 写入 ----
 *
 * 逐列传参而不是收一个对象：加了列忘了传参会在编译期报错
 * （`site.repo.ts` 的同类说明），而 `Record<string, unknown>` 展开会静默漏列。
 */

export interface TemplateWriteRow {
  id: string;
  code: string;
  name: string;
  priority: TaskPriority;
  defaultCargoKg: number | null;
  timeWindowMinutes: number | null;
  fromSiteType: SiteType | null;
  toSiteType: SiteType | null;
  remark: string | null;
  at: string;
}

export function insertTemplate(db: Db, row: TemplateWriteRow): void {
  run(
    db,
    `INSERT INTO task_templates
       (id, code, name, priority, default_cargo_kg, time_window_minutes, from_site_type, to_site_type, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.code,
      row.name,
      row.priority,
      row.defaultCargoKg,
      row.timeWindowMinutes,
      row.fromSiteType,
      row.toSiteType,
      row.remark,
      row.at,
      row.at
    ]
  );
}

/** 更新模板：`code` 不在可改列里（契约与 `validateTemplateInput` 都已拦住）。 */
export function updateTemplateRow(
  db: Db,
  id: string,
  patch: {
    name?: string;
    priority?: TaskPriority;
    defaultCargoKg?: number | null;
    timeWindowMinutes?: number | null;
    fromSiteType?: SiteType | null;
    toSiteType?: SiteType | null;
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
  if (patch.priority !== undefined) {
    assignments.push('priority = ?');
    params.push(patch.priority);
  }
  if (patch.defaultCargoKg !== undefined) {
    assignments.push('default_cargo_kg = ?');
    params.push(patch.defaultCargoKg);
  }
  if (patch.timeWindowMinutes !== undefined) {
    assignments.push('time_window_minutes = ?');
    params.push(patch.timeWindowMinutes);
  }
  if (patch.fromSiteType !== undefined) {
    assignments.push('from_site_type = ?');
    params.push(patch.fromSiteType);
  }
  if (patch.toSiteType !== undefined) {
    assignments.push('to_site_type = ?');
    params.push(patch.toSiteType);
  }
  if (patch.remark !== undefined) {
    assignments.push('remark = ?');
    params.push(patch.remark);
  }
  // 空补丁也执行：只有 `updated_at` 变（与其它仓库同口径）
  run(db, `UPDATE task_templates SET ${assignments.length > 0 ? `${assignments.join(', ')}, ` : ''}updated_at = ? WHERE id = ?`, [...params, at, id]);
}
