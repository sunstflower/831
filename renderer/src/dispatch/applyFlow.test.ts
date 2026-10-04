import { describe, expect, it } from 'vitest';
import { summarizeDispatchRun, type DispatchStartAttempt } from './applyFlow';

function attempt(code: string, start: DispatchStartAttempt['start']): DispatchStartAttempt {
  return { taskId: `id-${code}`, taskCode: code, vehicleCode: 'AGV-01', start };
}

describe('调度中心 · 派发与开跑的结果汇总（D-58）', () => {
  it('全部开跑成功：横幅为 ok，且不产生任何补充说明', () => {
    const summary = summarizeDispatchRun([attempt('T-001', { ok: true }), attempt('T-002', { ok: true })], '贪心');
    expect(summary.applied).toBe(2);
    expect(summary.started).toBe(2);
    expect(summary.failed).toEqual([]);
    expect(summary.tone).toBe('ok');
    expect(summary.headline).toBe('已派发 2 单（贪心），2 单已开始执行');
    expect(summary.details).toEqual([]);
  });

  it('部分失败：成功的部分照实计入，失败的逐条给出原因与去哪儿重试', () => {
    const summary = summarizeDispatchRun(
      [attempt('T-001', { ok: true }), attempt('T-002', { ok: false, message: '电量不足' })],
      '匈牙利'
    );
    expect(summary.started).toBe(1);
    expect(summary.failed).toEqual([{ taskCode: 'T-002', vehicleCode: 'AGV-01', message: '电量不足' }]);
    expect(summary.headline).toBe('已派发 2 单（匈牙利）：1 单已开跑，1 单未启动');
    expect(summary.details[0]).toContain('电量不足');
    expect(summary.details[0]).toContain('任务管理页');
  });

  it('开关关闭（start 为 null）：说清「尚未启动」以及去哪里开跑，而不是报成失败', () => {
    const summary = summarizeDispatchRun([attempt('T-001', null)], '贪心');
    expect(summary.started).toBe(0);
    expect(summary.failed).toEqual([]);
    expect(summary.notStarted).toBe(1);
    expect(summary.headline).toBe('已派发 1 单（贪心），尚未启动执行');
    expect(summary.details.join('')).toContain('execution:start');
  });

  it('一半跳过一半成功：不能因为「没有失败」就说成全量开跑', () => {
    const summary = summarizeDispatchRun([attempt('T-001', { ok: true }), attempt('T-002', null)], '贪心');
    expect(summary.started).toBe(1);
    expect(summary.notStarted).toBe(1);
    expect(summary.headline).toBe('已派发 2 单（贪心）：1 单已开跑，1 单未启动');
  });

  it('空批次不产出误导性的成功文案', () => {
    const summary = summarizeDispatchRun([], '贪心');
    expect(summary.applied).toBe(0);
    expect(summary.headline).toBe('没有派发任何任务');
  });
});
