/** 节点/边 `data` 的形状（与 `model/toFlow.ts` 的产出保持一致）。 */
import type { ObjectType, SiteType, TaskStatus, VehicleStatus } from '@udm/shared';
import type { MapAlert } from '../../api/types';

export interface EntityRef {
  entityType: ObjectType;
  entityId: string;
}

export interface MapNodeData extends Record<string, unknown> {
  entityType: ObjectType;
  entityId: string;
  code?: string;
  name?: string;
  status?: string;
  alerts?: MapAlert[];
}

export interface SiteNodeData extends MapNodeData {
  siteType: SiteType;
  alerts?: MapAlert[];
}

export interface VehicleNodeData extends MapNodeData {
  status: VehicleStatus;
  battery: number;
  taskId: string | null;
  alerts?: MapAlert[];
}

export interface TaskEndpointData extends MapNodeData {
  role: 'from' | 'to';
  status: TaskStatus;
  progress: number;
  vehicleId: string | null;
}

export interface OrderEndpointData extends MapNodeData {
  role: 'from' | 'to';
  confidence: number | null;
  matchType: string | null;
  pathStatus: 'ok' | 'route_unavailable';
}

export interface NetEdgeData extends Record<string, unknown> {
  lengthM: number | null;
  speedLimitMps: number | null;
  disabled: boolean;
}

export interface RouteEdgeData extends Record<string, unknown> {
  routeId: string;
  taskId: string | null;
  vehicleId: string | null;
  superseded: boolean;
}
