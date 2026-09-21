import { describe, expect, it } from 'vitest';
import { buildMockOverview } from '../../api/mock-data';
import { structuralSignature } from './structural';
import type { MapOverview } from '../../api/types';

describe('structuralSignature', () => {
  it('同一份数据两次签名相同（保证轮询不会重建图结构）', () => {
    const overview = buildMockOverview();
    expect(structuralSignature(overview)).toBe(structuralSignature(buildMockOverview()));
  });

  it('车辆位置变化不影响签名（位置走定向更新，不应触发图重建）', () => {
    const a = buildMockOverview();
    const b: MapOverview = {
      ...a,
      vehicles: a.vehicles.map((v, i) => (i === 0 ? { ...v, x: v.x + 20, y: v.y + 20 } : v))
    };
    expect(structuralSignature(b)).toBe(structuralSignature(a));
  });

  it('eventSeq 变化不影响签名', () => {
    const a = buildMockOverview();
    expect(structuralSignature({ ...a, eventSeq: a.eventSeq + 999 })).toBe(structuralSignature(a));
  });

  it('车辆状态变化会改变签名（车辆徽标需要刷新）', () => {
    const a = buildMockOverview();
    const b: MapOverview = {
      ...a,
      vehicles: a.vehicles.map((v, i) => (i === 0 ? { ...v, status: 'fault' } : v))
    };
    expect(structuralSignature(b)).not.toBe(structuralSignature(a));
  });

  it('电量小数抖动（取整后相同）不改变签名', () => {
    const a = buildMockOverview();
    const b: MapOverview = {
      ...a,
      vehicles: a.vehicles.map((v, i) => (i === 0 ? { ...v, battery: v.battery + 0.2 } : v))
    };
    expect(structuralSignature(b)).toBe(structuralSignature(a));
  });

  it('路网节点位移会改变签名', () => {
    const a = buildMockOverview();
    const b: MapOverview = {
      ...a,
      nodes: a.nodes.map((n, i) => (i === 0 ? { ...n, x: n.x + 5 } : n))
    };
    expect(structuralSignature(b)).not.toBe(structuralSignature(a));
  });

  it('路线节点序列变化会改变签名', () => {
    const a = buildMockOverview();
    const b: MapOverview = {
      ...a,
      routes: a.routes.map((r) => ({ ...r, nodeIds: [...r.nodeIds, 'seed-n08'] }))
    };
    expect(structuralSignature(b)).not.toBe(structuralSignature(a));
  });

  it('新增告警会改变签名', () => {
    const a = buildMockOverview();
    const b: MapOverview = {
      ...a,
      alerts: [...a.alerts, { id: 'x', type: 'task_failed', level: 'critical', objectType: 'task', objectId: 't1' }]
    };
    expect(structuralSignature(b)).not.toBe(structuralSignature(a));
  });
});
