/**
 * 任务页（M3）的**表格模型**：列定义、筛选器、查询状态。
 *
 * 与 `base/model.ts` 同一分工：列怎么显示、筛选怎么拼，都写在纯函数 + 常量里，
 * 组件只负责排版 —— 于是「状态显示成什么颜色」「时间窗怎么念」这些口径可以完整单测，
 * 而不是靠肉眼在一段 JSX 里读出来。
 *
 * **边界**：本文件不定义数据（形状由 `@udm/shared` 的 `TaskListItem` 决定）、
 * 不发请求、不做权限判断。载荷字段名必须与 `docs/api.md` §3.3.1 一字不差。
 */
import { TASK_PRIORITIES, TASK_STATUSES, type TaskListItem, type TaskStatus } from '@udm/shared';
import { formatNumber, timeWindowText } from '../domain/format';
import { TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, labelOf } from '../domain/labels';
import { column, text, type Column } from '../domain/table';
import { TASK_STATUS_TONE, badgeToneClass, toneClass } from '../domain/tone';

/** 状态徽标：颜色与文案都来自共享的展示口径（`domain/tone.ts` / `domain/labels.ts`）。 */
function statusBadge(status: TaskStatus) {
  return (
    <span className={`udm-badge ${badgeToneClass(TASK_STATUS_TONE[status])}`}>
      {labelOf(TASK_STATUS_LABEL, status)}
    </span>
  );
}

/**
 * 进度条。
 *
 * 未派发的任务进度恒为 0，这里仍然照实画一条空进度条而不是显示 `—`：
 * 「还没开始」与「进度未知」在契约里是同一个值（`progress: 0`），
 * 界面替使用者区分它们就等于编造了一个契约里没有的状态。
 */
function progressCell(row: TaskListItem) {
  const percent = Math.round(row.progress * 100);
  return (
    <span className="udm-task__progress">
      <span className={`udm-progress ${toneClass(TASK_STATUS_TONE[row.status], 'udm-progress--')}`}>
        <span className="udm-progress__fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="udm-task__percent">{percent}%</span>
    </span>
  );
}

/**
 * 列定义（顺序即表格里的顺序）。
 *
 * 把「编码」放在第一列而不是标题：任务编码是**人对任务的称呼**（`T20260926-0001`），
 * 调度沟通里说的就是它；标题是一句话，放第二列并在宽度不够时先被截断。
 */
export const TASK_COLUMNS: Array<Column<TaskListItem>> = [
  column<TaskListItem>('code', '任务编码'),
  column<TaskListItem>('title', '标题'),
  column<TaskListItem>('status', '状态', { cell: (row) => statusBadge(row.status) }),
  column<TaskListItem>('priority', '优先级', { cell: (row) => labelOf(TASK_PRIORITY_LABEL, row.priority) }),
  column<TaskListItem>('cargoKg', '载重 (kg)', { align: 'right', cell: (row) => formatNumber(row.cargoKg) }),
  // 起终点合成一列：它们总是一起读（「A 仓库 → B 月台」），拆两列反而要来回看
  column<TaskListItem>('fromSiteName', '起终点', {
    cell: (row) => `${text(row.fromSiteName)} → ${text(row.toSiteName)}`
  }),
  column<TaskListItem>('timeWindowStart', '时间窗', {
    cell: (row) => timeWindowText(row.timeWindowStart, row.timeWindowEnd)
  }),
  column<TaskListItem>('vehicleCode', '执行车辆', { cell: (row) => text(row.vehicleCode) }),
  column<TaskListItem>('progress', '进度', { cell: (row) => progressCell(row) })
];

/**
 * 状态筛选。
 *
 * 「进行中（未结束）」是一个**多值筛选项**（`status=draft,pending,assigned,running,paused`）：
 * 契约允许逗号组合，而使用者真正想找的通常不是某一个状态，而是「还没结束的那批」。
 * 不给出多个并列的下拉，是因为那需要一次发多个请求再合并 —— 每页各算各的，
 * 翻页时会漏行（这也是契约选择逗号多值的原因，见 `docs/api.md` §3.3.1）。
 */
export const UNFINISHED_STATUSES: TaskStatus[] = ['draft', 'pending', 'assigned', 'running', 'paused'];

export const TASK_STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: UNFINISHED_STATUSES.join(','), label: '进行中（未结束）' },
  ...TASK_STATUSES.map((status) => ({ value: status as string, label: labelOf(TASK_STATUS_LABEL, status) }))
];

/** 优先级筛选（空值 = 不筛选）。 */
export const TASK_PRIORITY_FILTERS: Array<{ value: string; label: string }> = TASK_PRIORITIES.map((priority) => ({
  value: priority,
  label: labelOf(TASK_PRIORITY_LABEL, priority)
}));

/** 页面上的查询状态。 */
export interface ListQuery {
  page: number;
  pageSize: number;
  keyword: string;
  /** 单个状态或逗号组合（与「进行中」那一项对应）。 */
  status: string;
  priority: string;
  vehicleId: string;
}

export const EMPTY_QUERY: ListQuery = { page: 1, pageSize: 20, keyword: '', status: '', priority: '', vehicleId: '' };

/** 把查询状态翻译成接口载荷：空值一律**不发**（主进程把它当「未给筛选」，见 D-40）。 */
export function buildPayload(query: ListQuery): Record<string, unknown> {
  const payload: Record<string, unknown> = { page: query.page, pageSize: query.pageSize };
  if (query.keyword.trim()) {
    payload.keyword = query.keyword.trim();
  }
  if (query.status) {
    // 逗号组合**原样**发送：解析在服务端（`parseTaskStatusFilter`），前端不拆成数组 ——
    // 契约的参数形态就是字符串，前端换个形态等于偷偷定义第二套参数
    payload.status = query.status;
  }
  if (query.priority) {
    payload.priority = query.priority;
  }
  if (query.vehicleId) {
    payload.vehicleId = query.vehicleId;
  }
  return payload;
}

/** 车辆筛选的候选项（执行车辆下拉）。 */
export function vehicleOptionsOf(
  vehicles: Array<{ id: string; code: string; name: string }>
): Array<{ value: string; label: string }> {
  return vehicles.map((vehicle) => ({ value: vehicle.id, label: `${vehicle.code} · ${vehicle.name}` }));
}
