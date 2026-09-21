/**
 * 快照「结构签名」。
 *
 * 兜底轮询每秒都会拿到一份新快照；若无条件 `setOverview(newData)`，
 * `nodes`/`edges` 数组会被每秒换新引用，触发 React Flow 全量重算
 * （实测表现：边会偶发地整帧消失，因为边依赖节点测量结果，重算期间存在空档）。
 *
 * 因此只比较**结构相关内容**，相同则保持原引用不动
 * （`docs/module-M6-map.md` §9 第 2 条：数组只在数据真变了才换新引用）。
 *
 * 车辆位置**不计入签名**：位置由事件推送 + `positionsRef` 走定向更新，
 * 不应导致图结构重建。电量取整后计入，避免小数抖动引发重建。
 */
import type { MapOverview } from '../../api/types';

export function structuralSignature(overview: MapOverview): string {
  const parts: string[] = [];
  parts.push(`n:${overview.nodes.length}`);
  for (const item of overview.nodes) {
    parts.push(`${item.id}|${item.x}|${item.y}|${item.status}`);
  }
  parts.push(`e:${overview.edges.length}`);
  for (const item of overview.edges) {
    parts.push(`${item.id}|${item.fromNodeId}|${item.toNodeId}|${item.status ?? ''}`);
  }
  parts.push(`s:${overview.sites.length}`);
  for (const item of overview.sites) {
    parts.push(`${item.id}|${item.x}|${item.y}|${item.status}|${item.type}`);
  }
  parts.push(`v:${overview.vehicles.length}`);
  for (const item of overview.vehicles) {
    // 位置刻意排除；状态/电量/任务绑定参与签名
    parts.push(`${item.id}|${item.status}|${Math.round(item.battery)}|${item.taskId ?? ''}`);
  }
  parts.push(`t:${overview.tasks.length}`);
  for (const item of overview.tasks) {
    parts.push(`${item.id}|${item.status}|${item.progress}|${item.vehicleId ?? ''}`);
  }
  parts.push(`r:${overview.routes.length}`);
  for (const item of overview.routes) {
    parts.push(`${item.id}|${item.status}|${item.nodeIds.join(',')}`);
  }
  parts.push(`a:${overview.alerts.length}`);
  for (const item of overview.alerts) {
    parts.push(`${item.id}|${item.type}|${item.level}|${item.status ?? ''}|${item.objectType}|${item.objectId}`);
  }
  parts.push(`o:${overview.orderEndpoints?.length ?? 0}`);
  for (const item of overview.orderEndpoints ?? []) {
    parts.push(`${item.orderId}|${item.role}|${item.x}|${item.y}|${item.pathStatus ?? ''}`);
  }
  return parts.join('\n');
}
