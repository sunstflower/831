import { describe, expect, it } from 'vitest';
import { DISPATCH_COST_WEIGHTS } from './constants.js';
import type { RouteEdgeInput, RouteNodeInput, RouteRestrictionInput } from './route-graph.js';
import { chargeRiskOf, compositeScoreOf, costOf, createRunContext, evaluatePair, nearestNodeId, startNodeOf } from './dispatch-evaluate.js';
import { DISPATCH_UNSERVED_PENALTY_S, type DispatchSnapshot, type DispatchTaskView, type DispatchVehicleView } from './dispatch-types.js';

const NOW = '2026-09-26T08:00:00.000Z';

const nodes: RouteNodeInput[] = [
  { id: 'n1', x: 0, y: 0, status: 'enabled' },
  { id: 'n2', x: 100, y: 0, status: 'enabled' },
  { id: 'n3', x: 200, y: 0, status: 'enabled' }
];

const edges: RouteEdgeInput[] = [
  { id: 'e12', fromNodeId: 'n1', toNodeId: 'n2', lengthM: 100, speedLimitMps: null, status: 'enabled' },
  { id: 'e23', fromNodeId: 'n2', toNodeId: 'n3', lengthM: 100, speedLimitMps: null, status: 'enabled' }
];

function vehicle(over: Partial<DispatchVehicleView> = {}): DispatchVehicleView {
  return {
    id: 'v1',
    code: 'AGV-01',
    type: 'agv',
    status: 'idle',
    capacityKg: 100,
    loadKg: 0,
    battery: 100,
    maxSpeedMps: 1.5,
    x: 0,
    y: 0,
    startNodeId: 'n1',
    freeAt: NOW,
    ...over
  };
}

function task(over: Partial<DispatchTaskView> = {}): DispatchTaskView {
  return {
    id: 't1',
    code: 'T-001',
    priority: 'normal',
    cargoKg: 10,
    fromNodeId: 'n1',
    toNodeId: 'n3',
    timeWindowStart: null,
    timeWindowEnd: null,
    ...over
  };
}

function snapshot(over: Partial<DispatchSnapshot> = {}): DispatchSnapshot {
  return {
    tasks: [task()],
    vehicles: [vehicle()],
    nodes,
    edges,
    restrictions: [],
    occupiedSlots: [],
    weights: { ...DISPATCH_COST_WEIGHTS },
    now: NOW,
    ...over
  };
}

function restrictedNode(id: string): RouteRestrictionInput {
  return { type: 'node', targetId: id, startAt: null, endAt: null, vehicleType: null, status: 'active' };
}

describe('evaluate · §5 六步短路', () => {
  it('可行：给出完整 costDetail、路线与占用区间', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task(), vehicle(), { occupied: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.route?.distanceM).toBe(200);
    // AGV 默认 1.5 m/s → 200 m = 133.333 s
    expect(result.plan.costDetail.executeTimeS).toBeCloseTo(400 / 3, 3);
    expect(result.plan.costDetail.deadheadTimeS).toBe(0);
    expect(result.plan.occupiedFrom).toBe(NOW);
    expect(result.plan.occupiedTo).toBe('2026-09-26T08:02:13.333Z');
    expect(result.plan.cost).toBeCloseTo(costOf(result.plan.costDetail, DISPATCH_COST_WEIGHTS), 6);
  });

  it('U1 步骤 1：非 idle 车辆 → VEHICLE_NOT_AVAILABLE（先于载重与路线判断）', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task({ cargoKg: 999 }), vehicle({ status: 'busy' }), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('VEHICLE_NOT_AVAILABLE');
    expect(result.reject.detail.status).toBe('busy');
  });

  it('U2 步骤 2：载重不足 → LOAD_EXCEEDED，detail 带数值', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task({ cargoKg: 120 }), vehicle({ loadKg: 30 }), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('LOAD_EXCEEDED');
    expect(result.reject.detail.remainKg).toBe(70);
    expect(result.reject.message).toContain('AGV-01');
  });

  it('U3 步骤 4：目标节点被禁行封住 → RESTRICTION_VIOLATED（不是 UNREACHABLE）', () => {
    const ctx = createRunContext(snapshot({ restrictions: [restrictedNode('n3')] }));
    const result = evaluatePair(ctx, task(), vehicle(), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('RESTRICTION_VIOLATED');
    expect(result.reject.detail.routeReason).toBe('BLOCKED');
  });

  it('U3b 步骤 4：没有这条路（不是被封）→ UNREACHABLE', () => {
    const ctx = createRunContext(snapshot({ edges: [edges[0]!] }));
    const result = evaluatePair(ctx, task(), vehicle(), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('UNREACHABLE');
    expect(result.reject.detail.routeReason).toBe('NOT_FOUND_PATH');
  });

  it('U4 步骤 5：与该车既有占用相交 → TIMEWINDOW_CONFLICT', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task(), vehicle(), {
      occupied: [{ vehicleId: 'v1', from: Date.parse(NOW), to: Date.parse('2026-09-26T08:01:00.000Z') }]
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('TIMEWINDOW_CONFLICT');
    expect(result.reject.detail.conflictWith).toBeDefined();
    // 「被占用」这一种必须自报家门：界面与 explain 靠 `kind` 分辨，不靠反推
    expect(result.reject.detail.kind).toBe('occupied');
  });

  it('步骤 5：别人的占用不影响本车', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task(), vehicle(), {
      occupied: [{ vehicleId: 'v2', from: Date.parse(NOW), to: Date.parse('2026-09-26T09:00:00.000Z') }]
    });
    expect(result.ok).toBe(true);
  });

  it('步骤 5：早到要等 —— waitTimeS 计入代价，占用从「实际开工」起算', () => {
    const ctx = createRunContext(snapshot());
    const start = '2026-09-26T10:00:00.000Z';
    const result = evaluatePair(ctx, task({ timeWindowStart: start }), vehicle(), { occupied: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.costDetail.waitTimeS).toBeCloseTo(2 * 3600, 0);
    expect(result.plan.occupiedFrom).toBe(start);
  });

  it('步骤 5：晚于窗口末端超过容忍 → TIMEWINDOW_CONFLICT', () => {
    const ctx = createRunContext(snapshot());
    // 执行段 133.3 s，窗口末端在「预计完成」前 7 分钟 → 晚点 433 s > 容忍 300 s
    const result = evaluatePair(ctx, task({ timeWindowEnd: '2026-09-26T07:55:00.000Z' }), vehicle(), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('TIMEWINDOW_CONFLICT');
    expect(result.reject.detail.lateS).toBeGreaterThan(300);
    expect(result.reject.detail.kind).toBe('late');
  });

  it('步骤 5：窗口内轻微晚点只记罚分，不拒绝', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task({ timeWindowEnd: '2026-09-26T08:02:00.000Z' }), vehicle(), { occupied: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.costDetail.penaltyLateS).toBeGreaterThan(0);
    expect(result.plan.costDetail.penaltyLateS).toBeLessThanOrEqual(300);
  });

  it('U5 步骤 6：电量不足 → BATTERY_INSUFFICIENT', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task(), vehicle({ battery: 20 }), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('BATTERY_INSUFFICIENT');
    expect(result.reject.detail.remainBattery).toBeLessThan(20);
  });

  it('电量宽松时 chargeRisk 为 0；低于舒适电量后按缺口给分', () => {
    expect(chargeRiskOf(100)).toBe(0);
    expect(chargeRiskOf(40)).toBe(0);
    expect(chargeRiskOf(30)).toBeCloseTo(0.25, 6);
    expect(chargeRiskOf(0)).toBe(1);
  });

  it('算法不改入参：occupied 传入后原样不动', () => {
    const ctx = createRunContext(snapshot());
    const occupied: Array<{ vehicleId: string; from: number; to: number }> = [];
    evaluatePair(ctx, task(), vehicle(), { occupied });
    expect(occupied).toEqual([]);
  });

  it('时间无法解析的 freeAt 退化成 now，而不是当成 1970 年', () => {
    const ctx = createRunContext(snapshot());
    const result = evaluatePair(ctx, task(), vehicle({ freeAt: '' }), { occupied: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.occupiedFrom).toBe(NOW);
  });
});

describe('evaluate · 出发节点', () => {
  it('优先用 current_node_id（startNodeId）', () => {
    expect(startNodeOf(vehicle({ startNodeId: 'n2' }), nodes)).toBe('n2');
  });

  it('没有 startNodeId 时按坐标就近取点', () => {
    expect(startNodeOf(vehicle({ startNodeId: null, x: 190, y: 0 }), nodes)).toBe('n3');
  });

  it('没有可用节点 → null（由调用方报不可达）', () => {
    expect(nearestNodeId([], 0, 0)).toBeNull();
    const ctx = createRunContext(snapshot({ nodes: [], edges: [] }));
    const result = evaluatePair(ctx, task(), vehicle({ startNodeId: null }), { occupied: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reject.reason).toBe('UNREACHABLE');
  });
});

describe('批次加权综合分（§7.3）', () => {
  it('= 已派发代价之和 + 未派发单数 × 未派发惩罚（被拒的不能记 0）', () => {
    const plans = [{ cost: 10 }, { cost: 25.5 }];
    expect(compositeScoreOf(plans, 0)).toBeCloseTo(35.5, 6);
    expect(compositeScoreOf(plans, 2)).toBeCloseTo(35.5 + 2 * DISPATCH_UNSERVED_PENALTY_S, 6);
  });

  it('惩罚严格大于单条计划代价上限 →「能派就派」不会被反向激励', () => {
    // 单条代价的上界 = 空驶+执行时长 × w1/w2 + 晚点容忍 300s × w4 + 续航风险上界 0.5 × w5。
    // 1674 s 是**实测**值：在 30 节点 / 90 边的演示路网上穷举（车 × 有序节点对）得到的
    // 最长「空驶 + 执行」时长 1673.3 s（AGV-01：DEPOT → GATE_N → N00）。地图变大后
    // 这个数要重测 —— `desktop/src/domain/dispatch/dispatch.service.test.ts` 里有一条
    // 按真实 seed 数据自动跑的同类护栏，改地图时它会先红。
    const worstDriveS = 1674;
    // `worstDriveS` 是「空驶 + 执行」的**合计**时长，故乘两者中较大的权重即可覆盖两者
    const worstPlanCost =
      worstDriveS * Math.max(DISPATCH_COST_WEIGHTS.deadhead, DISPATCH_COST_WEIGHTS.execute) +
      300 * DISPATCH_COST_WEIGHTS.late +
      0.5 * DISPATCH_COST_WEIGHTS.chargeRisk;
    expect(DISPATCH_UNSERVED_PENALTY_S).toBeGreaterThan(worstPlanCost);
  });

  it('多派一单永远优于少派一单（即使那一单是最贵的一单）', () => {
    const expensive = { cost: 1674 + 300 * DISPATCH_COST_WEIGHTS.late + 0.5 * DISPATCH_COST_WEIGHTS.chargeRisk };
    const cheap = { cost: 0 };
    expect(compositeScoreOf([expensive], 0)).toBeLessThan(compositeScoreOf([cheap], 1));
  });
});

describe('evaluate · 确定性', () => {
  it('同一输入两次评估结果完全相同（不依赖当前时钟）', () => {
    const a = evaluatePair(createRunContext(snapshot()), task(), vehicle({ freeAt: '' }), { occupied: [] });
    const b = evaluatePair(createRunContext(snapshot()), task(), vehicle({ freeAt: '' }), { occupied: [] });
    expect(a).toEqual(b);
  });
});
