import { describe, expect, it } from 'vitest';
import { DISPATCH_COST_WEIGHTS } from './constants.js';
import type { RouteNodeInput } from './route-graph.js';
import { DISPATCH_FORBIDDEN_COST } from './dispatch-types.js';
import { runGreedy, runHungarian, solveAssignment } from './dispatch-strategies.js';
import type { DispatchSnapshot, DispatchTaskView, DispatchVehicleView } from './dispatch-types.js';

const NOW = '2026-09-26T08:00:00.000Z';

const nodes: RouteNodeInput[] = [
  { id: 'n1', x: 0, y: 0, status: 'enabled' },
  { id: 'n2', x: 100, y: 0, status: 'enabled' },
  { id: 'n3', x: 200, y: 0, status: 'enabled' }
];

const edges = [
  { id: 'e12', fromNodeId: 'n1', toNodeId: 'n2', lengthM: 100, speedLimitMps: null as number | null, status: 'enabled' as const },
  { id: 'e23', fromNodeId: 'n2', toNodeId: 'n3', lengthM: 100, speedLimitMps: null as number | null, status: 'enabled' as const }
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

describe('solveAssignment（标准匈牙利，n ≤ m）', () => {
  it('1×1', () => {
    expect(solveAssignment([[5]], 1, 1)).toEqual([0]);
  });

  it('2×2 取全局最小（而不是逐行贪心）', () => {
    expect(solveAssignment([[1, 100], [100, 1]], 2, 2)).toEqual([0, 1]);
    // 逐行贪心会先给第 0 行挑 1，第 1 行只剩 3 → 总代价 4；
    // 全局最优是第 0 行挑 2、第 1 行挑 1 → 总代价 3。这正是匈牙利存在的理由。
    expect(solveAssignment([[1, 2], [1, 3]], 2, 2)).toEqual([1, 0]);
  });

  it('n < m（行少于列）：每行都能分到一格', () => {
    const assignment = solveAssignment([[10, 1, 9]], 1, 3);
    expect(assignment).toEqual([1]);
  });

  it('不可行格（有限大数）不会破坏求解：宁可指派到可行格', () => {
    const assignment = solveAssignment([[DISPATCH_FORBIDDEN_COST, 7], [3, DISPATCH_FORBIDDEN_COST]], 2, 2);
    expect(assignment).toEqual([1, 0]);
  });
});

describe('hungarian（§7.2）', () => {
  it('U9 任务多于车辆：多出来的任务被拒，且 reason 是 NO_AVAILABLE_VEHICLE', () => {
    const tasks = [task({ id: 'a', priority: 'urgent' }), task({ id: 'b', code: 'T-B', priority: 'normal' }), task({ id: 'c', code: 'T-C', priority: 'low' })];
    const outcome = runHungarian(snapshot({ tasks, vehicles: [vehicle(), vehicle({ id: 'v2', code: 'AGV-02' })] }));
    expect(outcome.plans).toHaveLength(2);
    expect(outcome.rejected).toHaveLength(1);
    expect(outcome.rejected[0]?.reason).toBe('NO_AVAILABLE_VEHICLE');
    // 被拒的是优先级最低的那个
    expect(outcome.rejected[0]?.taskId).toBe('c');
    // 两辆车各接一单
    expect(new Set(outcome.plans.map((plan) => plan.vehicleId)).size).toBe(2);
  });

  it('U8 整体代价不劣于贪心（同一批输入）', () => {
    const tasks = [task({ id: 'a', priority: 'high' }), task({ id: 'b', code: 'T-B' })];
    const vehicles = [vehicle({ id: 'near', code: 'AGV-NEAR', startNodeId: 'n1' }), vehicle({ id: 'far', code: 'AGV-FAR', startNodeId: 'n3', x: 200 })];
    const input = snapshot({ tasks, vehicles });
    const greedy = runGreedy(input);
    const hungarian = runHungarian(input);
    expect(hungarian.summary.assigned).toBe(greedy.summary.assigned);
    expect(hungarian.summary.totalCost).toBeLessThanOrEqual(greedy.summary.totalCost + 1e-9);
  });

  it('不可行任务在矩阵里被拒，不会硬塞给某辆车', () => {
    const tasks = [task({ id: 'a', cargoKg: 999 })];
    const outcome = runHungarian(snapshot({ tasks }));
    expect(outcome.plans).toHaveLength(0);
    expect(outcome.rejected[0]?.reason).toBe('LOAD_EXCEEDED');
  });

  it('任务多于车辆时（2 任务 / 1 车）走预拒绝，不产生重叠指派', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', code: 'T-B' })];
    const outcome = runHungarian(snapshot({ tasks, vehicles: [vehicle()] }));
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.rejected).toHaveLength(1);
    // §7.2 步骤 2：超编的任务在进矩阵之前就被拒，原因是「没有可用车辆」
    expect(outcome.rejected[0]?.reason).toBe('NO_AVAILABLE_VEHICLE');
    // 计划里只有一台车，且至多一单 —— 不会出现同一辆车两条重叠指派
    expect(outcome.plans.filter((plan) => plan.vehicleId === 'v1')).toHaveLength(1);
  });

  it('一对一匹配保证每台车至多一单（不存在本批内同车冲突）', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b', code: 'T-B' })];
    const outcome = runHungarian(snapshot({ tasks, vehicles: [vehicle(), vehicle({ id: 'v2', code: 'AGV-02' })] }));
    const assigned = outcome.plans.map((plan) => plan.vehicleId);
    expect(assigned).toHaveLength(2);
    expect(new Set(assigned).size).toBe(2);
  });

  it('没有车辆：全部任务被拒', () => {
    const outcome = runHungarian(snapshot({ vehicles: [] }));
    expect(outcome.plans).toEqual([]);
    expect(outcome.rejected[0]?.reason).toBe('NO_AVAILABLE_VEHICLE');
  });

  it('确定性：同一快照跑两次逐字段相同', () => {
    const input = snapshot({
      tasks: [task({ id: 'a' }), task({ id: 'b', code: 'T-B' }), task({ id: 'c', code: 'T-C', priority: 'urgent' })],
      vehicles: [vehicle(), vehicle({ id: 'v2', code: 'AGV-02', startNodeId: 'n3', x: 200 })]
    });
    expect(runHungarian(input)).toEqual(runHungarian(input));
  });
});
