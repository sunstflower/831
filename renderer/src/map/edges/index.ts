/** 边类型注册表：与 `nodes/index.ts` 同理，必须是模块级常量。 */
import { NetEdge } from './NetEdge';
import { RouteEdge } from './RouteEdge';

export const edgeTypes = {
  net: NetEdge,
  route: RouteEdge
} as const;
