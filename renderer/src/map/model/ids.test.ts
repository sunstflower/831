import { describe, expect, it } from 'vitest';
import { netEdgeId, netNodeId, orderEndpointId, routeSegmentId, siteNodeId, taskEndpointId, vehicleNodeId } from './ids';

describe('id 命名空间', () => {
  it('不同实体的 id 前缀互不相同', () => {
    const ids = [
      netNodeId('x'),
      netEdgeId('x'),
      siteNodeId('x'),
      vehicleNodeId('x'),
      taskEndpointId('x', 'from'),
      taskEndpointId('x', 'to'),
      orderEndpointId('x', 'from'),
      routeSegmentId('r', 0)
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('同一业务 id 在不同图层不会撞车', () => {
    // 站点与路网节点可能共用同一个 UUID 形态的业务 id
    expect(siteNodeId('same-id')).not.toBe(netNodeId('same-id'));
  });

  it('起终点按 role 区分', () => {
    expect(taskEndpointId('t1', 'from')).not.toBe(taskEndpointId('t1', 'to'));
  });

  it('路线分段按 seq 区分', () => {
    expect(routeSegmentId('r1', 0)).not.toBe(routeSegmentId('r1', 1));
  });
});
