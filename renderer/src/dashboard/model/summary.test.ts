import { describe, expect, it } from 'vitest';
import type { MapOverview } from '../../api/types';
import { buildMockOverview } from '../../api/mock-data';
import { computeMetrics } from '../../map/model/metrics';
import { buildAlertRows, buildFleetBuckets, buildKpis, buildTaskRows } from './summary';
import { toneClass } from '../../domain/tone';

/**
 * 工作台的展示口径测试。
 *
 * 这一层是**纯函数**，因此测试重点是「口径」而不是渲染细节：
 * 每个数字都由谁构成、排序为什么是这个顺序、缺失数据回落成什么。
 * 一旦口径变了而组件没改，这些用例会先红。
 */

function empty(): MapOverview {
  return { nodes: [], edges: [], sites: [], vehicles: [], tasks: [], routes: [], alerts: [], eventSeq: 0 };
}

describe('buildKpis', () => {
  it('四个指标齐全，且键名稳定（组件按 key 布局）', () => {
    const overview = buildMockOverview();
    const kpis = buildKpis(overview, computeMetrics(overview));
    expect(kpis.map((kpi) => kpi.key)).toEqual(['fleet', 'running', 'alerts', 'battery']);
  });

  it('「可用车辆」= 空闲 + 已预留，分母是车队总数', () => {
    const overview: MapOverview = {
      ...empty(),
      vehicles: [
        { id: 'v1', code: 'V1', status: 'idle', x: 0, y: 0, battery: 80, taskId: null },
        { id: 'v2', code: 'V2', status: 'reserved', x: 0, y: 0, battery: 80, taskId: 't1' },
        { id: 'v3', code: 'V3', status: 'busy', x: 0, y: 0, battery: 80, taskId: 't2' },
        { id: 'v4', code: 'V4', status: 'fault', x: 0, y: 0, battery: 10, taskId: null }
      ]
    };
    const kpis = buildKpis(overview, computeMetrics(overview));
    const fleet = kpis.find((kpi) => kpi.key === 'fleet')!;
    // idle(1) + reserved(1) = 2，总 4 台
    expect(fleet.value).toBe('2');
    expect(fleet.suffix).toBe('/ 4');
    expect(fleet.hint).toContain('空闲 1');
    expect(fleet.hint).toContain('已预留 1');
    expect(fleet.hint).toContain('执行中 1');
  });

  it('车队为空时不报错：可用 0、平均电量为 0、tone 落到 dim', () => {
    const kpis = buildKpis(empty(), computeMetrics(empty()));
    expect(kpis.find((kpi) => kpi.key === 'fleet')!.tone).toBe('dim');
    expect(kpis.find((kpi) => kpi.key === 'battery')!.value).toBe('0');
  });

  it('平均电量按台数取整：80 与 40 → 60%', () => {
    const overview: MapOverview = {
      ...empty(),
      vehicles: [
        { id: 'v1', code: 'V1', status: 'idle', x: 0, y: 0, battery: 80, taskId: null },
        { id: 'v2', code: 'V2', status: 'idle', x: 0, y: 0, battery: 40, taskId: null }
      ]
    };
    expect(buildKpis(overview, computeMetrics(overview)).find((kpi) => kpi.key === 'battery')!.value).toBe('60');
  });

  it('有低电车时平均电量提示里给出低电台数', () => {
    const overview: MapOverview = {
      ...empty(),
      vehicles: [
        { id: 'v1', code: 'V1', status: 'idle', x: 0, y: 0, battery: 15, taskId: null },
        { id: 'v2', code: 'V2', status: 'idle', x: 0, y: 0, battery: 90, taskId: null }
      ]
    };
    const battery = buildKpis(overview, computeMetrics(overview)).find((kpi) => kpi.key === 'battery')!;
    expect(battery.hint).toContain('低电');
    expect(battery.hint).toContain('1 台');
  });

  it('待确认告警为 0 时用 ok 色，>0 时用 danger（避免「0 也是红的」）', () => {
    const withAlert: MapOverview = {
      ...empty(),
      alerts: [{ id: 'a1', type: 'task_failed', level: 'critical', status: 'new', objectType: 'task', objectId: 't1' }]
    };
    expect(buildKpis(withAlert, computeMetrics(withAlert)).find((kpi) => kpi.key === 'alerts')!.tone).toBe('danger');
    expect(buildKpis(empty(), computeMetrics(empty())).find((kpi) => kpi.key === 'alerts')!.tone).toBe('ok');
  });
});

describe('buildFleetBuckets', () => {
  it('七个状态全部返回（含 0 台），顺序与枚举一致', () => {
    const buckets = buildFleetBuckets(buildMockOverview());
    expect(buckets.map((bucket) => bucket.status)).toEqual([
      'idle',
      'reserved',
      'busy',
      'charging',
      'offline',
      'fault',
      'disabled'
    ]);
  });

  it('ratio 之和为 1（有车时），无车时全部为 0 且不出现 NaN', () => {
    const withVehicles = buildFleetBuckets(buildMockOverview());
    const sum = withVehicles.reduce((total, bucket) => total + bucket.ratio, 0);
    expect(sum).toBeCloseTo(1, 10);

    const none = buildFleetBuckets(empty());
    expect(none.every((bucket) => bucket.ratio === 0)).toBe(true);
    expect(none.every((bucket) => Number.isFinite(bucket.ratio))).toBe(true);
  });

  it('按 Req-M2-7 标记可调度性：故障 / 离线 / 停用不算候选运力', () => {
    const byStatus = new Map(buildFleetBuckets(empty()).map((bucket) => [bucket.status, bucket.schedulable]));
    expect(byStatus.get('idle')).toBe(true);
    expect(byStatus.get('reserved')).toBe(true);
    expect(byStatus.get('charging')).toBe(true);
    expect(byStatus.get('fault')).toBe(false);
    expect(byStatus.get('offline')).toBe(false);
    expect(byStatus.get('disabled')).toBe(false);
  });
});

describe('buildTaskRows', () => {
  it('执行中的任务排在最前，其余按展示顺序', () => {
    const overview: MapOverview = {
      ...empty(),
      tasks: [
        { id: 't1', code: 'T-DONE', status: 'finished', fromSiteId: 's1', toSiteId: 's2', vehicleId: null, progress: 1 },
        { id: 't2', code: 'T-RUN', status: 'running', fromSiteId: 's1', toSiteId: 's2', vehicleId: 'v1', progress: 0.5 },
        { id: 't3', code: 'T-PAUSE', status: 'paused', fromSiteId: 's1', toSiteId: 's2', vehicleId: 'v1', progress: 0.2 }
      ]
    };
    const { rows } = buildTaskRows(overview);
    expect(rows.map((row) => row.code)).toEqual(['T-RUN', 'T-PAUSE', 'T-DONE']);
  });

  it('起终点与车辆翻译成业务 code；翻译不到时回落 id 而不是留空', () => {
    const overview: MapOverview = {
      ...empty(),
      sites: [
        { id: 's1', code: 'A-01', type: 'depot', nodeId: null, x: 0, y: 0, status: 'enabled' },
        { id: 's2', code: 'B-01', type: 'dock', nodeId: null, x: 0, y: 0, status: 'enabled' }
      ],
      vehicles: [{ id: 'v1', code: 'AGV-01', status: 'busy', x: 0, y: 0, battery: 60, taskId: 't1' }],
      tasks: [
        { id: 't1', code: 'T-1', status: 'running', fromSiteId: 's1', toSiteId: 's2', vehicleId: 'v1', progress: 0.42 },
        { id: 't2', code: 'T-2', status: 'pending', fromSiteId: 'sX', toSiteId: 's2', vehicleId: null, progress: 0 }
      ]
    };
    const { rows } = buildTaskRows(overview);
    const running = rows.find((row) => row.code === 'T-1')!;
    expect(running.fromCode).toBe('A-01');
    expect(running.toCode).toBe('B-01');
    expect(running.vehicleCode).toBe('AGV-01');
    expect(running.percent).toBe(42);

    const pending = rows.find((row) => row.code === 'T-2')!;
    expect(pending.fromCode).toBe('sX');
    expect(pending.vehicleCode).toBeNull();
  });

  it('超出 limit 的条数如实报告（不静默截断）', () => {
    const tasks = Array.from({ length: 9 }, (_, index) => ({
      id: `t${index}`,
      code: `T-${index}`,
      status: 'pending' as const,
      fromSiteId: 's1',
      toSiteId: 's2',
      vehicleId: null,
      progress: 0
    }));
    const page = buildTaskRows({ ...empty(), tasks }, 6);
    expect(page.rows).toHaveLength(6);
    expect(page.hidden).toBe(3);
  });

  it('任务为空时返回空列表且 hidden 为 0', () => {
    expect(buildTaskRows(empty())).toEqual({ rows: [], hidden: 0 });
  });
});

describe('buildAlertRows', () => {
  const sites = [{ id: 's1', code: 'A-01', type: 'depot' as const, nodeId: null, x: 0, y: 0, status: 'enabled' as const }];
  const vehicles = [{ id: 'v1', code: 'DRN-01', status: 'offline' as const, x: 0, y: 0, battery: 20, taskId: null }];

  it('未闭环的排在已归档之前；同状态下严重级别优先', () => {
    const overview: MapOverview = {
      ...empty(),
      alerts: [
        { id: 'a1', type: 'data_error', level: 'warning', status: 'archived', objectType: 'site', objectId: 's1' },
        { id: 'a2', type: 'vehicle_offline', level: 'critical', status: 'new', objectType: 'vehicle', objectId: 'v1' },
        { id: 'a3', type: 'task_timeout', level: 'warning', status: 'new', objectType: 'site', objectId: 's1' }
      ]
    };
    const { rows } = buildAlertRows(overview);
    expect(rows.map((row) => row.id)).toEqual(['a2', 'a3', 'a1']);
  });

  it('对象 id 翻译成业务 code 并带类型前缀', () => {
    const overview: MapOverview = {
      ...empty(),
      sites,
      vehicles,
      alerts: [{ id: 'a1', type: 'vehicle_offline', level: 'critical', objectType: 'vehicle', objectId: 'v1' }]
    };
    const row = buildAlertRows(overview).rows[0]!;
    expect(row.objectLabel).toBe('车辆 · DRN-01');
  });

  it('类型 / 级别 / 状态都给中文文案（不把机器值印给使用者）', () => {
    const overview: MapOverview = {
      ...empty(),
      alerts: [{ id: 'a1', type: 'vehicle_offline', level: 'critical', status: 'new', objectType: 'system', objectId: 'x' }]
    };
    const row = buildAlertRows(overview).rows[0]!;
    expect(row.typeLabel).toBe('车辆离线');
    expect(row.levelLabel).toBe('严重');
    expect(row.statusLabel).toBe('待确认');
    expect(row.tone).toBe('danger');
  });

  it('缺 status 字段时按 new 处理（契约里 status 可选）', () => {
    const overview: MapOverview = {
      ...empty(),
      alerts: [{ id: 'a1', type: 'data_error', level: 'info', objectType: 'system', objectId: 'x' }]
    };
    const page = buildAlertRows(overview);
    expect(page.rows[0]!.statusLabel).toBe('待确认');
    expect(page.rows[0]!.open).toBe(true);
    expect(page.openCount).toBe(1);
  });

  it('openCount 只数未闭环的告警（与「待确认」是两个口径）', () => {
    const overview: MapOverview = {
      ...empty(),
      alerts: [
        { id: 'a1', type: 'data_error', level: 'info', status: 'new', objectType: 'system', objectId: 'x' },
        { id: 'a2', type: 'data_error', level: 'info', status: 'acknowledged', objectType: 'system', objectId: 'x' },
        { id: 'a3', type: 'data_error', level: 'info', status: 'resolved', objectType: 'system', objectId: 'x' }
      ]
    };
    const page = buildAlertRows(overview);
    expect(page.openCount).toBe(2);
    expect(computeMetrics(overview).newAlerts).toBe(1);
  });
});

describe('toneClass', () => {
  it('默认产出 tone-* 类名，可切换前缀产出徽标类名', () => {
    expect(toneClass('danger')).toBe('tone-danger');
    // 前缀要连修饰符的横线一起给：`.udm-badge--ok` 是双横线（见 `domain/tone.ts`）
    expect(toneClass('ok', 'udm-badge--')).toBe('udm-badge--ok');
  });
});
