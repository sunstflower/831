# 模块开发文档：路径规划（M5）

> 版本：v1.0 · 面向开发 · 状态：**已实现**（`plan` / `compare` / `GET {id}` 三条接口已落地并有测试；
> 接口范围见 `docs/api.md` §3.5 的「已实现范围」）。
> 关联：`design.md` §4.6 / §7.1 · `docs/api.md` §3.5 · `docs/database.md` §2.4 ·
> `docs/module-M4-dispatch.md`（路线的**消费方**：apply 才写 `routes`）· `docs/module-M6-map.md`（路线的**渲染方**）
> 定位：把 `design.md` §4.6 的 `Req-M5-*` 落成可直接编码的口径 —— 算法内核的归属与不变量、
> 构图规则、失败原因到错误码的映射、途经点语义、渲染层口径与测试清单。
> 任何实现偏差必须先回写本文档与 `AGENTS.md`。
> **文档边界**：本文件只负责「M5 路径规划模块的模块内实现口径」。接口路径 / 请求字段 / 权限点以
> `docs/api.md` §3.5 为准，表结构与列 `docs/database.md` 为准，`Req-M5-*` 以 `design.md` §4.6 为准；
> **算法与字段规则的代码侧唯一作者**是 `shared/src/route-search.ts` · `route-graph.ts` · `route-rules.ts`。
> 本文件**不复述可漂移的数值**（车种默认速度、绕行阈值、途经点上限、用例数、路由条数），需要时引用文件与常量名（D-34）。

## 1. 模块定位

M5 回答一个问题：**在这张路网上，从 A 到 B 怎么走、要多久、为什么不是更短的那条。**

它是一条**只读的计算链**，不落业务库、不改任何状态：

```
nodes / edges / restrictions（库）  ──buildRouteGraph──▶  可用图（RouteGraph）
                                                              │
                                                     searchRoute│（A* 或 Dijkstra）
                                                              ▼
                                                     路线回执（RoutePlan）
```

它同时是三个下游的输入：

- M4 的 apply 用同一条链算出的**路线**写进 `routes` 表（`assignment` 的产物）；
- M6 地图按 `routes.nodeIds` / `edgeIds` 画高亮线；
- M7 执行器按 `routes.duration_s` 算进度与超时。

因此 M5 的正确性判据不是「算得快」，而是**同一个输入在三个运行形态下得到同一条路线**
（主进程 SQLite / 浏览器 Mock / 将来的本地 HTTP 必须逐字段一致）。

## 2. 范围与边界

### 2.1 功能范围（对应 Req-M5）

| 需求 | 能力 | 落点 | 状态 |
| --- | --- | --- | --- |
| Req-M5-1 | 指定起终点（可加途经点）规划路线 | `validateRouteInput` + `searchRoute` 的 `viaNodeIds` 分段拼接 | 已实现 |
| Req-M5-2 | A* 与 Dijkstra 结果可同时输出对比 | `POST /api/routes/compare`（两个算法在同一张图上各算一次） | 已实现 |
| Req-M5-3 | 禁行边 / 节点生效后不再出现在新路线 | `buildRouteGraph` 的三层排除（停用 / 车种 / 时间窗） | 已实现 |
| Req-M5-4 | 路线结果含完整可解释字段 | `RoutePlan`（`nodeIds` / `edgeIds` / 里程 / 耗时 / 算法 / `costDetail` / `warnings`） | 已实现 |
| Req-M5-5 | 任务取消 / 重派后旧路线不删除，留版本对比 | 落库侧在 `routes` 表（只 `insert`、不更新）；**触发方是 M4 的 apply** | 由 M4 承接（本模块只提供计算） |

### 2.2 本模块**不负责**什么

划清边界是为了避免同一件事两处实现：

| 不负责 | 归属 | 原因 |
| --- | --- | --- |
| 把路线写进 `routes` 表 | M4（apply） | 规划是**预览**：先看后生效（D-03）。M5 落库会让「点一下看看」改动业务数据 |
| 为「哪个任务派哪台车」做决策 | M4 | M5 只算「两点之间怎么走」，不判断该不该走 |
| 车辆运行态的推进（`busy` / `charging` …） | M7 执行器 | 路线是静态结果，执行是动态过程 |
| 禁行规则的增删改 | M2 | M5 只**读**规则并据此构图（`docs/module-M2-base-data.md` §3.4） |
| 路网节点 / 边本身的增删改 | M2 | 同上：M5 是纯读者 |
| 真实地图投影（经纬度） | 二期 | 首期按 `design.md` D-05 的平面 `{x,y}` 米制 |

### 2.3 依赖与数据来源

| 依赖 | 来源 | 说明 |
| --- | --- | --- |
| 路网与禁行数据 | `desktop/src/db/repositories/route.repo.ts` | 读全量节点 / 边 / 规则，**不走分页列表接口**（见 §4.1） |
| 表结构 | `desktop/migrations/0001_init.sql` | `routes` / `nodes` / `edges` / `restrictions`；DDL 契约见 `docs/database.md`（**列清单不复述**，D-34） |
| 车种与算法枚举 | `shared/src/enums.ts` | `VEHICLE_TYPES` / `ROUTE_ALGORITHMS`（唯一作者） |
| 缺省算法设置项 | `shared/src/constants.ts` 的 `SETTINGS_SCHEMA` | `route.defaultAlgorithm`；值由 `settings` 表承载 |
| 权限点 | `design.md` §3.7 | `route:plan`（三条接口共用，见 §6.3） |

## 3. 代码结构

```
shared/src/
  route-rules.ts       validateRouteInput（字段规则，两个接口共用）+ ROUTE_MAX_VIA_NODES
  route-graph.ts       buildRouteGraph（停用 / 车种 / 时间窗三层排除）+ ROUTE_DEFAULT_SPEED_MPS
  route-search.ts      图模型 + MinHeap + A* / Dijkstra + 途经点拼接 + 警告（纯函数，不 import db / errors）
  types.ts             RoutePlan / RoutePlanResponse / RouteCompareItem / RouteCompareResponse / RouteDetail

desktop/src/db/repositories/route.repo.ts    读全量图（listGraphNodes/Edges/RestrictionRules）+ 落库路线读取
desktop/src/domain/route/route.service.ts    planRoute / compareRoutes / getRoute；失败原因 → 错误码
desktop/src/ipc/api.ts                       三条路由（permission: 'route:plan'，两条 POST + 一条 GET）

renderer/src/api/mock-route.ts               Mock 侧同一套内核，只有存储不同
renderer/src/route/model.ts                  表单模型 + 展示口径（载荷构造、途经点解析、摘要、对比表）
renderer/src/route/RoutePlanner.tsx          规划面板
renderer/src/pages/DispatchPage.tsx          挂载点（`/dispatch`）
```

边界约束（与 `docs/module-M2-base-data.md` §3 同口径）：

1. **`shared/` 里的三个文件是纯函数**：不读时间、不碰数据库、不抛异常 —— 失败是**返回值**
   （`RouteFailure`），由领域服务决定抛哪个 `DomainError`（与 `task-state.ts` / `base-rules.ts` 一致）；
2. **领域层不得 import 传输层**：`route.service.ts` 只依赖 `db/repositories` 与 `services/audit`；
3. **算法层不得 import `errors.ts`**：`route-search.ts` 不知道错误码的存在，映射只在服务层做；
4. **渲染层不得自己算路线**：Mock 走 `shared` 的同一份内核，页面只消费 `RoutePlan`。

## 4. 构图口径

### 4.1 为什么读「全量图」而不是复用基础数据的分页列表接口

规划需要**整张图**，而 `/api/nodes` / `/api/edges` 是**分页列表接口**（默认一页 20 条）。
拿它取图只会拿到第一页，路线于是被**静默**规划在一张残缺的路网上 —— 不报错、不警告，
只是结果偏长或直接「不连通」。因此 `route.repo.ts` 另有一组读取（`SELECT ... FROM nodes` 全表、
按 id 排序让构图结果可复现），形状是 `shared` 定义的中立输入（`RouteNodeInput` 等）。

### 4.2 三层排除，且**先到的原因更可行动**

`buildRouteGraph` 按固定顺序判定一个节点 / 边是否进图：

| 顺序 | 判据 | 排除原因 |
| ---: | --- | --- |
| 1 | 主数据 `status = 'disabled'` | `disabled`（去基础数据里启用它） |
| 2 | 生效中的禁行规则（全车种 / 本车种） | `restricted`（改规则或换时间窗） |
| 3 | 规则的半开时间窗 `[start, end)` 不覆盖本次时刻 | 不排除（规则本就不生效） |

两处刻意如此：

1. **先到的原因留下**（`??=` 而非覆盖）：两个原因叠在一起时，使用者需要的是**最可行动的那个**
   ——「被停用了」是他能自己在基础数据页改的，「被规则封住」要去找规则；
2. **端点被排除时边也必须排除**：否则搜索会「经停一个已停用的节点」—— 图里没有那个节点，
   但边还在邻接表里，路线会指向一个不存在的节点。

时间窗用**服务端传入的 `at`**（`nowIso()`）而不是各段各取一次 `new Date()`：一次调度里所有
候选必须用同一个时刻判规则，否则同一辆车先评估与后评估可能落在窗口的两侧，结果无法复核。

### 4.3 通行速度：取小值，且必须有车种

```
通行速度 = min(边限速 ?? 车种默认速度, 车种默认速度)
```

`edges.speed_limit_mps` 是**道路属性**（同一条路对所有车型都一样限速），车辆最高速只是它的**上限**。
漏掉 `min` 会让限速 1.0 m/s 的慢速段按 5 m/s 通过，路线耗时整体偏乐观。

车种默认速度按 `RouteNodeInput` 的车种取（`ROUTE_DEFAULT_SPEED_MPS`），因此 `vehicleType` 是**必填**的：
给默认值会让「忘了传」与「故意按 other 算」得到同一个结果。

## 5. 搜索口径

### 5.1 A* 与 Dijkstra 共用一套框架

两者只差一个启发式函数（Dijkstra 即启发式为 0 的 A*）。这样做的收益是可测的：
**随机图上两个算法的结果必须逐字段一致**（由 `shared/src/route-search.test.ts` 断言）。
若分成两套实现，这条性质就无法断言，而它恰恰是 `compare` 接口存在的意义。

启发式用「欧氏直线距离 ÷ 全网最高速度」——它永远不会**高估**真实剩余时间（速度只可能更慢），
因此是可采纳的（admissible）。这一点不靠推导保证，靠测试保证。

### 5.2 途经点是**分段拼接**，不是「顺路经过」

`viaNodeIds` 必须按顺序逐段求解再拼接，拼接时**丢掉重复的接缝节点**。三处容易写错：

1. 把 via 当成「必须经过的集合」做单次搜索 → **顺序丢了**；
2. 拼接时不去重 → `nodeIds` 里出现连续两个相同节点，渲染层画出一段零长度边；
3. 把 via 里的端点当一个错误 → 会拒绝「起点 = 途经点」这种没有意义但无害的输入。
   实现按「过滤掉等于两端点的 via」处理：过滤比报错友好，且与「空路线合法」的口径一致。

### 5.3 警告是结构化的，且只有两条、都有触发条件

| code | 触发 | 为什么需要 |
| --- | --- | --- |
| `slow_edge` | 路径里出现了**全网最低速**的边，且全网速度**确实有差异** | 「这条线为什么这么慢」无法从总里程 / 总耗时看出来 |
| `detour` | 里程 ≥ 起终点**直线距离** × `ROUTE_DETOUR_WARN_RATIO` | 绕行是「能走但不该走」的信号 |

`slow_edge` 的第二个条件（`maxSpeedMps > minSpeedMps`）不是可有可无的修饰：所有路段一样快时，
「最低速段」就是**每一条边**，提示会在每条路线上都出现 —— 而一条永远出现的提示等于没有提示
（D-48 的同一条原则：无意义的信号会淹没有意义的信号）。这是实现中实测发现并修掉的缺陷（`ISS-063`）。

警告在共享层带 `code`（供测试与后续筛选），接口契约里只暴露 `message` 文案（`warnings: string[]`）——
界面直接展示；将来若要按类型筛选，再给契约开口子。

## 6. 接口口径

### 6.1 三条接口的分工

| 接口 | 方法 | 行为 | 落库 | 事件 |
| --- | --- | --- | --- | --- |
| `/api/routes/plan` | POST | 按请求里的 `algorithm` 算一次 | 否 | **不发** |
| `/api/routes/compare` | POST | 忽略请求里的 `algorithm`，两个都算，比对 | 否 | **不发**（不一致时写审计） |
| `/api/routes/{id}` | GET | 按 id 读已落库路线 | — | **不发** |

两条 POST 是**预览**：用 POST 只是因为请求体带结构化参数（`viaNodeIds` 是数组，塞进 query 很难看），
不代表写语义。因此**三条都不发领域事件** —— 没有数据变化，发 `map.updated` 会让地图白重拉一次快照
（`D-23` 已证明反复重建 `nodes`/`edges` 会让边渲染不稳）。

### 6.2 校验顺序（命中即返回）

1. **字段规则**（`validateRouteInput`）：必填 / 枚举 / 途经点形状与上限 → `VALIDATION.FAILED` + `detail.fields`；
2. **节点存在性**：`fromNodeId` / `toNodeId` / 每个 via 都要在库里存在 → `NODE.NOT_FOUND` + `detail.id`；
3. **构图**（读边与规则，按 §4.2 排除）；
4. **搜索**（按 §5 分段），失败按 §7 映射；
5. **缺省算法**：请求没给 `algorithm` 时读 `settings.route.defaultAlgorithm`，设置值非法则回落 `aStar`。

第 2 步在构图**之前**：构图会把「不存在」与「存在但被排除」都变成「图里没有它」，
而那两种情况该报的错完全不同（改 id vs 改路网）。先查一次全量节点表就能把它们分开，
代价是一次本来就要读的查询。

### 6.3 权限：三条接口共用 `route:plan`

不给查询另拆 `route:read`：三者是同一个能力面，拆开会让「会规划的人看不了自己刚算出的路线」。

## 7. 错误映射（本模块最容易做错的一处）

内核返回五种 `reason`，映射为**四种** code：

| `reason` | code | HTTP(参考) | 使用者该做什么 |
| --- | --- | --- | --- |
| `GRAPH_EMPTY` | `GRAPH.EMPTY` | 409 | 路网没数据 → 建档或导入地图 |
| `GRAPH_DISCONNECTED` | `GRAPH.DISCONNECTED` | 409 | 所有边都被禁用 / 封住 → 检查禁用项 |
| `BLOCKED` | `GRAPH.BLOCKED` | 409 | 端点被禁行规则或停用封住 → 改规则 / 启用 / 换时间窗 |
| `NOT_FOUND_PATH` | `ROUTE.NOT_FOUND_PATH` | 409 | 两点确实不连通 → 路网规划问题 |
| `VIA_UNREACHABLE` | `ROUTE.NOT_FOUND_PATH` | 409 | 同上，位置进 `detail.unreachableVia` + `detail.reachedNodeId` |

**五种合成四种是故意的**：`VIA_UNREACHABLE` 与 `NOT_FOUND_PATH` 对使用者是同一件事（这条线走不通），
差别只是「走不通的位置」—— 那个信息放 `detail` 而不是拆成第五个 code。反过来说，前四种合并任何一个
都会让使用者拿到一句无法行动的话。

**`detail` 有两个层次**：catalog 的 `message` 说「这类失败是什么」（`ERROR_CODES` 唯一作者），
`detail.message` 说「这次为什么失败」（内核给出，含节点 id）。两者都展示，不覆写。

`GET /api/routes/{id}` 查不到时用 `ROUTE.NOT_FOUND`（404）—— 与「两点走不通」的
`ROUTE.NOT_FOUND_PATH`（409）是**两个不同的 code**：混用会让调用方分不清该改 id 还是改路网。

## 8. 审计动作命名

| 时机 | `module` | `action` | `result` |
| --- | --- | --- | --- |
| `compare` 两个算法结果不一致 | `route` | `compare_inconsistent` | `failure` |

只有这一条。规划的**成功**不写审计：它不改任何状态、也不构成「谁做了什么」的留痕对象，
每次都写会让审计表被预览请求淹掉（与 §6.1「不发事件」同一个判断）。
不一致的那一条必须写：A* 的启发式若不可采纳就会给出更短的路线，而那是**实现缺陷**，
不记下来只能靠人肉比对两条路线才能发现。

## 9. 渲染层口径（`renderer/src/route/` + `renderer/src/pages/DispatchPage.tsx`）

### 9.1 挂载点为什么是 `/dispatch`

`design.md` §7.1 的页面清单里**没有**「路径规划」这一页 —— 路线是调度中心的输出之一
（该页主能力写的是「预览/策略对比/应用/手动指派/日志」）。另开一页会与设计清单不一致；
需求条目的唯一作者是 `design.md`（D-34）。

### 9.2 表单

- **起终点是下拉、途经点是文本框**。途经点是**有序**的，下拉方案要么给固定槽位（大多空着）、
  要么做动态行（顺序容易改错）。文本框的代价是必须解析输入，而那正好由 `model.ts` 负责并测到。
- **已停用节点保留在下拉里但标记为不可选**，而不是隐藏：隐藏会让人以为「这个节点不存在」，
  而真实情况是它在库里、只是不参与调度 —— 那决定了使用者去基础数据启用它，还是去查编码是否敲错。
- **途经点解析失败必须报出认不出的词**，不能静默丢弃（丢弃会让使用者以为途经点生效了，
  而路线其实是另一条）。分隔符接受逗号 / 顿号 / 空白，匹配顺序是「节点编码（大小写不敏感）→ 节点 id」。
- **参数不合法时清掉上一次的结果**（实测走查发现：留着上一条路线的摘要会被读成「这次算出了这条路」）。

### 9.3 展示

- 摘要五项（里程 / 耗时 / 经停节点 / 经过边 / 算法）由 `routeFactsOf` 产出，单位与小数位只在
  `domain/format.ts` 定一次；
- 节点链用**编码**而不是内部 id（`nodeChainOf`）；不在节点表里的 id 原样显示 ——
  宁可显示一个陌生 id，也不要显示空白让人以为丢了节点；
- 算法文案来自 `domain/labels.ts` 的 `ROUTE_ALGORITHM_LABEL`（「A*（默认，快）」/「Dijkstra（基线，可对照）」）：
  标出默认与基线是这一对选项的全部意义；
- `consistent=false` 的文案必须说清「这是实现缺陷、已记入审计」，**不能**写成「两种方案各有取舍」。

### 9.4 未实现部分如实标注

页面顶部常驻说明「派发预览 / 策略对比 / 应用派发 / 手动指派属 M4，尚未实现 —— 因此这里的路线
不会写进任务的 `routes` 表」。不写这句，使用者会以为规划结果就是任务实际会走的路线。

## 10. 测试清单

| 层 | 文件 | 覆盖 |
| --- | --- | --- |
| 内核 | `shared/src/route-search.test.ts` | 最短路 / 车种速度 / 限速取小 / 自环 / 有向性 / **随机图 A* 与 Dijkstra 逐字段一致** / via 有序 / 拼接不重复 / 三种失败可区分 / 警告触发条件 |
| 构图 | `shared/src/route-graph.test.ts` | 三层排除 / 端点被排除时边也排除 / 原因优先级 / 时间窗半开 / 速度换算 / 空图不产生 NaN |
| 字段规则 | `shared/src/route-rules.test.ts` | 必填 / 枚举 / 缺省算法 / via 三态（缺省、空数组、非法） |
| 领域 | `desktop/src/domain/route/route.service.test.ts` | 五种失败 → 四种 code / 存在性先于构图 / `via` 不可达带 `unreachableVia` / 设置项读缺省算法 / 图变化真的改变结果 / 已存路线读取 |
| 传输 | `desktop/src/ipc/api.route.test.ts` | 三条路由接通 / `route:plan` 权限（monitor 被拒）/ 领域错误透出为信封 / **不发事件** |
| 三层一致 | `renderer/src/api/mock-parity.test.ts` | 同一批请求打 Mock 与主进程：成功逐字段相同、失败 `code` + `message` + `detail` 逐字相同 |
| 渲染 | `renderer/src/route/model.test.ts` · `renderer/src/pages/DispatchPage.test.tsx` · `DispatchPage.error.test.tsx` | 途经点解析 / 载荷构造 / 展示口径 / 规划与对比的交互 / 失败形态与空态 |

写测试时的两条纪律（踩过的坑）：

1. **不要断言等长路线的节点序列**。网格上等长的走法不止一条，A* 与 Dijkstra 选谁由 tie-break 决定，
   不是契约 —— 断言序列相等会把正确实现判成错的（`ISS-064`）；
2. **写用例与读用例分文件**。Mock 的内存表与 `apiClient` 单例在一次页面会话内持续存在，
   同文件里先跑的读用例会被后跑的写用例（建禁行规则）污染（`mock-parity.test.ts` 文件头的同一条纪律）。

## 11. 走查与 DoD

DoD（全部满足才算完成）：

1. `npm test` / `npm run typecheck` / `npm run build` 三端全绿；
2. 真实 Electron：`plan` 结果与 seed 的手算值一致（网格 5 段 × 20 m、AGV 1.5 m/s）；
3. 真实 Electron 的**界面**：选点 → 规划 → 看到摘要与节点链；对比 → 两行 + 一致结论；
4. 浏览器 Mock 与 Electron 对同一批输入给出**逐字段相同**的结果（含失败时的 `detail`）；
5. 控制台错误 0 条。

走查要点（2026-09-26 实测口径）：

- 用 `route:plan` 之外的角色（monitor）打开：侧栏没有入口、页面显示权限提示、按钮禁用、
  **直连 IPC 也被拒**（`AUTH.FORBIDDEN`）—— 前端隐藏只是体验优化，强制在主进程（D-08）；
- 禁用一条边 / 建一条禁行规则后重新规划：路线真的绕开（里程变大），删掉规则后恢复；
- `timed` 类检查：`compare` 的 `consistent` 必须为 `true`（若为 `false` 说明 A* 的启发式不可采纳）。

## 12. 风险与待评审

| 编号 | 问题 | 现状 | 处理 |
| --- | --- | --- | --- |
| Q1 | 途经点上限 `ROUTE_MAX_VIA_NODES` 是**成本护栏**而非业务规则，取值来自实现而非需求 | 已实现（`shared/src/route-rules.ts`） | 待评审：需求未规定上限，取 10 是「每多一个 via 多一次最短路」的成本判断 |
| Q2 | `algo` 域的导入型算法配置（`allowViaNodes` / `maxDetourRatio` / 权重）尚未与运行时收敛 | 契约见 `docs/data-interfaces.md` §6；运行时按 D-12 走常量 | 属导入管线支线，见 `docs/issues.md` 的待评审项 |
| Q3 | `simulated execution` 的**动态重规划**（边被封时自动改道并产生 `route_blocked` 告警） | **未实现** | 属 M7 执行器；M5 只提供「给定图上的最短路线」这个能力 |
| Q4 | 真实地图投影（经纬度 → 平面米制） | 按 D-05 用平面坐标，二期再做转换层 | 不在本模块范围 |

> 本模块**不受** `ISS-017` / `ISS-018` 阻塞：它的输入（节点 / 边 / 规则 / 设置）与错误码都已落地，
> 待评审的是导入管线侧的口径（D-28…D-31、D-35 等）。
