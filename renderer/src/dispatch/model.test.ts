import { describe, expect, it } from 'vitest';
import type { DispatchLogListItem, PlanPreview, PreviewResult, RejectItem, StrategyResult, TaskListItem } from '@udm/shared';
import {
  ALL_STRATEGIES_VALUE,
  assignmentDiffsOf,
  candidateOptions,
  canApply,
  confirmLinesOf,
  confirmRejectLinesOf,
  logRowOf,
  differenceLinesOf,
  durationText,
  metricComparisonOf,
  outcomeMetricsOf,
  outcomeOf,
  outcomeRowOf,
  planRowOf,
  previewPayload,
  recommendationOf,
  rejectDetailOf,
  rejectRowOf,
  selectionState,
  strategyLabel,
  strategyOptions,
  taskCodesOf,
  vehiclePlanGroupsOf
} from './model';

/**
 * 调度中心的展示模型（纯函数）。
 *
 * 这里断言的是**界面要说的话**（推荐语、确认清单、日志小结），而不是接口有没有返回数据 ——
 * 后者由 `desktop/src/domain/dispatch/dispatch.service.test.ts` 与
 * `desktop/src/ipc/api.dispatch.test.ts` 覆盖。
 *
 * 之所以值得单独测：这些字符串是使用者**唯一**能看到的结论（「推荐哪个策略」「没派出去的是哪些」），
 * 而它们由若干数字拼成 —— 拼错不会报错，只会让人读到一句自信的错话。
 */

function task(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: 't-1',
    code: 'T20260926-0001',
    title: 'A 仓 → B 仓',
    status: 'pending',
    priority: 'normal',
    cargoKg: 100,
    fromSiteId: 'seed-site-a',
    toSiteId: 'seed-site-b',
    timeWindowStart: null,
    timeWindowEnd: null,
    fromSiteName: null,
    toSiteName: null,
    assignedVehicleId: null,
    vehicleCode: null,
    progress: 0,
    createdAt: '2026-09-26T08:00:00.000Z',
    createdBy: null,
    ...overrides
  };
}

function plan(overrides: Partial<PlanPreview> = {}): PlanPreview {
  return {
    taskId: 't-1',
    vehicleId: 'seed-veh-car01',
    vehicleCode: 'CAR-01',
    route: { fromNodeId: 'seed-n01', toNodeId: 'seed-n12', nodeIds: ['seed-n01', 'seed-n12'], distanceM: 100, durationS: 33.3 },
    cost: 66.6,
    costDetail: { deadheadTimeS: 0, executeTimeS: 66.6, waitTimeS: 0, penaltyLateS: 0, chargeRisk: 0 },
    occupiedFrom: '2026-09-26T08:05:00.000Z',
    occupiedTo: '2026-09-26T08:06:07.000Z',
    ...overrides
  };
}

function reject(overrides: Partial<RejectItem> = {}): RejectItem {
  return {
    taskId: 't-2',
    reason: 'LOAD_EXCEEDED',
    message: '任务 T20260926-0002 载重超限',
    detail: { cargoKg: 900, vehicleCode: 'AGV-01', remainKg: 500 },
    ...overrides
  };
}

function outcome(overrides: Partial<StrategyResult> = {}): StrategyResult {
  const plans = overrides.plans ?? [plan()];
  const rejected = overrides.rejected ?? [reject()];
  return {
    strategy: 'greedy',
    plans,
    rejected,
    summary: {
      totalTasks: plans.length + rejected.length,
      assigned: plans.length,
      rejectedCount: rejected.length,
      totalCost: plans.reduce((sum, item) => sum + item.cost, 0),
      elapsedMs: 12
    },
    explain: [],
    ...overrides
  };
}

describe('调度中心 · 候选池', () => {
  it('按「优先级降序 → 时间窗升序」排序，与内核的 compareTasks 同口径', () => {
    const options = candidateOptions([
      task({ id: 'c', code: 'C', priority: 'low' }),
      task({ id: 'a', code: 'A', priority: 'urgent' }),
      task({ id: 'b', code: 'B', priority: 'normal', timeWindowStart: '2026-09-26T09:00:00.000Z', timeWindowEnd: '2026-09-26T10:00:00.000Z' })
    ]);
    expect(options.map((item) => item.label)).toEqual(['A', 'B', 'C']);
    expect(options[1]!.detail).toContain('时间窗至 10:00:00');
    // 没有时间窗的任务不显示时间窗片段（而不是显示一个空串或 undefined）
    expect(options[0]!.detail).not.toContain('时间窗');
  });

  it('勾选状态三态分明（按钮文案据它切换全选 / 清空）', () => {
    const candidates = candidateOptions([task({ id: 'a' }), task({ id: 'b' })]);
    expect(selectionState([], candidates)).toBe('none');
    expect(selectionState(['a'], candidates)).toBe('some');
    expect(selectionState(['a', 'b'], candidates)).toBe('all');
    // 候选池为空时不能报「全部已选」—— 那会让使用者以为已经选中了东西
    expect(selectionState([], [])).toBe('none');
  });
});

describe('调度中心 · 策略与推荐', () => {
  it('策略清单补上 `all` 一项，并在没有可用策略时禁用', () => {
    const options = strategyOptions([
      { key: 'greedy', label: '贪心', description: 'g', enabled: true },
      { key: 'hungarian', label: '匈牙利', description: 'h', enabled: true },
      { key: 'genetic', label: '遗传', description: 'x', enabled: false }
    ]);
    expect(options.map((item) => item.key)).toEqual(['greedy', 'hungarian', 'genetic', ALL_STRATEGIES_VALUE]);
    expect(options.at(-1)!.enabled).toBe(true);
    // 服务端清单缺失（请求失败）时 `all` 必须禁用：点了必然报错
    expect(strategyOptions(null).filter((item) => item.enabled)).toEqual([]);
    expect(strategyLabel('all')).toBe('全部（对比）');
    expect(strategyLabel('hungarian')).toBe('匈牙利');
  });

  it('推荐：先比指派数、再比加权综合分，并在两策略相同时明说「一致」', () => {
    const greedy = outcome({ strategy: 'greedy', plans: [plan()] });
    const hungarian = outcome({
      strategy: 'hungarian',
      plans: [plan({ taskId: 't-1', cost: 50 }), plan({ taskId: 't-2', cost: 10 })],
      rejected: []
    });
    const better = recommendationOf([greedy, hungarian]);
    expect(better.strategy).toBe('hungarian');
    expect(better.tone).toBe('ok');
    expect(better.text).toContain('多派 1 单');

    const same = recommendationOf([greedy, { ...greedy, strategy: 'hungarian' }]);
    expect(same.tone).toBe('info');
    expect(same.text).toContain('结论一致');

    const none = recommendationOf([outcome({ plans: [], rejected: [reject()] })]);
    expect(none.tone).toBe('warn');
    expect(none.text).toContain('没有任何任务能派出');
  });

  it('单策略预览的推荐语不比较（没有第二个策略可比）', () => {
    const one = recommendationOf([outcome()]);
    expect(one.tone).toBe('ok');
    expect(one.text).toContain('本次只跑了「贪心」');
    expect(recommendationOf([]).strategy).toBeNull();
  });

  it('对比表一行里同时有指派数 / 拒绝数 / 加权综合分 / 耗时，并标出推荐项', () => {
    const row = outcomeRowOf(outcome(), 'greedy');
    expect(row).toMatchObject({ label: '贪心', assigned: 1, totalTasks: 2, rejectedCount: 1, totalCost: '66.6', elapsedMs: 12, recommended: true });
    expect(outcomeRowOf(outcome({ strategy: 'hungarian' }), 'greedy').recommended).toBe(false);
  });
});

describe('调度中心 · 计划与拒绝行', () => {
  const codes = taskCodesOf([task({ id: 't-1' }), task({ id: 't-2', code: 'T20260926-0002' })]);

  it('计划行把内部 id 翻成任务编码、把秒数取整、把时刻截成 HH:mm:ss', () => {
    const row = planRowOf(plan(), codes);
    expect(row).toMatchObject({ taskCode: 'T20260926-0001', vehicleCode: 'CAR-01', executeS: '67s', cost: '66.6', doneAt: '08:06:07' });
  });

  it('计划行给出这条计划**分配到的路线**（段数 + 里程）——「路线分配」要看得见', () => {
    const row = planRowOf(plan({ route: { fromNodeId: 'a', toNodeId: 'd', nodeIds: ['a', 'b', 'c', 'd'], distanceM: 450.6, durationS: 150 } }), codes);
    expect(row.route).toBe('3 段 · 451 m');
    expect(row.routeSegments).toBe(3);
    expect(row.routeDistanceM).toBe(451);
  });

  it('没有路线的计划写成「无路线」而不是留空（空单元格读起来像界面没做完）', () => {
    const row = planRowOf(plan({ route: null }), codes);
    expect(row.route).toBe('无路线');
    expect(row.routeSegments).toBe(0);
  });

  it('拒绝原因用共享词表；detail 只拼已知键，不泄漏原始 JSON', () => {
    const row = rejectRowOf(reject(), codes);
    expect(row.reason).toBe('载重超限');
    expect(row.detail).toBe('任务 900kg 超过 AGV-01 剩余 500kg');
    expect(rejectDetailOf(reject({ reason: 'UNREACHABLE', detail: { graph: 'x', note: 'y' } }))).toBe('当前路网下无法到达');
    // 未知键不产生摘要（宁可空，也不显示 JSON）
    expect(rejectDetailOf(reject({ reason: 'VEHICLE_NOT_AVAILABLE', detail: {} }))).toBe(' 当前状态 ');
  });

  it('时间窗冲突的两种情形分得开：晚点 / 被占用（走查回归：后者曾被印成「晚点 0s」）', () => {
    // ① 晚点：预计完成晚于窗口末端超过容忍
    expect(
      rejectDetailOf(
        reject({ reason: 'TIMEWINDOW_CONFLICT', detail: { kind: 'late', lateS: 433, toleranceS: 300 } })
      )
    ).toBe('预计晚点 433s，超出容忍 300s');
    // ② 被占用：与该车已排班次的占用区间相交 —— detail 里根本没有 lateS
    const occupied = rejectDetailOf(
      reject({
        reason: 'TIMEWINDOW_CONFLICT',
        detail: {
          kind: 'occupied',
          vehicleCode: 'CAR-01',
          from: '2026-10-03T04:33:24.000Z',
          to: '2026-10-03T04:41:24.000Z'
        }
      })
    );
    expect(occupied).toBe('CAR-01 在 04:33:24 ~ 04:41:24 已被占用');
    expect(occupied).not.toContain('晚点');
    // 兼容 `kind` 之前落库的旧快照：没有 kind 时仍按「有没有 lateS」判
    expect(rejectDetailOf(reject({ reason: 'TIMEWINDOW_CONFLICT', detail: { lateS: 433, toleranceS: 300 } }))).toBe(
      '预计晚点 433s，超出容忍 300s'
    );
  });

  it('二次确认清单逐条列出「任务 → 车辆」与预计完成时刻，并单独列出被拒的', () => {
    const lines = confirmLinesOf(outcome(), codes);
    expect(lines).toEqual(['T20260926-0001 → CAR-01（空驶 0s + 执行 67s，预计 08:06:07 完成）']);
    expect(confirmRejectLinesOf(outcome(), codes)).toEqual(['T20260926-0002：载重超限']);
  });
});

describe('调度中心 · 日志与请求体', () => {
  it('日志行把小结拼成「派 x/y · 拒 n · 加权综合分 · 耗时」', () => {
    const record: DispatchLogListItem = {
      id: 'log-1',
      requestId: 'req-1',
      action: 'manual_assign',
      strategy: 'greedy',
      taskIds: ['t-1'],
      summary: { totalTasks: 1, assigned: 1, rejectedCount: 0, totalCost: 12.34, elapsedMs: 7 },
      rejected: [],
      reason: '客户指定',
      elapsedMs: 7,
      operatorName: '调度员',
      createdAt: '2026-09-26T08:05:00.000Z'
    };
    const row = logRowOf(record);
    expect(row).toMatchObject({ action: '手动指派', strategy: '贪心', taskCount: 1, reason: '客户指定', operator: '调度员' });
    expect(row.summary).toBe('派 1/1 · 拒 0 · 加权综合分 12.3 · 7ms');
    // 预览 / 应用没有原因：显示占位符而不是空白（空白看起来像「这条日志缺字段」）
    expect(logRowOf({ ...record, reason: null, operatorName: null }).reason).toBe('—');
    expect(logRowOf({ ...record, reason: null, operatorName: null }).operator).toBe('—');
  });

  it('重算日志不套「派 x/y」模板：那是回收动作，套模板会读成「一单都没派也没被拒」', () => {
    const recompute: DispatchLogListItem = {
      id: 'log-2',
      requestId: 'req-2',
      action: 'recompute',
      strategy: 'greedy',
      taskIds: ['t-1'],
      // 服务端就是这么写的：回收动作本身不产生派发，`summary` 恒为 0 派 / 0 拒
      summary: { totalTasks: 1, assigned: 0, rejectedCount: 0, totalCost: 0, elapsedMs: 0 },
      rejected: [],
      reason: 'A 仓封路',
      elapsedMs: 0,
      operatorName: '调度员',
      createdAt: '2026-09-26T08:06:00.000Z'
    };
    const row = logRowOf(recompute);
    expect(row.summary).toBe('回收 1 条计划 · 新建议待确认');
    expect(row.summary).not.toContain('派 0/1');
    // 其余动作仍是四件事一起说
    expect(logRowOf({ ...recompute, action: 'apply', elapsedMs: 3, summary: { totalTasks: 2, assigned: 1, rejectedCount: 1, totalCost: 9.5, elapsedMs: 3 } }).summary).toBe(
      '派 1/2 · 拒 1 · 加权综合分 9.5 · 3ms'
    );
  });

  it('请求体：策略一律显式带上；taskIds 复制一份，调用方改原数组不影响已发出的请求', () => {
    const ids = ['t-1'];
    const payload = previewPayload(ids, 'all');
    ids.push('t-2');
    expect(payload).toEqual({ taskIds: ['t-1'], strategy: 'all' });
  });

  it('取结果与应用条件：取不到策略返回 null，没有可派计划时不允许应用', () => {
    const result: PreviewResult = { requestId: 'req-1', strategies: [outcome()] };
    expect(outcomeOf(result, 'greedy')?.strategy).toBe('greedy');
    expect(outcomeOf(result, 'hungarian')).toBeNull();
    expect(outcomeOf(null, 'greedy')).toBeNull();
    expect(canApply(outcome(), false)).toBe(true);
    expect(canApply(outcome(), true)).toBe(false);
    expect(canApply(outcome({ plans: [] }), false)).toBe(false);
    expect(canApply(null, false)).toBe(false);
  });
});

describe('调度中心 · 参数对比与接力', () => {
  const codes = taskCodesOf([
    task({ id: 't-1', code: 'T-DEMO-0001' }),
    task({ id: 't-2', code: 'T-DEMO-0002' })
  ]);

  it('时长文案：不足一分钟按秒，超过一分钟按「x 分 y 秒」，读得出「快了多少」', () => {
    expect(durationText(0)).toBe('0 秒');
    expect(durationText(59.4)).toBe('59 秒');
    expect(durationText(60)).toBe('1 分');
    expect(durationText(140)).toBe('2 分 20 秒');
  });

  it('批量指标：里程只累加执行段，行驶耗时含空驶，完成时刻取最晚，接力按「同车第 2 单起」计', () => {
    const relayed = outcome({
      plans: [
        plan({ taskId: 't-1', occupiedFrom: '2026-09-26T08:05:00.000Z', occupiedTo: '2026-09-26T08:06:07.000Z' }),
        plan({
          taskId: 't-2',
          // 与上一单首尾相接：这正是「接力」的样子（半开区间允许占用时刻重合）
          occupiedFrom: '2026-09-26T08:06:07.000Z',
          occupiedTo: '2026-09-26T08:09:00.000Z',
          route: { fromNodeId: 'a', toNodeId: 'b', nodeIds: ['a', 'b'], distanceM: 200, durationS: 100 },
          costDetail: { deadheadTimeS: 40, executeTimeS: 100, waitTimeS: 0, penaltyLateS: 0, chargeRisk: 0 }
        })
      ]
    });
    const metrics = outcomeMetricsOf(relayed);
    expect(metrics.distanceM).toBe(300);
    expect(metrics.driveS).toBeCloseTo(206.6, 1);
    expect(metrics.finishAt).toBe('2026-09-26T08:09:00.000Z');
    expect(metrics.vehicleCount).toBe(1);
    expect(metrics.relayTasks).toBe(1);
    // 对比表一行必须把四个数都带上，缺一个就没法回答「哪个更快」
    expect(outcomeRowOf(relayed, 'greedy')).toMatchObject({
      distance: '300 m',
      drive: '3 分 27 秒',
      finishAt: '08:09:00',
      fleet: '1 台（含接力 1 单）'
    });
    expect(outcomeMetricsOf(outcome({ plans: [] }))).toMatchObject({ finishAt: null, vehicleCount: 0, relayTasks: 0 });
  });

  it('差异行只说「另一个更好的项」，逐项给出差值', () => {
    const greedy = outcome({
      strategy: 'greedy',
      plans: [plan({ occupiedTo: '2026-09-26T08:06:07.000Z' })],
      rejected: []
    });
    const faster = outcome({
      strategy: 'hungarian',
      plans: [
        plan({
          occupiedTo: '2026-09-26T08:05:10.000Z',
          route: { fromNodeId: 'a', toNodeId: 'b', nodeIds: ['a', 'b'], distanceM: 40, durationS: 20 },
          costDetail: { deadheadTimeS: 0, executeTimeS: 20, waitTimeS: 0, penaltyLateS: 0, chargeRisk: 0 }
        })
      ],
      rejected: [reject()]
    });
    const lines = differenceLinesOf([greedy, faster], 'greedy');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toContain('少跑 60 m');
    expect(lines[0]!.text).toContain('少行驶');
    expect(lines[0]!.text).toContain('早');
    // 匈牙利多派不了，所以「多派」不该出现（说了就是假话）
    expect(lines[0]!.text).not.toContain('多派');
    // 单策略 / 没有推荐项时没有可比对象
    expect(differenceLinesOf([greedy], 'greedy')).toEqual([]);
    expect(differenceLinesOf([greedy, faster], null)).toEqual([]);
  });

  it('按车辆分组：组内按开始时刻排出接力顺序，组间按第一单时间排', () => {
    const grouped = outcome({
      plans: [
        // 故意乱序给出：分组视图必须自己排出「第 1 单 / 第 2 单」
        plan({ taskId: 't-2', vehicleId: 'v-2', vehicleCode: 'CAR-01', occupiedFrom: '2026-09-26T08:06:07.000Z', occupiedTo: '2026-09-26T08:09:00.000Z' }),
        plan({ taskId: 't-1', vehicleId: 'v-1', vehicleCode: 'AGV-02', occupiedFrom: '2026-09-26T08:00:00.000Z', occupiedTo: '2026-09-26T08:01:00.000Z' }),
        plan({ taskId: 't-1', vehicleId: 'v-2', vehicleCode: 'CAR-01', occupiedFrom: '2026-09-26T08:05:00.000Z', occupiedTo: '2026-09-26T08:06:07.000Z' })
      ],
      rejected: []
    });
    const groups = vehiclePlanGroupsOf(grouped, codes);
    expect(groups.map((group) => group.vehicleCode)).toEqual(['AGV-02', 'CAR-01']);
    expect(groups[0]!.relay).toBe(false);
    expect(groups[1]!.relay).toBe(true);
    expect(groups[1]!.steps.map((step) => step.seq)).toEqual([1, 2]);
    expect(groups[1]!.steps[0]!.beginsAt).toBe('08:05:00');
    expect(groups[1]!.steps[1]!.taskCode).toBe('T-DEMO-0002');
    expect(vehiclePlanGroupsOf(outcome({ plans: [] }), codes)).toEqual([]);
  });
});

describe('调度中心 · 差异对照（逐指标 / 逐任务）', () => {
  const codes = taskCodesOf([
    task({ id: 't-1', code: 'T-DEMO-0001' }),
    task({ id: 't-2', code: 'T-DEMO-0002' }),
    task({ id: 't-3', code: 'T-DEMO-0003' })
  ]);

  /** 便宜的一单：里程 40 m、执行 20 s、加权综合分 40。 */
  const cheapPlan = (over: Partial<PlanPreview> = {}) =>
    plan({
      route: { fromNodeId: 'a', toNodeId: 'b', nodeIds: ['a', 'b'], distanceM: 40, durationS: 20 },
      cost: 40,
      costDetail: { deadheadTimeS: 0, executeTimeS: 20, waitTimeS: 0, penaltyLateS: 0, chargeRisk: 0 },
      occupiedTo: '2026-09-26T08:05:10.000Z',
      ...over
    });

  const greedy = outcome({
    strategy: 'greedy',
    plans: [plan({ taskId: 't-1', cost: 100 })],
    rejected: []
  });
  const hungarian = outcome({
    strategy: 'hungarian',
    plans: [cheapPlan({ taskId: 't-1' })],
    rejected: [reject({ taskId: 't-2' })]
  });

  it('两个策略才谈得上对照；单策略返回 null 而不是编一张空表', () => {
    expect(metricComparisonOf([greedy], 'greedy')).toBeNull();
    expect(metricComparisonOf([greedy, hungarian], 'greedy')).not.toBeNull();
    expect(assignmentDiffsOf([greedy], codes, 'greedy')).toBeNull();
  });

  it('推荐策略排在基准列；非基准列给带符号差值，并按指标方向判优劣', () => {
    // 推荐匈牙利（虽然它拒了一单）—— 验证基准列跟着推荐走，而不是固定取第一个
    const compare = metricComparisonOf([greedy, hungarian], 'hungarian')!;
    expect(compare.columns.map((column) => column.strategy)).toEqual(['hungarian', 'greedy']);
    expect(compare.columns[0]!.base).toBe(true);
    expect(compare.columns[1]!.base).toBe(false);

    const rowOf = (key: string) => compare.rows.find((row) => row.key === key)!;
    // 拒绝：贪心 0 拒（更好），差值是相对基准的 +1
    expect(rowOf('rejected').texts).toEqual(['1', '0']);
    expect(rowOf('rejected').deltas[1]).toBe('-1 单');
    expect(rowOf('rejected').verdicts[1]).toBe('better');
    // 里程：基准 40 m，贪心 100 m → +60 m 且更差
    expect(rowOf('distance').texts).toEqual(['40 m', '100 m']);
    expect(rowOf('distance').deltas[1]).toBe('+60 m');
    expect(rowOf('distance').verdicts[1]).toBe('worse');
    // 加权综合分同理
    expect(rowOf('cost').texts).toEqual(['40.0', '100.0']);
    expect(rowOf('cost').deltas[1]).toBe('+60.0');
    // 用车不判优劣：有展示值但没有差值、没有优劣标记
    expect(rowOf('fleet').deltas[1]).toBe('');
    expect(rowOf('fleet').verdicts[1]).toBe('same');
    // 基准列永远是 base + 空差值
    for (const row of compare.rows) {
      expect(row.deltas[0], row.key).toBe('');
      expect(row.verdicts[0], row.key).toBe('base');
    }
  });

  it('单车平均抵消「派得少就天然省」：合计更小但每单更贵时也读得出来', () => {
    // 贪心派 3 单共 300 m，匈牙利派 1 单 40 m —— 合计匈牙利小，但每单平均 40 < 100 仍然更优
    const many = outcome({
      strategy: 'greedy',
      plans: [
        plan({ taskId: 't-1', cost: 100 }),
        plan({ taskId: 't-2', cost: 100 }),
        plan({ taskId: 't-3', cost: 100 })
      ],
      rejected: []
    });
    const few = outcome({ strategy: 'hungarian', plans: [cheapPlan({ taskId: 't-1' })], rejected: [] });
    const compare = metricComparisonOf([many, few], 'greedy')!;
    const avg = compare.rows.find((row) => row.key === 'avgDistance')!;
    expect(avg.texts).toEqual(['100 m', '40 m']);
    expect(avg.deltas[1]).toBe('-60 m');
    expect(avg.verdicts[1]).toBe('better');
  });

  it('派单差异只列「不一致」的行，没派的那一方是 null（界面显示未派发）', () => {
    const a = outcome({
      strategy: 'greedy',
      plans: [
        plan({ taskId: 't-1', vehicleCode: 'CAR-01' }),
        plan({ taskId: 't-2', vehicleCode: 'CAR-02' }),
        // t-3 两边都派给 AGV-02 —— 不是差异，不该出现在表里
        plan({ taskId: 't-3', vehicleCode: 'AGV-02' })
      ],
      rejected: []
    });
    const b = outcome({
      strategy: 'hungarian',
      plans: [
        plan({ taskId: 't-1', vehicleCode: 'DRN-01' }),
        plan({ taskId: 't-3', vehicleCode: 'AGV-02' })
      ],
      rejected: [reject({ taskId: 't-2' })]
    });
    const diff = assignmentDiffsOf([a, b], codes, 'greedy')!;
    expect(diff.columns.map((column) => column.label)).toEqual(['贪心', '匈牙利']);
    expect(diff.rows.map((row) => row.taskCode)).toEqual(['T-DEMO-0001', 'T-DEMO-0002']);
    expect(diff.rows[0]!.vehicles.map((cell) => cell.vehicleCode)).toEqual(['CAR-01', 'DRN-01']);
    // 匈牙利没派 t-2：null 就是「未派发」的数据形态
    expect(diff.rows[1]!.vehicles.map((cell) => cell.vehicleCode)).toEqual(['CAR-02', null]);
  });
});
