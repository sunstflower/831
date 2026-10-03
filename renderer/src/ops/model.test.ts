import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlanAssignment, PlanRiskItem } from '@udm/shared';
import {
  ALERT_STALE_MINUTES,
  RISK_LEVEL_TONE,
  ackTargetsOf,
  alertAgeOf,
  assignmentGroupsOf,
  batchAckNotice,
  isOpenAlert,
  pageSummary,
  riskRowOf,
  riskSummaryOf
} from './model';

/**
 * M8 异常处置的纯函数。
 *
 * 这里锁的是**处置动作的判断依据**：哪条该被标红、一键认领会打到哪几条、
 * 失败了几条要不要说出来。算错的后果不是崩溃，而是「看着像有人在处理，
 * 其实没人看」—— 那比没有这个功能更危险。
 */
const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const minutesAgo = (value: number) => new Date(NOW - value * 60_000).toISOString();

describe('告警年龄与停滞判定', () => {
  it('未终结的告警才有时长；已解决/已归档显示「—」', () => {
    expect(isOpenAlert('new')).toBe(true);
    expect(isOpenAlert('processing')).toBe(true);
    expect(isOpenAlert('resolved')).toBe(false);
    expect(isOpenAlert('archived')).toBe(false);

    expect(alertAgeOf({ status: 'new', createdAt: minutesAgo(120) }, NOW)).toMatchObject({
      open: true,
      minutes: 120,
      text: '已 2 小时未认领',
      stale: true
    });
    expect(alertAgeOf({ status: 'resolved', createdAt: minutesAgo(120) }, NOW)).toMatchObject({
      open: false,
      text: '—',
      stale: false
    });
  });

  it('文案随状态变：卡在「没人认领」和卡在「没人解决」是两件事', () => {
    expect(alertAgeOf({ status: 'new', createdAt: minutesAgo(45) }, NOW).text).toBe('已 45 分钟未认领');
    expect(alertAgeOf({ status: 'acknowledged', createdAt: minutesAgo(90) }, NOW).text).toBe('已 1 小时 30 分钟未开始处理');
    expect(alertAgeOf({ status: 'processing', createdAt: minutesAgo(2000) }, NOW).text).toBe('已 1 天 9 小时未解决');
  });

  it('阈值就是「变黄」的界线，边界值要落在阈值这一侧', () => {
    expect(alertAgeOf({ status: 'new', createdAt: minutesAgo(ALERT_STALE_MINUTES - 1) }, NOW).stale).toBe(false);
    expect(alertAgeOf({ status: 'new', createdAt: minutesAgo(ALERT_STALE_MINUTES) }, NOW).stale).toBe(true);
    // 坏时间戳不抛错：库里有手工写入的坏值时仍然读得出来（显示「—」）
    expect(alertAgeOf({ status: 'new', createdAt: '不是时间' }, NOW).text).toBe('—');
  });
});

describe('批量认领', () => {
  it('只挑 `new` 的：认领过的再打一次只会得到状态冲突', () => {
    const ids = ackTargetsOf([
      { id: 'a', status: 'new' },
      { id: 'b', status: 'acknowledged' },
      { id: 'c', status: 'new' },
      { id: 'd', status: 'archived' }
    ]);
    expect(ids).toEqual(['a', 'c']);
    expect(ackTargetsOf([])).toEqual([]);
  });

  it('结果文案分开说成功与失败，不把被拒的那几条藏起来', () => {
    expect(batchAckNotice(3, 0)).toBe('已认领 3 条告警。');
    expect(batchAckNotice(2, 1)).toContain('另有 1 条失败');
    expect(batchAckNotice(0, 0)).toContain('没有待认领');
  });
});

describe('分页文案', () => {
  it('总数按页大小折算页数，0 条也至少有 1 页', () => {
    expect(pageSummary(0, 1, 20)).toBe('共 0 条 · 第 1 / 1 页');
    expect(pageSummary(21, 2, 20)).toBe('共 21 条 · 第 2 / 2 页');
  });
});

describe('风险预检的展示模型', () => {
  const item = (over: Partial<PlanRiskItem> = {}): PlanRiskItem => ({
    kind: 'VEHICLE_OVERLAP',
    level: 'critical',
    message: 'CAR-01 的两单时间重叠 60 秒',
    suggestion: '把其中一单改派给别的车',
    taskIds: ['t1', 't2'],
    taskCodes: ['T-1', 'T-2'],
    vehicleIds: ['v1'],
    vehicleCodes: ['CAR-01'],
    detail: {},
    ...over
  });

  it('风险行把编码列表拼成人读串，空列表显示「—」而不是空白', () => {
    expect(riskRowOf(item()).tasks).toBe('T-1、T-2');
    expect(riskRowOf(item({ taskCodes: [], vehicleCodes: [] })).tasks).toBe('—');
    expect(riskRowOf(item({ taskCodes: [], vehicleCodes: [] })).vehicles).toBe('—');
  });

  it('风险行保留**原始 id**（展示串不能拿去跳转 / 处理）', () => {
    const row = riskRowOf(item());
    expect(row.taskIds).toEqual(['t1', 't2']);
    expect(row.vehicleIds).toEqual(['v1']);
  });

  it('类型名来自唯一来源，不在页面里各写一份', () => {
    expect(riskRowOf(item({ kind: 'WINDOW_EXPIRED' })).kindLabel).toBe('已超时');
    expect(riskRowOf(item({ kind: 'UNASSIGNED_TASK' })).kindLabel).toBe('未派发');
  });

  it('三个级别都有色调名（漏一个会渲染出无样式的徽标，且不报错）', () => {
    expect(RISK_LEVEL_TONE).toEqual({ info: 'info', warning: 'warn', critical: 'danger' });
  });

  it('汇总文案分开说「必须处理」与「需留意」—— 这两类的动作完全不同', () => {
    expect(riskSummaryOf({ critical: 0, warning: 0, info: 0 })).toBe('没有发现冲突或超时');
    expect(riskSummaryOf({ critical: 2, warning: 1, info: 0 })).toBe('共 3 条 · 必须处理 2 · 需留意 1');
    expect(riskSummaryOf({ critical: 0, warning: 3, info: 1 })).toBe('共 4 条 · 需留意 3 · 提示 1');
  });
});

describe('任务分配派发区块的分组', () => {
  const row = (over: Partial<PlanAssignment>): PlanAssignment => ({
    taskId: 't1',
    taskCode: 'T-1',
    taskStatus: 'assigned',
    vehicleId: 'v1',
    vehicleCode: 'CAR-01',
    routeId: 'r1',
    occupiedFrom: '2026-09-28T12:00:00.000Z',
    occupiedTo: '2026-09-28T12:10:00.000Z',
    ...over
  });

  it('同一台车的多条计划归到一组，并标成「接力」', () => {
    const groups = assignmentGroupsOf([
      row({ taskId: 't1', taskCode: 'T-1' }),
      row({ taskId: 't2', taskCode: 'T-2', occupiedFrom: '2026-09-28T12:10:00.000Z' })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.relay).toBe(true);
    expect(groups[0]!.steps.map((step) => step.taskCode)).toEqual(['T-1', 'T-2']);
  });

  it('一台车只接一单时不标接力', () => {
    const groups = assignmentGroupsOf([row({})]);
    expect(groups[0]!.relay).toBe(false);
  });

  it('**不重排**顺序：读到的就是渲染的（排序由服务端定死）', () => {
    const groups = assignmentGroupsOf([
      row({ taskId: 't2', taskCode: 'T-2', vehicleId: 'v2', vehicleCode: 'CAR-02' }),
      row({ taskId: 't1', taskCode: 'T-1' })
    ]);
    expect(groups.map((group) => group.vehicleCode)).toEqual(['CAR-02', 'CAR-01']);
  });

  it('没有路线的计划被标出来（它同时也会出现在风险清单里）', () => {
    const groups = assignmentGroupsOf([row({ routeId: null })]);
    expect(groups[0]!.steps[0]!.hasRoute).toBe(false);
  });

  it('空输入得到空数组（不是 undefined，也不是一个空组）', () => {
    expect(assignmentGroupsOf([])).toEqual([]);
  });
});

/**
 * 风险预检表的**排版护栏**。
 *
 * 起因（ISS-086）：预检表里「具体情况」与「建议动作」是两张长文本列，而 `ui.css` 给
 * `.udm-table td` 的默认是 `white-space: nowrap`（列表页一行一条记录，nowrap 是对的）。
 * 整表 nowrap 会把长句顶出卡片右缘；`docs` 层与单测都不会红，只有**真实 Electron 走查**
 * 才看得见「建议动作被裁成半句」。jsdom 不做布局，量不出宽度，因此这里退一步：
 * 直接读 CSS，断言这两列确实被显式改成 `normal`。
 *
 * 「退一步的护栏」仍比没有强 —— 它拦的正是当初的成因（有人把这两条规则删掉/合并回去）。
 */
const opsCss = readFileSync(join(process.cwd(), 'renderer/src/ops/style/ops.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

describe('风险预检表 · 长文本列必须允许换行', () => {
  it('「具体情况」「建议动作」都显式设了 white-space: normal', () => {
    const block = /\.udm-risk__table td\.udm-risk__message,\s*\.udm-risk__table td\.udm-risk__suggestion\s*\{[^}]*white-space:\s*normal[^}]*\}/.test(
      opsCss
    );
    expect(block, 'ops.css 里这两列应有一条 white-space: normal 的规则').toBe(true);
  });

  it('建议动作列有宽度上限，避免它一条长句把整表撑开', () => {
    expect(opsCss).toMatch(/\.udm-risk__table td\.udm-risk__suggestion\s*\{[^}]*max-width:\s*\d+px/);
  });
});
