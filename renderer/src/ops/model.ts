/**
 * M1/M7/M8/M9/M10 页面的**共用纯函数**。
 *
 * 为什么合在一份而不是每页一个 `model.ts`：这几页共用同一批小工具
 * （时间格式化、字段错误提取、分页文案、告警操作的文案），
 * 各写一份就会出现「告警页修了格式、审计页没修」这种分叉（D-34）。
 *
 * **边界**：本文件不定义枚举的展示名（那是 `domain/labels.ts`），
 * 也不发请求（那是各页自己的 hook）。
 */
import type {
  AlertAction,
  AlertLevel,
  AlertStatus,
  AlertType,
  PlanAssignment,
  PlanRiskItem,
  PlanRiskKind,
  TaskStatus
} from '@udm/shared';
import { PLAN_RISK_LABELS, alertActionsOf } from '@udm/shared';
import type { Tone } from '../domain/tone';

/** 时间戳的短格式：本地时区、秒级。列表里一律用它，避免出现两种时间写法。 */
export function shortTime(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    // 库里可能有手工写入的坏值：原样显示比显示 `Invalid Date` 可诊断
    return iso;
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 字段级错误（`VALIDATION.FAILED` 的 `detail.fields`）→ 表单能直接用的映射。 */
export function fieldsOf(detail: unknown): Record<string, string> {
  if (typeof detail !== 'object' || detail === null) {
    return {};
  }
  const fields = (detail as { fields?: unknown }).fields;
  if (typeof fields !== 'object' || fields === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

/**
 * 某个告警状态下可执行的操作（UI 据此渲染按钮）。
 *
 * 直接转发 `shared` 的状态机（唯一作者）：页面里再写一遍
 * 「`new` 能确认不能关闭」就会与服务端分叉。
 */
export function actionsOf(status: AlertStatus): AlertAction[] {
  return alertActionsOf(status);
}

/**
 * 告警操作的中文名。
 *
 * `resolve` 的按钮文案是「解决」而不是「关闭」：它要求填写处置结论，
 * 叫「关闭」会让人以为可以不写原因就点掉。
 */
export const ALERT_ACTION_LABEL: Record<AlertAction, string> = {
  acknowledge: '认领',
  resolve: '解决',
  archive: '归档'
};

/** 该操作是否要求填写说明（`resolve` 必须给出处置结论）。 */
export const ALERT_ACTION_REQUIRES_NOTE: Record<AlertAction, boolean> = {
  acknowledge: false,
  resolve: true,
  archive: false
};

/** 操作成功后的一行提示文案（带上「现在的状态」，让人确认这次真的推到了那一步）。 */
export function alertActionNotice(action: AlertAction, status: AlertStatus): string {
  const target: Record<AlertStatus, string> = {
    new: '待确认',
    acknowledged: '已确认',
    processing: '处理中',
    resolved: '已解决',
    archived: '已归档'
  };
  return `已${ALERT_ACTION_LABEL[action]}：告警现在是「${target[status]}」。`;
}

/** 分页信息的一行文案（`共 N 条 · 第 x / y 页`）。 */
export function pageSummary(total: number, page: number, pageSize: number): string {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return `共 ${total} 条 · 第 ${page} / ${pages} 页`;
}

/** 告警类型的触发原因（`design.md` §4.8 的触发规则表的短标签）。 */
export const ALERT_TYPE_HINT: Record<AlertType, string> = {
  vehicle_offline: '车辆心跳超时',
  task_timeout: '任务执行超时',
  task_failed: '任务失败',
  route_blocked: '路线受阻',
  data_error: '数据异常'
};

/* ==================== M8 异常处置：停滞时长与批量认领 ==================== */

/**
 * 未终结的告警**挂了多久算久**（分钟）。
 *
 * 30 分钟是一个运营口径，不是算法常量：它决定「这一行要不要变成黄色」，
 * 因此必须是一个能一眼看懂的数，而不是某个自适应公式 —— 使用者要能解释
 * 「为什么这条是黄的」。真正要改的场合（不同级别用不同阈值）留到有实际运营数据再谈。
 */
export const ALERT_STALE_MINUTES = 30;

/** 告警是否**仍在流程里**（`resolved` / `archived` 之后才算出流程）。 */
export function isOpenAlert(status: AlertStatus): boolean {
  return status !== 'resolved' && status !== 'archived';
}

export interface AlertAge {
  open: boolean;
  minutes: number;
  /** `已 45 分钟未认领` / `已 2 小时未解决`；已终结时为 `—`。 */
  text: string;
  /** 超过 `ALERT_STALE_MINUTES` 仍未推进 → 列表里要显眼 */
  stale: boolean;
}

/** 分钟 → 人读时长（与调度页的 `durationText` 同口径：分钟以下说秒，以上说分/小时）。 */
function ageText(minutes: number): string {
  if (minutes < 1) {
    return '不到 1 分钟';
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) {
    return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} 天` : `${days} 天 ${restHours} 小时`;
}

/**
 * 一条告警「卡了多久」。
 *
 * 从 `createdAt` 起算而不是从上次状态变更起算：使用者关心的是
 * 「这条问题从出现到现在多久没被解决」，而不是「这一步用了多久」。
 * 文案随状态变化（未认领 / 未解决），因为**卡住的原因不同，该做的事也不同**。
 *
 * `nowMs` 由调用方传入而不是在这里取当前时间：这样它是纯函数，能测。
 */
export function alertAgeOf(row: { status: AlertStatus; createdAt: string }, nowMs: number): AlertAge {
  const created = Date.parse(row.createdAt);
  if (Number.isNaN(created)) {
    return { open: isOpenAlert(row.status), minutes: 0, text: '—', stale: false };
  }
  const minutes = Math.max(0, Math.floor((nowMs - created) / 60_000));
  if (!isOpenAlert(row.status)) {
    return { open: false, minutes, text: '—', stale: false };
  }
  const verb = row.status === 'new' ? '未认领' : row.status === 'acknowledged' ? '未开始处理' : '未解决';
  return {
    open: true,
    minutes,
    text: `已 ${ageText(minutes)}${verb}`,
    stale: minutes >= ALERT_STALE_MINUTES
  };
}

/**
 * 批量认领的目标：**本页里所有 `new` 的告警**。
 *
 * 为什么需要批量：异常往往是成批来的（一次断网会让一片车同时心跳超时），
 * 逐条点「认领」在真实处置里是最容易被跳过的一步 —— 而跳过认领，
 * 后面的人就看不出「这条已经有人在看了」。
 */
export function ackTargetsOf(rows: readonly { id: string; status: AlertStatus }[]): string[] {
  return rows.filter((row) => row.status === 'new').map((row) => row.id);
}

/**
 * 批量认领的结果文案。
 *
 * 必须**分开说成功与失败**：一起说「操作完成」会把「3 条被服务端拒绝」
 * 藏起来，而那 3 条正是需要人再看一眼的。
 */
export function batchAckNotice(succeeded: number, failed: number): string {
  if (succeeded === 0 && failed === 0) {
    return '本页没有待认领的告警。';
  }
  if (failed === 0) {
    return `已认领 ${succeeded} 条告警。`;
  }
  return `已认领 ${succeeded} 条，另有 ${failed} 条失败 —— 多半是状态已被他人改变，请刷新后再看。`;
}

/* ==================== M8 任务风险预检：列表与派发区块 ==================== */

/** 风险行（`GET /api/alerts/risks` 的一条 → 界面能直接渲染的一行）。 */
export interface RiskRow {
  kind: PlanRiskKind;
  /** 风险类型的中文名（唯一来源 `PLAN_RISK_LABELS`）。 */
  kindLabel: string;
  level: AlertLevel;
  message: string;
  suggestion: string;
  /** `T-DEMO-0002、T-DEMO-0007`；没有关联任务时为 `—`。 */
  tasks: string;
  /** `CAR-01`；没有关联车辆时为 `—`。 */
  vehicles: string;
  /** 供「在调度中心处理」跳转用的原始 id（`tasks` 只是展示串，跳转要真 id）。 */
  taskIds: string[];
  vehicleIds: string[];
}

export function riskRowOf(item: PlanRiskItem): RiskRow {
  return {
    kind: item.kind,
    kindLabel: PLAN_RISK_LABELS[item.kind],
    level: item.level,
    message: item.message,
    suggestion: item.suggestion,
    tasks: item.taskCodes.length > 0 ? item.taskCodes.join('、') : '—',
    vehicles: item.vehicleCodes.length > 0 ? item.vehicleCodes.join('、') : '—',
    taskIds: item.taskIds,
    vehicleIds: item.vehicleIds
  };
}

/**
 * 级别 → **色调名**（不是 CSS 类名）。
 *
 * 存色调名、由 `toneClass` / `badgeToneClass` 拼类名：直接存 `'tone-danger'`
 * 会让「色调 → 类名」的拼接规则散到每个消费点，而各家的分隔符并不统一
 * （`tone-*` 是单横线、`udm-badge--*` 是双横线）—— 那是 `tone.ts` 反复踩过的坑。
 */
export const RISK_LEVEL_TONE: Record<AlertLevel, Tone> = {
  info: 'info',
  warning: 'warn',
  critical: 'danger'
};

/**
 * 风险清单的**汇总文案**（列表头上那一行）。
 *
 * 分开说「冲突」与「超时」：这两类的处置动作完全不同（改派 vs 改时间窗 / 取消），
 * 只说「共 N 条风险」等于把唯一有行动价值的信息藏起来。
 */
export function riskSummaryOf(counts: { critical: number; warning: number; info: number }): string {
  const total = counts.critical + counts.warning + counts.info;
  if (total === 0) {
    return '没有发现冲突或超时';
  }
  const parts = [`共 ${total} 条`];
  if (counts.critical > 0) parts.push(`必须处理 ${counts.critical}`);
  if (counts.warning > 0) parts.push(`需留意 ${counts.warning}`);
  if (counts.info > 0) parts.push(`提示 ${counts.info}`);
  return parts.join(' · ');
}

/** 一辆车在这批派发里接了哪些单（界面据此渲染「任务分配派发」区块）。 */
export interface AssignmentGroup {
  vehicleId: string;
  vehicleCode: string;
  relay: boolean;
  steps: Array<{ taskId: string; taskCode: string; taskStatus: TaskStatus; beginsAt: string; doneAt: string; hasRoute: boolean }>;
}

/**
 * 按车辆分组。
 *
 * 组内、组间的顺序都**沿用服务端给的顺序**（`PlanRiskReport.assignments` 已按
 * 「车辆编码 → 开始时刻」排好）：再排一次就会出现「告警页与调度页顺序不同」，
 * 而两处说的是同一批派发。这里只做分组，不排序 —— 这正是把排序放在服务端的理由。
 */
export function assignmentGroupsOf(rows: readonly PlanAssignment[]): AssignmentGroup[] {
  const groups = new Map<string, AssignmentGroup>();
  for (const row of rows) {
    let group = groups.get(row.vehicleId);
    if (!group) {
      group = { vehicleId: row.vehicleId, vehicleCode: row.vehicleCode, relay: false, steps: [] };
      groups.set(row.vehicleId, group);
    }
    group.steps.push({
      taskId: row.taskId,
      taskCode: row.taskCode,
      taskStatus: row.taskStatus,
      beginsAt: row.occupiedFrom,
      doneAt: row.occupiedTo,
      hasRoute: row.routeId !== null
    });
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.relay = group.steps.length > 1;
  }
  return list;
}
