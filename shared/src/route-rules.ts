/**
 * M5 路径规划的**字段规则**（唯一作者，`docs/api.md` §3.5.1）。
 *
 * 与 `base-rules.ts` / `task-rules.ts` 同一分工：规则放这里，主进程与浏览器 Mock 都调它，
 * 各自只负责自己的存储。原语从 `base-rules.ts` 复用，**不复制**。
 *
 * ## 只有一个方法，但两个接口都用它
 *
 * `/api/routes/plan` 与 `/api/routes/compare` 的请求体**逐字段相同**
 * （`compare` 只是忽略 `algorithm`，两个都算）。因此这里只导出 `validateRouteInput`，
 * 由服务层决定要不要看 `algorithm` —— 给 `compare` 另写一份「允许清单」会让两个接口
 * 的字段校验随时间分叉（`ISS-032` 那一类）。
 */
import { ROUTE_ALGORITHMS, VEHICLE_TYPES, type RouteAlgorithm, type VehicleType } from './enums.js';
import { readEnum, readText, type FieldErrors, type RuleResult } from './base-rules.js';

/**
 * 途经点个数上限。
 *
 * 与任务列表的批量上限（`TASK_MAX_CARGO_KG` 那类常数）同理，是一个**成本护栏**而不是业务规则：
 * 每多一个途经点就多一次最短路，而调用方几乎不会真的需要 10 个以上 ——
 * 需要的话说明这条线该拆成多条路线，那属于路线管理而不是单次规划。
 */
export const ROUTE_MAX_VIA_NODES = 10;

export interface RoutePlanInput {
  fromNodeId: string;
  toNodeId: string;
  viaNodeIds: string[];
  vehicleType: VehicleType;
  algorithm: RouteAlgorithm;
}

/**
 * 把 `viaNodeIds` 读成字符串数组。
 *
 * 手写而不复用 `readText`：那是个**标量**读取器，对数组会一律判成「类型不对」。
 * 三处细节都是刻意的：**只接受数组**（不把逗号分隔的字符串当数组 —— 那会让
 * 「节点 id 里含逗号」变成一个无法表达的输入）、**逐项 trim**（去空白是输入整洁，
 * 与业务无关）、**空数组等价于不传**（调用方从表单读出 `[]` 时不该报错）。
 */
function readViaNodes(raw: Record<string, unknown>, fields: FieldErrors): string[] {
  const value = raw['viaNodeIds'];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fields['viaNodeIds'] = '必须是节点 id 数组';
    return [];
  }
  if (value.length > ROUTE_MAX_VIA_NODES) {
    fields['viaNodeIds'] = `途经点不能超过 ${ROUTE_MAX_VIA_NODES} 个`;
    return [];
  }
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') {
      fields['viaNodeIds'] = '途经点必须是节点 id';
      return [];
    }
    ids.push(item.trim());
  }
  return ids;
}

export function validateRouteInput(raw: Record<string, unknown>): RuleResult<RoutePlanInput> {
  const fields: FieldErrors = {};
  const fromNodeId = readText(raw, 'fromNodeId', { required: true, maxLength: 64 }, fields);
  const toNodeId = readText(raw, 'toNodeId', { required: true, maxLength: 64 }, fields);
  const viaNodeIds = readViaNodes(raw, fields);
  // 车种必填而不是给默认值：它决定「没有单独限速的边」按多快算，直接改变返回的耗时。
  // 给默认值会让「忘了传」与「故意按 other 算」得到同一个结果，而前者是错的输入。
  const vehicleType = readEnum(raw, 'vehicleType', VEHICLE_TYPES, { required: true }, fields);
  const algorithm = readEnum(raw, 'algorithm', ROUTE_ALGORITHMS, { required: false }, fields);

  if (
    !fromNodeId.ok ||
    !toNodeId.ok ||
    !vehicleType.ok ||
    !algorithm.ok ||
    Object.keys(fields).length > 0
  ) {
    return { ok: false, fields };
  }
  return {
    ok: true,
    value: {
      fromNodeId: fromNodeId.value as string,
      toNodeId: toNodeId.value as string,
      viaNodeIds,
      vehicleType: vehicleType.value as VehicleType,
      // 缺省算法：`aStar`（与 `SETTINGS_SCHEMA` 的 `route.defaultAlgorithm` 默认值一致）。
      // 服务层会用库里的设置覆盖它 —— 这里只是「设置里也没值」时的最后兜底。
      algorithm: (algorithm.value ?? 'aStar') as RouteAlgorithm
    }
  };
}
