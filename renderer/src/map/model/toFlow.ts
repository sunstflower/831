/**
 * `MapOverview` → React Flow `{ nodes, edges }`。
 *
 * **纯函数**：不读全局状态、不发请求、不产生副作用，因此可被单测完整覆盖（M6-U1…U5）。
 * 所有顺序都是刻意的（见 `layers.ts`：路线高亮边必须压在基础边之上）。
 */
import type { Edge, Node } from '@xyflow/react';
import type { MapAlert, MapOverview } from '../../api/types';
import { computeFocus, isDimmed } from './focus';
import { buildEdgeLengthIndex, segmentLength } from './edgeIndex';
import type { SelectableEntityType } from '../../store/selection';
import { netEdgeId, netNodeId, orderEndpointId, routeSegmentId, siteNodeId, taskEndpointId, vehicleNodeId } from './ids';
import { PIXELS_PER_METER, toFlowXY } from './projection';
import { DEFAULT_VISIBILITY, LAYERS, type LayerKey } from './layers';
import { LOW_BATTERY_PERCENT } from './metrics';

/**
 * 让节点以**中心**为锚点摆放。
 *
 * 为什么必须显式设置：React Flow 默认 `nodeOrigin = [0, 0]`（左上角对齐），
 * 于是「坐标点」落在节点卡片的左上角。其后果在实测中很明显：
 * - 站点（96×26 的横向卡片）看起来整体偏到坐标点的右下方；
 * - 两个坐标相同的元素（车辆与站点）因为尺寸不同而**错位**，不再重叠；
 * - `fitView` 也会按「左上角 + 尺寸」算包围盒，图会偏向画布一侧。
 *
 * 设为 `[0.5, 0.5]` 后，坐标点即卡片中心 —— 与「站点/车辆就是一个点」的直觉一致，
 * `getNodesBounds` 同样按该 origin 计算（`@xyflow/system` 的 `getNodePositionWithOrigin`），
 * 因此框选与适配视图也随之正确。
 */
const CENTER_ORIGIN: [number, number] = [0.5, 0.5];

/** 在**米制业务坐标**上做展示偏移：`px` 偏移除以比例尺换算回米。 */
function shiftEndpoint(
  point: { x: number; y: number },
  offset: { x: number; y: number }
): { x: number; y: number } {
  return { x: point.x + offset.x / PIXELS_PER_METER, y: point.y + offset.y / PIXELS_PER_METER };
}

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
  net: { width: 12, height: 12 },
  // 站点与车辆带可见文字标签，宽度远大于高度 —— 尺寸偏差过大时缩略图会与主画布不一致
  site: { width: 96, height: 26 },
  vehicle: { width: 84, height: 42 },
  taskEndpoint: { width: 20, height: 20 },
  orderEndpoint: { width: 20, height: 20 }
};

/**
 * 起终点标记的**展示去重叠偏移**（画布 px）。
 *
 * 背景：任务起终点落在**站点**上，而执行该任务的**车辆**也停在同一个站点上。
 * 三者位置完全重合，且车辆层恒在最上层 —— 实测结果是「任务起终点永远看不见」。
 * 这不是数据问题（坐标本身是对的），而是三个元素挤在同一个点上的排版问题。
 *
 * 处理：把起终点标记沿对角方向让开一点，让「站点本体 / 车辆 / 起终点」三者同时可见。
 * 这是**纯展示变换**（与 `projection.ts` 的 y 轴翻转同类），
 * 不写回业务数据、不影响任何接口，也不改变「起终点就在这个站点」这一事实。
 * 偏移量取 22px：约等于站点标记自身尺寸，视觉上仍明显「贴着」站点。
 */
const ENDPOINT_OFFSET = {
  from: { x: -22, y: -22 },
  to: { x: 22, y: -22 }
} as const;

/** 把声明尺寸与中心锚点摊平到节点上（`initial*` 而非 `width/height`，避免覆盖真实测量）。 */
function sized(node: Node): Node {
  const size = NODE_SIZE[node.type ?? ''];
  return {
    ...node,
    origin: CENTER_ORIGIN,
    ...(size ? { initialWidth: size.width, initialHeight: size.height } : {})
  };
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
  /** 业务标识。有它才能算出「聚焦上下文」（`model/focus.ts`）。 */
  entityType?: SelectableEntityType;
  entityId?: string;
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
  const siteById = new Map(overview.sites.map((site) => [site.id, site]));
  const edgeLengthByPair = buildEdgeLengthIndex(overview);
  // 聚焦上下文：只根据「业务标识」算，与 flowId 无关（flowId 只用于选中态回填）
  const focus = computeFocus(
    overview,
    selection?.entityType && selection.entityId
      ? { flowId: selection.flowId, entityType: selection.entityType, entityId: selection.entityId }
      : null
  );
  /**
   * 有生效路线时，路网边**变细变淡**，把视觉权重让给路线。
   *
   * 实测依据：seed 路网 34 条边里有 5 段与路线完全重合，两者同时用中等粗细绘制时
   * 视觉上分不清「哪条是我的配送路线」。官方示例（如「Edge Types」）同样把基础边
   * 当作底板、高亮边当作前景，这里沿用该做法。
   */
  const hasActiveRoute = overview.routes.some((route) => route.status === 'active');

  // ---- 1. 基础路网边（必须排在路线高亮边之前） ----
  for (const edge of overview.edges) {
    // 端点必须都存在，否则 React Flow 拿不到几何会渲染异常；不一致时跳过而不是抛错
    if (!nodeById.has(edge.fromNodeId) || !nodeById.has(edge.toNodeId)) {
      continue;
    }
    const disabled = edge.status === 'disabled';
    const fromNode = nodeById.get(edge.fromNodeId);
    const toNode = nodeById.get(edge.toNodeId);
    if (!fromNode || !toNode) {
      continue;
    }
    edges.push({
      id: netEdgeId(edge.id),
      source: netNodeId(edge.fromNodeId),
      target: netNodeId(edge.toNodeId),
      type: 'net',
      selectable: false,
      hidden: !visibility.netEdges,
      /**
       * 类名在数据层决定（`is-muted` / `is-dimmed`），样式在 CSS 层决定。
       * 这样「谁被弱化」是可单测的事实，而「弱化到什么程度」是可调的设计。
       */
      className: [
        hasActiveRoute && visibility.routeEdges ? 'is-muted' : '',
        isDimmed(focus, focus.edgeIds, netEdgeId(edge.id)) ? 'is-dimmed' : ''
      ]
        .filter(Boolean)
        .join(' '),
      data: {
        lengthM: edge.lengthM ?? null,
        speedLimitMps: edge.speedLimitMps ?? null,
        disabled,
        /** 通行耗时（s）：有长度与限速时才可算，否则 null（不要假造）。 */
        travelSeconds:
          Number.isFinite(edge.lengthM) && Number.isFinite(edge.speedLimitMps) && (edge.speedLimitMps ?? 0) > 0
            ? Math.round(((edge.lengthM ?? 0) / (edge.speedLimitMps ?? 1)) * 10) / 10
            : null,
        kind: disabled ? '禁行' : '可通行',
        fromCode: fromNode.code,
        toCode: toNode.code
      }
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
        className: isDimmed(focus, focus.edgeIds, routeSegmentId(route.id, seq)) ? 'is-dimmed' : '',
        data: {
          routeId: route.id,
          taskId: route.taskId,
          vehicleId: route.vehicleId,
          superseded,
          /** 第几段 / 共几段：详情面板用它显示「3/5 段」，不必再回查原路线。 */
          seq,
          total: route.nodeIds.length - 1,
          lengthM: segmentLength(edgeLengthByPair, from, to)
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
      className: isDimmed(focus, focus.nodeIds, netNodeId(node.id)) ? 'is-dimmed' : '',
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
      className: isDimmed(focus, focus.nodeIds, siteNodeId(site.id)) ? 'is-dimmed' : '',
      data: {
        entityType: 'site',
        entityId: site.id,
        code: site.code,
        name: site.name ?? site.code,
        siteType: site.type,
        status: site.status,
        /** 站点挂靠的路网节点编码：详情面板要回答「这个仓库在哪个路口」。 */
        nodeCode: site.nodeId ? nodeById.get(site.nodeId)?.code : undefined,
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
      const xy2 = shiftEndpoint(xy, ENDPOINT_OFFSET[role]);
      nodes.push(sized({
        id: taskEndpointId(task.id, role),
        type: 'taskEndpoint',
        position: toFlowXY(xy2),
        className: isDimmed(focus, focus.nodeIds, taskEndpointId(task.id, role)) ? 'is-dimmed' : '',
        // 图层开关统一用 hidden，不移除元素：关掉再打开时选中态与视口不丢（D-21）
        hidden: !visibility.taskEndpoints,
        data: {
          entityType: 'task',
          entityId: task.id,
          code: task.code,
          role,
          status: task.status,
          progress: task.progress,
          vehicleId: task.vehicleId,
          /**
           * 对端站点编码：详情面板显示「A-01 → B-01」时用，避免再查一次快照。
           * 注意查的是 `sites` 而不是 `nodes` —— 任务的 from/to 是**站点 id**。
           */
          peerCode: siteById.get(role === 'from' ? task.toSiteId : task.fromSiteId)?.code
        }
      }));
    }
  }

  // ---- 6. 订单起终点（可选图层；未匹配地区的订单不会出现在数据里） ----
  for (const endpoint of overview.orderEndpoints ?? []) {
    nodes.push(sized({
      id: orderEndpointId(endpoint.orderId, endpoint.role),
      type: 'orderEndpoint',
      // 与任务起终点同理：订单点位常落在站点上，需让开车辆与站点标记
      position: toFlowXY(shiftEndpoint(endpoint, ENDPOINT_OFFSET[endpoint.role])),
      hidden: !visibility.orderEndpoints,
      className: isDimmed(focus, focus.nodeIds, orderEndpointId(endpoint.orderId, endpoint.role)) ? 'is-dimmed' : '',
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
      // 车辆**从不压暗**：地图上找不到车比「上下文噪音」更糟（§图层定义）
      className: '',
      data: {
        entityType: 'vehicle',
        entityId: vehicle.id,
        code: vehicle.code,
        status: (live as { status?: string } | undefined)?.status ?? vehicle.status,
        battery: (live as { battery?: number } | undefined)?.battery ?? vehicle.battery,
        taskId: vehicle.taskId,
        /** 是否低电：在数据层算一次，节点组件与图例共用同一口径（阈值见 `metrics.ts`）。 */
        lowBattery: ((live as { battery?: number } | undefined)?.battery ?? vehicle.battery) <= LOW_BATTERY_PERCENT,
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
