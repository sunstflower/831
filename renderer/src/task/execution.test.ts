import { describe, expect, it } from 'vitest';
import { TASK_STATUSES } from '@udm/shared';
import { executionActionDefOf, executionActionsOf, executionNotice, executionPayload } from './execution';

describe('executionActionsOf', () => {
  it('开始执行只在「已派发」出现（契约里只有 assigned→running 合法）', () => {
    expect(executionActionsOf('assigned').map((def) => def.action)).toEqual(['start']);
  });

  it('手动接管只在「执行中」出现（契约里只有 running→paused 合法）', () => {
    expect(executionActionsOf('running').map((def) => def.action)).toEqual(['takeover']);
  });

  it('其余状态一律没有执行动作（点不动且不说原因的按钮比没有按钮更糟）', () => {
    const others = TASK_STATUSES.filter((status) => status !== 'assigned' && status !== 'running');
    for (const status of others) {
      expect(executionActionsOf(status), status).toEqual([]);
    }
  });

  it('权限点与动作一一对应：开始执行要 execution:start，接管要 execution:takeover', () => {
    expect(executionActionDefOf('start').permission).toBe('execution:start');
    expect(executionActionDefOf('takeover').permission).toBe('execution:takeover');
  });

  it('只有接管要求写原因（它是复盘时唯一的人工线索）', () => {
    expect(executionActionDefOf('takeover').reasonRequired).toBe(true);
    expect(executionActionDefOf('start').reasonRequired).toBe(false);
  });
});

describe('executionPayload', () => {
  it('说明非空时带上 `note`；空说明不发明细字段', () => {
    expect(executionPayload(' 现场检查 ')).toEqual({ note: '现场检查' });
    expect(executionPayload('   ')).toEqual({});
  });
});

describe('executionNotice', () => {
  it('开始执行只报告「开始了」', () => {
    expect(executionNotice(executionActionDefOf('start'), 'T-001', { taskId: 't1' })).toBe('已开始执行“T-001”');
  });

  it('接管必须把建议下一步一起说出来（「已接管」没告诉人接下来做什么）', () => {
    const notice = executionNotice(executionActionDefOf('takeover'), 'T-002', {
      alertId: 'a1',
      nextSteps: ['检查车辆定位', '必要时重新派发']
    });
    expect(notice).toContain('已手动接管“T-002”');
    expect(notice).toContain('检查车辆定位；必要时重新派发');
  });

  it('响应里没有建议时不编造，也不报错', () => {
    expect(executionNotice(executionActionDefOf('takeover'), 'T-003', {})).toBe('已手动接管“T-003”，并生成了一条告警。');
    expect(executionNotice(executionActionDefOf('takeover'), 'T-004', { nextSteps: [1, 2] })).not.toContain('1');
  });
});
