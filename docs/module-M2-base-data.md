# 模块开发文档：基础数据（M2）

> 版本：v1.0 · 面向开发 · 状态：**设计中（待实现）**
> 关联：`design.md` §4.2 / §6.2 · `docs/api.md` §3.2 · `docs/database.md` §2.2-§2.4 · `docs/data-interfaces.md` §4（F2 仿真地图）
> 定位：把 `design.md` §4.2 的 7 条 `Req-M2-*` 落成可直接编码的口径 —— 文件划分、校验顺序、
> 软删与引用完整性、审计动作命名、错误映射、测试清单。任何实现偏差必须先回写本文档与 `AGENTS.md`。
> **文档边界**：本文件只负责「M2 基础数据模块的模块内实现口径」。字段契约以 `design.md` §6.2 与
> `docs/database.md` §2 为准，接口路径/请求字段/权限点以 `docs/api.md` §3.2 为准；
> 本文件**不复述可漂移的数值**（条数、seed 规模、表数），需要时引用对应 §号（D-34）。

## 1. 模块定位

M2 是**唯一的主数据写入口**：站点、车辆、路网（节点 / 有向边 / 禁行规则）、任务模板五类主数据，
在此增删改查与启停。它本身不产生业务价值，它决定的是**其它模块的输入质量**：

- M4 调度候选集与 M5 路径搜索读的是 M2 维护的路网与车辆参数；
- M6 地图渲染读的是同一份节点/边/站点快照；
- M8 告警的「封路触发相关任务告警评估」由 M2 的边状态变更触发。

因此本模块的设计目标只有一句：**让主数据在任意时刻都是自洽、可审计、可被下游直接消费的**。

## 2. 范围与边界

### 2.1 功能范围（对应 Req-M2）

| 需求 | 能力 | 落点 |
| --- | --- | --- |
| Req-M2-1 | 站点 CRUD（编码唯一 / 坐标 / 类型 / 启停） | `SiteService` |
| Req-M2-2 | 车辆 CRUD（编码唯一 / 型号 / 载重 / 速度 / 电量 / 位置 / 状态） | `VehicleService` |
| Req-M2-3 | 路网节点与有向边维护；边长可缺省按坐标推导；启停 | `GraphService` |
| Req-M2-4 | 禁行规则（节点/边 + 时间窗 + 原因 + 适用车型） | `RestrictionService` |
| Req-M2-5 | 任务模板默认参数 | `TemplateService` |
| Req-M2-6 | 主数据变更写审计（before/after） | 全部服务统一走 `writeAudit` |
| Req-M2-7 | 离线/故障/停用车辆不进调度候选集 | 由快照筛选保证（本模块只负责把状态写对） |

### 2.2 本模块**不负责**什么

划清边界是为了避免同一件事两处实现：

| 不负责 | 归属 | 原因 |
| --- | --- | --- |
| 车辆运行态（`charging` / `offline` / `fault` 的进入与退出） | M7 执行器 + 心跳 | 运行态由设备与执行器推进，管理接口不得代写（见 §6.1） |
| 任务的状态迁移 | M3 | M2 只提供模板与站点校验 |
| 路径计算与连通性判定 | M5 | M2 只保证图结构与引用自洽 |
| 导入了什么文件、批次结果 | 导入管线（`docs/data-interfaces.md`） | M2 只消费导入后的落库结果 |
| 演示数据的写法 | `desktop/src/db/seed.ts` | seed 与业务写路径分离，见 §3 边界约定 |

### 2.3 依赖与数据来源

| 依赖 | 来源 | 说明 |
| --- | --- | --- |
| 表结构 | `desktop/migrations/0001_init.sql` | 本模块涉及的表与列；DDL 契约见 `docs/database.md` §2.2-§2.4（**表数不在此复述**，D-34） |
| 分页与参数校验 | `desktop/src/ipc/api.ts` 现有内联工具 | 接口数增长后抽 `ipc/validators.ts`（`docs/issues.md` ISS-015） |
| 审计写入 | `desktop/src/services/audit.ts` 的 `writeAudit` | 已有实现，直接复用 |
| 事件推送 | `desktop/src/services/event-bus.ts` 的 `EventBus.emit` | 新增事件须登记 `EVENT_PERMISSIONS`（D-32） |
| 枚举 | `shared/src/enums.ts` | **唯一来源**；本模块不得自定义状态取值 |

## 3. 代码结构规划

```text
shared/src/types.ts                  # 追加 M2 的 CRUD DTO（SiteDTO / VehicleDTO / NodeDTO / EdgeDTO / RestrictionDTO / TaskTemplateDTO）
shared/src/enums.ts                  # 已含全部取值，本模块只读不改
desktop/src/domain/base/
├── site.service.ts                  # 站点：CRUD + 启停 + 节点引用校验
├── vehicle.service.ts               # 车辆：CRUD + 启停（disabled ↔ idle）
├── graph.service.ts                 # 节点 + 有向边：CRUD + 引用完整性 + 边长推导
├── restriction.service.ts           # 禁行规则：CRUD（含物理删除）
├── template.service.ts              # 任务模板：CRUD
├── validate.ts                      # 本模块共用的字段校验（长度/坐标/正数/枚举）
└── errors.ts                        # M2 错误码常量与构造器（映射见 §8）
desktop/src/db/repositories/
├── site.repo.ts  vehicle.repo.ts  graph.repo.ts
├── restriction.repo.ts  template.repo.ts
└── audit.repo.ts                    # 已有，写审计用
```

边界约束（与 `module-M4-dispatch.md` §3 同口径）：

1. 领域服务**不写 SQL**，只调用 Repository；Repository 不做业务判断，只做查询与受控写入。
2. `desktop/src/domain/base/*` 不得 import 任何渲染层内容，也不得 import `desktop/src/ipc/*`。
3. **seed 不调用领域服务**：`seed.ts` 直接写表，因此不产生审计。这是有意的 —— 演示数据不是用户行为，
   若计入审计会污染「谁在什么时候改了什么」这条链路。导入管线同理（批次本身就是留痕载体）。

## 4. 领域服务契约

方法签名（实现时以实际代码为准，此处锁定**语义与事务边界**）：

```ts
// actor 用 shared 的 AuditContext（`shared/src/types.ts`），**不要** import `ipc/router.ts` 的 RouteActor
// —— 否则领域层会反向依赖传输层，违反 §3 的边界约束 2。
interface CrudContext { db: Db; actor: AuditContext | null }

// 站点
listSites(ctx, query): PageResult<SiteDTO>
getSite(ctx, id): SiteDTO
createSite(ctx, input): SiteDTO
updateSite(ctx, id, input): SiteDTO          // code 不可改
setSiteStatus(ctx, id, status): SiteDTO

// 车辆
listVehicles(ctx, query): PageResult<VehicleDTO>
createVehicle(ctx, input): VehicleDTO
updateVehicle(ctx, id, input): VehicleDTO    // 不含 status
setVehicleStatus(ctx, id, status): VehicleDTO // 仅 disabled / idle

// 路网
listNodes(ctx, query): PageResult<NodeDTO>
createNode(ctx, input): NodeDTO
createEdge(ctx, input): EdgeDTO              // lengthM 缺省按坐标推导
setNodeStatus(ctx, id, status): NodeDTO      // 被引用则拒
setEdgeStatus(ctx, id, status): EdgeDTO      // 封路会触发告警评估

// 禁行规则 / 模板
createRestriction(ctx, input): RestrictionDTO // 校验 targetId 存在
updateRestriction(ctx, id, input): RestrictionDTO
deleteRestriction(ctx, id): void              // 物理删除（唯一例外，见 §6.2）
createTemplate(ctx, input): TaskTemplateDTO
```

**统一事务纪律**：每个写方法 = 一个 `tx()`。事务内顺序固定为
「读旧值 → 校验 → 写表 → 写审计」；`EventBus.emit` 与告警评估放在**事务提交之后**，
避免事件先于数据可见而让渲染层读到旧快照。

## 5. 校验规则（按固定顺序，命中即返回）

顺序不可随意调换：**先校验字段本身、再校验唯一性、最后校验跨表引用**。
理由 —— 字段格式错误是调用方的输入问题（`VALIDATION.FAILED`），
唯一性与引用是数据一致性问题（域错误码），前端要按不同 code 给出不同引导。

| # | 校验 | 失败 |
| --- | --- | --- |
| 1 | 必填字段非空、类型正确 | `VALIDATION.FAILED` + `detail.fields` |
| 2 | 长度上限（`code` ≤ 32、`name` ≤ 100、`reason` ≤ 200、`remark` ≤ 500） | `VALIDATION.FAILED` |
| 3 | 数值域：`lengthM > 0`、`speedLimitMps > 0`、`capacityKg > 0`、`maxSpeedMps > 0`、`battery ∈ [0,100]` | `VALIDATION.FAILED` |
| 4 | 枚举取值必须是 `shared/src/enums.ts` 成员 | `VALIDATION.FAILED` |
| 5 | 时间窗 `endAt > startAt`（两端都填时） | `VALIDATION.FAILED` |
| 6 | `code` 全局唯一（同表内） | `BASE.CODE_EXISTS` |
| 7 | 站点：`nodeId` 存在（填了的话） | `NODE.NOT_FOUND` |
| 8 | 边：`fromNodeId` / `toNodeId` 存在 | `NODE.NOT_FOUND` |
| 9 | 边：`fromNodeId !== toNodeId`（自环拒绝） | `VALIDATION.FAILED` |
| 10 | 边：方向对唯一 `(from,to)` | `BASE.CODE_EXISTS`（见上注：不新增专用码） |
| 11 | 禁行规则：`targetId` 按其 `type` 分别指向 `nodes` / `edges` | `NODE.NOT_FOUND` / `EDGE.NOT_FOUND` |
| 12 | 站点：`x`/`y` 有限（非 NaN / Infinity） | `VALIDATION.FAILED` |
| 13 | 车辆启用（`disabled → idle`）时 `online` 不被本接口修改 | 见 §6.1 |

> **为什么不给「自环 / 方向对重复」新增专用错误码**：按 D-33「同一概念只允许一个 code」，
> 能由既有 code 表达的一律不新增 —— 新增只会让前端多一个分支。
> 自环由 DB 的 `CHECK (from_node_id <> to_node_id)` 兜底，对外报 `VALIDATION.FAILED`；
> 方向对重复在 **D-35 落地后**等价于「`code` 重复」（`code` 缺省由 `E_<fromCode>_<toCode>` 推导），
> 故复用 `BASE.CODE_EXISTS`。**D-35 仍待评审**：若评审改掉 `code` 的推导规则，
> 本行须随之改为 `VALIDATION.FAILED`（届时边没有可比的业务键）。

## 6. 两条容易写错的规则

### 6.1 车辆状态：M2 只拥有 `idle` / `disabled`

车辆 7 态中的 `charging` / `offline` / `fault` 属**运行态**，其进入与退出条件是执行器与心跳的职责。
`docs/api.md` §3.2.2 明确规定管理接口不直接改这些状态，本模块据此只实现**两个真正的迁移**
（第三行为幂等 no-op）：

| 从 | 到 | 接口 | 前置 |
| --- | --- | --- | --- |
| `disabled` | `idle` | `PATCH /api/vehicles/{id}/status` `{status:"idle"}` | 该车无未终结任务（防御性校验，正常不应出现） |
| `idle` / `charging` / `offline` / `fault` | `disabled` | 同上 `{status:"disabled"}` | 非 `reserved` / `busy`，否则 `VEHICLE.STATE_CONFLICT` |
| `disabled` | `disabled` | 同上 `{status:"disabled"}` | **幂等**：不报错、不重复写审计（或按 §11 Q4 记一条 no-op，二选一） |

> `reserved`（已被计划占用）与 `busy`（执行中）**不在可停用之列** —— 必须先取消任务或等执行结束。
> 从 `offline` / `fault` 直接停用是允许的（管理动作优先于运行态）：停用后即使心跳恢复，
> 也须由管理接口显式启用才会回到 `idle`。

**要点**：

1. **车辆域没有 `enabled` 这个取值** —— `enabled` 是站点/节点/边的状态，不是车辆的。
   写成 `{status:"enabled"}` 必须报 `VALIDATION.FAILED`，不能静默当成 `idle`。
2. **占用中禁止停用**：`reserved`（已被计划占用）与 `busy`（正在执行）不允许直接软删，
   否则会出现「任务挂着 disabled 车」的矛盾状态（与 `seed` 中「状态必须成对写」同一教训）。
   停用**不回收**任务，只拒绝 —— 回收是 M3/M4 的职责。
3. **不校验 `battery` / `loadKg`**：这两个字段是运行态**读数**，由执行器写；
   管理接口只允许创建时给初值，后续更新不得覆盖（否则会与真实读数打架）。

> **与 ISS-016 的关系**：`charging` / `offline` / `fault` 的完整迁移表仍待 M7 补写，
> 本模块**不臆测**其条件；本文只锁定 M2 真正拥有的这两条迁移。

### 6.2 删除策略：一律软删，唯一例外是禁行规则

D-07 定了「站点/车辆/节点/边一律软删（`disabled`）」。落地时有三个易错点：

| 实体 | 操作 | 实现 | 陷阱 |
| --- | --- | --- | --- |
| 站点 / 车辆 | 停用 | `status = 'disabled'` | 车辆停用前须过 §6.1 的占用校验 |
| 节点 | 禁用 | `status = 'disabled'` | **被边或站点引用时拒绝** → `BASE.NODE_IN_USE` |
| 边 | 封路 | `status = 'disabled'` | 会触发「相关任务告警评估」（Req-M2-4 / M8），见 §7 |
| 禁行规则 | 删除 | **物理 `DELETE`** | 唯一例外：规则无历史依赖，且已过期的规则留着只会干扰查询 |

`BASE.NODE_IN_USE` 的判定范围必须**同时**覆盖两张表，漏一张就会出现「节点已禁用但边上还指着它」：

```sql
-- 判定节点是否被引用（任一命中即拒绝禁用）
SELECT 1 FROM edges   WHERE from_node_id = :nodeId OR to_node_id = :nodeId LIMIT 1;
SELECT 1 FROM sites   WHERE node_id = :nodeId LIMIT 1;
SELECT 1 FROM vehicles WHERE current_node_id = :nodeId LIMIT 1;   -- 按需
```

> `vehicles.current_node_id` 是否纳入判定**需要评审**：它是运行态位置，禁用一个「此刻正好停在该节点」
> 的节点会立刻产生引用悬空。倾向是**纳入**，但处置方式改为「提示 + 拒绝」而非静默通过。

## 7. 审计与事件口径

### 7.1 审计动作命名（`audit_logs`）

`module` 取 `base`，`action` 与接口动词对齐，便于审计页按动作筛选：

| action | 触发 | before/after |
| --- | --- | --- |
| `create` | 新增任一主数据 | `before=null`，`after=完整记录` |
| `update` | 更新基础属性 | 两者都是**变更前后的完整记录**（不是 diff） |
| `status` | 启停 / 封路 | 两者都含 `status`，便于看出从哪到哪 |
| `delete` | 仅禁行规则 | `before=原记录`，`after=null` |

`objectType` 取 `shared/src/enums.ts` 的 `OBJECT_TYPES` 成员，对照如下：

| 实体 | `OBJECT_TYPES` 中的取值 | 说明 |
| --- | --- | --- |
| 站点 / 车辆 / 节点 / 边 | `site` / `vehicle` / `node` / `edge` | 直接可用 |
| 任务模板 | **无对应取值** | 与 `restriction` 同属缺口，见 §11 Q1 |
| 禁行规则 | **无对应取值** | 同上 |

> **不要用 `system` 兜底**：按 D-33「同一概念只允许一个 code / 一个键」，
> 把两类实体都塞进 `system` 会让审计页无法按对象筛选，等于把缺口藏起来。
> 倾向是**扩枚举**（新增 `restriction` / `taskTemplate`），但这会触及 `alerts.object_type` 的
> `CHECK` 约束（`docs/database.md` §6 规则 4：需新迁移重建），故列为 §11 Q1 **待评审**。

### 7.2 事件

| 何时 emit | 事件 | 载荷要点 |
| --- | --- | --- |
| 站点/车辆/节点/边/模板变更 | `map.updated` | `{ reason }` —— 通用刷新信号（公开，无需权限映射） |
| 车辆状态变更 | `vehicle.changed` | `{ vehicleId, code, status, x, y, battery, taskId? }` |
| 边封路 | `map.updated` | 另**触发告警评估**（M8 落地后接入） |

**新增事件必须同时登记 `desktop/src/services/event-bus.ts` 的 `EVENT_PERMISSIONS`**，
否则 `event-bus.test.ts` 会失败（D-32）。上表两个事件都已登记，本模块不需要新增事件。

## 8. 错误映射（本模块）

本模块只使用 `shared/src/errors.ts` 中**已登记**的 code；下表是「校验项 → code」的对照，
实现时不得自造 code（D-33）。

| 场景 | code | source | detail 建议 |
| --- | --- | --- | --- |
| 字段缺失 / 格式错 / 枚举非法 / 自环 / 时间窗倒置 | `VALIDATION.FAILED` | validation | `{ fields: { <字段>: <原因> } }` |
| `code` 重复（站点/车辆/节点/边/模板） | `BASE.CODE_EXISTS` | business | `{ code, entity }` |
| 节点被边/站点引用时禁用 | `BASE.NODE_IN_USE` | business | `{ nodeId, refs: { edges: n, sites: n } }` |
| 站点不存在 | `SITE.NOT_FOUND` | business | `{ siteId }` |
| 车辆不存在 | `VEHICLE.NOT_FOUND` | business | `{ vehicleId }` |
| 节点不存在 | `NODE.NOT_FOUND` | business | `{ nodeId }` |
| 边不存在 | `EDGE.NOT_FOUND` | business | `{ edgeId }` |
| 模板不存在 | `TEMPLATE.NOT_FOUND` | business | `{ templateId }` |
| **禁行规则不存在** | `RESTRICTION.NOT_FOUND` | business | `{ restrictionId }` |
| 车辆占用中停用 / 非 `disabled→idle` 的迁移 | `VEHICLE.STATE_CONFLICT` | business | `{ vehicleId, currentStatus, expected }` |

> `RESTRICTION.NOT_FOUND` 是本次随本文档补登的 code（此前 `PUT/DELETE /api/restrictions/{id}`
> 没有对应的「不存在」错误可用）。已按 D-33 先写入 `shared/src/errors.ts` 再回写 `docs/api.md` §2.1。

## 9. 测试清单（建议）

### 9.1 单元 / 服务层（SQLite `:memory:` + 迁移 + seed）

| 编号 | 用例 | 断言 |
| --- | --- | --- |
| B1 | 站点 `code` 重复 | `BASE.CODE_EXISTS`，且无新行 |
| B2 | 站点 `nodeId` 不存在 | `NODE.NOT_FOUND` |
| B3 | 车辆 `{status:"enabled"}` | `VALIDATION.FAILED`（**不是**静默当 `idle`） |
| B4 | `busy` 车辆停用 | `VEHICLE.STATE_CONFLICT`，状态不变 |
| B5 | `disabled` 车辆启用 | 状态 → `idle` |
| B6 | 禁用被边引用的节点 | `BASE.NODE_IN_USE`，detail 含边数 |
| B7 | 禁用被站点引用的节点 | `BASE.NODE_IN_USE`，detail 含站点数 |
| B8 | 边 `lengthM` 缺省 | 落库值 == 两端欧氏距离（容差 0.01） |
| B9 | 边自环 | `VALIDATION.FAILED` |
| B10 | 边方向对重复 | `BASE.CODE_EXISTS` |
| B11 | 禁用不存在的边 | `EDGE.NOT_FOUND` |
| B12 | 禁行规则 `targetId` 不存在 | `NODE.NOT_FOUND` / `EDGE.NOT_FOUND` |
| B13 | 删除禁行规则 | 行**物理消失**（与其它实体的软删区分） |
| B14 | 更新站点 `code` | 被拒绝或忽略，`code` 保持不变 |
| B15 | 每次写操作 | `audit_logs` 恰好多 1 条，含 before/after 与 `traceId` |
| B16 | 写操作失败（校验不通过） | **不产生**审计行（或按 `result='failure'` 记一条，二者择一，见 §11 Q4） |

### 9.2 契约测试（走统一信封）

- `docs/api.md` §3.2 的 6 组路径逐条比对请求/响应字段；
- `monitor` 角色调写接口 → `AUTH.FORBIDDEN`；未登录 → `AUTH.REQUIRED`；
- MockAdapter 与 IpcAdapter 对同一组用例返回一致（复用 `mock-parity.test.ts` 的思路）。

### 9.3 验收走查（对照 Req-M2-1..7）

1. 建站点（编码唯一校验通过 / 重复被拒）（Req-M2-1）。
2. 建车辆并停用/启用；确认状态变化影响 M4 候选集（Req-M2-2 / Req-M2-7）。
3. 建节点与有向边；边 `lengthM` 留空自动推导；禁用被引用节点被拒（Req-M2-3）。
4. 对某边建禁行规则后重新规划路径，路径绕开该边（Req-M2-4，需 M5 就位）。
5. 用模板创建任务，默认字段被套用（Req-M2-5，需 M3 就位）。
6. 上述任一步后查审计页，可按 `module=base` 与动作筛选到记录（Req-M2-6）。

## 10. 开发顺序与完成标准（DoD）

```text
Step 1  shared/src/types.ts 追加 M2 DTO              → typecheck 通过
Step 2  Repository 五个（site/vehicle/graph/restriction/template）  → B1-B14 绿
Step 3  domain/base 五个服务 + validate + errors     → B15-B16 绿
Step 4  ipc/api.ts 注册 §3.2 全部路由 + 权限          → 契约测试通过
Step 5  renderer 基础数据页（五个分页签）             → 走查 1-6 通过
```

**DoD**：7 条 `Req-M2-*` 全部通过走查；审计断言覆盖每个写方法；`docs/api.md` §3.2 无未实现路径；
`BasePage` 替换 `PlaceholderPage`（`renderer/src/app/App.tsx` 的 `/base-data`）；提交前按 `AGENTS.md` 纪律记录。

## 11. 风险与待评审

| 编号 | 事项 | 倾向 |
| --- | --- | --- |
| Q1 | `OBJECT_TYPES` 缺「禁行规则」与「任务模板」两个取值，审计 `objectType` 无处安放（见 §7.1） | **倾向扩枚举**（值取 `restriction`、`taskTemplate`，与既有 `objectType` 的 camelCase 风格一致）。注意 `alerts.object_type` 有 `CHECK` 约束，按 `docs/database.md` §6 规则 4 需新迁移重建；`audit_logs.object_type` 无约束，可先落。需评审确认后再改代码 |
| Q2 | `vehicles.current_node_id` 是否纳入 `BASE.NODE_IN_USE` 判定 | **倾向纳入**（运行态位置也是引用） |
| Q3 | 边封路 → 「相关任务告警评估」的判定范围与去重键 | 随 M8 定义，本模块只 emit `map.updated` |
| Q4 | 校验失败是否写审计（`result='failure'`） | **倾向不写**（审计记行为，不记噪声）；若写则须防止被刷 |
| Q5 | M2 是否需要「路网批量导入」入口 | 倾向**复用 `docs/data-interfaces.md` 的 F2 导入管线**，不在 M2 另开一套 |
| Q6 | 站点边绑定（`edge_id` / 泊位）何时落地 | 见 `docs/issues.md` ISS-024；D-30 双写过渡，不在 M2 首期强制 |

