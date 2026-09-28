# API 接口文档

> 项目：无人物流调度管理软件 · 状态：**契约文档（已实现部分标【已实现】）**
> 配套：[`design.md`](../design.md)（设计文档，字段/表结构以此为准）
> 说明：接口以服务路径 `/api/{module}/{action}` 表达。实现层映射三种适配器（IPC / 本地 HTTP / Mock），契约完全一致；调用方只依赖 `renderer/src/api/index.ts` 导出的 `apiClient`（**适配器在 renderer 侧，不在 `shared/`**），不感知传输细节。

> **文档边界**：本文件只负责「接口契约（路径 / 参数 / 响应 / 错误码 / 事件订阅）」，并且**是「文档事实单一来源」的指派总表** ——
> §0 规定每个易漂移事实由哪份文档负责，其余文档只引用、不复述数值。本文件不复述 DDL、`Req-*` 条目与导入字段定义。

## 0. 文档事实单一来源（Single Source of Truth）

> 本表规定**每个事实由哪份文档负责**。其余文档**只能引用、不得复述具体数值** ——
> 复述就会漂移（见 `docs/issues.md` ISS-032：同一事实曾最多出现三种写法）。

| 事实 | 唯一负责文档 | 其它文档应当 |
| --- | --- | --- |
| 错误码目录 | `shared/src/errors.ts` → 本文 §2（**条数以 §2 为准**） | 引用 code，不复述条数 |
| 接口路径、请求/响应字段、权限点 | 本文（`docs/api.md`） | 引用 §号 |
| 事件名与载荷 | 本文 §4 | 引用 §4 |
| 数据表 DDL、索引、字段约束 | `docs/database.md` | 引用表名 |
| 模块需求条目与状态机 | `design.md` | 引用 `Req-*` / §号 |
| 四类导入数据文件的字段契约 | `docs/data-interfaces.md` | 引用 §号 |
| 工程脚本、仓库形态、阶段验收 | `docs/build-plan.md` | 引用脚本名 |
| 问题 / 风险 / 待决 | `docs/issues.md` | 引用 `ISS-xxx` |
| 设计决策编号（D-xx） | `AGENTS.md` | 引用编号 |
| 适配器默认行为 / 环境开关 | `renderer/src/api/index.ts`（代码即事实） | 引用 D-22，不复述默认值 |
| 演示数据规模（seed） | `desktop/src/db/seed.ts` → `docs/database.md` §4 | 引用表名与「见 §4」 |
| **源码文件与目录路径** | **仓库文件系统本身**（目录树速览见 `README.md`「目录结构」） | 引用真实路径；写路径前先确认它存在 |
| npm 脚本清单 | `package.json` → `docs/build-plan.md` §3 | 引用脚本名 |
| 文档索引 | `README.md`「文档入口」 | 不再各自维护副本 |
| 页面路由 / 导航分组 / 模块元数据 | `renderer/src/app/modules.ts` | 引用模块键或路由，不复述标题与权限清单 |
| 设计令牌（颜色 / 字号 / 间距）与共用 UI 基元的归属 | `renderer/src/styles/theme.css` · `styles/ui.css`（代码即事实，见 D-36） | 引用类名与变量名，不复述色值 |
| 首屏声明（图标 / `color-scheme` / `theme-color`） | `renderer/index.html`（代码即事实，见 D-37；色值已登记性由 `renderer/src/app/index-html.test.ts` 断言） | 引用 D-37，不复述色值 |
| 弹层键盘语义（焦点管理 / 可读名称 / 焦点环） | 组件代码即事实（首个实现见 `renderer/src/components/UserMenu.tsx`）与它同目录的 `.test.tsx`（见 D-38） | 引用 D-38，不必逐条复述 |
| 传输层参数校验与分页的归属、以及「非法分页值怎么处理」 | `desktop/src/ipc/paging.ts` · `desktop/src/ipc/validators.ts`（代码即事实，见 D-40） | 引用 D-40；具体容错口径不复述 |
| 边的**业务编码**命名约定（`E_<小>_<大>` / 反向后缀 `_R`）、以及「`edges.code` 列还没落地时由谁推导」 | `shared/src/edge-code.ts`（代码即事实，见 D-35；条数/取值不复述） | 引用该文件与 D-35 |
| 枚举值 → 中文展示文案 | `renderer/src/domain/labels.ts` | 引用文案表，不另写一份映射 |
| 各模块的**模块内实现口径**（文件划分、校验顺序、事务与副作用边界、审计动作命名、测试清单） | `docs/module-M2-base-data.md` · `docs/module-M3-task.md` · `docs/module-M4-dispatch.md` · **`docs/module-M5-route.md`** · `docs/module-M6-map.md` | 引用模块文档的 §号；**不复述**其文件清单与步骤 |
| 路径规划的车种默认速度、通行速度取小规则、绕行阈值与警告产生条件 | `shared/src/route-graph.ts` · `shared/src/route-search.ts`（代码即事实，见 D-49 / D-50） | 引用文件与常量名，**不复述**数值 |
| 表与列 DDL | `desktop/migrations/*.sql` → `docs/database.md` | 引用表名与列名 |

> **禁止**：在非负责文档的**正文叙述**里复述可漂移的数值（条数、节点数、用例数、路径、默认值）。
> 需要时写「见 §X」。只有两类例外，且都必须**自带出处与日期**：
>
> 1. **带日期的实测快照** —— `AGENTS.md` 的「项目快照 / 验证基线」、各文档的「实测结论」小节。
>    它们记录的是**某一次运行**的结果，因此必须写明实测日期；下一次复测时**整段更新**，不做增量引用。
> 2. **图表视图** —— `docs/architecture.md` 等图集为汇报需要可在图内嵌数字，
>    但文件头必须声明「**与来源冲突时以来源为准**」并标注生成日期。
>
> 判定要点：**不是在问「这个数字对不对」，而是在问「它是否有唯一作者」。**
>
> **注意**：受管事实的**载体不限于 Markdown** —— `.env.example` 的注释、脚本与测试里的注释同样可能在复述事实，
> 按本表指派时应按「事实」而非「文件类型」判断（`.env.example` 曾写「默认 mock」而代码实际按 preload 桥判定）。

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

### 1.5 通用枚举目录（唯一来源：`shared/src/enums.ts`）

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
> **条数不在此处固化**（易漂移）：实时值 = `Object.keys(ERROR_CODES).length`，当前为 **126 条
> （36 运行时 + 90 导入域）**；其它文档引用条数时请改引「本文 §2」，不要各自复述（D-34）。
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
| `RESTRICTION.NOT_FOUND` | business | 禁行规则不存在 | 404 |

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
| `ROUTE.NOT_FOUND` | business | 路线不存在（按 id 查不到已落库的路线） | 404 |
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
| `MAP.OBSTACLES_UNAVAILABLE` | validation | 障碍物来源 `campus.add.xml` 缺失，`obstacles[]` 只能为空 | 200 | warning |
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

> **方法不是可选项**（2026-09-26 实测，`ISS-066`）：`Route.method` 省略时路由按 `GET` 注册，
> 而本契约写的是 `POST`。曾因此出现「渲染层不传方法 → 整条链路都是 GET → 界面一切正常」，
> 只有**照着本文档调用的第三方**（HTTP 客户端 / E2E 脚本）拿到 `API.ROUTE_NOT_FOUND`。
> 同 §3.1.3 的 `POST /api/auth/logout`。两者现有断言：`desktop/src/ipc/api.auth.test.ts`。

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
    "displayName": "系统管理员",
    "permissions": ["user:manage", "base:read", "base:write", "task:read", "task:write", "dispatch:read", "dispatch:preview", "dispatch:apply", "route:plan", "map:read", "monitor:read", "execution:start", "execution:takeover", "alert:read", "alert:ack", "alert:resolve", "alert:archive", "audit:read", "settings:read", "settings:write"]
  }
}
```

`permissions` 由 `permissionsOf(role)` 计算（`shared/src/enums.ts` 的 `ROLE_PERMISSIONS`），
按角色返回**完整**权限点列表：admin 20 项（全部）、dispatcher 16 项、monitor 6 项。
上例为 admin，**不要把它当作固定清单照抄** —— 权限点增删只需改 `enums.ts`。

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

> **已实现范围（2026-09-26）**：本节的**读接口**（`GET /api/sites` · `GET /api/vehicles` · `GET /api/nodes` · `GET /api/edges` ·
> `GET /api/restrictions` · `GET /api/task-templates`，含各自的分页、`keyword` 搜索与 `status`/`type` 筛选）与
> **写接口**（POST 创建 / PUT 更新 / PATCH 启停 / DELETE 删除，六类资源共 19 条）
> 均已落地并有测试。本节表格里的 `GET /api/{资源}/{id}`（详情）**未实现**，界面不用它：
> 列表行已带齐字段，而详情会引入第二套「一条记录长什么样」的形状。
> 四个列表接口共用同一套分页口径（**宽进**）与筛选项口径（**严出**），取舍见 `AGENTS.md` D-40；
> 写接口的字段规则**唯一作者**是 `shared/src/base-rules.ts`（主进程与浏览器 Mock 共用，见 D-44）。
>
> 写接口的三条落地口径（实现处：`desktop/src/domain/base/`）：
>   1. **参数原样进领域服务**：传输层不再重复 `requireString` 一遍 —— 两处都判会出现「传输层说合法、
>      领域层说非法」的口径分叉，且只在某个字段组合上显形；
>   2. **写操作 = 一个事务 + 一条审计**，顺序固定为「读旧值 → 校验 → 写表 → 写审计」；
>      已是目标状态的启停请求**幂等返回且不写审计**（否则重复点两次会在审计里留下两条 disable）；
>   3. **`map.updated` 事件在事务提交之后发**，渲染层收到事件时一定能读到新值。
>
> 易被误解的一处：车辆停用**不是**通用的 `{ "status": "disabled" }` 语义 ——
> 取值必须是 §1.5 车辆状态枚举成员，且 `reserved`/`busy` 停用返回 `VEHICLE.STATE_CONFLICT`（见 §3.2.2）。
>
> 六类资源的能力**并不对称**，而且都是契约决定的，不是实现缺口：
> `sites`/`vehicles`/`nodes`/`edges` 有启停；`restrictions` 有**物理删除**但没有启停接口
> （失效是一条带理由的 `PUT`，见 §3.2.5）；`task-templates` 只有读 / 创建 / 更新，**没有删除也没有停用**（§3.2.6）。

#### 3.2.1 站点 sites

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/sites` | query：`keyword/type/status/page/pageSize`；记录含 `nodeId/x/y` |
| `GET /api/sites/{id}` | 详情（含绑定节点坐标） |
| `POST /api/sites` | 创建：`code/name/type/nodeId?/x?/y?/remark?` |
| `PUT /api/sites/{id}` | 更新（`code` 不可改） |
| `PATCH /api/sites/{id}/status` | `{ "status": "disabled" / "enabled" }`（二选一） |

#### 3.2.2 车辆 vehicles

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/vehicles` | query：`keyword/status/type/page/pageSize` |
| `GET /api/vehicles/{id}` | 详情 |
| `POST /api/vehicles` | 创建：`code/name/type/capacityKg/maxSpeedMps/x/y/battery` |
| `PUT /api/vehicles/{id}` | 更新基础属性（**不含 `status`**） |
| `PATCH /api/vehicles/{id}/status` | `{ "status": "disabled" }` 停用（D-07 软删）或 `{ "status": "idle" }` 启用（恢复）。取值必须是 §1.5 车辆状态枚举的成员 —— **车辆域没有 `enabled`**（与 `sites` 不同）；调度占用中（`reserved`/`busy`）停用被拒 → `VEHICLE.STATE_CONFLICT` |

说明：`offline/fault/charging` 等运行态状态由执行器/心跳更新，管理接口不直接改；`online`（心跳标志）同样不由本接口维护。启用（`disabled → idle`）的目标状态固定为 `idle`，完整迁移表见 `design.md` §4.2。

界面上还有一条**客户端**的预防措施（不是接口约束）：调度占用中（`reserved`/`busy`）的车辆，「停用」按钮直接禁用并给出原因，
不让使用者点了才被 `VEHICLE.STATE_CONFLICT` 拒 —— 服务端校验仍是唯一的判定者。

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
| `GET /api/edges` | query：`code/fromNodeId/toNodeId/status/page/pageSize`；记录含 `code` |
| `GET /api/edges/{id}` | 详情 |
| `POST /api/edges` | `code?/fromNodeId/toNodeId/lengthM?/speedLimitMps?/remark?`；`code` 缺省按两端节点 `code` 生成 `E_<from>_<to>`，唯一（见 `docs/data-interfaces.md` §4.3、D-35）；`lengthM` 缺省按坐标欧氏距离自动计算；重复方向对拒绝 |
| `PUT /api/edges/{id}` | 更新（`code` 不可改） |
| `PATCH /api/edges/{id}/status` | 封路（`disabled`）。**当前实现**：只写状态与审计并广播 `map.updated`；「触发相关任务告警评估」是 M5 的评估器落地后的行为（`edge.status` 事件已带 `edgeId`/`status`，评估器接上即可用） |

#### 3.2.5 禁行规则 restrictions

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/restrictions` | query：`type/status/page/pageSize`；响应含对象编码便于展示 |
| `POST /api/restrictions` | `type/targetId/startAt?/endAt?/vehicleType?/reason`；写入时自动校验 targetId 存在 |
| `PUT /api/restrictions/{id}` | 更新 |
| `DELETE /api/restrictions/{id}` | 物理删除（规则无历史依赖） |

实现口径（`desktop/src/domain/base/restriction.service.ts`、`desktop/src/db/repositories/restriction.repo.ts`）：

- **没有 `keyword` 搜索**：规则的可读标识是派生的 `targetCode`（节点取 `nodes.code`、边按两端节点推导），
  它分散在两张表里，按它模糊搜在语义上不成立（与 §3.2.4 的边同理）。找一条规则的路径是
  「按 `type` / `status` 缩小范围，再看 `targetCode` 列」。
- **`targetId` 是多态引用**（节点或边），`restrictions.target_id` **没有外键**。因此：
  读取时用 `LEFT JOIN` 现算 `targetCode`，目标被删除后规则**仍在列表里**、`targetCode` 为 `null`
  （界面显示「目标已不存在」）—— 若用 `JOIN`，那条规则会凭空消失，使用者既看不到它也无法清理它；
  写入时由服务层校验「目标在当前 `type` 下真实存在」，否则 `MAP.RESTRICTION_TARGET_NOT_FOUND`。
- **时间窗是跨字段校验**：两个字段各自只需是**可解析的 ISO 8601 串**（字符串比较即时间序，
  见 `docs/database.md` 的生效查询），而 `endAt > startAt` 由服务层拿**库里的**另一侧配对判断 ——
  只传 `endAt` 的更新必须与旧 `startAt` 比较（只判传来的那一个会漏掉倒挂，撞 DDL 的 CHECK 报成 500）。
- **删除是物理删除**：行真的从库里移除，动态数据只剩 `audit_logs` 里一条 `action='delete'`（`before` 存全量快照）。
  这是 `design.md` D-07「一律软删」的**唯一例外**，也正是审计必须存 before 的原因。
- 排序为 `created_at DESC, id ASC`（时间戳可能同毫秒，故用 `id` 兜底定序）；`type` / `status` 取值非法一律
  `VALIDATION.FAILED`（不静默忽略，见 D-40）。

#### 3.2.6 任务模板 task-templates

| 方法/路径 | 说明 |
| --- | --- |
| `GET /api/task-templates` | query：`keyword/page/pageSize` |
| `GET /api/task-templates/{id}` | 详情 |
| `POST /api/task-templates` | `code/name/priority/defaultCargoKg/timeWindowMinutes/fromSiteType/toSiteType/remark?` |
| `PUT /api/task-templates/{id}` | 更新 |

实现口径：

- **只有三条路由**：没有 `DELETE`（模板会被 `tasks.template_id` 引用，删掉会让历史任务失去来源说明），
  也没有启停（`task_templates` 表**没有 status 列**）。这是此表与其余五类的不对称之处，
  属契约决定的范围，不是实现没做完 —— 服务层也**不提供**契约之外的入口。
- `priority` 创建时可缺省，缺省值为 **`normal`**（与 DDL 的 `DEFAULT 'normal'` 一致；不是枚举首项 `low`）。
- `defaultCargoKg` 域为 `>= 0`、`timeWindowMinutes` 为**正整数**（`> 0`），与 DDL 的 CHECK 保持一致 ——
  DDL 拒掉而校验放过的值会以 `SYS.INTERNAL` 的形式冒出来，看不出原因。
- 四个可空列（`defaultCargoKg` / `timeWindowMinutes` / `fromSiteType` / `toSiteType`）显式传 `null` 表示**清空**。
- `code` 创建后不可改（与其它五类同口径）；模板**不影响路网**，因此变更**不**发 `map.updated`。
- 排序为 `code ASC`。

### 3.3 任务管理（M3）

字段与状态机见 design §4.3、§6.2。任务编码 `code` 创建后不可变；`fromSiteId/toSiteId` 必须是 `enabled` 站点。

> **已实现范围（2026-09-26）**：本节的 **§3.3.1 列表** · **§3.3.2 详情** · **§3.3.3 创建** · **§3.3.5 编辑** ·
> **§3.3.6 状态操作**（六个动作共用 `POST /api/tasks/{id}/{action}` + `DELETE /api/tasks/{id}`）· **§3.3.7 操作响应**
> 均已落地并有测试；**§3.3.4 批量导入未实现** —— 页面已如实标注未实现，契约保留待导入管线定案（见
> `docs/module-M3-task.md` §2.1 / §12 Q1）。状态操作的 HTTP 暴露面由状态机派生
> （`shared/src/task-state.ts` 的 `TASK_API_ACTIONS - {delete}`），未登记的动作一律 `API.ROUTE_NOT_FOUND`；
> 模块内实现口径见 `docs/module-M3-task.md`。
>
> 三条落地口径（实现处：`desktop/src/domain/task/task.service.ts`）：
>   1. **写操作 = 一个事务 + 一条审计**，顺序固定为「读旧值 → 校验 → 写表 → 写审计」；
>      `create` 带 `submit=true` 时 `draft → pending` 在**同一事务内**完成；
>   2. **取消 / 重派先回收车辆再改状态**：仅 `busy` / `reserved` 回 `idle`（不谎报故障 / 离线 / 充电中 / 停用），
>      并把计划置 `cancelled` / `superseded`、清空 `assigned_vehicle_id` 与 `plan_id`；未回收的提示写进审计 `message`；
>   3. **`task.changed` 事件在事务提交之后发**，载荷含 `reason` 与 `taskId`（状态操作另带 `status`）。
>
> 契约里没有的能力**不是实现缺口**：`assign` / `start` / `complete` / `fail` 由 M4 / M7 触发，不给 HTTP 入口；
> 单个任务没有「批量操作」接口；暂停原因落 `tasks.pause_reason` 列（迁移 `0004`）而不是只写审计。

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

六个动作共用**同一个路径形态** `POST /api/tasks/{id}/{action}`（`{action}` ∈ `submit` / `pause` / `resume` / `cancel` / `requeue` / `reassign`）；
物理删除是唯一的例外，走 `DELETE /api/tasks/{id}`。逐条列在下表（实现时不再为每个动作单独注册一条路径，见 `docs/module-M3-task.md` §3）。

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

> **已实现范围（2026-09-27）**：本节 **§3.4.1-§3.4.6 六条接口全部落地**，代码在
> `desktop/src/domain/dispatch/dispatch.service.ts`（+ `snapshot.ts` / `explain.ts`）与
> `desktop/src/ipc/api.ts`；仓储在 `desktop/src/db/repositories/dispatch-plan.repo.ts` /
> `dispatch-log.repo.ts`；渲染层调度台在 `renderer/src/dispatch/`，浏览器形态复用
> `renderer/src/api/mock-dispatch.ts`。三处**必须一并读**的落地口径：
>
>   1. **apply 不重跑算法**，落的是预览当场存下的 `dispatch_logs.output_snapshot`
>      （只有路线会重推）。重跑会让「我确认的方案」与「实际落库的方案」不是同一个，
>      而事后无法分辨是算法变了还是数据变了。并发安全由条件 UPDATE（乐观锁）负责，
>      不靠「快照没变」这种无法证伪的判据。
>   2. **`strategy=all` 只能用于预览**；apply / recompute 必须指定单一策略，
>      传 `all` 得 `VALIDATION.FAILED`。否则会出现「对比后选了匈牙利、应用时落了贪心」。
>   3. **车辆状态只到 `reserved`**：`busy` 由执行器（M7）在开工时置位。M7 未落地，
>      因此应用派发之后车辆**不会自动变 `busy`**，也不会产生 `vehicle.changed` 位置流 ——
>      地图上的车因此是静止的。这是当前已知且预期内的形态，不是接口缺陷。
>
> `eventSeq`（`GET /api/map/overview`）取 `sqlite_sequence` 这一单调水位线而非 `MAX(seq)`，
> 与 `D-24` 同一判据；调度写入不额外发 `execution.progress`（那是 M7 的事件）。
>
> 模块内实现口径与测试清单见 `docs/module-M4-dispatch.md` §14。

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

成功副作用（单事务）：任务 `pending→assigned`；车辆 `idle→reserved`（进入占用区间；`busy` 由 M7 执行器在开工时置位）；写入 `routes`、`dispatch_plans(applied)`、`dispatch_logs(action=apply)`。返回各任务详情。

**同一辆车可以在一批里出现多条计划**（内核按半开占用区间排，见 `docs/module-M4-dispatch.md` §6）：
后一个任务只要自然落在前一个区间之外就同样可行。此时车辆只 `idle→reserved` **一次**，
「预留」不是可重入动作；两条计划的时间区间若重叠（存档被改动或来自旧版实现），
整批拒绝并返回 `DISPATCH.PLAN_EXPIRED`，要求重新预览。

**回收的语义是「释放这一单的占用」**：重算 / 取消某条计划时，只有该车不再被任何**其它**
生效计划占用，才把状态改回 `idle`。否则会出现「车辆显示空闲、身上却还挂着未完成的计划」，
下一次调度就会把车派出去，两条计划真重叠而库里查不出是哪一步错的。

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

字段与状态机见 design §4.6。路线结果**只读**：`routes` 表的写入发生在调度 apply（§3.4）。

> **已实现范围（2026-09-26）**：本节的 **§3.5.1 规划** · **§3.5.2 对比** · **§3.5.3 已存路线查询**
> 三条接口均已落地并有测试（`desktop/src/ipc/api.route.test.ts` · `desktop/src/domain/route/route.service.test.ts` ·
> `renderer/src/api/mock-parity.test.ts` 的三层一致性）。**本模块没有「写」接口** —— 规划是预览，
> 落库由 M4 的 apply 触发（§3.4.4），因此**这三条接口都不发领域事件**（没有数据变化；
> 发 `map.updated` 会让地图为一个没有变化的世界重拉快照，`D-23` 已证明反复重建图层会让边渲染不稳）。
>
> 模块内实现口径见 `docs/module-M5-route.md`。三条落地口径（不复述该文档的清单）：
>   1. **算法与构图是纯函数、放在 `shared/`**（`route-graph.ts` / `route-search.ts` / `route-rules.ts`）：
>      主进程与浏览器 Mock 必须用同一份 —— 各抄一份的分叉只在切换形态时显形（D-27 / D-44 的形态）；
>   2. **失败原因 → 错误码**：内核返回五种 `reason`，映射为四种 code（`GRAPH.EMPTY` /
>      `GRAPH.DISCONNECTED` / `GRAPH.BLOCKED` / `ROUTE.NOT_FOUND_PATH`）。`VIA_UNREACHABLE` 与
>      `NOT_FOUND_PATH` 合为同一个 code —— 对使用者是同一件事（这条线走不通），位置信息进 `detail.unreachableVia`；
>   3. **节点存在性先于构图判**：`fromNodeId` / `toNodeId` / `viaNodeIds` 里出现库里没有的 id 一律
>      `NODE.NOT_FOUND`，而不是「走不通」—— 两者该做的事完全不同（改 id vs 改路网）。

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

`vehicleType` 必填且**不给默认值**：它决定「没有单独限速的边」按多快计算（`shared/src/route-graph.ts` 的
`ROUTE_DEFAULT_SPEED_MPS`），给默认值会让「忘了传」与「故意按 other 算」得到同一个结果，而前者是错的输入。
`algorithm` 可省 —— 缺省取 `settings.route.defaultAlgorithm`（该设置项写坏时回落 `aStar`，不因此让规划打不开）。
通行时间取 `min(边限速, 车种默认速度)`：道路限速是**上限**，漏掉 `min` 会让慢速车按道路限速通过。

#### 3.5.2 算法对比

`POST /api/routes/compare` · `route:plan`

请求同 plan，`algorithm` **忽略**（但仍走字段校验：给一个非法算法名应当报参数错误，而不是静默忽略）。响应：

```json
{
  "results": [ { "algorithm": "aStar", "route": { "…": "…" }, "elapsedMs": 3 }, { "algorithm": "dijkstra", "route": { "…": "…" }, "elapsedMs": 12 } ],
  "consistent": true,
  "difference": { "distanceM": 0, "durationS": 0 }
}
```

`consistent=false` 时实现方需记系统日志排查（实现：写一条 `module=route`、`action=compare_inconsistent`
的审计，`result=failure`）。**构一次图、算两次**：两次搜索必须面对同一张图，否则差异里会混进「两次读数之间的数据变化」。

`consistent` 不是「两次结果一样」的装饰：A* 的启发式若不可采纳（高估剩余时间），它就会给出比 Dijkstra
更短的路线 —— 那是**实现缺陷**而不是策略差异。判据是**里程与耗时**，不是节点序列：网格上等长的走法不止一条，
A* 受启发式引导、Dijkstra 按 id 顺序展开，两者选出的等长路径本来就可能不同（断言序列相等会把正确实现判成错的）。

#### 3.5.3 已存路线查询

`GET /api/routes/{id}` · `route:plan`（任务关联路线也可由任务详情读取）。仅 apply/调度过程产生的路线会落库，可查 `nodeIds/distanceM/durationS/warnings` 全字段。

不存在时返回 `ROUTE.NOT_FOUND`（404 语义）—— 与「两点之前没有可行路径」的 `ROUTE.NOT_FOUND_PATH`（409）是
**两个不同的 code**：一个是「这条记录不存在」，一个是「这两点走不通」，混用会让调用方分不清该改 id 还是改路网。
`costDetail` 在落库路线上**可能为空对象**（`routes.cost_detail` 列为 `'{}'` 默认值，seed 的演示路线正是如此），
故类型上 `travelS` 是可选的 —— 规划响应里必然有它。

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

渲染层通过 `dispatchApi.on(event, handler)` 订阅。事件名常量在 `shared/src/enums.ts`。

**推送按会话权限过滤（D-32）**：`desktop/src/services/event-bus.ts` 的 `EVENT_PERMISSIONS` 规定每个事件
所需权限点；窗口在登录后绑定会话、登出即降权，**未登录窗口收不到任何登记过权限的事件**。
未在下表登记权限的事件（如 `map.updated`）视为公开 —— 它只是刷新信号，不含业务对象。

| 事件 | 载荷要点 | 所需权限点 | 说明 |
| --- | --- | --- | --- |
| `task.changed` | `{ taskId, code, status, transition: {from,to}, vehicleId?, updatedAt }` | `task:read` | 任务任何状态变化 |
| `vehicle.changed` | `{ vehicleId, code, status, x, y, battery, taskId? }` | `monitor:read` | 位置/状态/电量变化 |
| `alert.created` | `{ alertId, type, level, objectType, objectId, message }` | `alert:read` | 新告警（角标+toast） |
| `alert.updated` | `{ alertId, status }` | `alert:read` | 告警状态变化 |
| `execution.progress` | `{ taskId, vehicleId, progress, x, y }` | `monitor:read` | 高频进度事件（节流 ≥ 250ms） |
| `settings.changed` | `{ key, value }` | `settings:read` | 设置变更广播 |
| `map.updated` | `{ eventSeq }` | —（公开） | 通用刷新信号（可触发 overview 拉取） |

> 事件日志（`event_log`）**照写不误**，权限过滤只作用于**推送** —— 服务端真相不受影响。
> 新增事件必须同时登记 `EVENT_PERMISSIONS`，否则 `desktop/src/services/event-bus.test.ts` 会失败。

监听须知：渲染层应缓存事件号去重；高频事件（execution.progress / vehicle.changed）节流合并；离线/断连时以 `monitor.refreshIntervalMs` 定时兜底。

---

## 5. 种子数据（演示）

首次启动 seed（幂等，`desktop/src/db/seed.ts`；**实测值以 `npm run db:seed` 输出为准**）：

| 数据 | 实测数量 | 说明 |
| --- | ---: | --- |
| `nodes` / `edges` | 12 / 34 | 4×3 网格路网，双向边 |
| `sites` | 3 | 2 个 `depot` + 1 个 `charging` |
| `vehicles` | 3 | agv / carrier / drone 各 1 |
| `task_templates` | 2 | 任务模板 |
| `users` | 3 | admin / dispatcher / monitor |
| `settings` | 9 | 见 `design.md` §4.10 键目录 |
| `tasks` / `routes` / `alerts` | 1 / 1 / 1 | **演示执行数据**（D-26）：一条 `running` 任务 + 其路线 + 一条告警，AGV-01 同步置 `busy` |

账号与默认密码由 `shared/src/constants.ts` 的 `SEED_ACCOUNTS` 定义（admin / dispatcher / monitor，各角色权限点见 §3.1.1）。

> **尚未实现**：设计早期设想的「一键推进 / 一键重置演示数据」入口**在代码中不存在**，属计划项，不要在 UI 里当作既有能力引用。
> 当前如需重置演示库，用 `npm run db:reset`（删库后重新 migrate + seed）。
