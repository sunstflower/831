import { describe, expect, it } from 'vitest';
import { DISPATCH_COST_WEIGHTS } from './constants.js';
import type { RouteEdgeInput, RouteNodeInput } from './route-graph.js';
import { runGreedy } from './dispatch-strategies.js';
import type { DispatchSnapshot, DispatchTaskView, DispatchVehicleView } from './dispatch-types.js';

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

describe('greedy（§7.1）', () => {
  it('U6 任务排序：优先级降序压过时间窗升序', () => {
    const urgent = task({ id: 'urgent', code: 'T-URG', priority: 'urgent', timeWindowStart: '2026-09-26T12:00:00.000Z' });
    const low = task({ id: 'low', code: 'T-LOW', priority: 'low', timeWindowStart: '2026-09-26T09:00:00.000Z' });
    const outcome = runGreedy(snapshot({ tasks: [low, urgent], vehicles: [vehicle(), vehicle({ id: 'v2', code: 'AGV-02' })] }));
    expect(outcome.plans.map((plan) => plan.taskId)).toEqual(['urgent', 'low']);
  });

  it('同优先级时时间窗更早者先派（都没有时间窗时按 id 稳定排序）', () => {
    const a = task({ id: 'b', code: 'T-B', timeWindowStart: '2026-09-26T09:00:00.000Z' });
    const b = task({ id: 'a', code: 'T-A', timeWindowStart: null });
    const outcome = runGreedy(snapshot({ tasks: [b, a], vehicles: [vehicle(), vehicle({ id: 'v2', code: 'AGV-02' })] }));
    expect(outcome.plans.map((plan) => plan.taskId)).toEqual(['b', 'a']);
  });

  it('挑代价最小的车（空驶更近的那台）', () => {
    const near = vehicle({ id: 'near', code: 'AGV-NEAR', startNodeId: 'n1' });
    const far = vehicle({ id: 'far', code: 'AGV-FAR', startNodeId: 'n3', x: 200 });
    const outcome = runGreedy(snapshot({ vehicles: [far, near] }));
    expect(outcome.plans[0]?.vehicleId).toBe('near');
  });

  it('U7 同一辆车不会被排两次重叠的活 → 第二个任务 TIMEWINDOW_CONFLICT', () => {
    const first = task({ id: 'a', code: 'T-A' });
    const second = task({ id: 'b', code: 'T-B' });
    const outcome = runGreedy(snapshot({ tasks: [first, second], vehicles: [vehicle()] }));
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0]?.taskId).toBe('a');
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.reason).toBe('TIMEWINDOW_CONFLICT');
  });

  it('时间窗不重叠时，同一辆车可以连排两单（首尾相接不算冲突）', () => {
    const first = task({ id: 'a', code: 'T-A', timeWindowStart: '2026-09-26T09:00:00.000Z' });
    const second = task({ id: 'b', code: 'T-B', timeWindowStart: '2026-09-26T09:03:00.000Z' });
    const outcome = runGreedy(snapshot({ tasks: [first, second], vehicles: [vehicle()] }));
    expect(outcome.plans).toHaveLength(2);
    expect(outcome.rejected).toHaveLength(0);
  });

  it('U1（策略层）全部车辆不可用 → 每个任务都是 VEHICLE_NOT_AVAILABLE', () => {
    const outcome = runGreedy(snapshot({ vehicles: [vehicle({ status: 'disabled' }), vehicle({ id: 'v2', code: 'AGV-02', status: 'fault' })] }));
    expect(outcome.plans).toEqual([]);
    expect(outcome.rejected.map((item) => item.reason)).toEqual(['VEHICLE_NOT_AVAILABLE']);
  });

  it('没有车辆时兜底为 NO_AVAILABLE_VEHICLE', () => {
    const outcome = runGreedy(snapshot({ vehicles: [] }));
    expect(outcome.rejected[0]?.reason).toBe('NO_AVAILABLE_VEHICLE');
    expect(outcome.rejected[0]?.detail.candidateCount).toBe(0);
  });

  it('summary 与 plans / rejected 对得上', () => {
    const outcome = runGreedy(snapshot({ tasks: [task({ id: 'a' }), task({ id: 'b', code: 'T-B' })] }));
    expect(outcome.summary.totalTasks).toBe(2);
    expect(outcome.summary.assigned).toBe(1);
    expect(outcome.summary.rejectedCount).toBe(1);
    expect(outcome.summary.totalCost).toBeCloseTo(outcome.plans[0]!.cost, 6);
    expect(outcome.summary.elapsedMs).toBe(0);
    expect(outcome.strategy).toBe('greedy');
  });

  it('U10 确定性：同一快照跑两次逐字段相同', () => {
    const input = snapshot({
      tasks: [task({ id: 'a' }), task({ id: 'b', code: 'T-B' }), task({ id: 'c', code: 'T-C', priority: 'high' })],
      vehicles: [vehicle(), vehicle({ id: 'v2', code: 'AGV-02' })]
    });
    expect(runGreedy(input)).toEqual(runGreedy(input));
  });
});
