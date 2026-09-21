/**
 * 节点类型注册表。
 *
 * **必须是模块级常量**（不得写成内联对象 `nodeTypes={{ ... }}`）：
 * 实测与官方一致——内联对象会让 React Flow 认为类型每次都变，
 * 从而卸载并重新挂载全部节点，直接造成帧率崩塌（`docs/module-M6-map.md` §9 第 1 条）。
 */
import { NetNode } from './NetNode';
import { OrderEndpointNode } from './OrderEndpointNode';
import { SiteNode } from './SiteNode';
import { TaskEndpointNode } from './TaskEndpointNode';
import { VehicleNode } from './VehicleNode';

export const nodeTypes = {
  net: NetNode,
  site: SiteNode,
  vehicle: VehicleNode,
  taskEndpoint: TaskEndpointNode,
  orderEndpoint: OrderEndpointNode
} as const;
