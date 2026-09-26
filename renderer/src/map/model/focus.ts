/**
 * 「聚焦」计算：选中某个实体后，画布上哪些元素属于**它的上下文**。
 *
 * 为什么需要：只给选中项加一圈描边，在 12 节点 / 34 边的路网上几乎看不出来
 * ——用户点了一台车，仍然要自己在整张图里找它的路线、起终点、任务。
 * 正确的可视化做法是**把无关元素压暗**，让上下文自己浮出来。
 *
 * 本文件只回答「谁是相关的」，**不回答「长什么样」**（那是 CSS 的事），
 * 因此是纯函数、可单测，且不引入任何新的业务字段。
 */
import type { MapOverview } from '../../api/types';
import { netEdgeId, netNodeId, orderEndpointId, routeSegmentId, siteNodeId, taskEndpointId, vehicleNodeId } from './ids';
import type { FlowSelection } from './toFlow';

export interface FocusSet {
  /** `false` 表示「没有聚焦目标」，此时不应压暗任何元素。 */
  active: boolean;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

const EMPTY: FocusSet = { active: false, nodeIds: new Set(), edgeIds: new Set() };

/**
 * 计算聚焦集合。
 *
 * 关系是**双向可达**的（车 → 任务 → 路线 → 站点），这样从任何一个入口点进来，
 * 都能看到同一条执行链的完整上下文，而不是「点车只看车」。
 */
export function computeFocus(overview: MapOverview, selection: FlowSelection | null): FocusSet {
  if (!selection) {
    return EMPTY;
  }
  // 显式收窄：调用方（`toFlow`）只在两者齐备时才把 selection 视为「可聚焦」，
  // 但类型上是可选的。这里提前返回，避免把 `undefined` 一路传进 `addNode()`。
  const entityId = selection.entityId;
  if (!selection.entityType || !entityId) {
    return EMPTY;
  }

  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const addNode = (id: string): void => {
    nodeIds.add(netNodeId(id));
  };
  const addEdge = (id: string): void => {
    edgeIds.add(netEdgeId(id));
  };
  const addNetEdgesOf = (ids: string[]): void => {
    // 一条边只要有一端在集合里就算相关：用于「点了路口，显示它连出去的路」
    for (const edge of overview.edges) {
      if (ids.includes(edge.fromNodeId) || ids.includes(edge.toNodeId)) {
        addEdge(edge.id);
      }
    }
  };
  const addRoute = (route: MapOverview['routes'][number]): void => {
    for (const id of route.nodeIds) {
      addNode(id);
    }
    for (let seq = 0; seq < route.nodeIds.length - 1; seq += 1) {
      edgeIds.add(routeSegmentId(route.id, seq));
    }
    // 路线经过的既有路段也一起高亮，否则「路线之外的路网」仍然是亮的
    addNetEdgesOf(route.nodeIds);
  };
  const addTask = (taskId: string): void => {
    const task = overview.tasks.find((item) => item.id === taskId);
    if (!task) {
      return;
    }
    nodeIds.add(taskEndpointId(task.id, 'from'));
    nodeIds.add(taskEndpointId(task.id, 'to'));
    for (const route of overview.routes) {
      if (route.taskId === task.id) {
        addRoute(route);
      }
    }
    // 任务的两端站点同样属于上下文
    for (const siteId of [task.fromSiteId, task.toSiteId]) {
      nodeIds.add(siteNodeId(siteId));
      const site = overview.sites.find((item) => item.id === siteId);
      if (site?.nodeId) {
        addNode(site.nodeId);
      }
    }
  };
  const addVehicle = (vehicleId: string): void => {
    nodeIds.add(vehicleNodeId(vehicleId));
    for (const route of overview.routes) {
      if (route.vehicleId === vehicleId) {
        addRoute(route);
      }
    }
    const vehicle = overview.vehicles.find((item) => item.id === vehicleId);
    if (vehicle?.taskId) {
      addTask(vehicle.taskId);
    }
  };

  switch (selection.entityType) {
    case 'vehicle':
      addVehicle(entityId);
      break;
    case 'task':
      addTask(entityId);
      break;
    case 'route': {
      const route = overview.routes.find((item) => item.id === entityId);
      if (route) {
        addRoute(route);
      }
      break;
    }
    case 'site': {
      nodeIds.add(siteNodeId(entityId));
      const site = overview.sites.find((item) => item.id === entityId);
      if (site?.nodeId) {
        addNode(site.nodeId);
      }
      break;
    }
    case 'node': {
      addNode(entityId);
      addNetEdgesOf([entityId]);
      break;
    }
    case 'order':
      nodeIds.add(orderEndpointId(entityId, 'from'));
      nodeIds.add(orderEndpointId(entityId, 'to'));
      break;
    default:
      // user / system / alert / settings / edge 等不起图上聚焦作用，保持不压暗
      return EMPTY;
  }

  return { active: true, nodeIds, edgeIds };
}

/** 元素是否应被压暗（`active` 为 false 时一切保持原样）。 */
export function isDimmed(focus: FocusSet, ids: Set<string>, id: string): boolean {
  if (!focus.active) {
    return false;
  }
  return !ids.has(id);
}
