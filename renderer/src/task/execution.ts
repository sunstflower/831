/**
 * 任务的**执行动作**（M7）：开始执行与手动接管。
 *
 * ## 为什么这两个动作不放在 `task/actions.ts` 里
 *
 * `task/actions.ts` 描述的是「任务状态机允许的迁移」（提交 / 暂停 / 取消…），
 * 走的是 `POST /api/tasks/{id}/{action}`。而这两个动作**改变的是执行器**：
 *   - 开始执行：`POST /api/execution/tasks/{id}/start` 让车辆真的开动（`assigned→running`）；
 *   - 手动接管：`POST /api/execution/tasks/{id}/takeover` 暂停任务**并生成一条告警**。
 * 它们的权限点（`execution:start` / `execution:takeover`）与 `task:write` 也不同 ——
 * 派给谁（调度室）与现在开跑（现场）在真实现场往往不是同一个人（D-11）。
 *
 * ## 为什么按钮只在**一个**状态出现
 *
 * 契约把这两条路径写死了：`start` 只在 `assigned→running` 合法，`takeover` 只在
 * `running→paused` 合法，其余状态一律 `TASK.STATE_CONFLICT`。因此这里按状态给出
 * 按钮而不是「渲染出来再禁用」—— 一个点不动且不说原因的按钮比没有按钮更糟
 * （`ISS-010` 的教训，与 `task/actions.ts` 同一条判据）。
 *
 * ## 为什么接管必须写原因、开始执行不必
 *
 * 接管会**停下来**并且产生一条告警，是复盘时唯一的人工线索（「当时为什么停」），
 * 缺了它，这条告警就只剩机器视角。开始执行没有需要解释的决策：车辆本来就已经派好了。
 */
import type { Permission, TaskStatus } from '@udm/shared';

export type ExecutionAction = 'start' | 'takeover';

export interface ExecutionActionDef {
  action: ExecutionAction;
  label: string;
  /** 按钮样式：接管会让任务停下来并告警，用危险色提醒它的分量。 */
  style: 'ghost' | 'danger';
  /** 确认层里的副作用说明（与契约的真实副作用同源）。 */
  note: string;
  /** 是否必须填说明。 */
  reasonRequired: boolean;
  permission: Permission;
}

const DEFS: Record<ExecutionAction, Omit<ExecutionActionDef, 'action'>> = {
  start: {
    label: '开始执行',
    style: 'ghost',
    note: '让已派发的车辆按计划开跑：任务进入执行中，执行器开始按周期更新位置、进度与轨迹。',
    reasonRequired: false,
    permission: 'execution:start'
  },
  takeover: {
    label: '手动接管',
    style: 'danger',
    note: '暂停这台车的任务并生成一条 task_timeout 告警（缺省类型），把当前情况留给人工判断；任务与车辆的进度都会停在原地。',
    reasonRequired: true,
    permission: 'execution:takeover'
  }
};

/** 某个任务状态下可用的执行动作（按契约的合法路径，**不是**完整状态机）。 */
export function executionActionsOf(status: TaskStatus): ExecutionActionDef[] {
  const actions: ExecutionAction[] =
    status === 'assigned'
      ? ['start']
      : status === 'running'
        ? ['takeover']
        : [];
  return actions.map(executionActionDefOf);
}

/** 单个动作的定义（`Record` 取值，新增动作时这里会报错而不是静默少一个按钮）。 */
export function executionActionDefOf(action: ExecutionAction): ExecutionActionDef {
  return { action, ...DEFS[action] };
}

/**
 * 请求体：`note` 只在非空时发送。
 *
 * 不发明细的空字段：两条契约都把 `note` 定义为可选，发 `{ note: '' }`
 * 会让审计里出现一条「有说明但说明是空的」记录 —— 那比没有更难看懂。
 */
export function executionPayload(note: string): Record<string, unknown> {
  const trimmed = note.trim();
  return trimmed ? { note: trimmed } : {};
}

/**
 * 成功提示文案。
 *
 * 接管的响应带回 `nextSteps`（建议下一步，与告警详情同源），必须展示出来：
 * 「已接管」只说明按下了按钮，而使用者真正需要的是**接下来做什么**。
 */
export function executionNotice(def: ExecutionActionDef, taskCode: string, data: unknown): string {
  const base = `已${def.label}“${taskCode}”`;
  if (def.action !== 'takeover') {
    return base;
  }
  const steps = (data as { nextSteps?: unknown } | undefined)?.nextSteps;
  const list = Array.isArray(steps) ? steps.filter((step): step is string => typeof step === 'string') : [];
  return list.length > 0 ? `${base}，并生成了一条告警。建议下一步：${list.join('；')}` : `${base}，并生成了一条告警。`;
}
