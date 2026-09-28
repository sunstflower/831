import { describe, expect, it } from 'vitest';
import { TASK_STATUSES } from './enums.js';
import {
  TASK_ACTIONS,
  TASK_API_ACTIONS,
  TASK_EDITABLE_STATUSES,
  TASK_TRANSITIONS,
  canRun,
  checkTaskTransition,
  isTaskAction,
  taskActionsOf,
  transitionTargetText
} from './task-state.js';

/**
 * 任务状态机的单测。
 *
 * 这里锁的**不是**「某个动作能跑」，而是**整张迁移表的结构不变量** ——
 * 漏一条边、给终态开出边、把内部动作暴露成 HTTP 接口，都会在这里当场红。
 * 逐条迁移的行为由领域层用例覆盖（`desktop/src/domain/task/task.service.test.ts`）。
 */
describe('任务状态机（M3）', () => {
  it('每个动作都有迁移定义，且没有多余的键', () => {
    expect(Object.keys(TASK_TRANSITIONS).sort()).toEqual([...TASK_ACTIONS].sort());
  });

  it('每条迁移的源状态与目标状态都在枚举内（delete 的目标为 null）', () => {
    for (const action of TASK_ACTIONS) {
      const transition = TASK_TRANSITIONS[action];
      expect(transition.action, action).toBe(action);
      expect(transition.from.length, action).toBeGreaterThan(0);
      for (const status of transition.from) {
        expect(TASK_STATUSES, `${action}.from`).toContain(status);
      }
      if (transition.to !== null) {
        expect(TASK_STATUSES, `${action}.to`).toContain(transition.to);
      }
      // 同一个动作里不允许重复列同一个源状态（重复列会让「允许的源状态」看起来更多）
      expect(new Set(transition.from).size, `${action}.from 去重`).toBe(transition.from.length);
      // 目标不在源状态里：那是自环，设计里没有任何自环
      expect(transition.from.includes(transition.to as never), `${action} 自环`).toBe(false);
    }
  });

  it('终态没有出边：finished / cancelled 不是任何迁移的源状态', () => {
    const sources = new Set(TASK_ACTIONS.flatMap((action) => TASK_TRANSITIONS[action].from));
    expect(sources.has('finished')).toBe(false);
    expect(sources.has('cancelled')).toBe(false);
    // draft 只能被 submit / delete 推动，正对应「草稿未提交」这件事
    expect(taskActionsOf('draft').sort()).toEqual(['delete', 'submit']);
  });

  it('delete 只允许 draft（其余状态走 cancel）', () => {
    expect(TASK_TRANSITIONS.delete.from).toEqual(['draft']);
    expect(TASK_TRANSITIONS.delete.to).toBeNull();
    expect(transitionTargetText(TASK_TRANSITIONS.delete)).toBe('(删除)');
    for (const status of ['pending', 'assigned', 'running', 'paused', 'finished', 'cancelled', 'failed'] as const) {
      expect(taskActionsOf(status), status).not.toContain('delete');
    }
  });

  it('reassign 的目标是 pending（回到候选池），不是 assigned', () => {
    expect(TASK_TRANSITIONS.reassign.to).toBe('pending');
    expect(TASK_TRANSITIONS.reassign.from).toEqual(['assigned', 'running', 'paused']);
  });

  it('HTTP 动作清单派生自迁移表，且不含由其它模块触发的动作', () => {
    expect([...TASK_API_ACTIONS].sort()).toEqual(
      ['cancel', 'delete', 'pause', 'reassign', 'requeue', 'resume', 'submit'].sort()
    );
    // `assign`（M4）、`start` / `complete` / `fail`（M7）不得出现在状态操作接口里，
    // 否则使用者能手工把任务标成「执行中」，而执行器并不知情
    for (const internal of ['assign', 'start', 'complete', 'fail'] as const) {
      expect(TASK_API_ACTIONS, internal).not.toContain(internal);
    }
  });

  it('必填原因的动作与设计一致（取消 / 重派 / 重排 / 暂停 / 失败）', () => {
    const withReason = TASK_ACTIONS.filter((action) => TASK_TRANSITIONS[action].requiresReason);
    expect([...withReason].sort()).toEqual(['cancel', 'fail', 'pause', 'reassign', 'requeue'].sort());
  });

  it('checkTaskTransition：合法迁移给出目标状态，非法迁移给出当前状态与期望状态', () => {
    const ok = checkTaskTransition('pause', 'running');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.transition.to).toBe('paused');
    }

    const bad = checkTaskTransition('pause', 'draft');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.failure.from).toBe('draft');
      expect(bad.failure.expected).toEqual(['running']);
      // 文案必须同时说清「现在是什么」与「要什么」，否则使用者不知道下一步做什么
      expect(bad.failure.message).toContain('draft');
      expect(bad.failure.message).toContain('running');
    }
  });

  it('canRun 与 checkTaskTransition 结论一致（两处判定不得分叉）', () => {
    for (const action of TASK_ACTIONS) {
      for (const status of TASK_STATUSES) {
        expect(canRun(action, status), `${action} @ ${status}`).toBe(checkTaskTransition(action, status).ok);
      }
    }
  });

  it('可编辑状态是「还没有派发痕迹」的那几个（界面与服务端共用同一份定义）', () => {
    expect([...TASK_EDITABLE_STATUSES]).toEqual(['draft', 'pending', 'failed']);
    for (const status of TASK_EDITABLE_STATUSES) {
      // 与状态机自洽：可编辑的状态都还不是终态，仍有出边
      const outgoing = TASK_ACTIONS.filter((action) => canRun(action, status));
      expect(outgoing.length, `${status} 应当还有出边`).toBeGreaterThan(0);
    }
    // 派发之后的状态不在这里：改字段要走重派（`reassign`），而不是编辑
    expect(TASK_EDITABLE_STATUSES).not.toContain('assigned');
    expect(TASK_EDITABLE_STATUSES).not.toContain('running');
  });

  it('isTaskAction 只认已登记的动作', () => {
    expect(isTaskAction('pause')).toBe(true);
    expect(isTaskAction('finish')).toBe(false);
    expect(isTaskAction('')).toBe(false);
    expect(isTaskAction(undefined)).toBe(false);
  });
});
