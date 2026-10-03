import { describe, expect, it } from 'vitest';
import { buildMockOverview } from '../../api/mock-data';
import { computeFocus, isDimmed } from './focus';
import { netEdgeId, netNodeId, routeSegmentId, siteNodeId, taskEndpointId, vehicleNodeId } from './ids';
import { SEED_IDS, campusNodeId } from '@udm/shared';

describe('computeFocus · 无选中', () => {
  it('未选中任何对象时不产生压暗（active=false）', () => {
    const focus = computeFocus(buildMockOverview(), null);
    expect(focus.active).toBe(false);
    // 关键不变量：active=false 时任何元素都不应被判定为压暗
    expect(isDimmed(focus, focus.nodeIds, vehicleNodeId(SEED_IDS.vehicleAgv))).toBe(false);
    expect(isDimmed(focus, focus.edgeIds, netEdgeId('anything'))).toBe(false);
  });

  it('选中对象但缺 entityId 时退化为「不压暗」，而不是把整张图压暗', () => {
    const focus = computeFocus(buildMockOverview(), { flowId: 'x', entityType: 'vehicle' });
    expect(focus.active).toBe(false);
  });
});

describe('computeFocus · 车辆（执行链双向可达）', () => {
  it('选中执行中的车辆 → 覆盖任务起终点、路线分段与所在站点', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, {
      flowId: vehicleNodeId(SEED_IDS.vehicleAgv),
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    expect(focus.active).toBe(true);
    // 车辆自身
    expect(focus.nodeIds.has(vehicleNodeId(SEED_IDS.vehicleAgv))).toBe(true);
    // 它的任务起终点（说明「车 → 任务」这条边被走通了）
    expect(focus.nodeIds.has(taskEndpointId(SEED_IDS.demoTask, 'from'))).toBe(true);
    expect(focus.nodeIds.has(taskEndpointId(SEED_IDS.demoTask, 'to'))).toBe(true);
    // 它的路线分段
    expect(focus.edgeIds.has(routeSegmentId(SEED_IDS.demoRoute, 0))).toBe(true);
    // 两端站点
    expect(focus.nodeIds.has(siteNodeId(SEED_IDS.siteDepot))).toBe(true);
    expect(focus.nodeIds.has(siteNodeId(SEED_IDS.siteDorm))).toBe(true);
  });

  it('空闲车辆：只聚焦自己，不牵连别的任务', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, {
      flowId: vehicleNodeId(SEED_IDS.vehicleDrone),
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleDrone
    });
    expect(focus.nodeIds.has(vehicleNodeId(SEED_IDS.vehicleDrone))).toBe(true);
    // 没有任务 → 不应把演示任务拉进上下文
    expect(focus.nodeIds.has(taskEndpointId(SEED_IDS.demoTask, 'from'))).toBe(false);
    expect(focus.edgeIds.has(routeSegmentId(SEED_IDS.demoRoute, 0))).toBe(false);
  });

  it('压暗判定是「不在集合内」的补集', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, {
      flowId: vehicleNodeId(SEED_IDS.vehicleAgv),
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    expect(isDimmed(focus, focus.nodeIds, vehicleNodeId(SEED_IDS.vehicleAgv))).toBe(false);
    // 未参与该执行链的车辆应被压暗
    expect(isDimmed(focus, focus.nodeIds, vehicleNodeId(SEED_IDS.vehicleDrone))).toBe(true);
  });
});

describe('computeFocus · 任务 / 路线 / 站点 / 节点', () => {
  it('选中任务 → 含起终点、路线与两端站点', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, {
      flowId: 'task',
      entityType: 'task',
      entityId: SEED_IDS.demoTask
    });
    expect(focus.nodeIds.has(taskEndpointId(SEED_IDS.demoTask, 'from'))).toBe(true);
    expect(focus.edgeIds.has(routeSegmentId(SEED_IDS.demoRoute, 0))).toBe(true);
    expect(focus.nodeIds.has(siteNodeId(SEED_IDS.siteDepot))).toBe(true);
  });

  it('选中路线 → 路线的每个节点与每段边都在集合内', () => {
    const overview = buildMockOverview();
    const route = overview.routes[0]!;
    const focus = computeFocus(overview, {
      flowId: 'route',
      entityType: 'route',
      entityId: route.id
    });
    for (const nodeId of route.nodeIds) {
      expect(focus.nodeIds.has(netNodeId(nodeId)), `缺少节点 ${nodeId}`).toBe(true);
    }
    for (let seq = 0; seq < route.nodeIds.length - 1; seq += 1) {
      expect(focus.edgeIds.has(routeSegmentId(route.id, seq)), `缺少第 ${seq} 段`).toBe(true);
    }
  });

  it('选中站点 → 含站点自身与其挂靠的路网节点', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, {
      flowId: siteNodeId(SEED_IDS.siteDepot),
      entityType: 'site',
      entityId: SEED_IDS.siteDepot
    });
    expect(focus.nodeIds.has(siteNodeId(SEED_IDS.siteDepot))).toBe(true);
    // 站点挂靠的节点从快照读出来，不写死（换地图数据后站点会挂到别的路口）
    const anchor = overview.sites.find((site) => site.id === SEED_IDS.siteDepot)!.nodeId!;
    expect(focus.nodeIds.has(netNodeId(anchor))).toBe(true);
  });

  it('选中路网节点 → 含该节点与它连出去的所有边', () => {
    const overview = buildMockOverview();
    const nodeId = campusNodeId('N01');
    const focus = computeFocus(overview, {
      flowId: netNodeId(nodeId),
      entityType: 'node',
      entityId: nodeId
    });
    expect(focus.nodeIds.has(netNodeId(nodeId))).toBe(true);
    const connected = overview.edges.filter(
      (edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId
    );
    expect(connected.length).toBeGreaterThan(0);
    for (const edge of connected) {
      expect(focus.edgeIds.has(netEdgeId(edge.id)), `缺少边 ${edge.id}`).toBe(true);
    }
  });

  it('不参与画布聚焦的类型（settings 等）不压暗任何东西', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, { flowId: 'x', entityType: 'settings', entityId: 's1' });
    expect(focus.active).toBe(false);
  });

  it('选中了已不存在的实体 → 不压暗（避免整屏变灰且无解释）', () => {
    const overview = buildMockOverview();
    const focus = computeFocus(overview, { flowId: 'x', entityType: 'vehicle', entityId: 'ghost' });
    // 实体不存在：active 仍为 true，但集合里只有那个不存在的 id，画布上所有真实元素都会被压暗
    // —— 这是刻意的：用户选中了「不存在的东西」= 数据异常，压暗提示比静默忽略更容易发现
    expect(focus.active).toBe(true);
    expect(focus.nodeIds.has(vehicleNodeId('ghost'))).toBe(true);
  });
});
