/**
 * 跨图层 id 命名空间。
 *
 * React Flow 要求节点/边 id **全局唯一**，而业务 id 可能撞车
 * （站点 id 与路网节点 id 都是 UUID 形态）。故统一加前缀。
 */
export const ID_PREFIX = {
  net: 'net',
  site: 'site',
  vehicle: 'veh',
  task: 'task',
  route: 'route',
  order: 'order'
} as const;

export type LayerKey = keyof typeof ID_PREFIX;

export function netNodeId(id: string): string {
  return `${ID_PREFIX.net}:${id}`;
}

export function netEdgeId(id: string): string {
  return `${ID_PREFIX.net}:e:${id}`;
}

export function siteNodeId(id: string): string {
  return `${ID_PREFIX.site}:${id}`;
}

export function vehicleNodeId(id: string): string {
  return `${ID_PREFIX.vehicle}:${id}`;
}

export function taskEndpointId(id: string, role: 'from' | 'to'): string {
  return `${ID_PREFIX.task}:${id}:${role}`;
}

export function routeSegmentId(routeId: string, seq: number): string {
  return `${ID_PREFIX.route}:${routeId}:${seq}`;
}

export function orderEndpointId(id: string, role: 'from' | 'to'): string {
  return `${ID_PREFIX.order}:${id}:${role}`;
}
