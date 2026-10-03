/**
 * 任务页（M3）的**状态操作模型**：某个状态下有哪几个按钮、点了会发生什么、要不要先确认。
 *
 * ## 为什么不是一串 `if (status === 'running')`
 *
 * 「这个状态能做什么」的唯一作者是 `@udm/shared` 的 `task-state.ts`（M4 / M7 也读它）。
 * 本文件**只加展示与交互信息**（按钮文案、按钮样式、副作用说明），
 * 并且在 `TASK_ACTIONS` 上取 `Record` —— 状态机新增一个动作时这里会**编译报错**，
 * 而不是安静地少显示一个按钮。
 *
 * ## 二次确认与「必须写原因」是两件事
 *
 *   - **必须写原因**来自状态机（`requiresReason`）：暂停 / 取消 / 重派 / 重新入池
 *     要在审计里说明为什么，缺了服务端会拒；
 *   - **二次确认**是交互判断：不可逆或影响在途车辆的动作（取消 / 重派 / 删除）先问一句。
 *
 * 把两者混成一个标志，就会出现「只写原因、不确认」或「确认了却没填原因」的裂缝。
 */
import { TASK_ACTION_LABEL, labelOf } from '../domain/labels';
import {
  TASK_EDITABLE_STATUSES,
  TASK_TRANSITIONS,
  taskActionsOf,
  type TaskAction,
  type TaskStatus
} from '@udm/shared';

export interface TaskActionDef {
  action: TaskAction;
  /** 按钮文案（`domain/labels.ts`，与状态机动作一一对应）。 */
  label: string;
  /** 按钮样式：不可逆的动作用危险色，其余用幽灵按钮（页面上主按钮留给「新建任务」）。 */
  style: 'ghost' | 'danger';
  /**
   * 二次确认层里的**副作用说明**。
   *
   * 必须写清「会影响什么」而不只是「确定吗」：取消会回收车辆、把已生效的计划作废，
   * 使用者若不知道这一层，就会以为取消只是改个状态，回头发现车被放了。
   */
  note: string;
  /** 是否必须填原因（来自状态机，**不在这里另写一份清单**）。 */
  reasonRequired: boolean;
}

/** 每个动作的展示信息。`Record<TaskAction, …>` 保证新增动作时编译报错。 */
const ACTION_PRESENTATION: Record<TaskAction, Omit<TaskActionDef, 'action' | 'label' | 'reasonRequired'>> = {
  submit: {
    style: 'ghost',
    note: '提交后进入候选池等待调度派车；提交前仍可自由修改。'
  },
  assign: {
    style: 'ghost',
    note: '由调度应用或手动指派触发，会把任务推进到「已派发」并生成计划与路线。'
  },
  start: {
    style: 'ghost',
    note: '由执行器触发（车辆到达起点开始作业），不手工点。'
  },
  pause: {
    style: 'ghost',
    note: '暂停会把原因记进任务与审计；车辆原地等待，不会自动返回。'
  },
  resume: {
    style: 'ghost',
    note: '继续执行，并清空暂停原因（它只属于暂停期间）。'
  },
  complete: {
    style: 'ghost',
    note: '由执行器触发（到达终点并卸货完成）。'
  },
  fail: {
    style: 'ghost',
    note: '由执行器或人工判定异常时触发，之后可「重新入池」再派。'
  },
  cancel: {
    style: 'danger',
    note: '取消会回收车辆、把已生效的计划置为已作废（superseded）；任务进入终态，不能再恢复。'
  },
  requeue: {
    style: 'ghost',
    note: '回到候选池等待下一次调度；不会自动指派车辆。'
  },
  reassign: {
    style: 'danger',
    note: '先回收当前车辆、把已生效计划置为已作废，任务回到候选池重新派发。'
  },
  delete: {
    style: 'danger',
    note: '物理删除：草稿从库中移除，只在审计日志里留下痕迹。此操作不可撤销。'
  }
};

/** 一个动作的完整展示信息（`reasonRequired` 从状态机取）。 */
export function actionDefOf(action: TaskAction): TaskActionDef {
  return {
    action,
    label: labelOf(TASK_ACTION_LABEL, action),
    reasonRequired: TASK_TRANSITIONS[action].requiresReason,
    ...ACTION_PRESENTATION[action]
  };
}

/**
 * 该状态下可用的按钮。
 *
 * 只包含 `task-api` 的动作（`taskActionsOf` 的定义）：`assign` / `start` / `complete` / `fail`
 * 由 M4 / M7 触发，把它们显示成按钮等于给使用者一个点了会 404 的入口 ——
 * 更糟的是「手工把任务标成执行中」而执行器并不知情。
 */
export function taskActionDefs(status: TaskStatus): TaskActionDef[] {
  return taskActionsOf(status).map(actionDefOf);
}

/**
 * 是否需要先弹一次确认。
 *
 * 需要写原因的动作**由那个原因弹层兼任确认**（它已经打断了操作并说明副作用），
 * 不再叠一层「确定吗」。删除没有原因可写，因此单独要一次确认。
 *
 * 参数写成**结构类型**而不是 `TaskActionDef`：执行动作（M7 的开始执行 / 手动接管，
 * 见 `task/execution.ts`）走的是另一组接口，但「要不要先确认」的判据完全相同。
 * 绑死一个动作族就得为同一套确认层写第二份判断，两份迟早分叉（D-34）。
 */
export function needsConfirm(def: { action: string; reasonRequired: boolean }): boolean {
  return def.reasonRequired || def.action === 'delete';
}

/** 是否可编辑字段：与状态机同源（`TASK_EDITABLE_STATUSES`，服务端与 Mock 读的也是它）。 */
export function canEditTask(status: TaskStatus): boolean {
  return TASK_EDITABLE_STATUSES.includes(status);
}

/** 状态操作请求体：只有必须写原因的动作才带 `reason`。 */
export function actionPayload(def: TaskActionDef, reason: string): Record<string, unknown> {
  return def.reasonRequired ? { reason: reason.trim() } : {};
}
