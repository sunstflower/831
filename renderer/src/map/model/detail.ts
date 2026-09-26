/**
 * 选中对象的**详情卡内容**（纯计算）。
 *
 * 为什么要有这一层：地图原本只有一句「已选中：vehicle · AGV-01」，
 * 点了一台车之后看不到它的任务、路线、电量、告警 —— 这正是 Req-M6-2
 * 要求「点击实体与列表、详情双向联动」里的「详情」。
 *
 * 这里把「详情卡显示哪几行」变成可单测的数据，组件只负责排版。
 * 所有字段都来自**已有快照**，不新增请求、不新增业务字段（Req-M6-5）。
 */
import type { MapOverview } from '../../api/types';
import type { FlowSelection } from './toFlow';
import { buildEdgeLengthIndex, routeLength } from './edgeIndex';
import {
  ALERT_LEVEL_LABEL,
  ALERT_TYPE_LABEL,
  SITE_TYPE_LABEL,
  TASK_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  labelOf
} from '../../domain/labels';

export interface DetailRow {
  label: string;
  value: string;
  /** 用于给值上色（如故障/低电用 danger）。 */
  tone?: 'default' | 'ok' | 'warn' | 'danger' | 'dim';
}

export interface DetailCard {
  /** 卡片标题（实体名）。 */
  title: string;
  /** 副标题：类型 + 业务编号。 */
  subtitle: string;
  /** 业务对象类型（用于跳转/后续抽屉）。 */
  entityType: string;
  entityId: string;
  rows: DetailRow[];
  /** 关联的未处理告警。 */
  alerts: Array<{ id: string; label: string; tone: 'info' | 'warning' | 'critical' }>;
}

const EMPTY_PLACEHOLDER = '—';

function text(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return EMPTY_PLACEHOLDER;
  }
  return String(value);
}

/**
 * 构造详情卡。
 *
 * 返回 `null` 表示「该选中对象在画布上无详情可展示」（例如 `settings` 这类对象类型）
 * —— 由调用方决定显示「无详情」而不是显示一张空卡。
 */
export function buildDetailCard(overview: MapOverview, selection: FlowSelection | null): DetailCard | null {
  if (!selection?.entityType || !selection.entityId) {
    return null;
  }
  const { entityType, entityId } = selection;
  const alertsOf = (type: string, id: string): DetailCard['alerts'] =>
    overview.alerts
      .filter((alert) => alert.objectType === type && alert.objectId === id)
      .map((alert) => ({
        id: alert.id,
        // 用中文类型名而非机器值：地图上直接读到 `vehicle_offline` 对使用者不构成信息
        label: `${labelOf(ALERT_TYPE_LABEL, alert.type)} · ${labelOf(ALERT_LEVEL_LABEL, alert.level)}`,
        tone: alert.level
      }));

  if (entityType === 'vehicle') {
    const vehicle = overview.vehicles.find((item) => item.id === entityId);
    if (!vehicle) {
      return null;
    }
    const task = vehicle.taskId ? overview.tasks.find((item) => item.id === vehicle.taskId) : undefined;
    const route = task ? overview.routes.find((item) => item.taskId === task.id) : undefined;
    const lengthIndex = buildEdgeLengthIndex(overview);
    const length = route ? routeLength(lengthIndex, route.nodeIds) : null;
    const batteryTone = vehicle.battery <= 20 ? 'danger' : vehicle.battery <= 40 ? 'warn' : 'ok';
    return {
      title: vehicle.code,
      subtitle: `车辆 · ${labelOf(VEHICLE_STATUS_LABEL, vehicle.status)}`,
      entityType,
      entityId,
      rows: [
        { label: '状态', value: labelOf(VEHICLE_STATUS_LABEL, vehicle.status) },
        { label: '电量', value: `${Math.round(vehicle.battery)}%`, tone: batteryTone },
        { label: '坐标', value: `${Math.round(vehicle.x)}, ${Math.round(vehicle.y)} m` },
        { label: '执行任务', value: text(task?.code), tone: task ? 'default' : 'dim' },
        {
          label: '任务进度',
          value: task ? `${Math.round(task.progress * 100)}%` : EMPTY_PLACEHOLDER,
          tone: task ? 'default' : 'dim'
        },
        {
          label: '路线',
          value: route ? `${route.nodeIds.length} 个节点` : '无路线',
          tone: route ? 'default' : 'dim'
        },
        {
          label: '路线长度',
          value: length
            ? length.knownSegments === length.segments
              ? `${Math.round(length.totalM)} m`
              : `${Math.round(length.totalM)} m（${length.knownSegments}/${length.segments} 段有数据）`
            : EMPTY_PLACEHOLDER,
          tone: length && length.knownSegments < length.segments ? 'warn' : 'default'
        }
      ],
      alerts: alertsOf('vehicle', entityId)
    };
  }

  if (entityType === 'task') {
    const task = overview.tasks.find((item) => item.id === entityId);
    if (!task) {
      return null;
    }
    const from = overview.sites.find((item) => item.id === task.fromSiteId);
    const to = overview.sites.find((item) => item.id === task.toSiteId);
    const vehicle = task.vehicleId ? overview.vehicles.find((item) => item.id === task.vehicleId) : undefined;
    return {
      title: task.code,
      subtitle: `任务 · ${labelOf(TASK_STATUS_LABEL, task.status)}`,
      entityType,
      entityId,
      rows: [
        { label: '状态', value: labelOf(TASK_STATUS_LABEL, task.status) },
        { label: '起点', value: from ? `${from.code} ${from.name ?? ''}`.trim() : text(task.fromSiteId) },
        { label: '终点', value: to ? `${to.code} ${to.name ?? ''}`.trim() : text(task.toSiteId) },
        { label: '进度', value: `${Math.round(task.progress * 100)}%` },
        { label: '执行车辆', value: text(vehicle?.code), tone: vehicle ? 'default' : 'dim' }
      ],
      alerts: alertsOf('task', entityId)
    };
  }

  if (entityType === 'route') {
    const route = overview.routes.find((item) => item.id === entityId);
    if (!route) {
      return null;
    }
    const lengthIndex = buildEdgeLengthIndex(overview);
    const length = routeLength(lengthIndex, route.nodeIds);
    const task = route.taskId ? overview.tasks.find((item) => item.id === route.taskId) : undefined;
    const vehicle = route.vehicleId ? overview.vehicles.find((item) => item.id === route.vehicleId) : undefined;
    return {
      title: route.id,
      subtitle: `路线 · ${route.status === 'active' ? '生效中' : route.status === 'superseded' ? '已被替代' : '已取消'}`,
      entityType,
      entityId,
      rows: [
        { label: '状态', value: route.status === 'active' ? '生效中' : route.status === 'superseded' ? '已被替代' : '已取消' },
        { label: '节点数', value: `${route.nodeIds.length}` },
        {
          label: '路线长度',
          value:
            length.knownSegments === length.segments
              ? `${Math.round(length.totalM)} m`
              : `${Math.round(length.totalM)} m（${length.knownSegments}/${length.segments} 段有数据）`,
          tone: length.knownSegments < length.segments ? 'warn' : 'default'
        },
        { label: '所属任务', value: text(task?.code), tone: task ? 'default' : 'dim' },
        { label: '执行车辆', value: text(vehicle?.code), tone: vehicle ? 'default' : 'dim' }
      ],
      alerts: alertsOf('route', entityId)
    };
  }

  if (entityType === 'site') {
    const site = overview.sites.find((item) => item.id === entityId);
    if (!site) {
      return null;
    }
    const node = site.nodeId ? overview.nodes.find((item) => item.id === site.nodeId) : undefined;
    return {
      title: site.name ?? site.code,
      subtitle: `站点 · ${labelOf(SITE_TYPE_LABEL, site.type)}`,
      entityType,
      entityId,
      rows: [
        { label: '编码', value: site.code },
        { label: '类型', value: labelOf(SITE_TYPE_LABEL, site.type) },
        { label: '状态', value: site.status === 'disabled' ? '已停用' : '启用', tone: site.status === 'disabled' ? 'warn' : 'ok' },
        { label: '挂靠节点', value: text(node?.code), tone: node ? 'default' : 'warn' },
        { label: '坐标', value: `${Math.round(site.x)}, ${Math.round(site.y)} m` }
      ],
      alerts: alertsOf('site', entityId)
    };
  }

  if (entityType === 'node') {
    const node = overview.nodes.find((item) => item.id === entityId);
    if (!node) {
      return null;
    }
    const connected = overview.edges.filter(
      (edge) => edge.fromNodeId === node.id || edge.toNodeId === node.id
    );
    const disabled = connected.filter((edge) => edge.status === 'disabled').length;
    return {
      title: node.code,
      subtitle: '路网节点',
      entityType,
      entityId,
      rows: [
        { label: '状态', value: node.status === 'disabled' ? '已禁用' : '启用', tone: node.status === 'disabled' ? 'warn' : 'ok' },
        { label: '坐标', value: `${Math.round(node.x)}, ${Math.round(node.y)} m` },
        { label: '连接边数', value: `${connected.length}` },
        {
          label: '禁行边',
          value: `${disabled}`,
          tone: disabled > 0 ? 'warn' : 'dim'
        }
      ],
      alerts: alertsOf('node', entityId)
    };
  }

  if (entityType === 'order') {
    const endpoints = (overview.orderEndpoints ?? []).filter((item) => item.orderId === entityId);
    if (endpoints.length === 0) {
      return null;
    }
    return {
      title: entityId,
      subtitle: '订单',
      entityType,
      entityId,
      rows: endpoints.map((endpoint) => ({
        label: endpoint.role === 'from' ? '取货点' : '送货点',
        value: `${Math.round(endpoint.x)}, ${Math.round(endpoint.y)} m${
          endpoint.confidence === undefined ? '' : ` · 置信度 ${(endpoint.confidence * 100).toFixed(0)}%`
        }`,
        tone: endpoint.pathStatus === 'route_unavailable' ? 'warn' : endpoint.confidence !== undefined && endpoint.confidence < 0.8 ? 'warn' : 'default'
      })),
      alerts: alertsOf('order', entityId)
    };
  }

  return null;
}
