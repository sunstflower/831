/**
 * 地图概览契约（`GET /api/map/overview`，`docs/api.md` §3.6.1）。
 *
 * 类型**单一来源在 `@udm/shared`**：主进程按 shared 类型产出快照，渲染层按同一份类型消费。
 * 若在此处重新声明一份，两边一旦漂移就会出现「后端改了字段名，前端静默 undefined」，
 * 所以这里只做别名再导出，不新增字段。
 *
 * 坐标一律为平面 `{x, y}` 米制（D-05 / `design.md` §3.2），**禁止经纬度**。
 */
import type {
  MapOverview,
  MapSnapshotAlert,
  MapSnapshotEdge,
  MapSnapshotNode,
  MapSnapshotOrderEndpoint,
  MapSnapshotRoute,
  MapSnapshotSite,
  MapSnapshotTask,
  MapSnapshotVehicle
} from '@udm/shared';

export type MapNode = MapSnapshotNode;
export type MapEdge = MapSnapshotEdge;
export type MapSite = MapSnapshotSite;
export type MapVehicle = MapSnapshotVehicle;
export type MapTask = MapSnapshotTask;
export type MapRoute = MapSnapshotRoute;
export type MapAlert = MapSnapshotAlert;
export type MapOrderEndpoint = MapSnapshotOrderEndpoint;
export type { MapOverview };
