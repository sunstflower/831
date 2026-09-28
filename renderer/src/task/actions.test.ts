import { describe, expect, it } from 'vitest';
import { TASK_ACTIONS, type TaskStatus } from '@udm/shared';
import { actionDefOf, actionPayload, canEditTask, needsConfirm, taskActionDefs } from './actions';

/**
 * 状态操作模型的单测。
 *
 * 最要紧的一组是「某个状态下到底有哪几个按钮」：多一个按钮 = 使用者点下去得到
 * 一条看不懂的冲突错误；少一个 = 这个状态在界面上看起来无事可做。
 * 这里逐状态列全，任何一处改动都会红。
 */
describe('每个状态下可用的操作', () => {
  const expected: Record<TaskStatus, string[]> = {
    draft: ['submit', 'delete'],
    pending: ['cancel'],
    assigned: ['cancel', 'reassign'],
    running: ['pause', 'cancel', 'reassign'],
    paused: ['resume', 'cancel', 'reassign'],
    finished: [],
    cancelled: [],
    failed: ['requeue']
  };

  for (const [status, actions] of Object.entries(expected) as Array<[TaskStatus, string[]]>) {
    it(`${status} → ${actions.length > 0 ? actions.join(' / ') : '（无可用操作）'}`, () => {
      expect(taskActionDefs(status).map((def) => def.action)).toEqual(actions);
    });
  }

  it('绝不把内部迁移暴露成按钮（assign / start / complete / fail 由 M4、M7 触发）', () => {
    const shown = new Set(TASK_ACTIONS.filter((action) => taskActionDefs('running').concat(taskActionDefs('assigned')).some((def) => def.action === action)));
    for (const internal of ['assign', 'start', 'complete', 'fail'] as const) {
      expect(shown.has(internal), `${internal} 不该出现在界面上`).toBe(false);
    }
  });

  it('终态没有任何出边：完成与取消之后不该再有按钮', () => {
    expect(taskActionDefs('finished')).toEqual([]);
    expect(taskActionDefs('cancelled')).toEqual([]);
  });
});

describe('二次确认与原因输入', () => {
  it('必须写原因的动作与状态机一致（不在界面上另立一份清单）', () => {
    const reasonRequired = TASK_ACTIONS.filter((action) => actionDefOf(action).reasonRequired);
    expect(reasonRequired.sort()).toEqual(['cancel', 'fail', 'pause', 'reassign', 'requeue'].sort());
  });

  it('需要确认的是「必须写原因的动作」加上物理删除', () => {
    expect(needsConfirm(actionDefOf('cancel'))).toBe(true);
    expect(needsConfirm(actionDefOf('pause'))).toBe(true);
    expect(needsConfirm(actionDefOf('delete'))).toBe(true);
    // 提交与继续是低风险、可再操作的动作：多一层弹窗只会让人钝化对弹窗的注意力
    expect(needsConfirm(actionDefOf('submit'))).toBe(false);
    expect(needsConfirm(actionDefOf('resume'))).toBe(false);
  });

  it('取消与删除用危险色，其余用幽灵按钮（主按钮留给「新建任务」）', () => {
    expect(actionDefOf('cancel').style).toBe('danger');
    expect(actionDefOf('delete').style).toBe('danger');
    expect(actionDefOf('submit').style).toBe('ghost');
  });

  it('每个动作都有中文名与副作用说明（漏写会在编译期被 Record 拦住，这里锁的是「不是空白」）', () => {
    for (const action of TASK_ACTIONS) {
      const def = actionDefOf(action);
      expect(def.label.length, `${action} 没有中文名`).toBeGreaterThan(0);
      expect(def.note.length, `${action} 没有副作用说明`).toBeGreaterThan(0);
      expect(def.label).not.toBe(action);
    }
  });

  it('载荷只带必须写原因的动作的 reason，其余为空对象', () => {
    expect(actionPayload(actionDefOf('cancel'), '  停电  ')).toEqual({ reason: '停电' });
    expect(actionPayload(actionDefOf('submit'), '随便写点什么')).toEqual({});
    expect(actionPayload(actionDefOf('delete'), '')).toEqual({});
  });
});

describe('可编辑状态', () => {
  it('草稿 / 待派发 / 执行失败可编辑，派发之后一律不可（改字段要走重派）', () => {
    expect(canEditTask('draft')).toBe(true);
    expect(canEditTask('pending')).toBe(true);
    expect(canEditTask('failed')).toBe(true);
    expect(canEditTask('assigned')).toBe(false);
    expect(canEditTask('running')).toBe(false);
    expect(canEditTask('paused')).toBe(false);
    expect(canEditTask('finished')).toBe(false);
    expect(canEditTask('cancelled')).toBe(false);
  });
});
