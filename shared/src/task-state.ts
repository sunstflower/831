/**
 * 任务**状态机**（M3，`design.md` §4.3 的迁移表是设计来源，本文件是代码侧唯一作者）。
 *
 * ## 为什么状态机放在 `shared` 且放在 M3 之外也要用
 *
 * 任务的每一条迁移会被**三个模块**触发，分布在两个进程里：
 *   - M3（任务管理）——`submit` / `pause` / `resume` / `cancel` / `requeue` / `reassign` / `delete`；
 *   - M4（调度引擎）——`assign`（apply 或手动指派把 `pending` 推到 `assigned`）；
 *   - M7（执行）——`start` / `complete` / `fail`（执行器推进）。
 *
 * 若每个模块各判一次「这个状态能不能那样改」，三处的判据迟早分叉，
 * 而分叉的后果是**数据进入一个没有任何模块认可的状态**：例如 M7 允许
 * `paused → failed`（设计里没有这条边），于是任务停在一个后面谁也处理不了的位置。
 * 这正是 D-33（错误码只改一处）与 D-34（每个事实只有一个作者）同一个原则的又一次应用。
 *
 * 浏览器 Mock 也调用本文件，因此状态机的行为在「无 SQLite」时与主进程逐条一致（由
 * `renderer/src/api/mock-parity.test.ts` 的成套用例守住）。
 *
 * ## 三个容易写错的地方（都在这里钉死）
 *
 *   1. **`reassign` 的终点是 `pending` 而不是 `assigned`**：重派要先回收车辆、
 *      把原计划置 `superseded`，任务回到候选池等下一次调度（`docs/api.md` §3.3.6）；
 *   2. **`delete` 只有 `draft`**：其余状态一律走 `cancel`（软删，留痕）。
 *      设计 §4.3 的表格行里写过「draft / pending」，但同一行的说明是
 *      「仅草稿可物理删除」——两者冲突时以**说明**为准，因为契约（§3.3.6）也这么写；
 *   3. **`finished` / `cancelled` 是终态**：没有任何出边。给终态开出边（哪怕是「重开」）
 *      会让「任务已完成」这件事失去意义；需要新任务就再建一条。
 *
 * 本文件是**纯函数 + 常量**：不读时间、不碰数据库、不抛异常（返回结果对象，
 * 由领域层决定抛哪个 `DomainError`）——与 `base-rules.ts` 的口径一致。
 */
import type { TaskStatus } from './enums.js';

/** 状态机里全部迁移动作。**顺序即 UI 上的推荐顺序**（先正向、后风险动作）。 */
export const TASK_ACTIONS = [
  'submit',
  'assign',
  'start',
  'pause',
  'resume',
  'complete',
  'fail',
  'cancel',
  'requeue',
  'reassign',
  'delete'
] as const;

export type TaskAction = (typeof TASK_ACTIONS)[number];

/**
 * 谁可以触发这条迁移。
 *
 * 这个字段不是注释：`docs/api.md` §3.3.6 只把 `trigger === 'task-api'` 的动作
 * 暴露成 `POST /api/tasks/{id}/…`，其余（`assign` / `start` / `complete` / `fail`）
 * 各有自己的调用点（M4 的 apply、M7 的执行推进）。**不给内部迁移开 HTTP 入口**，
 * 否则使用者可以手工把任务标成「执行中」，而执行器并不知情。
 */
export type TransitionTrigger = 'task-api' | 'dispatch' | 'executor';

export interface TaskTransition {
  action: TaskAction;
  /** 允许的**源状态**（多条边共用同一个动作时列多个，如 `complete` 与 `cancel`）。 */
  from: readonly TaskStatus[];
  /** 目标状态；`null` 表示**移出任务表**（只有物理删除）。 */
  to: TaskStatus | null;
  /** 是否必须给出原因（`design.md` §4.3 的「必须传原因」）。 */
  requiresReason: boolean;
  trigger: TransitionTrigger;
  /** 一句话说明这条迁移做什么（UI 提示与错误文案共用，避免两处各写一份）。 */
  summary: string;
}

/**
 * 全部迁移（`design.md` §4.3 的 mermaid 与迁移表的逐条落地）。
 *
 * `Record` 而非数组：少写一条边会**编译期报错**（缺 key），
 * 而数组少一条只会表现为「某个动作永远返回冲突」，要到使用时才发现。
 */
export const TASK_TRANSITIONS: Record<TaskAction, TaskTransition> = {
  submit: {
    action: 'submit',
    from: ['draft'],
    to: 'pending',
    requiresReason: false,
    trigger: 'task-api',
    summary: '提交进候选池，等待调度'
  },
  assign: {
    action: 'assign',
    from: ['pending'],
    to: 'assigned',
    requiresReason: false,
    trigger: 'dispatch',
    summary: '派发车辆并生成计划、路线（由调度 apply / 手动指派触发）'
  },
  start: {
    action: 'start',
    from: ['assigned'],
    to: 'running',
    requiresReason: false,
    trigger: 'executor',
    summary: '车辆到起点、开始执行（由执行器触发）'
  },
  pause: {
    action: 'pause',
    from: ['running'],
    to: 'paused',
    requiresReason: true,
    trigger: 'task-api',
    summary: '暂停执行，写暂停原因'
  },
  resume: {
    action: 'resume',
    from: ['paused'],
    to: 'running',
    requiresReason: false,
    trigger: 'task-api',
    summary: '继续执行'
  },
  complete: {
    action: 'complete',
    from: ['assigned', 'running'],
    to: 'finished',
    requiresReason: false,
    trigger: 'executor',
    summary: '到达终点并完成卸货（由执行器触发）'
  },
  fail: {
    action: 'fail',
    from: ['assigned', 'running'],
    to: 'failed',
    requiresReason: true,
    trigger: 'executor',
    summary: '执行器或车辆异常（由执行器触发）'
  },
  cancel: {
    action: 'cancel',
    from: ['pending', 'assigned', 'running', 'paused'],
    to: 'cancelled',
    requiresReason: true,
    trigger: 'task-api',
    summary: '取消任务；已派发的先回收车辆'
  },
  requeue: {
    action: 'requeue',
    from: ['failed'],
    to: 'pending',
    requiresReason: true,
    trigger: 'task-api',
    summary: '重新进入候选池'
  },
  reassign: {
    action: 'reassign',
    from: ['assigned', 'running', 'paused'],
    to: 'pending',
    requiresReason: true,
    trigger: 'task-api',
    summary: '改派：原计划置 superseded、回收车辆，任务回到候选池'
  },
  delete: {
    action: 'delete',
    from: ['draft'],
    to: null,
    requiresReason: false,
    trigger: 'task-api',
    summary: '物理删除草稿'
  }
};

/**
 * 可以通过状态操作接口触发的动作（`docs/api.md` §3.3.6 的六个 + 删除）。
 *
 * 派生自 `TASK_TRANSITIONS`，**不另写一份清单**：手工维护的第二份清单
 * 会在新增动作时漏改，而漏改的表现是「接口存在但状态机不认」。
 */
export const TASK_API_ACTIONS: readonly TaskAction[] = (
  Object.values(TASK_TRANSITIONS) as TaskTransition[]
)
  .filter((transition) => transition.trigger === 'task-api')
  .map((transition) => transition.action);

/**
 * 可以直接编辑字段的状态（Req-M3-3：「已派发的任务不要直接改，走重派 / 取消」）。
 *
 * 为什么放在这里而不是各写一份：这条规则同时被**三处**用到 ——
 * 主进程领域服务（`desktop/src/domain/task/task.service.ts`）、
 * 浏览器 Mock（`renderer/src/api/mock-tasks.ts`）与任务页（决定「编辑」按钮渲不渲染）。
 * 三处各写一个数组时，界面上能点进去的状态与服务端放行的状态迟早不一致，
 * 而那种不一致的表现是「按钮点了报错」或「能改但服务端拒绝」。
 *
 * 判据是**有没有派发痕迹**：`assigned` 之后任务已经绑了车辆与计划，
 * 改起终点等于让执行中的车开去别处 —— 那是重派（`reassign`）的语义，不是编辑。
 */
export const TASK_EDITABLE_STATUSES: readonly TaskStatus[] = ['draft', 'pending', 'failed'];

/** 由字符串判定是不是一个已登记的动作（传输层用它拦掉拼错的路径段）。 */
export function isTaskAction(value: unknown): value is TaskAction {
  return typeof value === 'string' && (TASK_ACTIONS as readonly string[]).includes(value);
}

/** 该动作是否允许从 `from` 出发（纯判定，不产生文案）。 */
export function canRun(action: TaskAction, from: TaskStatus): boolean {
  return TASK_TRANSITIONS[action].from.includes(from);
}

export interface TaskTransitionFailure {
  action: TaskAction;
  /** 请求时的**实际**状态。 */
  from: TaskStatus;
  /** 该动作**允许**的源状态（用于告诉调用方「期望什么」）。 */
  expected: readonly TaskStatus[];
  to: TaskStatus | null;
  message: string;
}

export type TransitionCheck =
  | { ok: true; transition: TaskTransition }
  | { ok: false; failure: TaskTransitionFailure };

/**
 * 判定一次迁移是否合法，失败时给出**可引导**的说明。
 *
 * 文案里同时出现「当前状态」与「期望状态」：`design.md` §4.3 的验收口径就是
 * 「非法迁移被拒绝且 detail 说明当前状态与期望状态」。只有一句
 * 「当前状态不允许执行该操作」会让使用者不知道下一步该做什么
 * （任务在 `draft` 时点「暂停」应该提示先提交，而不是只说不行）。
 */
export function checkTaskTransition(action: TaskAction, from: TaskStatus): TransitionCheck {
  const transition = TASK_TRANSITIONS[action];
  if (transition.from.includes(from)) {
    return { ok: true, transition };
  }
  const expected = transition.from.join(' / ');
  return {
    ok: false,
    failure: {
      action,
      from,
      expected: transition.from,
      to: transition.to,
      message: `当前状态 ${from} 不能执行 ${action}（该动作只允许在 ${expected} 时执行）`
    }
  };
}

/**
 * 某个状态下**可执行**的状态操作（UI 据此决定渲染哪些按钮）。
 *
 * 只列 `task-api` 的动作：`assign` / `start` / `complete` / `fail` 由其它模块触发，
 * 把它们显示成按钮等于给使用者一个点了会 404（或更糟：绕过执行器）的入口。
 */
export function taskActionsOf(from: TaskStatus): TaskAction[] {
  return TASK_API_ACTIONS.filter((action) => canRun(action, from));
}

/** 目标的展示名：物理删除没有目标状态，用 `(删除)` 而不是空白。 */
export function transitionTargetText(transition: TaskTransition): string {
  return transition.to ?? '(删除)';
}
