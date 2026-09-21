import type { ApiFailure, ApiSuccess, ErrorSource } from './types.js';

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface ErrorDefinition {
  source: ErrorSource;
  message: string;
  httpStatus: number;
  /**
   * 仅数据文件导入域（`IMPORT.*` / `ORDER.*` / `MAP.*` / `VEHICLE.*` / `ALGO.*` / `SCENARIO.*`）使用：
   * 该 code 的**默认**严重度。`error` 阻断所在条目（同一批次其它合法条目仍入库）、
   * `warning` 入库但提示、`info` 仅告知。调用点可在单条 `ImportIssue` 上覆盖。
   * 运行时业务 code 不带此字段。
   */
  severity?: ErrorSeverity;
}

export const ERROR_CODES = {
  'AUTH.REQUIRED': { source: 'auth', message: '未登录或会话已失效', httpStatus: 401 },
  'AUTH.INVALID_TOKEN': { source: 'auth', message: '会话令牌无效', httpStatus: 401 },
  'AUTH.FORBIDDEN': { source: 'auth', message: '当前账号无此操作权限', httpStatus: 403 },
  'AUTH.LOGIN_FAILED': { source: 'auth', message: '用户名或密码错误', httpStatus: 401 },
  'AUTH.USER_DISABLED': { source: 'auth', message: '账号已被禁用', httpStatus: 401 },
  'AUTH.ACCOUNT_LOCKED': { source: 'auth', message: '密码错误次数过多，账号已临时锁定', httpStatus: 401 },
  'AUTH.OLD_PASSWORD_WRONG': { source: 'auth', message: '原密码错误', httpStatus: 400 },
  'VALIDATION.FAILED': { source: 'validation', message: '参数校验失败', httpStatus: 400 },
  'API.ROUTE_NOT_FOUND': { source: 'validation', message: '接口不存在', httpStatus: 404 },
  'USER.NOT_FOUND': { source: 'business', message: '用户不存在', httpStatus: 404 },
  'USER.NAME_EXISTS': { source: 'business', message: '用户名已存在', httpStatus: 409 },
  'SITE.NOT_FOUND': { source: 'business', message: '站点不存在', httpStatus: 404 },
  'VEHICLE.NOT_FOUND': { source: 'business', message: '车辆不存在', httpStatus: 404 },
  'NODE.NOT_FOUND': { source: 'business', message: '路网节点不存在（导入时指引用的节点编码无法解析）', httpStatus: 404 },
  'EDGE.NOT_FOUND': { source: 'business', message: '路网边不存在（导入时指引用的边无法解析）', httpStatus: 404 },
  'TEMPLATE.NOT_FOUND': { source: 'business', message: '任务模板不存在', httpStatus: 404 },
  'BASE.CODE_EXISTS': { source: 'business', message: '编码已存在', httpStatus: 409 },
  'BASE.NODE_IN_USE': { source: 'business', message: '节点被边或站点引用，禁止禁用或删除', httpStatus: 409 },
  'TASK.NOT_FOUND': { source: 'business', message: '任务不存在', httpStatus: 404 },
  'TASK.STATE_CONFLICT': { source: 'business', message: '当前状态不允许执行该操作', httpStatus: 409 },
  'TASK.BATCH_PARTIAL_FAIL': { source: 'business', message: '批量导入存在失败项', httpStatus: 200 },
  'VEHICLE.STATE_CONFLICT': { source: 'business', message: '车辆状态不允许该操作', httpStatus: 409 },
  'DISPATCH.REQUEST_NOT_FOUND': { source: 'business', message: '调度请求不存在或已失效', httpStatus: 404 },
  'DISPATCH.PLAN_EXPIRED': { source: 'business', message: '调度预览已过期，请重新预览', httpStatus: 409 },
  'DISPATCH.ALREADY_APPLIED': { source: 'business', message: '该调度请求已应用', httpStatus: 409 },
  'DISPATCH.NO_CANDIDATE': { source: 'business', message: '没有满足约束的候选车辆', httpStatus: 409 },
  'ROUTE.NOT_FOUND_PATH': { source: 'business', message: '起点与终点之间不存在可行路径', httpStatus: 409 },
  'GRAPH.EMPTY': { source: 'business', message: '路网为空', httpStatus: 409 },
  'GRAPH.DISCONNECTED': { source: 'business', message: '路网不连通', httpStatus: 409 },
  'GRAPH.BLOCKED': { source: 'business', message: '受禁行规则限制无法通行', httpStatus: 409 },
  'ALERT.NOT_FOUND': { source: 'business', message: '告警不存在', httpStatus: 404 },
  'ALERT.STATE_CONFLICT': { source: 'business', message: '告警当前状态不允许该操作', httpStatus: 409 },
  'SETTINGS.KEY_NOT_FOUND': { source: 'business', message: '设置项不存在', httpStatus: 404 },
  'SYS.INTERNAL': { source: 'system', message: '系统内部错误，请查看日志', httpStatus: 500 },

  // ---------------------------------------------------------------------------
  // 数据文件导入（F1 订单 / F2 仿真地图 / F3 车辆参数 / F4 算法配置）
  //
  // 命名遵循 D-33 的 `域.原因`（对应 AIP-193 的 domain + reason）。同一概念
  // **只允许一个 code**：`severity` 是单次问题出现的属性，不是 code 的身份，
  // 因此「导入时 warning、运行时 error」共用同一个 code（如 `GRAPH.EMPTY`）。
  // ---------------------------------------------------------------------------
  // ---- 导入管线（四类文件通用） ----
  'IMPORT.FILE_TOO_LARGE': { source: 'validation', severity: 'error', message: '超过体积或行数上限', httpStatus: 413 },
  'IMPORT.ENCODING_INVALID': { source: 'validation', severity: 'error', message: '无法解码', httpStatus: 422 },
  'IMPORT.ENCODING_ASSUMED': { source: 'validation', severity: 'warning', message: '按 GB18030 解码，需用户确认', httpStatus: 200 },
  'IMPORT.DELIMITER_ASSUMED': { source: 'validation', severity: 'warning', message: '分隔符为推断值', httpStatus: 200 },
  'IMPORT.KIND_MISMATCH': { source: 'validation', severity: 'error', message: '`kind` 与接口不符', httpStatus: 400 },
  'IMPORT.SCHEMA_VERSION_UNSUPPORTED': { source: 'validation', severity: 'error', message: '版本不支持', httpStatus: 400 },
  'IMPORT.SCHEMA_VERSION_ASSUMED': { source: 'validation', severity: 'info', message: '文件未声明版本，按 v1 解析', httpStatus: 200 },
  'IMPORT.MAPPING_INCOMPLETE': { source: 'validation', severity: 'error', message: '标准字段缺少来源列', httpStatus: 400 },
  'IMPORT.MAPPING_CONFLICT': { source: 'validation', severity: 'error', message: '多列映射到同一标准字段', httpStatus: 400 },
  'IMPORT.FILE_CHANGED': { source: 'business', severity: 'error', message: '确认时校验和与预检不一致', httpStatus: 409 },
  'IMPORT.IN_USE_CONFLICT': { source: 'business', severity: 'error', message: '被进行中的任务/规则引用，禁止 replace', httpStatus: 409 },
  'IMPORT.CROSS_CHECK_SKIPPED': { source: 'validation', severity: 'warning', message: '依赖数据缺失，跳过交叉校验', httpStatus: 200 },
  'IMPORT.BATCH_FAILED': { source: 'business', severity: 'error', message: '批次致命错误，已整体回滚', httpStatus: 409 },
  // ---- F1 订单数据集 ----
  'ORDER.FIELD_REQUIRED': { source: 'validation', severity: 'error', message: '必填缺失', httpStatus: 200 },
  'ORDER.FIELD_FORMAT': { source: 'validation', severity: 'error', message: '类型或格式非法', httpStatus: 200 },
  'ORDER.NUMBER_NORMALIZED': { source: 'validation', severity: 'warning', message: '数值被规范化（如千分位）', httpStatus: 200 },
  'ORDER.DUPLICATE_ORDER': { source: 'business', severity: 'error', message: '批次内或库中重复', httpStatus: 200 },
  'ORDER.UPDATE_SKIPPED_STATE': { source: 'business', severity: 'warning', message: '目标订单非 `draft`，跳过更新', httpStatus: 200 },
  'ORDER.HEADER_INCONSISTENT': { source: 'validation', severity: 'error', message: '同批次混入 26 列与 32 列两种骨架', httpStatus: 200 },
  'ORDER.TIMEWINDOW_PAIR_MISSING': { source: 'validation', severity: 'error', message: '时间窗未成对出现', httpStatus: 200 },
  'ORDER.TIMEWINDOW_INVALID': { source: 'validation', severity: 'error', message: '`tw_start_s >= tw_end_s`', httpStatus: 200 },
  'ORDER.TIMEWINDOW_CROSS_DAY': { source: 'validation', severity: 'error', message: '`tw_end_s > 86400`（跨日，首期不支持）', httpStatus: 200 },
  'ORDER.TIME_TEXT_MISMATCH': { source: 'validation', severity: 'warning', message: '文本时间与秒数列对不上（比对按分钟下取整）', httpStatus: 200 },
  'ORDER.ORDER_TIME_AFTER_WINDOW': { source: 'validation', severity: 'warning', message: '`order_time_s > tw_start_s`（下单晚于时间窗开始）', httpStatus: 200 },
  'ORDER.PRIORITY_OUT_OF_RANGE': { source: 'validation', severity: 'error', message: '`priority` 不在 `{1,2,3}`', httpStatus: 200 },
  'ORDER.PRIORITY_FORMAT': { source: 'validation', severity: 'error', message: '`priority` 用了枚举名而非数字', httpStatus: 200 },
  'ORDER.TYPE_UNKNOWN': { source: 'validation', severity: 'error', message: '`order_type` 不在已知取值内', httpStatus: 200 },
  'ORDER.TYPE_ENDPOINT_MISMATCH': { source: 'validation', severity: 'error', message: '`order_type` 与起终点是否为 `DEPOT` 不符（§3.5）', httpStatus: 200 },
  'ORDER.SAME_ENDPOINT': { source: 'validation', severity: 'error', message: '`pickup_id == dropoff_id`', httpStatus: 200 },
  'ORDER.DERIVED_DIST_MISMATCH': { source: 'validation', severity: 'warning', message: '派生距离/时长列与复算不符', httpStatus: 200 },
  'ORDER.TW_INFEASIBLE_ROW': { source: 'validation', severity: 'warning', message: '`tw_feasible = 0`', httpStatus: 200 },
  'ORDER.PICKUP_COORD_MISMATCH': { source: 'validation', severity: 'warning', message: '订单坐标与站点表不符（疑似订单与地图版本不一致）', httpStatus: 200 },
  'ORDER.NAME_CODE_MISMATCH': { source: 'validation', severity: 'warning', message: '`pickup_name` 与命中的站点名不一致', httpStatus: 200 },
  'ORDER.REGION_NOT_FOUND': { source: 'business', severity: 'error', message: '起终点无法匹配', httpStatus: 200 },
  'ORDER.REGION_AMBIGUOUS': { source: 'business', severity: 'error', message: '匹配到多个候选', httpStatus: 200 },
  'ORDER.SITE_DISABLED': { source: 'business', severity: 'warning', message: '站点已禁用', httpStatus: 200 },
  // ---- F2 仿真地图（文件级校验；图结构性质归 GRAPH.*） ----
  'MAP.CODE_DUPLICATE': { source: 'validation', severity: 'error', message: 'code 重复', httpStatus: 200 },
  'MAP.ROAD_TYPE_NOT_FOUND': { source: 'validation', severity: 'error', message: '边引用的 `roadType` 未声明', httpStatus: 200 },
  'MAP.RESTRICTION_TARGET_NOT_FOUND': { source: 'validation', severity: 'error', message: '禁行目标不存在', httpStatus: 200 },
  'MAP.REFERENCE_UNRESOLVED_IN_DB': { source: 'validation', severity: 'error', message: '`merge` 模式下库内也无法解析引用', httpStatus: 200 },
  'MAP.COORDINATE_SYSTEM_UNSUPPORTED': { source: 'validation', severity: 'error', message: '`meta.coordinateSystem` 非 `planar-meters`', httpStatus: 200 },
  'MAP.EDGE_SELF_LOOP': { source: 'validation', severity: 'error', message: '自环边', httpStatus: 200 },
  'MAP.EDGE_DUPLICATE': { source: 'validation', severity: 'error', message: '重复有向边（含 `bidirectional` 与显式反向边冲突）', httpStatus: 200 },
  'MAP.EDGE_INVALID_SPEED': { source: 'validation', severity: 'error', message: '限速非正', httpStatus: 200 },
  'MAP.BERTH_OUT_OF_RANGE': { source: 'validation', severity: 'error', message: '泊位区间越出边长（`endPosM > lengthM`）', httpStatus: 200 },
  'MAP.SITE_WITHOUT_EDGE': { source: 'validation', severity: 'warning', message: '站点未绑定边', httpStatus: 200 },
  'MAP.EDGE_LENGTH_MISMATCH': { source: 'validation', severity: 'warning', message: '`lengthM` 与两端坐标距离不符（容差 0.01 m）', httpStatus: 200 },
  'MAP.BERTH_LENGTH_MISMATCH': { source: 'validation', severity: 'warning', message: '`berthLengthM` ≠ `endPosM − startPosM`', httpStatus: 200 },
  'MAP.SPEED_LIMIT_MISMATCH': { source: 'validation', severity: 'warning', message: '行内 `speed_kmh` 与 `roadType` 声明值不一致', httpStatus: 200 },
  'MAP.LANE_COUNT_MISMATCH': { source: 'validation', severity: 'warning', message: '行内 `num_lanes` 与 `roadType` 声明值不一致', httpStatus: 200 },
  'MAP.GEOJSON_MISMATCH': { source: 'validation', severity: 'warning', message: 'GeoJSON 与 CSV 不一致（CSV 为准）', httpStatus: 200 },
  'MAP.OBSTACLE_EDGE_UNLINKED': { source: 'validation', severity: 'warning', message: '`construction` 障碍未关联任何边', httpStatus: 200 },
  'MAP.ROAD_TYPE_INFERRED': { source: 'validation', severity: 'warning', message: '`roadType` 缺失，按限速推断得到', httpStatus: 200 },
  'MAP.ONE_WAY_EDGE': { source: 'validation', severity: 'info', message: '单向边且无反向边（合法，疑似编辑遗漏）', httpStatus: 200 },
  // ---- F3 车辆参数 ----
  'VEHICLE.RUNTIME_FIELD_REJECTED': { source: 'validation', severity: 'error', message: '文件中出现运行态字段（§5.1）', httpStatus: 200 },
  'VEHICLE.TYPE_NOT_IN_FLEET': { source: 'validation', severity: 'error', message: '`vehicles` 的键未在 `fleet` 中声明', httpStatus: 200 },
  'VEHICLE.FLEET_TYPE_MISSING': { source: 'validation', severity: 'warning', message: '`fleet` 声明的车型无参数体（视为预留）', httpStatus: 200 },
  'VEHICLE.ROAD_TYPE_UNKNOWN': { source: 'validation', severity: 'warning', message: '`speedLimitsKmh` 的键不是已知道路类型', httpStatus: 200 },
  'VEHICLE.ROAD_SPEED_EXCEEDS_MAX': { source: 'validation', severity: 'error', message: '某道路限速超过设计最高车速（规则 4）', httpStatus: 200 },
  'VEHICLE.SPEED_ORDER_INVALID': { source: 'validation', severity: 'error', message: '`operatingSpeedKmh > maxSpeedKmh`（规则 3）', httpStatus: 200 },
  'VEHICLE.SOC_RANGE_INVALID': { source: 'validation', severity: 'error', message: '`socMinPct >= socTargetPct`（规则 1）', httpStatus: 200 },
  'VEHICLE.EFFECTIVE_RANGE_MISMATCH': { source: 'validation', severity: 'error', message: '有效续航与公式不符（规则 2）', httpStatus: 200 },
  'VEHICLE.EMERGENCY_DECEL_INVALID': { source: 'validation', severity: 'error', message: '应急减速度未大于常规减速度（规则 9）', httpStatus: 200 },
  'VEHICLE.PAYLOAD_EXCEEDED_BY_ORDER': { source: 'business', severity: 'error', message: '存在订单货重超过最大载重（规则 7）', httpStatus: 200 },
  'VEHICLE.PAYLOAD_ALL_INSUFFICIENT': { source: 'business', severity: 'error', message: '全车队载重均不足以承接任何订单', httpStatus: 200 },
  'VEHICLE.ENERGY_CAPACITY_MISMATCH': { source: 'validation', severity: 'warning', message: '能耗 × 续航与容量偏差超 5%（规则 5）', httpStatus: 200 },
  'VEHICLE.CHARGE_RATE_MISMATCH': { source: 'validation', severity: 'warning', message: '充电速率与功率/容量偏差超 10%（规则 6）', httpStatus: 200 },
  'VEHICLE.CARGO_BOX_UNDERSIZED': { source: 'validation', severity: 'warning', message: '`cells × cellMaxLoadKg < maxPayloadKg`（规则 8）', httpStatus: 200 },
  'VEHICLE.ENERGY_MODEL_APPROXIMATE': { source: 'validation', severity: 'warning', message: '缺 `batteryCapacityKwh`，退化为百分比近似', httpStatus: 200 },
  'VEHICLE.ENERGY_NO_LOAD_FACTOR': { source: 'validation', severity: 'info', message: '未做载重修正，重载实际续航会低于估算', httpStatus: 200 },
  'VEHICLE.CONCURRENCY_UNSUPPORTED': { source: 'validation', severity: 'warning', message: '`maxConcurrentStops>1` 首期不生效', httpStatus: 200 },
  'VEHICLE.SITE_TYPE_UNCOVERED': { source: 'validation', severity: 'warning', message: '声明可服务的站点类别无对应站点', httpStatus: 200 },
  'VEHICLE.PASSAGE_WIDTH_CONFLICT': { source: 'validation', severity: 'warning', message: '`minPassageWidthM` 大于所有道路可通行宽度', httpStatus: 200 },
  'VEHICLE.SPEED_LIMIT_CONFLICT': { source: 'validation', severity: 'info', message: '车型限速高于地图同类型道路限速（实际取更严一侧）', httpStatus: 200 },
  'VEHICLE.WEATHER_UNKNOWN': { source: 'validation', severity: 'warning', message: '`weather` 含未知取值', httpStatus: 200 },
  'VEHICLE.CUSTOM_RULE_FAILED': { source: 'validation', severity: 'info', message: '文件自定义一致性规则未通过（不阻断）', httpStatus: 200 },
  'VEHICLE.SPEED_OUTLIER': { source: 'validation', severity: 'info', message: '同类型车辆速度离散度过大', httpStatus: 200 },
  // ---- F4 算法配置 ----
  'ALGO.WEIGHT_NEGATIVE': { source: 'validation', severity: 'error', message: '权重为负', httpStatus: 200 },
  'ALGO.WEIGHTS_ALL_ZERO': { source: 'validation', severity: 'error', message: '权重全为 0', httpStatus: 200 },
  'ALGO.WEIGHT_IMBALANCE': { source: 'validation', severity: 'warning', message: '权重差异过大', httpStatus: 200 },
  'ALGO.HEURISTIC_NOT_ADMISSIBLE': { source: 'validation', severity: 'warning', message: '参考速度可能导致 A* 非最优', httpStatus: 200 },
  'ALGO.LIMIT_RAISED': { source: 'validation', severity: 'warning', message: '规模上限被调高', httpStatus: 200 },
  'ALGO.SETTINGS_CONFLICT': { source: 'business', severity: 'info', message: '与 `settings` 表既有值冲突', httpStatus: 200 },
  'ALGO.STRATEGY_NOT_ENABLED': { source: 'validation', severity: 'error', message: '`defaultStrategy` 不在 `enabledStrategies` 中', httpStatus: 200 },
  // ---- 场景包组合校验 ----
  'SCENARIO.VEHICLE_TYPE_UNCOVERED': { source: 'validation', severity: 'warning', message: '车队车型在算法配置中无参数', httpStatus: 200 },
  'SCENARIO.PARAM_MISSING': { source: 'validation', severity: 'warning', message: '必需参数缺失', httpStatus: 200 },
  // ---- 路径规划 ----
  'ROUTE.VIA_NOT_ALLOWED': { source: 'business', severity: 'error', message: '配置关闭 `allowViaNodes` 后仍传了 `viaNodeIds`', httpStatus: 200 },
  'ROUTE.DETOUR_EXCEEDED': { source: 'business', severity: 'warning', message: '实际里程超出 `maxDetourRatio` 上限', httpStatus: 200 },
  // ---- 图结构 ----
  'GRAPH.ISOLATED_NODE': { source: 'validation', severity: 'warning', message: '存在没有任何邻边的孤立节点', httpStatus: 200 },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CODES;

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly source: ErrorSource;
  readonly detail?: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, detail?: Record<string, unknown>) {
    const definition = ERROR_CODES[code];
    super(message ?? definition.message);
    this.name = 'DomainError';
    this.code = code;
    this.source = definition.source;
    this.detail = detail;
  }
}

export function ok<T>(data: T): ApiSuccess<T> {
  return { code: 0, message: 'success', data };
}

export function fail(code: ErrorCode, detail?: Record<string, unknown>, message?: string): ApiFailure {
  const definition = ERROR_CODES[code];
  return {
    code,
    message: message ?? definition.message,
    source: definition.source,
    ...(detail ? { detail } : {})
  };
}

export function fromError(error: unknown, traceId?: string): ApiFailure {
  if (error instanceof DomainError) {
    const definition = ERROR_CODES[error.code];
    return {
      code: error.code,
      message: error.message || definition.message,
      source: error.source,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(traceId ? { traceId } : {})
    };
  }
  return {
    code: 'SYS.INTERNAL',
    message: ERROR_CODES['SYS.INTERNAL'].message,
    source: 'system',
    ...(traceId ? { traceId } : {})
  };
}

export function isFailure<T>(result: ApiSuccess<T> | ApiFailure): result is ApiFailure {
  return result.code !== 0;
}
