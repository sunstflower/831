import { describe, expect, it } from 'vitest';
import type { MonitorVehicleItem, TaskListItem } from '@udm/shared';
import {
  batteryToneOf,
  fleetAttentionCount,
  fleetBucketsOf,
  FLEET_BUCKET_STATUSES,
  fleetRowsOf,
  trackPathOf
} from './model';

/**
 * 车辆中心的**纯函数**：分桶统计、异常计数、行组装、轨迹投影。
 *
 * 页面只看它们「有没有被渲染出来」（`FleetPage.test.tsx`），算得对不对在这里钉住 ——
 * 尤其是三个刻意的口径：
 *   1. 「需关注」**不含停用**（disabled 是刻意关掉的，不是异常）；
 *   2. 电量色调的两条线来自调度内核（40% 舒适线 / 20% 下限），本文件不另立阈值；
 *   3. 轨迹投影要翻转 y 轴，且单点/共线不能产出 `NaN`（SVG 的 `d` 里出现 NaN 会整条不显示）。
 */

function vehicle(overrides: Partial<MonitorVehicleItem> = {}): MonitorVehicleItem {
  return {
    id: 'seed-veh-agv01',
    code: 'AGV-01',
    name: '一号 AGV',
    type: 'agv',
    status: 'idle',
    capacityKg: 500,
    loadKg: 0,
    maxSpeedMps: 1.5,
    battery: 80,
    x: 10,
    y: 20,
    currentNodeId: 'seed-n01',
    online: true,
    lastHeartbeatAt: '2026-10-03T08:00:00.000Z',
    remark: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-03T08:00:00.000Z',
    currentTaskId: null,
    ...overrides
  };
}

function task(overrides: Partial<TaskListItem> = {}): TaskListItem {
  return {
    id: 'seed-task-01',
    code: 'T-DEMO-0001',
    title: '演示任务',
    status: 'running',
    priority: 'normal',
    cargoKg: 100,
    fromSiteId: 'seed-site-a',
    toSiteId: 'seed-site-b',
    fromSiteName: null,
    toSiteName: null,
    timeWindowStart: null,
    timeWindowEnd: null,
    assignedVehicleId: 'seed-veh-agv01',
    vehicleCode: 'AGV-01',
    progress: 0.5,
    createdAt: '2026-10-03T07:00:00.000Z',
    createdBy: 'seed-admin',
    ...overrides
  };
}

describe('车辆中心 · 状态分桶', () => {
  it('七个桶恒在（空桶也返回）：表格与 KPI 的列宽不随数据跳动', () => {
    const buckets = fleetBucketsOf([]);
    expect(buckets.map((bucket) => bucket.status)).toEqual(FLEET_BUCKET_STATUSES);
    expect(buckets).toHaveLength(7);
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it('按状态计数，并带上中文名与色调（都来自唯一的展示口径）', () => {
    const buckets = fleetBucketsOf([
      vehicle({ id: 'a', status: 'idle' }),
      vehicle({ id: 'b', status: 'idle' }),
      vehicle({ id: 'c', status: 'busy' }),
      vehicle({ id: 'd', status: 'fault' })
    ]);
    const byStatus = new Map(buckets.map((bucket) => [bucket.status, bucket]));
    expect(byStatus.get('idle')!.count).toBe(2);
    expect(byStatus.get('busy')!.count).toBe(1);
    expect(byStatus.get('fault')!.count).toBe(1);
    expect(byStatus.get('idle')!.label).toBe('空闲');
    expect(byStatus.get('fault')!.tone).toBe('danger');
    expect(byStatus.get('reserved')!.count).toBe(0);
  });
});

describe('车辆中心 · 需关注计数', () => {
  it('充电中 / 离线 / 故障计入；空闲、在途、**停用**不计入', () => {
    const count = fleetAttentionCount([
      vehicle({ id: 'a', status: 'charging' }),
      vehicle({ id: 'b', status: 'offline' }),
      vehicle({ id: 'c', status: 'fault' }),
      vehicle({ id: 'd', status: 'idle' }),
      vehicle({ id: 'e', status: 'busy' }),
      vehicle({ id: 'f', status: 'disabled' })
    ]);
    // 停用是刻意关掉的，报成「需关注」会让这个数字永远不为零
    expect(count).toBe(3);
  });
});

describe('车辆中心 · 电量色调', () => {
  it('40% 是舒适线、20% 是下限（与调度内核同一组常量）', () => {
    expect(batteryToneOf(100)).toBe('ok');
    expect(batteryToneOf(40)).toBe('ok');
    expect(batteryToneOf(39.9)).toBe('warn');
    expect(batteryToneOf(20)).toBe('warn');
    expect(batteryToneOf(19.9)).toBe('danger');
    expect(batteryToneOf(0)).toBe('danger');
  });
});

describe('车辆中心 · 行组装', () => {
  it('currentTaskId 翻成任务编码；查不到时退化成 id、为空时给 null（渲染成「—」）', () => {
    const rows = fleetRowsOf(
      [
        vehicle({ id: 'a', code: 'AGV-01', currentTaskId: 'seed-task-01' }),
        vehicle({ id: 'b', code: 'AGV-02', currentTaskId: 'ghost-task' }),
        vehicle({ id: 'c', code: 'AGV-03', currentTaskId: null })
      ],
      [task({ id: 'seed-task-01', code: 'T-DEMO-0001' })]
    );
    expect(rows[0]!.taskCode).toBe('T-DEMO-0001');
    // 任务清单是「在跑的 + 出问题的」；不在清单里说明这条关联已经过期，如实显示 id 而不是空
    expect(rows[1]!.taskCode).toBe('ghost-task');
    expect(rows[2]!.taskCode).toBeNull();
  });

  it('载重列带单位、比例封顶在 1；位置与心跳来自快照，不在这里重算', () => {
    const [row] = fleetRowsOf(
      [vehicle({ loadKg: 250, capacityKg: 500, x: 12.34, y: -5, battery: 55, lastHeartbeatAt: '2026-10-03T08:00:00.000Z' })],
      []
    );
    expect(row!.loadText).toBe('250 / 500 kg');
    expect(row!.loadRatio).toBe(0.5);
    expect(row!.positionText).toBe('12.3, -5');
    expect(row!.battery).toBe(55);
    expect(row!.heartbeatText).toBe('2026-10-03 08:00:00');
  });

  it('额定载重为 0 时比例兜底为 0，不产生 NaN / Infinity 宽度', () => {
    const [row] = fleetRowsOf([vehicle({ loadKg: 10, capacityKg: 0 })], []);
    expect(row!.loadRatio).toBe(0);
  });
});

describe('车辆中心 · 轨迹投影', () => {
  it('空轨迹返回空字符串（调用方据此显示「暂无轨迹」而不是一条坏 path）', () => {
    expect(trackPathOf([])).toBe('');
  });

  it('单点画成 M 指令，共线时另一轴不产生 NaN', () => {
    const single = trackPathOf([{ ts: 't', x: 0, y: 0, speedMps: 0, status: 'running', taskId: null }]);
    expect(single).toBe('M 24.0 108.0');
    const line = trackPathOf([
      { ts: 't1', x: 0, y: 0, speedMps: 0, status: 'running', taskId: null },
      { ts: 't2', x: 100, y: 0, speedMps: 0, status: 'running', taskId: null }
    ]);
    expect(line).not.toContain('NaN');
    expect(line.startsWith('M ')).toBe(true);
  });

  it('y 轴翻转：平面坐标的 y 越大，画布上越靠上（SVG 的 y 向下）', () => {
    const path = trackPathOf([
      { ts: 't1', x: 0, y: 0, speedMps: 0, status: 'running', taskId: null },
      { ts: 't2', x: 0, y: 100, speedMps: 0, status: 'running', taskId: null }
    ]);
    const [first, second] = path.split('L');
    const yOf = (segment: string) => Number(segment.trim().split(' ')[1]);
    // 起点 y=0 → 画布底部；终点 y=100 → 画布顶部（两者相差整个可用高度）
    expect(yOf(second!)).toBeLessThan(yOf(first!));
  });
});
