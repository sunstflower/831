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
import type { AlertAction, AlertStatus, AlertType } from '@udm/shared';
import { alertActionsOf } from '@udm/shared';

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
