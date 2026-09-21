# API 接口文档

> 项目：无人物流调度管理软件 · 文档阶段
> 配套：[`design.md`](../design.md)（设计文档，字段/表结构以此为准）
> 说明：接口以服务路径 `/api/{module}/{action}` 表达。实现层映射三种适配器（IPC / 本地 HTTP / Mock），契约完全一致；调用方只依赖 `shared/apiClient`，不感知传输细节。

## 1. 通用约定

### 1.1 传输与信封

- 所有调用载荷为 JSON；列表/分页参数可在 IPC 载荷内联，HTTP 形态为 query。
- **成功**：

```json
{ "code": 0, "message": "success", "data": { } }
```

- **失败**（HTTP 形态附状态码：400 validation / 401 auth / 403 forbidden / 404 not found / 409 conflict / 500 system）：

```json
{
  "code": "TASK.STATE_CONFLICT",
  "message": "当前状态不允许执行该操作",
  "source": "business",
  "detail": { "taskId": "…", "currentStatus": "finished", "expected": ["running", "paused"] }
}
```

### 1.2 会话与鉴权

- `POST /api/auth/login` 成功后返回 `token` 与 `user.permissions`。
- 除登录与健康检查外，每次调用必须通过会话鉴权；IPC 形态由主进程从会话自动注入，HTTP 形态请求头 `Authorization: Bearer <token>`。
- 鉴权顺序：是否登录 → 权限点是否允许 → 业务校验。失败分别返回 `AUTH.REQUIRED` / `AUTH.FORBIDDEN`。

### 1.3 分页与列表

- 请求：`page`（默认 1，≥1）、`pageSize`（默认 20，1-100）、`keyword`（可选模糊匹配）。
- 各模块过滤参数以 `query` 形式见接口行（IPC 为同名字段）。
- 响应：

```json
{ "records": [], "total": 0, "page": 1, "pageSize": 20 }
```

### 1.4 时间 / ID / 单位

- 时间：ISO 8601 UTC 字符串（毫秒），如 `2026-09-07T09:00:00.000Z`。
- ID：字符串 UUID v4；种子数据为可读固定 ID（`seed-*`）。
- 单位：距离 `distanceM`(米)、时长 `durationS`(秒)、速度 `mps`、载重 `capacityKg/loadKg/cargoKg`(千克)、电量 `battery`(0-100)。
- 坐标：`x`、`y`（平面米制）。全部模块一致，禁止混用经纬度。

### 1.5 通用枚举目录（唯一来源：`shared/enums`）

| 枚举 | 取值 |
| --- | --- |
| role | `admin` / `dispatcher` / `monitor` |
| userStatus | `active` / `disabled` |
| siteType | `depot` / `dock` / `charging` / `gate` / `other` |
| vehicleType | `agv` / `carrier` / `drone` / `other` |
| vehicleStatus | `idle` / `reserved` / `busy` / `charging` / `offline` / `fault` / `disabled` |
| edgeStatus | `enabled` / `disabled` |
| restrictionType | `node` / `edge` |
| taskStatus | `draft` / `pending` / `assigned` / `running` / `paused` / `finished` / `cancelled` / `failed` |
| taskPriority | `low` / `normal` / `high` / `urgent` |
| dispatchStrategy | `greedy` / `hungarian` / `genetic`(预留) |
| planStatus | `applied` / `superseded` / `cancelled` |
| routeAlgorithm | `aStar` / `dijkstra` |
| alertType | `vehicle_offline` / `task_timeout` / `task_failed` / `route_blocked` / `data_error` |
| alertLevel | `info` / `warning` / `critical` |
| alertStatus | `new` / `acknowledged` / `processing` / `resolved` / `archived` |
| objectType | `site` / `vehicle` / `task` / `route` / `node` / `edge` / `user` / `system` / `alert` / `settings` |

### 1.6 审计

以下动作默认写审计，除非接口行注明 `no-audit`：登录/退出、主数据与设置写、任务状态操作、调度预览/应用/重算/手动指派、接管、告警动作、用户管理、审计导出。审计字段见 design §4.9。

## 2. 错误码目录

> **全项目唯一登记处**：`shared/src/errors.ts` 的 `ERROR_CODES`（实现即契约）。
> 本表由该文件与 `shared/src/errors.catalog.test.ts` 的断言共同锁定 —— 文档里出现未登记的 code 会导致 `npm test` 失败。
> 数据文件导入域的 code（`IMPORT.*` / `ORDER.*` / `MAP.*` / `VEHICLE.*` / `ALGO.*` / `SCENARIO.*`）见 §2.2。

### 2.1 运行时业务错误码

`source` 表示错误来源（`auth` 认证 / `validation` 参数 / `business` 业务规则 / `system` 系统）；HTTP 列仅供本地 HTTP 适配器参考，IPC 与 Mock 不产生 HTTP 状态。

**认证与授权**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `AUTH.REQUIRED` | auth | 未登录或会话已失效 | 401 |
| `AUTH.INVALID_TOKEN` | auth | 会话令牌无效 | 401 |
| `AUTH.FORBIDDEN` | auth | 当前账号无此操作权限 | 403 |
| `AUTH.LOGIN_FAILED` | auth | 用户名或密码错误 | 401 |
| `AUTH.USER_DISABLED` | auth | 账号已被禁用 | 401 |
| `AUTH.ACCOUNT_LOCKED` | auth | 密码错误次数过多，账号已临时锁定 | 401 |
| `AUTH.OLD_PASSWORD_WRONG` | auth | 原密码错误 | 400 |

**通用校验**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `VALIDATION.FAILED` | validation | 参数校验失败 | 400 |
| `API.ROUTE_NOT_FOUND` | validation | 接口不存在 | 404 |

**用户与主数据**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `USER.NOT_FOUND` | business | 用户不存在 | 404 |
| `USER.NAME_EXISTS` | business | 用户名已存在 | 409 |
| `SITE.NOT_FOUND` | business | 站点不存在 | 404 |
| `NODE.NOT_FOUND` | business | 路网节点不存在（导入时指引用的节点编码无法解析） | 404 |
| `EDGE.NOT_FOUND` | business | 路网边不存在（导入时指引用的边无法解析） | 404 |
| `TEMPLATE.NOT_FOUND` | business | 任务模板不存在 | 404 |
| `BASE.CODE_EXISTS` | business | 编码已存在 | 409 |
| `BASE.NODE_IN_USE` | business | 节点被边或站点引用，禁止禁用或删除 | 409 |

**任务**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `TASK.NOT_FOUND` | business | 任务不存在 | 404 |
| `TASK.STATE_CONFLICT` | business | 当前状态不允许执行该操作 | 409 |
| `TASK.BATCH_PARTIAL_FAIL` | business | 批量导入存在失败项 | 200 |

**车辆与调度**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `VEHICLE.NOT_FOUND` | business | 车辆不存在 | 404 |
| `VEHICLE.STATE_CONFLICT` | business | 车辆状态不允许该操作 | 409 |
| `DISPATCH.REQUEST_NOT_FOUND` | business | 调度请求不存在或已失效 | 404 |
| `DISPATCH.PLAN_EXPIRED` | business | 调度预览已过期，请重新预览 | 409 |
| `DISPATCH.ALREADY_APPLIED` | business | 该调度请求已应用 | 409 |
| `DISPATCH.NO_CANDIDATE` | business | 没有满足约束的候选车辆 | 409 |

**路径与图**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `ROUTE.NOT_FOUND_PATH` | business | 起点与终点之间不存在可行路径 | 409 |
| `GRAPH.EMPTY` | business | 路网为空 | 409 |
| `GRAPH.DISCONNECTED` | business | 路网不连通 | 409 |
| `GRAPH.BLOCKED` | business | 受禁行规则限制无法通行 | 409 |

**告警与设置**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `ALERT.NOT_FOUND` | business | 告警不存在 | 404 |
| `ALERT.STATE_CONFLICT` | business | 告警当前状态不允许该操作 | 409 |
| `SETTINGS.KEY_NOT_FOUND` | business | 设置项不存在 | 404 |

**系统**

| code | source | 说明 | HTTP(参考) |
| --- | --- | --- | --- |
| `SYS.INTERNAL` | system | 系统内部错误，请查看日志 | 500 |

除 `AUTH.*` 与 `VALIDATION.FAILED` 外，其余错误码的 `message` 为兜底文案；
接口可在 `DomainError(code, message, detail)` 中给更贴切的中文，前端**按 `code` 本地化，不解析 `message`**。

### 2.2 数据文件导入域错误码

四类可导入文件（订单 CSV / 仿真地图 / 车辆参数 / 算法配置）共用一套 `ImportIssue` 模型，
`severity` 决定该条问题是否阻断：`error` 阻断**所在条目**（同批次其它合法条目仍入库）、`warning` 入库但提示、`info` 仅告知。
**`severity` 是单次问题出现的属性，不是 code 的身份** —— 同一个 code 可在不同调用点以不同 severity 出现
（如 `GRAPH.EMPTY`：导入预检报 warning、调度预览报 error）。契约细节见 `docs/data-interfaces.md` §8。

| code | source | 说明 | HTTP(参考) | severity |
| --- | --- | --- | --- | --- |
| `IMPORT.FILE_TOO_LARGE` | validation | 超过体积或行数上限 | 413 | error |
| `IMPORT.ENCODING_INVALID` | validation | 无法解码 | 422 | error |
| `IMPORT.ENCODING_ASSUMED` | validation | 按 GB18030 解码，需用户确认 | 200 | warning |
| `IMPORT.DELIMITER_ASSUMED` | validation | 分隔符为推断值 | 200 | warning |
| `IMPORT.KIND_MISMATCH` | validation | `kind` 与接口不符 | 400 | error |
| `IMPORT.SCHEMA_VERSION_UNSUPPORTED` | validation | 版本不支持 | 400 | error |
| `IMPORT.SCHEMA_VERSION_ASSUMED` | validation | 文件未声明版本，按 v1 解析 | 200 | info |
| `IMPORT.MAPPING_INCOMPLETE` | validation | 标准字段缺少来源列 | 400 | error |
| `IMPORT.MAPPING_CONFLICT` | validation | 多列映射到同一标准字段 | 400 | error |
| `IMPORT.FILE_CHANGED` | business | 确认时校验和与预检不一致 | 409 | error |
| `IMPORT.IN_USE_CONFLICT` | business | 被进行中的任务/规则引用，禁止 replace | 409 | error |
| `IMPORT.CROSS_CHECK_SKIPPED` | validation | 依赖数据缺失，跳过交叉校验 | 200 | warning |
| `IMPORT.BATCH_FAILED` | business | 批次致命错误，已整体回滚 | 409 | error |
| `ORDER.FIELD_REQUIRED` | validation | 必填缺失 | 200 | error |
| `ORDER.FIELD_FORMAT` | validation | 类型或格式非法 | 200 | error |
| `ORDER.NUMBER_NORMALIZED` | validation | 数值被规范化（如千分位） | 200 | warning |
| `ORDER.DUPLICATE_ORDER` | business | 批次内或库中重复 | 200 | error |
| `ORDER.UPDATE_SKIPPED_STATE` | business | 目标订单非 `draft`，跳过更新 | 200 | warning |
| `ORDER.HEADER_INCONSISTENT` | validation | 同批次混入 26 列与 32 列两种骨架 | 200 | error |
| `ORDER.TIMEWINDOW_PAIR_MISSING` | validation | 时间窗未成对出现 | 200 | error |
| `ORDER.TIMEWINDOW_INVALID` | validation | `tw_start_s >= tw_end_s` | 200 | error |
| `ORDER.TIMEWINDOW_CROSS_DAY` | validation | `tw_end_s > 86400`（跨日，首期不支持） | 200 | error |
| `ORDER.TIME_TEXT_MISMATCH` | validation | 文本时间与秒数列对不上（比对按分钟下取整） | 200 | warning |
| `ORDER.ORDER_TIME_AFTER_WINDOW` | validation | `order_time_s > tw_start_s`（下单晚于时间窗开始） | 200 | warning |
| `ORDER.PRIORITY_OUT_OF_RANGE` | validation | `priority` 不在 `{1,2,3}` | 200 | error |
| `ORDER.PRIORITY_FORMAT` | validation | `priority` 用了枚举名而非数字 | 200 | error |
| `ORDER.TYPE_UNKNOWN` | validation | `order_type` 不在已知取值内 | 200 | error |
| `ORDER.TYPE_ENDPOINT_MISMATCH` | validation | `order_type` 与起终点是否为 `DEPOT` 不符（§3.5） | 200 | error |
| `ORDER.SAME_ENDPOINT` | validation | `pickup_id == dropoff_id` | 200 | error |
| `ORDER.DERIVED_DIST_MISMATCH` | validation | 派生距离/时长列与复算不符 | 200 | warning |
| `ORDER.TW_INFEASIBLE_ROW` | validation | `tw_feasible = 0` | 200 | warning |
| `ORDER.PICKUP_COORD_MISMATCH` | validation | 订单坐标与站点表不符（疑似订单与地图版本不一致） | 200 | warning |
| `ORDER.NAME_CODE_MISMATCH` | validation | `pickup_name` 与命中的站点名不一致 | 200 | warning |
| `ORDER.REGION_NOT_FOUND` | business | 起终点无法匹配 | 200 | error |
| `ORDER.REGION_AMBIGUOUS` | business | 匹配到多个候选 | 200 | error |
| `ORDER.SITE_DISABLED` | business | 站点已禁用 | 200 | warning |
| `MAP.CODE_DUPLICATE` | validation | code 重复 | 200 | error |
| `MAP.ROAD_TYPE_NOT_FOUND` | validation | 边引用的 `roadType` 未声明 | 200 | error |
| `MAP.RESTRICTION_TARGET_NOT_FOUND` | validation | 禁行目标不存在 | 200 | error |
| `MAP.REFERENCE_UNRESOLVED_IN_DB` | validation | `merge` 模式下库内也无法解析引用 | 200 | error |
| `MAP.COORDINATE_SYSTEM_UNSUPPORTED` | validation | `meta.coordinateSystem` 非 `planar-meters` | 200 | error |
| `MAP.EDGE_SELF_LOOP` | validation | 自环边 | 200 | error |
| `MAP.EDGE_DUPLICATE` | validation | 重复有向边（含 `bidirectional` 与显式反向边冲突） | 200 | error |
| `MAP.EDGE_INVALID_SPEED` | validation | 限速非正 | 200 | error |
| `MAP.BERTH_OUT_OF_RANGE` | validation | 泊位区间越出边长（`endPosM > lengthM`） | 200 | error |
| `MAP.SITE_WITHOUT_EDGE` | validation | 站点未绑定边 | 200 | warning |
| `MAP.EDGE_LENGTH_MISMATCH` | validation | `lengthM` 与两端坐标距离不符（容差 0.01 m） | 200 | warning |
| `MAP.BERTH_LENGTH_MISMATCH` | validation | `berthLengthM` ≠ `endPosM − startPosM` | 200 | warning |
| `MAP.SPEED_LIMIT_MISMATCH` | validation | 行内 `speed_kmh` 与 `roadType` 声明值不一致 | 200 | warning |
| `MAP.LANE_COUNT_MISMATCH` | validation | 行内 `num_lanes` 与 `roadType` 声明值不一致 | 200 | warning |
| `MAP.GEOJSON_MISMATCH` | validation | GeoJSON 与 CSV 不一致（CSV 为准） | 200 | warning |
| `MAP.OBSTACLE_EDGE_UNLINKED` | validation | `construction` 障碍未关联任何边 | 200 | warning |
| `MAP.ROAD_TYPE_INFERRED` | validation | `roadType` 缺失，按限速推断得到 | 200 | warning |
| `MAP.ONE_WAY_EDGE` | validation | 单向边且无反向边（合法，疑似编辑遗漏） | 200 | info |
| `VEHICLE.RUNTIME_FIELD_REJECTED` | validation | 文件中出现运行态字段（§5.1） | 200 | error |
| `VEHICLE.TYPE_NOT_IN_FLEET` | validation | `vehicles` 的键未在 `fleet` 中声明 | 200 | error |
| `VEHICLE.FLEET_TYPE_MISSING` | validation | `fleet` 声明的车型无参数体（视为预留） | 200 | warning |
| `VEHICLE.ROAD_TYPE_UNKNOWN` | validation | `speedLimitsKmh` 的键不是已知道路类型 | 200 | warning |
| `VEHICLE.ROAD_SPEED_EXCEEDS_MAX` | validation | 某道路限速超过设计最高车速（规则 4） | 200 | error |
| `VEHICLE.SPEED_ORDER_INVALID` | validation | `operatingSpeedKmh > maxSpeedKmh`（规则 3） | 200 | error |
| `VEHICLE.SOC_RANGE_INVALID` | validation | `socMinPct >= socTargetPct`（规则 1） | 200 | error |
| `VEHICLE.EFFECTIVE_RANGE_MISMATCH` | validation | 有效续航与公式不符（规则 2） | 200 | error |
| `VEHICLE.EMERGENCY_DECEL_INVALID` | validation | 应急减速度未大于常规减速度（规则 9） | 200 | error |
| `VEHICLE.PAYLOAD_EXCEEDED_BY_ORDER` | business | 存在订单货重超过最大载重（规则 7） | 200 | error |
| `VEHICLE.PAYLOAD_ALL_INSUFFICIENT` | business | 全车队载重均不足以承接任何订单 | 200 | error |
| `VEHICLE.ENERGY_CAPACITY_MISMATCH` | validation | 能耗 × 续航与容量偏差超 5%（规则 5） | 200 | warning |
| `VEHICLE.CHARGE_RATE_MISMATCH` | validation | 充电速率与功率/容量偏差超 10%（规则 6） | 200 | warning |
| `VEHICLE.CARGO_BOX_UNDERSIZED` | validation | `cells × cellMaxLoadKg < maxPayloadKg`（规则 8） | 200 | warning |
| `VEHICLE.ENERGY_MODEL_APPROXIMATE` | validation | 缺 `batteryCapacityKwh`，退化为百分比近似 | 200 | warning |
| `VEHICLE.ENERGY_NO_LOAD_FACTOR` | validation | 未做载重修正，重载实际续航会低于估算 | 200 | info |
| `VEHICLE.CONCURRENCY_UNSUPPORTED` | validation | `maxConcurrentStops>1` 首期不生效 | 200 | warning |
| `VEHICLE.SITE_TYPE_UNCOVERED` | validation | 声明可服务的站点类别无对应站点 | 200 | warning |
| `VEHICLE.PASSAGE_WIDTH_CONFLICT` | validation | `minPassageWidthM` 大于所有道路可通行宽度 | 200 | warning |
| `VEHICLE.SPEED_LIMIT_CONFLICT` | validation | 车型限速高于地图同类型道路限速（实际取更严一侧） | 200 | info |
| `VEHICLE.WEATHER_UNKNOWN` | validation | `weather` 含未知取值 | 200 | warning |
| `VEHICLE.CUSTOM_RULE_FAILED` | validation | 文件自定义一致性规则未通过（不阻断） | 200 | info |
| `VEHICLE.SPEED_OUTLIER` | validation | 同类型车辆速度离散度过大 | 200 | info |
| `ALGO.WEIGHT_NEGATIVE` | validation | 权重为负 | 200 | error |
| `ALGO.WEIGHTS_ALL_ZERO` | validation | 权重全为 0 | 200 | error |
| `ALGO.WEIGHT_IMBALANCE` | validation | 权重差异过大 | 200 | warning |
| `ALGO.HEURISTIC_NOT_ADMISSIBLE` | validation | 参考速度可能导致 A* 非最优 | 200 | warning |
| `ALGO.LIMIT_RAISED` | validation | 规模上限被调高 | 200 | warning |
| `ALGO.SETTINGS_CONFLICT` | business | 与 `settings` 表既有值冲突 | 200 | info |
| `ALGO.STRATEGY_NOT_ENABLED` | validation | `defaultStrategy` 不在 `enabledStrategies` 中 | 200 | error |
| `SCENARIO.VEHICLE_TYPE_UNCOVERED` | validation | 车队车型在算法配置中无参数 | 200 | warning |
| `SCENARIO.PARAM_MISSING` | validation | 必需参数缺失 | 200 | warning |
| `ROUTE.VIA_NOT_ALLOWED` | business | 配置关闭 `allowViaNodes` 后仍传了 `viaNodeIds` | 200 | error |
| `ROUTE.DETOUR_EXCEEDED` | business | 实际里程超出 `maxDetourRatio` 上限 | 200 | warning |
| `GRAPH.ISOLATED_NODE` | validation | 存在没有任何邻边的孤立节点 | 200 | warning |

### 2.3 调度拒绝原因（`rejected[].reason`）

调度预览的「拒绝」**不是**错误码，而是逐条约束评估的结果，用独立枚举表达（`shared/src/enums.ts` 的 `REJECT_REASONS`），
随 `data.rejected[]` 一并返回：`VEHICLE_NOT_AVAILABLE` / `LOAD_EXCEEDED` / `TIMEWINDOW_CONFLICT` / `BATTERY_INSUFFICIENT` / `UNREACHABLE` / `RESTRICTION_VIOLATED` / `NO_AVAILABLE_VEHICLE`。
每条拒绝 = `{ taskId, reason, message, detail }`。

---

## 3. 接口明细

### 3.1 登录与权限（M1）

#### 3.1.1 登录

`POST /api/auth/login` · 公开（no-audit 仅在失败时不写，成功写审计）

请求：

```json
{ "username": "admin", "password": "admin123" }
```

响应：

```json
{
  "token": "sess_xxxx",
  "user": {
    "id": "seed-admin", "username": "admin", "role": "admin",
    "displayName": "管理员",
    "permissions": ["base:write", "task:write", "dispatch:read", "dispatch:preview", "dispatch:apply", "audit:read", "settings:write", "user:manage"]
  }
}
```

错误：`AUTH.LOGIN_FAILED` / `AUTH.USER_DISABLED` / `AUTH.ACCOUNT_LOCKED`。

#### 3.1.2 当前会话

`GET /api/auth/session` · 已登录

返回同上 `user`（不含 token 更新）；会话失效返回 `AUTH.REQUIRED`。渲染层启动/刷新后调用以恢复权限。

#### 3.1.3 退出

`POST /api/auth/logout` · 已登录 · 写审计

清空会话，返回 `{ ok: true }`。

#### 3.1.4 修改本人密码

`PUT /api/users/me/password` · 已登录 · 写审计

```json
{ "oldPassword": "…", "newPassword": "…" }
```

校验：新旧不同、长度 6-32。错误：`AUTH.OLD_PASSWORD_WRONG` / `VALIDATION.FAILED`。

#### 3.1.5 用户列表

`GET /api/users` · `user:manage`

query：`page/pageSize/keyword/role/status`。记录字段：`id/username/displayName/role/status/lastLoginAt/createdAt`。

#### 3.1.6 创建用户

`POST /api/users` · `user:manage`

```json
{ "username": "operator01", "password": "…", "displayName": "操作员一", "role": "dispatcher" }
```

错误：`USER.NAME_EXISTS`、`VALIDATION.FAILED`。

#### 3.1.7 更新用户 / 状态 / 重置密码

- `PUT /api/users/{id}` · `user:manage`：更新 `displayName/role/status`。
- `PATCH /api/users/{id}/status` · `user:manage`：`{ "status": "disabled" }`（禁止禁用自己）。
- `POST /api/users/{id}/reset-password` · `user:manage`：重置为管理员指定值。

错误：`USER.NOT_FOUND`、`VALIDATION.FAILED`。

### 3.2 基础数据（M2）

通用说明：写操作权限 `base:write`，读权限 `base:read`；实体字段以 design §6.2 为准。所有写操作写审计并做编码唯一校验（`BASE.CODE_EXISTS`）。

#### 3.2.1 站点 sites

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/sites` | query：`keyword/type/status/page/pageSize`；记录含 `nodeId/x/y` |
| `GET /api/sites/{id}` | 详情（含绑定节点坐标） |
| `POST /api/sites` | 创建：`code/name/type/nodeId?/x?/y?/remark?` |
| `PUT /api/sites/{id}` | 更新（`code` 不可改） |
| `PATCH /api/sites/{id}/status` | `{ "status": "disabled" | "enabled" }` |

#### 3.2.2 车辆 vehicles

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/vehicles` | query：`keyword/status/type/page/pageSize` |
| `GET /api/vehicles/{id}` | 详情 |
| `POST /api/vehicles` | 创建：`code/name/type/capacityKg/maxSpeedMps/x/y/battery` |
| `PUT /api/vehicles/{id}` | 更新基础属性 |
| `PATCH /api/vehicles/{id}/status` | `{ "status": "disabled" | "enabled" }`；调度占用中禁止置 disabled → `VEHICLE.STATE_CONFLICT` |

说明：`offline/fault/charging` 等运行态状态由执行器/心跳更新，管理接口不直接改。

#### 3.2.3 路网节点 nodes

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/nodes` | query：`keyword/status/page/pageSize` |
| `GET /api/nodes/{id}` | 详情（含邻接边） |
| `POST /api/nodes` | `code/name/x/y/remark?`；节点编码唯一 |
| `PUT /api/nodes/{id}` | 更新 |
| `PATCH /api/nodes/{id}/status` | 禁用时若被边或站点引用 → `BASE.NODE_IN_USE` |

#### 3.2.4 有向边 edges

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/edges` | query：`fromNodeId/toNodeId/status/page/pageSize` |
| `GET /api/edges/{id}` | 详情 |
| `POST /api/edges` | `fromNodeId/toNodeId/lengthM?/speedLimitMps?/remark?`；`lengthM` 缺省按坐标欧氏距离自动计算；重复方向对拒绝 |
| `PUT /api/edges/{id}` | 更新 |
| `PATCH /api/edges/{id}/status` | 封路（`disabled`）会触发相关任务告警评估 |

#### 3.2.5 禁行规则 restrictions

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/restrictions` | query：`type/status/page/pageSize`；响应含对象编码便于展示 |
| `POST /api/restrictions` | `type/targetId/startAt?/endAt?/vehicleType?/reason`；写入时自动校验 targetId 存在 |
| `PUT /api/restrictions/{id}` | 更新 |
| `DELETE /api/restrictions/{id}` | 物理删除（规则无历史依赖） |

#### 3.2.6 任务模板 task-templates

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/task-templates` | query：`keyword/page/pageSize` |
| `GET /api/task-templates/{id}` | 详情 |
| `POST /api/task-templates` | `code/name/priority/defaultCargoKg/timeWindowMinutes/fromSiteType/toSiteType/remark?` |
| `PUT /api/task-templates/{id}` | 更新 |

### 3.3 任务管理（M3）

字段与状态机见 design §4.3、§6.2。任务编码 `code` 创建后不可变；`fromSiteId/toSiteId` 必须是 `enabled` 站点。

#### 3.3.1 任务列表

`GET /api/tasks` · `task:read`

query：`status`(可逗号多值)/`priority`/`vehicleId`/`from`(timeWindowStart≥)/`to`/`keyword`/`page/pageSize`。

记录：`id/code/title/status/priority/cargoKg/fromSiteId/toSiteId/fromSiteName/toSiteName/timeWindowStart/timeWindowEnd/assignedVehicleId/vehicleCode/progress/createdAt/createdBy`。

#### 3.3.2 任务详情

`GET /api/tasks/{id}` · `task:read`

返回任务全字段 + `currentPlan`（若 applied）+ `route`（当前路线摘要）+ `alerts`（关联未归档告警）+ `auditSummaries`（最近 5 条操作）。

#### 3.3.3 创建任务

`POST /api/tasks` · `task:write`

```json
{
  "title": "配送A仓到B仓",
  "templateId": "…（可选，套用默认）",
  "priority": "normal",
  "cargoKg": 100,
  "cargoDesc": "电子料件",
  "fromSiteId": "…",
  "toSiteId": "…",
  "timeWindowStart": "2026-09-07T10:00:00.000Z",
  "timeWindowEnd": "2026-09-07T11:00:00.000Z",
  "submit": true
}
```

- `submit=false`（默认）→ 创建为 `draft`；`submit=true` → 直接 `draft→pending`（校验通过才可）。
- 错误：`VALIDATION.FAILED`、`SITE.NOT_FOUND`（起终点）。

#### 3.3.4 批量导入

`POST /api/tasks/batch-import` · `task:write`

```json
{
  "items": [ { "title": "…", "cargoKg": 50, "fromSiteCode": "A-01", "toSiteCode": "B-01", "priority": "normal", "timeWindowStart": "…", "timeWindowEnd": "…" } ]
}
```

按 `code` 映射站点；未填时间窗的任务不自动 submit。返回：

```json
{
  "total": 3, "succeeded": 2, "failed": 1,
  "createdTaskIds": ["…", "…"],
  "failedItems": [ { "index": 2, "reason": "站点编码不存在", "detail": { "fromSiteCode": "X-99" } } ]
}
```

部分失败返回 `code=0`（视为业务结果），明细在 `data.failedItems`。

#### 3.3.5 编辑任务

`PUT /api/tasks/{id}` · `task:write`

仅 `draft / pending / failed` 可编辑；`code/assignedVehicleId/status` 不可直接改。返回更新后详情。

#### 3.3.6 状态操作

| 方法/路径 | 权限 | 请求 | 迁移 | 说明 |
| --- | --- | --- | --- | --- |
| `POST /api/tasks/{id}/submit` | task:write | `{}` | draft→pending | 必填校验 |
| `POST /api/tasks/{id}/pause` | task:write | `{ "reason": "…" }` | running→paused | |
| `POST /api/tasks/{id}/resume` | task:write | `{}` | paused→running | 恢复执行器 |
| `POST /api/tasks/{id}/cancel` | task:write | `{ "reason": "…" }` | pending/assigned/running/paused→cancelled | 已派发先回收车辆 |
| `POST /api/tasks/{id}/requeue` | task:write | `{ "reason": "…" }` | failed→pending | 重新进入候选池 |
| `POST /api/tasks/{id}/reassign` | task:write | `{ "reason": "…" }` | assigned/running/paused | 原计划 superseded、回收车辆、置 pending 并提示去调度 |
| `DELETE /api/tasks/{id}` | task:write | – | draft | 物理删除；其余状态拒绝 |

统一错误：`TASK.NOT_FOUND`、`TASK.STATE_CONFLICT`、`VALIDATION.FAILED`（缺 reason）。

#### 3.3.7 任务操作响应

成功返回更新后详情 + `transition: { from, to }`：

```json
{ "id": "…", "code": "T20260907-0001", "status": "paused", "transition": { "from": "running", "to": "paused" } }
```

### 3.4 调度引擎（M4）

约束与策略定义见 design §4.4、§5。**预览不落业务库**，仅写调度日志；apply 才创建 `dispatch_plans` 与 `routes` 并变更任务/车辆。

#### 3.4.1 策略列表

`GET /api/dispatch/strategies` · `dispatch:read`

```json
{ "strategies": [ { "key": "greedy", "label": "贪心", "description": "按优先级/时间窗逐个最优分配", "enabled": true }, { "key": "hungarian", "label": "匈牙利", "description": "整体最小代价指派", "enabled": true }, { "key": "genetic", "label": "遗传", "description": "预留，二期", "enabled": false } ] }
```

#### 3.4.2 调度预览（可多策略对比）

`POST /api/dispatch/preview` · `dispatch:preview`

```json
{ "taskIds": ["…", "…"], "strategy": "all" }
```

- `strategy`：`greedy` / `hungarian` / `all`（并行输出多策略对比）。
- 输入任务必须为 `pending`；其它状态返回 `TASK.STATE_CONFLICT`。

响应（`strategy=all` 时 `strategies[]` 聚合，`single` 时平铺 `plan/rejected/summary`）：

```json
{
  "requestId": "req_…",
  "strategies": [
    {
      "strategy": "greedy",
      "plans": [ { "taskId": "…", "vehicleId": "…", "vehicleCode": "AGV-01", "route": { "fromNodeId": "…", "toNodeId": "…", "nodeIds": [], "distanceM": 120, "durationS": 60 }, "cost": 132.5, "costDetail": { "deadheadTime": 12, "executeTime": 60, "waitTime": 0, "penaltyLate": 0, "chargeRisk": 0 }, "occupiedFrom": "…", "occupiedTo": "…" } ],
      "rejected": [ { "taskId": "…", "reason": "LOAD_EXCEEDED", "message": "超过所有候选车辆载重", "detail": { "cargoKg": 2000, "maxCapacityKg": 1000 } } ],
      "summary": { "totalTasks": 3, "assigned": 2, "rejectedCount": 1, "totalCost": 265, "elapsedMs": 42 },
      "explain": ["任务 T2 优先派给 AGV-01（空驶 12s 最短）", "任务 T1 载重 2000kg 超所有候选上限，拒绝"]
    }
  ]
}
```

#### 3.4.3 应用派发

`POST /api/dispatch/apply` · `dispatch:apply`

```json
{ "requestId": "req_…", "strategy": "greedy" }
```

校验：requestId 存在且未应用（`DISPATCH.REQUEST_NOT_FOUND` / `DISPATCH.ALREADY_APPLIED`）；快照变化导致不可行时返回 `DISPATCH.PLAN_EXPIRED` 并提示重新预览。

成功副作用（单事务）：任务 `pending→assigned`；车辆 `idle→reserved→busy`（进入占用区间）；写入 `routes`、`dispatch_plans(applied)`、`dispatch_logs(action=apply)`。返回各任务详情。

#### 3.4.4 手动指派

`POST /api/dispatch/manual-assign` · `dispatch:apply`

```json
{ "taskId": "…", "vehicleId": "…", "reason": "指定距离最近的车辆" }
```

约束校验同自动流程（车辆状态/载重/时间窗/可达），通过后直接生效（前端需二次确认）；写 `dispatch_logs(action=manual_assign)`。错误：`VEHICLE.STATE_CONFLICT`、`TASK.STATE_CONFLICT`、`DISPATCH.NO_CANDIDATE`。

#### 3.4.5 重算（recompute）

`POST /api/dispatch/recompute` · `dispatch:apply`

```json
{ "taskId": "…", "reason": "路段临时封闭", "strategy": "all" }
```

仅 `assigned/running/paused` 任务可触发。副作用：原计划 `superseded`、车辆回收、任务置 `pending`，然后立即产出一份新预览返回（不自动应用）。动作成对写 `dispatch_logs`。

#### 3.4.6 调度日志

`GET /api/dispatch/logs` · `dispatch:read`

query：`requestId/action/strategy/taskId/from/to/page/pageSize`。记录：`requestId/action/strategy/taskIds/summary/rejected/elapsedMs/operatorName/createdAt`；`inputSnapshot/outputSnapshot` 仅详情接口可见。

### 3.5 路径规划（M5）

#### 3.5.1 路线规划（预览，不落库）

`POST /api/routes/plan` · `route:plan`

```json
{ "fromNodeId": "n-01", "toNodeId": "n-08", "viaNodeIds": ["n-03"], "vehicleType": "agv", "algorithm": "aStar" }
```

响应：

```json
{
  "route": {
    "fromNodeId": "n-01", "toNodeId": "n-08",
    "viaNodeIds": ["n-03"], "nodeIds": ["n-01", "n-02", "n-03", "n-08"],
    "edgeIds": ["e-1", "e-2", "e-5"],
    "distanceM": 260, "durationS": 130,
    "algorithm": "aStar",
    "costDetail": { "travelS": 130 },
    "warnings": ["途经边 e-2 限速 1.0m/s，为全网最低速段"]
  }
}
```

错误：`GRAPH.EMPTY` / `GRAPH.DISCONNECTED` / `GRAPH.BLOCKED` / `ROUTE.NOT_FOUND_PATH`；`viaNodeIds` 不可达并入 `detail.unreachableVia`。

#### 3.5.2 算法对比

`POST /api/routes/compare` · `route:plan`

请求同 plan，`algorithm` 忽略。响应：

```json
{
  "results": [ { "algorithm": "aStar", "route": { "…": "…" }, "elapsedMs": 3 }, { "algorithm": "dijkstra", "route": { "…": "…" }, "elapsedMs": 12 } ],
  "consistent": true,
  "difference": { "distanceM": 0, "durationS": 0 }
}
```

`consistent=false` 时实现方需记系统日志排查。

#### 3.5.3 已存路线查询

`GET /api/routes/{id}` · `route:plan`（任务关联路线也可由任务详情读取）。仅 apply/调度过程产生的路线会落库，可查 `nodeIds/distanceM/durationS/warnings` 全字段。

### 3.6 地图可视化（M6）

#### 3.6.1 地图概览快照

`GET /api/map/overview` · `map:read` · **【已实现】**

query：`include=`(逗号可选图层，默认全量；**该参数尚未实现**，订单摄入落地后再接入，
当前恒返回全量图层，`orderEndpoints` 字段不出现)。

实现要点（实测口径，详见 `module-M6-map.md` §11.5）：

- 本接口是地图画布的**唯一数据入口**；渲染层不得自行拼接多次请求或读取文件。
- `eventSeq` 取 `event_log` 的 `sqlite_sequence` 值（**单调水位线**），
  不是 `MAX(seq)` —— 后者在最高位事件被删除后会回退，导致渲染层重放旧事件。
- 车辆的 `taskId` 由 `tasks.assigned_vehicle_id` 反查、路线 `status` 由 `dispatch_plans.status`
  派生（`routes` 表没有 `status` 列），均为**读取时计算**，不冗余落库。

```json
{
  "nodes": [ { "id": "n-01", "code": "N1", "x": 0, "y": 0, "status": "enabled" } ],
  "edges": [ { "id": "e-1", "fromNodeId": "n-01", "toNodeId": "n-02" } ],
  "sites": [ { "id": "…", "code": "A-01", "type": "depot", "nodeId": "n-01", "x": 0, "y": 0, "status": "enabled" } ],
  "vehicles": [ { "id": "…", "code": "AGV-01", "status": "idle", "x": 10, "y": 20, "battery": 90, "taskId": null } ],
  "tasks": [ { "id": "…", "code": "T…", "status": "running", "fromSiteId": "…", "toSiteId": "…", "vehicleId": "…", "progress": 0.42 } ],
  "routes": [ { "id": "…", "taskId": "…", "vehicleId": "…", "nodeIds": [], "status": "active" } ],
  "alerts": [ { "id": "…", "type": "vehicle_offline", "level": "critical", "objectType": "vehicle", "objectId": "…" } ],
  "eventSeq": 128
}
```

#### 3.6.2 车辆轨迹

`GET /api/map/tracks/{vehicleId}` · `map:read` · 【设计中，未实现】

query：`taskId?/from?/to?`。响应：

```json
{ "vehicleId": "…", "points": [ { "ts": "…", "x": 0, "y": 0, "speedMps": 1.5, "status": "running" } ], "total": 42 }
```

### 3.7 运行监控与执行（M7）

#### 3.7.1 监控概览

`GET /api/monitor/overview` · `monitor:read`

```json
{
  "taskCounts": { "running": 2, "paused": 1, "pending": 5, "assigned": 1, "failed": 1, "finishedToday": 12 },
  "vehicleCounts": { "idle": 3, "busy": 2, "charging": 1, "offline": 1, "fault": 0 },
  "alertCounts": { "new": 2, "acknowledged": 1, "processing": 0, "unresolved": 3 },
  "eventSeq": 128,
  "updatedAt": "…"
}
```

#### 3.7.2 监控任务 / 车辆

- `GET /api/monitor/tasks` · `monitor:read`：等价 `GET /api/tasks`，默认只看 `running,paused,failed`，记录额外含 `progress`。
- `GET /api/monitor/vehicles` · `monitor:read`：等价 `GET /api/vehicles`，记录额外含 `currentTaskId`。

#### 3.7.3 开始执行

`POST /api/execution/tasks/{id}/start` · `execution:start`

请求 `{ "note": "车辆已到达起点" }`。迁移 `assigned→running`，启动模拟执行器，写轨迹采样开始。错误：`TASK.STATE_CONFLICT`。

#### 3.7.4 手动接管

`POST /api/execution/tasks/{id}/takeover` · `execution:takeover`

请求 `{ "note": "现场检查，暂停执行", "alertType": "task_timeout" }`；`alertType` 取值范围 `task_timeout` / `route_blocked` / `task_failed`，缺省 `task_timeout`。

副作用：任务 `running→paused`（或 `assigned` 时置回）；生成 `warning` 级 `alertType` 告警，`detail.nextSteps` 给出建议。返回 `{ taskId, alertId, nextSteps: [...] }`。错误：`TASK.STATE_CONFLICT`。

### 3.8 告警（M8）

#### 3.8.1 告警列表

`GET /api/alerts` · `alert:read`

query：`type/level/status/objectType/objectId/from/to/page/pageSize`。记录：`id/type/level/message/objectType/objectId/status/createdAt/ackBy/ackAt/resolveBy/resolveAt`。

#### 3.8.2 告警详情

`GET /api/alerts/{id}` · `alert:read`：全字段 + `detail` + 关联任务/车辆摘要 + `suggestedNextSteps`。

#### 3.8.3 状态操作

| 方法/路径 | 权限 | 请求 | 迁移 |
| --- | --- | --- | --- |
| `POST /api/alerts/{id}/acknowledge` | alert:ack | `{ "note": "…" }` | new→acknowledged |
| `POST /api/alerts/{id}/resolve` | alert:resolve | `{ "resolution": "已重启车辆" }` | acknowledged/processing→resolved |
| `POST /api/alerts/{id}/archive` | alert:archive | `{ "note": "…" }` | resolved（或任意态）→archived |

错误：`ALERT.NOT_FOUND` / `ALERT.STATE_CONFLICT`。

### 3.9 审计与日志（M9）

- `GET /api/audit/logs` · `audit:read`：query `module/action/actorId/objectType/objectId/from/to/page/pageSize`；记录：`ts/actorName/role/module/action/objectType/objectId/result/message/costMs/traceId`（before/after 仅详情）。
- `GET /api/audit/logs/export` · `audit:read`：导出 CSV（`Content-Disposition` attachment）。
- 调度日志查询见 `GET /api/dispatch/logs`（§3.4.6）。

### 3.10 系统设置（M10）

- `GET /api/settings` · `settings:read`：返回全部生效值 `{ "dispatch.defaultStrategy": "greedy", … }`。
- `GET /api/settings/schema` · `settings:read`：返回键目录（`key/type/label/default/min/max/options/unit/remark`），前端据此渲染表单。
- `PATCH /api/settings` · `settings:write`：`{ "updates": { "monitor.refreshIntervalMs": 500 } }`；按 schema 校验，非法返回 `VALIDATION.FAILED`。写审计。
- 启动加载：主进程读取设置表，缺失键回退默认值（见 design §4.10）。

### 3.11 健康检查

`GET /api/health` · 公开

```json
{ "status": "ok", "db": true, "version": "0.1.0", "now": "…" }
```

---

## 4. 事件订阅

渲染层通过 `dispatchApi.on(event, handler)` 订阅；IPC 实现由主进程按会话权限过滤后推送。事件名常量在 `shared/enums`。

| 事件 | 载荷要点 | 说明 |
| --- | --- | --- |
| `task.changed` | `{ taskId, code, status, transition: {from,to}, vehicleId?, updatedAt }` | 任务任何状态变化 |
| `vehicle.changed` | `{ vehicleId, code, status, x, y, battery, taskId? }` | 位置/状态/电量变化 |
| `alert.created` | `{ alertId, type, level, objectType, objectId, message }` | 新告警（角标+toast） |
| `alert.updated` | `{ alertId, status }` | 告警状态变化 |
| `map.updated` | `{ eventSeq }` | 通用刷新信号（可触发 overview 拉取） |
| `execution.progress` | `{ taskId, vehicleId, progress, x, y }` | 高频进度事件（节流 ≥ 250ms） |
| `settings.changed` | `{ key, value }` | 设置变更广播 |

监听须知：渲染层应缓存事件号去重；高频事件（execution.progress / vehicle.changed）节流合并；离线/断连时以 `monitor.refreshIntervalMs` 定时兜底。

---

## 5. 种子数据（演示）

首次启动 seed（幂等）：3 个账号（admin/dispatcher/monitor，默认密码见 design §3.7）；一张园区路网（10-16 节点、双向边、2 站点 + 1 充电桩）；3 辆车（agv/carrier/drone 各一）；若干任务模板。另提供演示动作「一键推进/一键重置演示数据」（写入日志与审计，仅开发与演示用途）。
