/**
 * `MapOverview` → React Flow `{ nodes, edges }`。
 *
 * **纯函数**：不读全局状态、不发请求、不产生副作用，因此可被单测完整覆盖（M6-U1…U5）。
 * 所有顺序都是刻意的（见 `layers.ts`：路线高亮边必须压在基础边之上）。
 */
import type { Edge, Node } from '@xyflow/react';
import type { MapAlert, MapOverview } from '../../api/types';
import { netEdgeId, netNodeId, orderEndpointId, routeSegmentId, siteNodeId, taskEndpointId, vehicleNodeId } from './ids';
import { toFlowXY } from './projection';
import { DEFAULT_VISIBILITY, LAYERS, type LayerKey } from './layers';

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

/**
 * 各图层节点的**声明尺寸**（px，与 `style/map.css` 一一对应）。
 *
 * 为什么必须给 React Flow 显式尺寸：`<MiniMap>` 只为「有尺寸」的节点画方块
 * （`@xyflow/react` 的 `NodeComponentWrapperInner` 里
 * `if (!node || node.hidden || !nodeHasDimensions(node)) return null`，
 * 而 `nodeHasDimensions` 读的是 `measured?.width ?? width ?? initialWidth`）。
 * 实测在渲染完成后 `measured` 仍未落到用户节点上，于是缩略图**一个方块都不画**，
 * 只剩一个空框（截图确认）；补 `initialWidth/initialHeight` 后立即正常。
 *
 * 这两个值只是「首帧尺寸提示」，真实测量值（`measured`）会覆盖它，
 * 因此不会影响布局，也不需要跟随 CSS 精确到像素：
 * 只需在测量完成前给缩略图一个合理的比例即可。
 * 改 CSS 尺寸时**不必**同步改这里，但偏差过大会让缩略图与主画布观感不一致。
 */
const NODE_SIZE: Record<string, { width: number; height: number }> = {
  net: { width: 22, height: 22 },
  site: { width: 30, height: 30 },
  vehicle: { width: 46, height: 30 },
  taskEndpoint: { width: 22, height: 22 },
  orderEndpoint: { width: 22, height: 22 }
};

/** 把声明尺寸摊平到节点上（`initial*` 而非 `width/height`，避免覆盖真实测量）。 */
function sized(node: Node): Node {
  const size = NODE_SIZE[node.type ?? ''];
  return size ? { ...node, initialWidth: size.width, initialHeight: size.height } : node;
}

export type LayerVisibility = Record<LayerKey, boolean>;

/**
 * 受控选中态。
 *
 * 因为 `nodes` 是受控数组，每次刷新都会产生新对象；若不在此处显式回填 `selected`，
 * React Flow 会认为选中态被清空 —— 表现为「轮询刷新一次，选中就丢了」。
 * 选中态的唯一来源是 store，这里只做投影。
 */
export interface FlowSelection {
  flowId: string;
}

/** 告警按「对象类型 + 对象 ID」归组，作为角标挂到对应实体节点上（不新建节点）。 */
type AlertIndex = Record<string, MapAlert[]>;

function indexAlerts(alerts: MapAlert[]): AlertIndex {
  const index: AlertIndex = {};
  for (const alert of alerts) {
    const key = `${alert.objectType}:${alert.objectId}`;
    (index[key] ??= []).push(alert);
  }
  return index;
}

/**
 * 站点的画布坐标：优先用站点自身坐标，缺失时回退到其绑定路网节点的坐标。
 * 两者都没有则返回 `null`（调用方跳过该元素，**不伪造坐标**）。
 */
function resolveSiteXY(overview: MapOverview, siteId: string): { x: number; y: number } | null {
  const site = overview.sites.find((item) => item.id === siteId);
  if (!site) {
    return null;
  }
  if (Number.isFinite(site.x) && Number.isFinite(site.y)) {
    return { x: site.x, y: site.y };
  }
  if (site.nodeId) {
    const node = overview.nodes.find((item) => item.id === site.nodeId);
    if (node) {
      return { x: node.x, y: node.y };
    }
  }
  return null;
}

export function toFlow(
  overview: MapOverview,
  visibility: LayerVisibility = DEFAULT_VISIBILITY,
  selection: FlowSelection | null = null,
  /**
   * 车辆当前位置覆盖值（业务 vehicleId → 米制坐标）。
   * 传入事件推送的最新位置，避免「图重建」时车辆被回退到快照里的旧坐标。
   */
  vehiclePositions: Record<string, { x: number; y: number }> = {}
): FlowGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const alertIndex = indexAlerts(overview.alerts ?? []);

  const nodeById = new Map(overview.nodes.map((node) => [node.id, node]));

  // ---- 1. 基础路网边（必须排在路线高亮边之前） ----
  for (const edge of overview.edges) {
    // 端点必须都存在，否则 React Flow 拿不到几何会渲染异常；不一致时跳过而不是抛错
    if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) {
      continue;
    }
    const disabled = edge.status === 'disabled';
    edges.push({
      id: netEdgeId(edge.id),
      source: netNodeId(edge.fromNodeId),
      target: netNodeId(edge.toNodeId),
      type: 'net',
      hidden: !visibility.netEdges,
      selectable: false,
      data: { lengthM: edge.lengthM ?? null, speedLimitMps: edge.speedLimitMps ?? null, disabled }
    });
  }

  // ---- 2. 路线高亮边（压在上一步的边之上） ----
  for (const route of overview.routes) {
    const superseded = route.status !== 'active';
    for (let seq = 0; seq < route.nodeIds.length - 1; seq += 1) {
      const from = route.nodeIds[seq];
      const to = route.nodeIds[seq + 1];
      if (!from || !to || !nodeById.has(from) || !nodeById.has(to)) {
        // 数据不一致：跳过该段，避免整张图白屏（M6-U4）
        continue;
      }
      edges.push({
        id: routeSegmentId(route.id, seq),
        source: netNodeId(from),
        target: netNodeId(to),
        type: 'route',
        hidden: !visibility.routeEdges,
        selectable: true,
        data: {
          routeId: route.id,
          taskId: route.taskId,
          vehicleId: route.vehicleId,
          superseded
        }
      });
    }
  }

  // ---- 3. 路网节点 ----
  for (const node of overview.nodes) {
    nodes.push(sized({
      id: netNodeId(node.id),
      type: 'net',
      position: toFlowXY(node),
      hidden: !visibility.netNodes,
      selectable: false,
      data: { entityType: 'node', entityId: node.id, code: node.code, status: node.status }
    }));
  }

  // ---- 4. 站点 ----
  for (const site of overview.sites) {
    const xy = resolveSiteXY(overview, site.id);
    if (!xy) {
      continue;
    }
    nodes.push(sized({
      id: siteNodeId(site.id),
      type: 'site',
      position: toFlowXY(xy),
      hidden: !visibility.sites,
      data: {
        entityType: 'site',
        entityId: site.id,
        code: site.code,
        name: site.name ?? site.code,
        siteType: site.type,
        status: site.status,
        alerts: alertIndex[`site:${site.id}`] ?? []
      }
    }));
  }

  // ---- 5. 任务起终点（由站点坐标派生；站点缺失则不上图） ----
  for (const task of overview.tasks) {
    for (const role of ['from', 'to'] as const) {
      const siteId = role === 'from' ? task.fromSiteId : task.toSiteId;
      const xy = resolveSiteXY(overview, siteId);
      if (!xy) {
        continue;
      }
      nodes.push(sized({
        id: taskEndpointId(task.id, role),
        type: 'taskEndpoint',
        position: toFlowXY(xy),
        // 图层开关统一用 hidden，不移除元素：关掉再打开时选中态与视口不丢（D-21）
        hidden: !visibility.taskEndpoints,
        data: {
          entityType: 'task',
          entityId: task.id,
          code: task.code,
          role,
          status: task.status,
          progress: task.progress,
          vehicleId: task.vehicleId
        }
      }));
    }
  }

  // ---- 6. 订单起终点（可选图层；未匹配地区的订单不会出现在数据里） ----
  for (const endpoint of overview.orderEndpoints ?? []) {
    nodes.push(sized({
      id: orderEndpointId(endpoint.orderId, endpoint.role),
      type: 'orderEndpoint',
      position: toFlowXY(endpoint),
      hidden: !visibility.orderEndpoints,
      data: {
        entityType: 'order',
        entityId: endpoint.orderId,
        role: endpoint.role,
        confidence: endpoint.confidence ?? null,
        matchType: endpoint.matchType ?? null,
        pathStatus: endpoint.pathStatus ?? 'ok'
      }
    }));
  }

  // ---- 7. 车辆（最上层；不可关闭，否则地图失去意义） ----
  for (const vehicle of overview.vehicles) {
    const live = vehiclePositions[vehicle.id];
    const position = toFlowXY(live ?? vehicle);
    nodes.push(sized({
      id: vehicleNodeId(vehicle.id),
      type: 'vehicle',
      position,
      data: {
        entityType: 'vehicle',
        entityId: vehicle.id,
        code: vehicle.code,
        status: (live as { status?: string } | undefined)?.status ?? vehicle.status,
        battery: (live as { battery?: number } | undefined)?.battery ?? vehicle.battery,
        taskId: vehicle.taskId,
        alerts: alertIndex[`vehicle:${vehicle.id}`] ?? []
      }
    }));
  }

  // 受控选中态回填（刷新后不丢选中）
  if (selection) {
    for (const node of nodes) {
      if (node.id === selection.flowId) {
        node.selected = true;
      }
    }
  }

  return { nodes, edges };
}

/** 便于 UI 渲染图例：只暴露可切换图层。 */
export function toggleableLayers() {
  return LAYERS.filter((layer) => layer.toggleable);
}
