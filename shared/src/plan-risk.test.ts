import { describe, expect, it } from 'vitest';
import {
  buildPlanRiskReport,
  scanPlanRisks,
  type PlanRiskPlanInput,
  type PlanRiskTaskInput,
  type PlanRiskVehicleInput
} from './plan-risk.js';
import type { TaskStatus, VehicleStatus } from './enums.js';

/**
 * 风险预检的用例。
 *
 * 每条都钉住「**什么算一条风险**」这个判断本身，而不是文案：
 * 文案改一个字不该让用例变红，但「首尾相接算不算撞单」这种判断改了必须变红。
 */

const NOW = Date.parse('2026-09-28T12:00:00.000Z');
const NOWISO = '2026-09-28T12:00:00.000Z';
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();

function task(over: Partial<PlanRiskTaskInput> & { id: string }): PlanRiskTaskInput {
  return {
    code: over.id.toUpperCase(),
    status: 'assigned' as TaskStatus,
    timeWindowStart: at(-30),
    timeWindowEnd: at(60),
    cargoKg: 10,
    ...over
  };
}

function plan(over: Partial<PlanRiskPlanInput> & { taskId: string; vehicleId: string }): PlanRiskPlanInput {
  return {
    vehicleCode: over.vehicleId.toUpperCase(),
    routeId: 'route-1',
    occupiedFrom: at(0),
    occupiedTo: at(10),
    ...over
  };
}

function vehicle(over: Partial<PlanRiskVehicleInput> & { id: string }): PlanRiskVehicleInput {
  return { code: over.id.toUpperCase(), status: 'idle' as VehicleStatus, battery: 80, ...over };
}

const scan = (
  tasks: PlanRiskTaskInput[],
  plans: PlanRiskPlanInput[],
  vehicles: PlanRiskVehicleInput[],
  options: Partial<Parameters<typeof scanPlanRisks>[3]> = {}
) => scanPlanRisks(tasks, plans, vehicles, { nowMs: NOW, ...options });

const kindsOf = (items: ReturnType<typeof scan>) => items.map((item) => item.kind);

describe('任务风险预检 · 任务冲突', () => {
  it('同一辆车两单首尾相接**不算**撞单（内核允许接力，预检不能反过来把它判成冲突）', () => {
    const items = scan(
      [task({ id: 't1' }), task({ id: 't2' })],
      [
        plan({ taskId: 't1', vehicleId: 'v1', occupiedFrom: at(0), occupiedTo: at(10) }),
        plan({ taskId: 't2', vehicleId: 'v1', occupiedFrom: at(10), occupiedTo: at(20) })
      ],
      [vehicle({ id: 'v1' })]
    );
    expect(kindsOf(items)).not.toContain('VEHICLE_OVERLAP');
  });

  it('重叠 1 秒也算撞单，并给出重叠秒数与两单编码', () => {
    const items = scan(
      [task({ id: 't1', code: 'T-1' }), task({ id: 't2', code: 'T-2' })],
      [
        plan({ taskId: 't1', vehicleId: 'v1', vehicleCode: 'CAR-01', occupiedFrom: at(0), occupiedTo: at(10) }),
        plan({ taskId: 't2', vehicleId: 'v1', vehicleCode: 'CAR-01', occupiedFrom: at(9), occupiedTo: at(20) })
      ],
      [vehicle({ id: 'v1' })]
    );
    const overlap = items.find((item) => item.kind === 'VEHICLE_OVERLAP');
    expect(overlap).toBeDefined();
    expect(overlap!.level).toBe('critical');
    expect(overlap!.detail['overlapS']).toBe(60);
    expect(overlap!.taskCodes).toEqual(['T-1', 'T-2']);
  });

  it('已完成的两单即便区间相交也不报（历史数据不该一直挂着冲突）', () => {
    const items = scan(
      [task({ id: 't1', status: 'finished' }), task({ id: 't2', status: 'finished' })],
      [
        plan({ taskId: 't1', vehicleId: 'v1', occupiedFrom: at(0), occupiedTo: at(20) }),
        plan({ taskId: 't2', vehicleId: 'v1', occupiedFrom: at(5), occupiedTo: at(25) })
      ],
      [vehicle({ id: 'v1' })]
    );
    expect(kindsOf(items)).not.toContain('VEHICLE_OVERLAP');
  });

  it('车掉线 / 在充电 / 故障 → 车辆不可用（任务派了也跑不了）', () => {
    for (const status of ['offline', 'fault', 'charging', 'disabled'] as const) {
      const items = scan(
        [task({ id: 't1' })],
        [plan({ taskId: 't1', vehicleId: 'v1' })],
        [vehicle({ id: 'v1', status })]
      );
      expect(kindsOf(items), status).toContain('VEHICLE_UNAVAILABLE');
    }
  });

  it('电量低于下限却还有未完成任务 → 电量不足；正常电量不报', () => {
    const low = scan([task({ id: 't1' })], [plan({ taskId: 't1', vehicleId: 'v1' })], [vehicle({ id: 'v1', battery: 12 })]);
    expect(kindsOf(low)).toContain('BATTERY_RISK');
    const ok = scan([task({ id: 't1' })], [plan({ taskId: 't1', vehicleId: 'v1' })], [vehicle({ id: 'v1', battery: 55 })]);
    expect(kindsOf(ok)).not.toContain('BATTERY_RISK');
  });

  it('有计划但没有路线 → 缺路线（地图上画不出来）', () => {
    const items = scan([task({ id: 't1' })], [plan({ taskId: 't1', vehicleId: 'v1', routeId: null })], [vehicle({ id: 'v1' })]);
    expect(kindsOf(items)).toContain('PLAN_WITHOUT_ROUTE');
  });
});

describe('任务风险预检 · 任务超时', () => {
  it('预计完成晚于时间窗末端 → 预计超时，并给出晚点秒数', () => {
    const items = scan(
      [task({ id: 't1', code: 'T-1', timeWindowEnd: at(5) })],
      [plan({ taskId: 't1', vehicleId: 'v1', occupiedFrom: at(0), occupiedTo: at(7) })],
      [vehicle({ id: 'v1' })]
    );
    const late = items.find((item) => item.kind === 'LATE_FINISH');
    expect(late).toBeDefined();
    expect(late!.detail['lateS']).toBe(120);
    // 120 s ≤ 默认容忍 300 s → 只是警告，不是「必须处理」
    expect(late!.level).toBe('warning');
  });

  it('晚点超出容忍秒数时升级为 critical（这种计划本不该被派出）', () => {
    const items = scan(
      [task({ id: 't1', timeWindowEnd: at(0) })],
      [plan({ taskId: 't1', vehicleId: 'v1', occupiedFrom: at(1), occupiedTo: at(20) })],
      [vehicle({ id: 'v1' })]
    );
    expect(items.find((item) => item.kind === 'LATE_FINISH')?.level).toBe('critical');
  });

  it('时间窗已过但任务没结束 → 已超时；时间窗还没到则不报', () => {
    const expired = scan([task({ id: 't1', status: 'running', timeWindowEnd: at(-3) })], [], []);
    expect(kindsOf(expired)).toContain('WINDOW_EXPIRED');
    expect(expired.find((item) => item.kind === 'WINDOW_EXPIRED')?.detail['overdueS']).toBe(180);

    const fresh = scan([task({ id: 't1', status: 'running', timeWindowEnd: at(30) })], [], []);
    expect(kindsOf(fresh)).not.toContain('WINDOW_EXPIRED');
  });

  it('待派发（pending）任务的时间窗过期也要报「已超时」—— 它恰恰是最该报的那一类', () => {
    /*
     * 回归护栏：曾经用「占用着车辆的状态」（assigned/running/paused）去过超时循环，
     * 于是 `pending` 任务**永远不报超时** —— 而待派发正是最容易超时的那一类
     * （连车都还没排上）。这类错误不报错、不影响其它断言，只让功能静默少一半。
     */
    const items = scan([task({ id: 't1', status: 'pending', timeWindowEnd: at(-5) })], [], []);
    expect(kindsOf(items)).toContain('WINDOW_EXPIRED');
  });

  it('待派发任务没有计划 → 未派发；时间窗已过则升级为 critical', () => {
    const waiting = scan([task({ id: 't1', status: 'pending', timeWindowEnd: at(30) })], [], []);
    expect(waiting.find((item) => item.kind === 'UNASSIGNED_TASK')?.level).toBe('warning');

    const overdue = scan([task({ id: 't1', status: 'pending', timeWindowEnd: at(-10) })], [], []);
    const item = overdue.find((entry) => entry.kind === 'UNASSIGNED_TASK');
    expect(item?.level).toBe('critical');
    expect(item?.detail['overdueS']).toBe(600);
  });

  it('已派发（有计划）的任务不再报「未派发」', () => {
    const items = scan(
      [task({ id: 't1', status: 'assigned' })],
      [plan({ taskId: 't1', vehicleId: 'v1' })],
      [vehicle({ id: 'v1' })]
    );
    expect(kindsOf(items)).not.toContain('UNASSIGNED_TASK');
  });
});

describe('任务风险预检 · 报告形状', () => {
  it('排序稳定：critical 在前，同类内按任务编码', () => {
    const items = scan(
      [
        task({ id: 't2', code: 'B-2', status: 'pending', timeWindowEnd: at(30) }),
        task({ id: 't1', code: 'A-1', status: 'pending', timeWindowEnd: at(30) })
      ],
      [],
      []
    );
    expect(items.every((item) => item.kind === 'UNASSIGNED_TASK')).toBe(true);
    expect(items.map((item) => item.taskCodes[0])).toEqual(['A-1', 'B-2']);
  });

  it('同样的输入两次扫描结果完全相同（可复核，无隐藏时钟）', () => {
    const tasks = [task({ id: 't1', status: 'pending' })];
    const plans: PlanRiskPlanInput[] = [];
    const vehicles = [vehicle({ id: 'v1' })];
    expect(scan(tasks, plans, vehicles)).toEqual(scan(tasks, plans, vehicles));
  });

  it('buildPlanRiskReport 的计数与记录一一对应', () => {
    const items = scan(
      [task({ id: 't1', timeWindowEnd: at(-10) })],
      [plan({ taskId: 't1', vehicleId: 'v1', routeId: null, occupiedFrom: at(0), occupiedTo: at(1) })],
      [vehicle({ id: 'v1', battery: 5 })]
    );
    const report = buildPlanRiskReport(items, '2026-09-28T12:00:00.000Z');
    expect(report.total).toBe(items.length);
    expect(report.counts.critical + report.counts.warning + report.counts.info).toBe(items.length);
    expect(report.counts.critical).toBeGreaterThan(0);
  });
});

describe('任务风险预检 · 派发区块与缺口（同一份输入的第二、三个视图）', () => {
  it('assignments 只含未完成任务名下的计划，并带上任务编码与车辆编码', () => {
    const tasks = [task({ id: 't1', code: 'T-1' }), task({ id: 't9', code: 'T-9', status: 'finished' })];
    const plans = [
      plan({ taskId: 't1', vehicleId: 'v1', vehicleCode: 'CAR-01' }),
      plan({ taskId: 't9', vehicleId: 'v2', vehicleCode: 'CAR-02' })
    ];
    const report = buildPlanRiskReport(scan(tasks, plans, []), NOWISO, { tasks, plans });
    expect(report.assignments.map((row) => row.taskCode)).toEqual(['T-1']);
    expect(report.assignments[0]!.vehicleCode).toBe('CAR-01');
  });

  it('assignments 排序固定在服务端：按车辆编码、再按开始时刻', () => {
    const tasks = [task({ id: 't1', code: 'T-1' }), task({ id: 't2', code: 'T-2' }), task({ id: 't3', code: 'T-3' })];
    const plans = [
      plan({ taskId: 't3', vehicleId: 'v2', vehicleCode: 'CAR-02', occupiedFrom: at(0), occupiedTo: at(5) }),
      plan({ taskId: 't2', vehicleId: 'v1', vehicleCode: 'CAR-01', occupiedFrom: at(20), occupiedTo: at(25) }),
      plan({ taskId: 't1', vehicleId: 'v1', vehicleCode: 'CAR-01', occupiedFrom: at(0), occupiedTo: at(5) })
    ];
    const report = buildPlanRiskReport(scan(tasks, plans, []), NOWISO, { tasks, plans });
    expect(report.assignments.map((row) => `${row.vehicleCode}:${row.taskCode}`)).toEqual([
      'CAR-01:T-1',
      'CAR-01:T-2',
      'CAR-02:T-3'
    ]);
  });

  it('unassignedTasks 只列待派发且没有计划的任务', () => {
    const tasks = [
      task({ id: 't1', code: 'T-1', status: 'pending' }),
      task({ id: 't2', code: 'T-2', status: 'pending' }),
      task({ id: 't3', code: 'T-3', status: 'assigned' })
    ];
    const plans = [plan({ taskId: 't2', vehicleId: 'v1' })];
    const report = buildPlanRiskReport(scan(tasks, plans, []), NOWISO, { tasks, plans });
    expect(report.unassignedTasks.map((row) => row.taskCode)).toEqual(['T-1']);
  });

  it('不传 context 时两个数组为空（保持向后兼容，不会 undefined）', () => {
    const report = buildPlanRiskReport([], NOWISO);
    expect(report.assignments).toEqual([]);
    expect(report.unassignedTasks).toEqual([]);
  });
});
