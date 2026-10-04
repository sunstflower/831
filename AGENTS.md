# AGENTS 工作记录与提交纪律

> 本文件是项目根规则文件与**协作工作日志**：任何构建/编码阶段的 git 提交，都必须先在本文件留下完整记录再提交。本文件同时记录项目状态、设计决策、困难与遗留问题。
>
> **文档边界**：本文件只负责「提交纪律、**设计决策编号（D-xx）**、历史问题原始记录、工作日志、项目快照」。
> 其余事实按 [`docs/api.md`](./docs/api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**；
> 文档索引见 [`README.md`](./README.md) 的「文档入口」表。
> 「项目快照 / 验证基线」属 §0 的**带日期实测快照**例外：写明实测日期，下次复测整段更新。

## 项目快照

- **项目**：无人物流调度管理软件（`/Users/sunsetflower/myJobs/js/831`）。
- **阶段**：**首期十个模块（M1-M10）的业务链路全部落地，三层（`shared` / `desktop` / `renderer`）端到端可跑；
  此后各批在此之上做了十二项增强**（①②③④ 属 2026-09-28 第二批，⑤ 属 2026-10-03 第三批，
  ⑥ 属 2026-10-03 第五批，⑦ 属第六批，⑧ 属第七批，⑨ 属第八批，⑩ 属第九批，⑪ 属第十批，
  ⑫ 属第十一批）**：
  ① **车辆接入**（基础数据页可新建车，「所在节点」让车从指定节点出发，新车立即进入调度候选池）；
  ② **调度对比给出了可核对的数字**（执行里程 / 行驶耗时 / 全部完成 / 用车，外加逐项差异文案
  「匈牙利少跑 680 m、少行驶 17 分 53 秒、早 12 分 2 秒完成」）与**按车辆分组的接力清单**
  （同一台车连跑两单：`CAR-01` 先 `T-DEMO-0002` 再 `T-DEMO-0007`，区间不重叠）；
  ③ **告警中心**加了「停滞」列（按状态换措辞：未认领 / 未开始处理 / 未解决）与**批量认领本页待确认**
  （逐条打既有接口，不新增批量端点）；
  ④ **地图数据换成 `data/campus/` 的更复杂校园路网**（30 节点 / 90 条有向边 / 13 站点 / 2 处占道），
  并引入 `edges.weight`（≥ 1 的**耗时**惩罚系数）+ 一份自编拥堵叠加层，让「近但慢」与「远但快」同时存在 ——
  这是「哪个策略更快」不再恒等于 0 的前提（D-54 / D-55）。
  ⑤ **告警中心从「只看过去」扩到「也看未来」**（2026-10-03 本批）：新增 `GET /api/alerts/risks`
  一次扫描给出**三个视图** —— 风险清单（7 类：抢同一台车 / 车跑不了 / 电量撑不到 / 缺路线 /
  预计迟到 / 窗口已过 / 还没排上车）、**任务分配派发区块**（按车辆分组，同一台车的第 2 单即「接力」，
  给出每单的占用区间）、以及还没排上车的缺口。**风险不是告警**：没有 id、不走状态机、不能认领 ——
  「预计会超时」被认领掉毫无意义（D-57）。判据的唯一作者是 `shared/src/plan-risk.ts`，
  主进程与浏览器 Mock 调**同一个函数**。调度中心的派发明细表同时加了**「路线（载货段）」列**
  （`2 段 · 300 m`，无路线时标黄），应用派发后的提示条给出**「在地图上查看这 N 台车」**
  —— 派发结果因此能一键落到地图上（选中车辆 → 地图自动聚焦并高亮其路线）。
  ⑥ **订单派发主链路打通 + 新增「车辆中心」**（2026-10-03 第五批，见
  [`docs/module-M4b-order-flow.md`](./docs/module-M4b-order-flow.md)）：调度中心**内建「新建订单」**
  （复用 M3 表单，创建即 `submit: true` 进待派队列），从而把「建单 → 入池 → 预览策略 → 应用派发 →
  （可选）立即开跑 → 同屏看本批次冲突 / 超时预检」收在**一页之内**；「派发后立即开跑」是**渲染层**
  把 `dispatch/apply` 与逐单 `execution/start` 组合成的带开关流程（契约与权限点不变，D-58），
  逐单结果显式列出（部分失败不掩盖成功部分）；调度中心按「只留主链路」精简，手动指派 / 回收重算 /
  调度日志 / 路径规划收进默认折叠的「高级操作」（折叠≠删除，接口调用与权限判定完全不变）；
  新增**车辆中心 `/fleet`**（运行态读模型：状态分桶 + 车队表格 + 单车抽屉的实时位置 / 当前任务 /
  轨迹折线，D-59）——**不在本页复制车辆 CRUD**，「加车」仍归基础数据页。
  ⑦ **待派任务池扩容 + 对比屏新增两块「差异」呈现**（2026-10-03 第六批，见
  [`docs/seed-dispatch-diversity.md`](./docs/seed-dispatch-diversity.md)）：待派演示任务由 6 条扩到 12 条，
  新任务按「放大哪一种算法差异」设计（只有 1200 kg 车型能拉的重货 / 只有 800 kg 以上能拉的中重件 /
  无人机小件 / 能塞进某台车班次空档的短途件）。调度中心「策略对比」在原有对比表与差异文案之外新增两块：
  **「差异对照（逐指标）」**（推荐策略为基准列，其余列给出带符号差值与更优 / 更差标记，并补
  「单车平均里程 / 平均耗时」抵消「派得少就天然省」）与**「派单差异（同一单派给了不同车）」**
  （列出两边派车不一致的任务，某一方没派就显示「未派发」—— 「贪心把唯一的重货车先用掉、
  重货反而排不进」这一条算法差异因此第一屏就能读到）。两块都是 `renderer/src/dispatch/model.ts`
  的新纯函数 + 只读渲染，**不触碰 `preview` / `apply` 契约、不新增接口或事件**。
  ⑧ **待派任务池再扩容 + 加权综合分与拒绝原因的口径修正**（2026-10-03 第七批，见
  [`docs/seed-dispatch-diversity.md`](./docs/seed-dispatch-diversity.md) §3.1 / §7 / §8）：待派任务 12 → 18
  （新增 3 个「大车不够分」的重货 / 中重件、2 个远距离无人机小件、1 个相邻短途件；**上限 18 是产品约束** ——
  1 演示 + 18 待派 = 19 ≤ 任务列表一页，再多一条就会把演示任务挤到第二页）。
  两处**算法口径修正**：① 加权综合分补上「未派发惩罚」（`compositeScoreOf`，D-60）——
  旧口径只累加已派发计划，18 条待派时把「只派 4 单」的匈牙利算得比「派 9 单」的贪心更省；
  ② 拒绝原因不再取「遍历到的第一个失败车辆」，改按「离能跑还差多少」排序（`mostInformativeReject`，D-61），
  修掉 `ISS-093` 的「十几行全是 AGV-01 不可用」。
  ⑨ **真实 Electron 走查 + 时间窗冲突两种情形分口径**（2026-10-03 第八批）：在 `db:reset` 后的干净库上跑
  `npm run dev:electron`，逐条核对调度中心（18 条待派全选 → 全部（对比）→ 预览）→ 确认第七批的加权综合分 /
  差异对照 / 公式行在真实 `ipc` 形态下逐项一致，并**当场发现 `ISS-095`**：拒绝原因表 9 行的「具体情况」
  全是「预计晚点 0s，超出容忍 0s」—— `TIMEWINDOW_CONFLICT` 一个 code 覆盖两种情形（预计晚点 /
  与该车已排班次占用区间相交），主进程 `explain.ts` 用「有没有 `lateS`」分辨、渲染层 `dispatch/model.ts`
  的同口径副本没有分。**修法是判据上移到产出方**：`shared/src/dispatch-evaluate.ts` 的 `detail.kind`
  （`'late'` / `'occupied'`）+ 共享的 `isLateWindowConflict(detail)`（含旧快照的 `lateS` 回退），
  两处消费方都调它，不再各自反推（与 D-34 / D-55 同一原则：**判据只能有一个作者**）。
  修复后 9 行各说各的真实瓶颈（`AGV-02 在 04:41:22 ~ 04:46:22 已被占用` 等）。
  ⑩ **风险预检按「是否依赖已生效派发」分两节**（2026-10-03 第九批）：此前告警中心那一块叫「任务冲突与超时预检」，
  七类风险平铺成一张表。用户的实际疑问是「一条任务都还没派发，为什么已经在报冲突」——根因是七类里只有五类
  （同车抢占 / 车辆不可用 / 电量不够 / 缺路线 / 预计迟到）由**已生效的派发**算出，另外两类
  （`WINDOW_EXPIRED` 窗口已过、`UNASSIGNED_TASK` 还没排上车）与有没有派发无关；而同一单可能同时命中这两类，
  于是「共 12 条」里只有 9 条不同任务、看起来像「凭空冒出两处冲突」。按用户要求**保留两条、不去重、改为分节**：
  节 1「派发冲突与执行风险」（那五类，**没派发时为空则不渲染**）与节 2「待派与超时缺口」（那两类，
  没派发也会出现）；区块标题改为**「任务风险预检」**，导语明说「先看派发冲突（还没派发就必然是空的），
  再看待派与超时缺口」。**分类判据的唯一作者放进 `shared/src/plan-risk.ts`**
  （`PLAN_RISK_SECTION_OF` / `planRiskSectionsOf` / `PLAN_RISK_SECTION_TEXT`；空节不返回、组内保持扫描顺序、不重排），
  渲染层只按节渲染、不做判断（`ISS-096`）。
  ⑪ **四步主链路端到端实测 + 节 1 可达性结论**（2026-10-04 第十批）：把用户点名的流程
  「调度中心新建订单 → 调度中心对新订单派发 → 告警中心提示冲突 → 地图上车节点运动」在真实
  `ipc` + SQLite 上逐步走完，**四步全部成立**，但发现一条**演示可达性**问题：
  节 1「派发冲突与执行风险」的五类风险里，当前 build 下**只有 `LATE_FINISH` 能由常规操作触发**
  （`VEHICLE_OVERLAP` 被派发前校验挡掉、`VEHICLE_UNAVAILABLE` 的管理白名单只放 `idle`/`disabled`
  而 `disabled` 对 `reserved`/`busy` 会被拒、`BATTERY_RISK` 每单只掉 1–2% 且低电车辆在派发阶段就被拒、
  `PLAN_WITHOUT_ROUTE` 因 `apply` 必建路线而不可达），已登记 `ISS-097`。
  实测同时给出**把节 1 演示出来的可复现配方**（见本批工作日志）：新建一张时间窗只有几分钟的单
  → 派发 → 即可看到 `预计超时` 落在节 1，且该单随后作为 `已超时` 落在节 2（同一单两节各出现一次，
  正是第九批「不去重、分节」要表达的口径）。
  ⑫ **车辆「人工报障」入口 + 共享规则下沉**（2026-10-04 第十一批，`ISS-097` 关闭 · D-62）：给管理接口补上
  唯一一个运行态端点 `fault` —— 白名单与冲突判定（`disableOccupied` / `faultRunning`）下沉到
  `shared/src/base-rules.ts`，主进程领域服务与浏览器 Mock **共用同一个函数**（顺带消掉了 Mock 侧那份重复白名单）；
  基础数据页车辆行多了「标记故障 / 恢复可用」，审计动作 `fault` 与 `disable` 分开。**护栏**：`busy`
  （执行器正在驱动）的车既不能停用也不能报障（否则「故障车还在跑」），`reserved`（已派发未开跑）**可以**报障
  —— 那正是改派代价最低的时刻。于是用户点名的第三步「告警中心对新订单的冲突进行提示」有了**一次点击**就能
  看得到的入口（演示数据**不带**常驻冲突，避免回到 `ISS-096`）。
  此前的 M2（六类主数据读写）· M3（任务状态机 11 动作）· M4（调度全链路）· M5（A* / Dijkstra + 途经点 + 禁行）·
  M6（React Flow 地图，含共点图层避让 D-42）· M1（用户维护）· M7（监控读模型 + 模拟执行器）·
  M8（告警五态闭环）· M9（审计查询与 CSV 导出）· M10（schema 驱动设置页）保持可用。
  未做（明确属二期或已登记）：四类数据文件的**导入管线**、M3 批量导入、M2 详情接口、订单端点图层。代码已落地三端：
  - `shared/`：**本轮新增 `campus-map.ts`（`data/campus/` 原生 5 文件 → 内部节点的唯一翻译层：列名 / 单位 / 派生字段，
    纯函数无 IO；含拥堵叠加层与「障碍物 → 封路 or 权重×2」的车道数判据）· `seed-data.ts`（`buildSeedDataset()`：
    路网 / 站点 / 车辆 / 模板 / 演示任务与路线的**唯一**推导处，seed 与浏览器 Mock 共用，D-55）** ·
    枚举 · 类型（含 `MapOverview` 系列快照契约、**M5 的 `RoutePlan` / `RouteCompare*` / `RouteDetail`**、**`edge.weight` 与可空的车辆 `x`/`y` + `currentNodeId`**）· **错误目录 `ERROR_CODES` 126 条**（36 运行时 + 90 导入域；**唯一登记处**，见 D-33；本批新增 `ROUTE.NOT_FOUND`）· 常量（含 `SEED_IDS` 演示任务/路线/告警）· **`base-rules.ts`（M2 六类资源的字段规则唯一作者，D-44）** · **`task-state.ts`（任务状态机唯一作者：11 个动作、`Record` 化迁移表、`checkTaskTransition`、`TASK_EDITABLE_STATUSES`；主进程 / Mock / 任务页三处共用）** · **`task-rules.ts`（任务字段规则唯一作者，创建与编辑共用同一对跨字段纯函数）** · **M5 路径内核（`route-search.ts`：图模型 + `MinHeap` + A*/Dijkstra 共用框架 + via 分段拼接与警告；`route-graph.ts`：`buildRouteGraph` 三层排除 + `ROUTE_DEFAULT_SPEED_MPS`；`route-rules.ts`：`validateRouteInput` + `ROUTE_MAX_VIA_NODES`。**纯函数、无 IO**，是主进程与浏览器 Mock 的**同一份**实现，D-49）· `edge-code.ts`（边编码唯一作者，禁行规则的目标编码也走它）· **M4 调度内核：`dispatch-types.ts`（快照类型与算法常量）· `dispatch-evaluate.ts`（占用区间 + 六步评估 + 代价函数）· `dispatch-strategies.ts`（贪心 + 匈牙利，含 `solveAssignment`）· `dispatch.ts`（分派入口）—— **纯函数、无 IO**，与 M5 内核同一处置（D-49 / D-51）** · **调度三张词表（`DISPATCH_STRATEGY_LABELS` / `REJECT_REASON_LABELS` / `DISPATCH_LOG_ACTION_LABELS`，唯一作者，D-52）**。
  - `desktop/`：`node:sqlite` 连接（`createRequire` 惰性加载，见下）· 迁移（**0001 + 0003 + 0004 + 0005**，
    见 D-46 / D-54；`0005_edge_weight.sql` 给 `edges` 加 `weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 1)`）·
    seed（**改为「取数（读 `data/campus/`）→ 推导（`buildSeedDataset()`）→ 落库」三步，本文件里没有业务数字**；
    含演示执行数据与一批演示待派发任务，后者的时间窗跟着当前时刻刷新）· `db/campus-map-source.ts`（Node 侧取数）· **IPC Router（鉴权/权限/`traceId`，支持 `method` 与 `:name` 路径参数，D-43）** · 会话 · 审计 · **事件总线（按会话权限过滤，D-32）** · **65 条路由**：health / auth×3 / settings×2 / users / map.overview / **M7 轨迹 `GET /api/map/tracks/:vehicleId`** / **M2 读列表×6 + 写路径×13** / **M3 任务×6**（列表 · 详情 · 创建 · 编辑 · `POST :id/:action`（六类状态操作共用一段）· `DELETE :id`）· **M5 路径×3**（`POST /api/routes/plan` · `POST /api/routes/compare` · `GET /api/routes/:id`，权限 `route:plan`，**三条都不发事件** —— 规划是只读计算，没有数据变化） · **M4 调度×6**（`GET /api/dispatch/strategies` · `POST /api/dispatch/preview` · `POST /api/dispatch/apply` · `POST /api/dispatch/manual-assign` · `POST /api/dispatch/recompute` · `GET /api/dispatch/logs`；三条写路由**显式 `method: 'POST'`**，见 `ISS-066` 教训。事件只由写路径发：apply / manual-assign 发 `task.changed` + `vehicle.changed` + `map.updated`，recompute 发同三条，**preview / strategies / logs 一律不发** —— 预览只写一条调度日志，世界没有变化）—— 写接口一律经领域服务（事务 + 审计 + 跨表校验），**任务的状态操作暴露面派生自状态机**（`TASK_API_ACTIONS - {delete}`，未登记动作按「没有这条路」处理） · **M1 用户维护×4**（列表 / 新增 / 更新 / 重置密码；两条护栏「不能停用最后一个启用的管理员」「不能停用当前账号」在服务端，
    字段归属随调用点走，故前端能把红框标在正确的控件上）· **M7 监控×3**（`monitor/overview` / `tasks` / `vehicles`；
    两条列表复用 `listTasks` / `listVehicles` 后补字段，不复制 SQL）· **M7 执行×2**（`execution/tasks/:id/start` / `takeover`；
    状态迁移复用 `operateTask`，遥测与轨迹写在**另一个**事务里 —— `tx()` 不支持嵌套）· **M8 告警×5**（列表 / 详情 / 认领 / 解决 / 归档；
    迁移表与「某状态可有哪些操作」都取自 `shared/src/alert-state.ts`）· **M9 审计×2**（查询 / 导出；导出把
    「文件名 + 正文」放进 `data` —— 本地 IPC 形态没有响应头可放 `Content-Disposition`）· **M10 设置写×1**（PATCH 只改提到的键、整批校验后才写）；
    `repositories/` 另有 **`monitor.repo.ts` / `execution.repo.ts`（轨迹采样与遥测）**、
    `domain/` 另有 **`user/`（`user.service.ts`）· `alert/`· `audit/`· `monitor/`· `settings/`（`settings.service.ts`）·
    `execution/executor.ts`（M7 本地模拟执行器，D-10：`tick()` 是纯推进、`startTimer()` 只管调度，因此可被逐帧断言；
    `adoptRunningTasks()` 把上次进程退出时仍在跑的任务接回内存续跑）**；
    路由清单与条数以 `docs/api.md` §3 为准，此处只记实测条数；`repositories/` 下 `map.repo.ts`（快照读取层）、**`site` / `vehicle` / `graph` / `restriction` / `template`（M2 读 + 写 + 引用计数）**、**`task.repo.ts`（列表 / 详情四块 / 状态写入 / 计划作废 / 物理删除）** 、**`route.repo.ts`（按 id 查路线 / 写路线 / 读全量图 `listGraphNodes` · `listGraphEdges` / 读禁行规则 —— 构图必须读全量，不能走分页列表）** 与 **`dispatch-plan.repo.ts` / `dispatch-log.repo.ts`（M4：计划写入 + 三处乐观锁 `…If` + 占用槽查询 + `hasOtherActivePlanForVehicle`；日志写入 + 存档读取 + 分页筛选）**；`domain/` 下 `base/`（六个服务）、**`task/task.service.ts`**、**`route/route.service.ts`（`planRoute` / `compareRoutes` / `getRoute`，五类失败原因 → 四个错误码）** 与 **`dispatch/`（`snapshot.ts` 组装 `DispatchSnapshot` · `explain.ts` 人读文案 · `dispatch.service.ts` 五个方法 `preview` / `apply` / `manualAssign` / `recompute` / `listDispatchLogs` + `listStrategies`）**。
  - `renderer/`：**入口与业务代码齐全，并已沉淀两层共用地基（D-36）** —— `src/main.tsx`（HashRouter，Electron `file://` 必需）、三层适配器（mock / ipc / http，**M4 的 Mock 存储 `api/mock-dispatch.ts` 复用 `shared` 同一份内核**，与主进程逐项对齐由 `mock-dispatch.test.ts` 守）、zustand store（session / selection）、路由与页面（**现代化外壳 + 监控工作台 + 登录页 + 基础数据（M2 读写）+ 任务管理（M3）+ 调度中心（M4 调度台 + M5 路径规划）+ 告警中心（M8）+ 审计日志（M9）+ 系统设置（M10）+ 用户管理（M1）** + 地图；`PlaceholderPage` 与 `app/modules.ts` 的 `PLANNED_MODULES` 保留给下一个模块，**当前没有任何路由指向占位页**）、**React Flow 地图**（`map/` 下 model / nodes / edges / hooks / stage / panels / style 全套；**本轮新增轨迹回放面板**，实时位置与历史折线分开显示）·
    **本轮的展示层增强**：`dispatch/`（对比表加「执行里程 / 行驶耗时 / 全部完成 / 用车」四列 + 差异文案 + **按车辆分组的接力清单** + 本批新增的 **`metricComparisonOf`（逐指标差异对照）** 与 **`assignmentDiffsOf`（同一单派给了不同车）**）、
    `ops/model.ts`（告警「停滞」话术与批量认领的纯函数）、**`ops/RiskTable.tsx`（本批从 `RiskPanels` 抽出的预检表，供告警中心与调度中心共用）**、`map/edges/NetEdge.tsx`（从 `data` 派生视觉标志类）、**设计系统**（`styles/theme.css` 令牌 + `styles/ui.css` 共用基元）、**信息架构**（`app/modules.ts`）、**跨模块共用层**（`domain/labels.ts`）、**监控工作台**（`dashboard/`）、**基础数据模块**（`base/`）、**任务模块**（`task/`）与**路径规划面板**（`route/`）；
    另有 **首屏声明**（`index.html` 内联图标 + 深色 meta，D-37）与**弹层键盘语义**（D-38）；
    **基础数据页自本批起为六个页签**（站点 / 车辆 / 路网节点 / 有向边 / 禁行规则 / 任务模板），
    禁行规则与任务模板各自的「契约不对称」都体现在界面上（前者无启停、有二次确认删除；后者只有编辑）。
    **`/tasks` 自本批起是真实的任务管理页（M3）**：九列列表 + 四个筛选项 + 新建 / 编辑弹层（套模板、
    `datetime-local` 时间窗）+ 按状态渲染的状态操作按钮 + 原因必填的二次确认层 + 只读详情（计划 / 路线 /
    告警 / 最近操作），写能力按 `task:write` 开关 —— 模块代码在 `renderer/src/task/`（model / form / actions /
    两个弹层 / style），公共机制见下一段。
    **`/dispatch` 自本批起是完整的调度中心（M4 调度台 + M5 路径规划，上半改数据、下半只读试算）**：
`pages/DispatchPage.tsx` 分两个区块 —— 上「调度台」`dispatch/DispatchConsole.tsx`（待派任务勾选与全选、
策略单选四项（贪心 / 匈牙利 / 遗传预留 / 全部对比）、预览派发、推荐结论条、策略对比表与逐策略派发明细、
拒绝原因表、手动指派、回收重算、底部跨栏日志面板 `DispatchLogPanel.tsx`），下「路径规划（试算）」
`route/RoutePlanner.tsx`。应用派发走 `dispatch/ConfirmDispatchDialog.tsx` 二次确认（逐条列「任务 → 车辆」+ 预计完成时刻，
**并单独列出被拒的**）；展示口径全部由 `dispatch/model.ts` 的纯函数产出（D-48），日志面板服务端筛选 + 分页，
订阅 `task.changed` / `vehicle.changed` 自动刷新。
**区块顺序与那句说明是有意的**：调度台会改数据、路径规划不会，因此「先调度、后试算」，
并写明「任务实际使用的路线要等『应用派发』才写进 `routes` 表」——
否则使用者会以为规划出来的路线就是任务会走的路线（页面级自检断言了这句话的存在）。
模块代码在 `renderer/src/dispatch/`（model / DispatchConsole / ConfirmDispatchDialog / DispatchLogPanel / style）。
**`/dispatch` 的路径规划部分（M5）**：`route/RoutePlanner.tsx` ——
    起终点 / 途经点（`N01` 这类编码，大小写与顿号分隔都认，**认不出的词全部报出来**）、算法选择、
    规划摘要 + 节点链（用编码显示）+ 警告、A*/Dijkstra 对比表与「一致 / 不一致」结论；
    这一页**常驻**一行说明「规划只预览、不落库，路线在应用派发时写入 `routes` 表」，
    因为「规划出来的路线 ≠ 任务实际路线」；
    模块代码在 `renderer/src/route/`（model / RoutePlanner / style），展示口径见 `docs/module-M5-route.md` §9。
    **参数不合法时清掉上一次结果**（否则旧摘要会被误读成对当前输入的答案）—— 这是走查发现后补的。
    **公共机制自本批起归 `renderer/src/domain/*` + `api/usePagedList.ts` + `api/useApiWrite.ts` + `styles/ui.css`（D-47）**：
    原来的 `base/model` · `base/form` · `base/useBaseDataList` · `base/useBaseDataWrite` 已上移并改名，
    类名前缀由 `udm-base__*` 上收为 `udm-list__*`，`base/style/base.css` **已删除**（内容全属公共部分）。
    测试侧新增 `app/index-html.test.ts`（首屏护栏）、`components/AppLayout.test.tsx`（导航权限过滤）、
    `components/UserMenu.test.tsx`（弹层键盘）、`styles/classnames.test.ts`（类名 ↔ CSS，D-39）、
    `pages/BaseDataPage.test.tsx` · `pages/BaseDataPage.write.test.tsx` 与 `base/model.test.ts` ·
    `base/form.test.ts`（M2 读写页与写表单载荷口径）、
    **`map/model/layout.test.ts`（共点图层不遮挡的不变量，D-42）**、
    **任务模块五个测试文件**（`task/model` · `task/form` · `task/actions` · `pages/TasksPage`（读）·
    `pages/TasksPage.write`（写））与**新抽公共机制的四个**（`domain/format` · `domain/paging` ·
    `domain/labels` · `domain/tone` —— 后者**直接读 CSS 核验类名存在**，D-48），
    **路径规划的三层测试**（`shared/src/route-search` · `route-graph` · `route-rules` 各一份、
    `desktop/src/domain/route/route.service.test.ts` · `desktop/src/ipc/api.route.test.ts`、
    `renderer/src/route/model.test.ts`，以及 `mock-parity.test.ts` 新增的 7 例 M5 一致性），
    以及**仓库级** `tests/docs.test.ts`（文档不变量：边界行 / 路径存在 / 索引一致，`tests/` 首次纳入
    `vitest.config.ts` 的 `include`）。
  - `npm run build` 与 `npm test` 均已通过（详见「验证基线」）。
- **形态**：本地优先桌面应用 —— Electron 主进程（SQLite + 领域服务 + 算法）+ React 渲染层 + 三层服务适配器（IPC / 本地 HTTP / Mock）。
- **技术栈（`node_modules` 实测版本）**：Electron 44.3.0 · React / React-DOM 18.3.1 · **`@xyflow/react` 12.11.6（仅 renderer；见 D-21）** · react-router-dom 6.30.6 · **Vite 6.4.3（renderer 独立安装）+ Vite 5.4.21（根，Vitest 侧）** · TypeScript 5.9.3 · **Node 内置 `node:sqlite`（见 D-14，非 better-sqlite3）** · zustand 5.0.15（`@xyflow/react` 另带嵌套 zustand 4.5.7，两者并存、互不影响）· Vitest 2.1.9 · bcryptjs 2.4.3 · @testing-library/react 16.3.3 · **@testing-library/jest-dom 6.10.0** · jsdom 25.0.1 · concurrently 9.2.4 · wait-on 8.0.5；运行时 Node v25.8.2 / npm 11.11.1。
- **仓库状态**：已完成 `git init`。提交序列 `e9a6100` → `64d9eea`（`地图 build`，68 文件）→
  `a22ae16`（`all build`，207 文件）→ `fef52a6`（`f build`，2026-09-28 第二批 + 2026-10-03 第三批）→
  **`2f33ac4`（`use1`，59 文件 / +5326 行，覆盖 2026-10-03 的第四 ~ 第九批：术语改名 · 订单派发主链路与车辆中心 ·
  对比屏差异 · 待派扩容与加权综合分口径 · Electron 走查与 `ISS-095` · 风险预检分节与 `ISS-096`）**。
  - 五笔提交全部由**使用者本人**提交（2026-09-26 / 2026-09-28 / 2026-10-03 / 2026-10-04），各把此前积压的一批改动合成一笔。
    **如实记录与纪律的偏差（连续第四笔）**：① commit message 均未按第 6 条的
    `类型(模块): 摘要` 格式（`地图 build` / `all build` / `f build` / `use1`）；② 多批互不相关的改动
    （M2…M10 / 设计系统 / 文档回写 / 复杂地图与边权 / 风险预检 / 订单主链路 / 车辆中心）被合成一笔，
    事后无法用 `git log` 分辨。`2f33ac4` 一笔吃掉**六批**（其中第四批还是一次跨端术语改名），
    落款信息不可用 —— 这也是本项目坚持「提交前先把范围、验证、遗留写进本文件」的原因：
    **提交信息可以丢，日志不会**。
  - ✅ **工作区仅剩文档改动**：第四 ~ 第九批已随 `2f33ac4` 进入版本控制；**第十批**（文档类）与
    **第十一批（本批：车辆人工报障 + 文档）**尚未提交（`AGENTS.md` / `docs/issues.md` 及本批源码改动）。
  - **已提交各批的内容摘要（备查）**：
    - **第四批（术语改名）**：把界面上的「代价」改称「加权综合分」（`COST_METRIC_LABEL` 唯一作者），
      涉及 `renderer/src/domain/labels.ts` · `renderer/src/dispatch/*` ·
      `renderer/src/task/TaskDetailDialog.tsx` · `desktop/src/domain/dispatch/*` ·
      `renderer/src/api/mock-dispatch.ts` · `docs/api.md` · `docs/module-M4-dispatch.md` ·
      `docs/issues.md`（含新登记的 `ISS-087`）。
    - **第五批（订单派发主链路 + 车辆中心）**：`shared/src/*` **未改动**（无新接口 / 无新事件 /
      无新错误码 / 无新权限点）；改动集中在 `renderer/src/`（`dispatch/` 新增 `NewOrderDialog` ·
      `applyFlow` · 两个用例文件；`DispatchConsole` / `DispatchPage` 重排；新增 `fleet/` 目录与
      `pages/FleetPage.tsx`；`ops/` 抽出 `RiskTable` 并加 `filterRiskReport`）、`app/` 导航与路由、
      `domain/tone.ts`（`VEHICLE_STATUS_TONE` 上移）、`docs/`（新建 `module-M4b-order-flow.md`，
      回写 `design.md` / `api.md` §0 / `README.md` / `issues.md`）与本文件。
    - **各批的 `AGENTS.md` 日志与 `docs/issues.md` 均已同步**（第四/五批同步于当时的日志，第六/七/八/九批同理）。
  - `package-lock.json` 已纳入版本控制；开发库 `desktop/.data/app.db` 被 `.gitignore` 的 `.data/` / `*.db` 排除
    （`data/campus/` 例外 —— 它是**源数据**而不是运行产物，因此必须在版本控制里）。

- **验证基线（2026-10-03 实测·第七批：待派再扩容 + 加权综合分 / 拒绝原因口径修正）**：
  - ✅ `npm test`（**空载**）：**98 个套件 / 1084 个用例全通过**。本轮新增 / 改动用例：
    `shared/src/dispatch-evaluate.test.ts` +3（`compositeScoreOf` 的算术、惩罚上界、单调性）、
    `shared/src/dispatch-greedy.test.ts` +2（拒绝原因两个方向的反例）、
    `desktop/src/domain/dispatch/dispatch.service.test.ts` +1（按真实 seed 数据穷举 `max(plan.cost)`，
    断言惩罚更大 —— 地图变大或惩罚调小时它先红）；
    `renderer/src/dispatch/DispatchConsole.test.tsx` 的「差异对照」用例 +2 条断言（公式文字与惩罚常量在表下出现）。
  - ✅ `npm run typecheck` 三 workspace exit 0；`npm run build` 三端通过；`npx vitest run tests/docs.test.ts` 8 条通过。
  - ✅ `npm run db:reset`：`tasks:19`（1 条演示执行 + **18 条待派**）、`vehicles:5`、`nodes:30`、`edges:90`。
  - ✅ **两策略实测**（真实 SQLite + 主进程内核，18 条待派一起跑）：
    贪心**派 9 / 拒 9**，已派发代价 3146、**加权综合分 35546**、执行里程 3760 m、执行时长 1666 s；
    匈牙利**派 4 / 拒 14**，已派发代价 1256、**加权综合分 51656**、执行里程 1950 m。
    旧口径（只加已派发）下匈牙利 1256 < 贪心 3146 —— 会推荐「少干 5 单活」的一方；
    新口径下贪心少 16110 分，与「多派 5 单」一致。
    （行内数字为本机一次实跑，随预览时刻有百级漂移；判定依据是「两策略指派数不同」与 `mock-parity.test.ts` 的结构断言，不是这些具体数值。）
  - ✅ **拒绝原因**：贪心拒绝的 9 条全部指向真实瓶颈（占用区间冲突），
    不再出现「十几行都是 AGV-01 不可用」的形态。
  - ℹ️ 本轮的 Electron 目视核对**已由第八批补做**（下一条基线）：走查确认「加权综合分」
    两行、差异对照、公式说明在真实 `ipc` + SQLite 形态下与上述数值逐项一致，
    并因此发现 `ISS-095`。

- **验证基线（2026-10-03 实测·第八批：真实 Electron 走查 + 时间窗冲突两种情形分口径）**：
  - ✅ `npm test`：**98 个套件 / 1085 个用例全通过**（第七批 1084 + 本批新增 1 条
    `renderer/src/dispatch/model.test.ts` 的「晚点 / 被占用」回归）；`npm run typecheck` 三 workspace exit 0；
    `npm run build` 三端通过；`npx vitest run tests/docs.test.ts` 8 条通过。
  - ✅ **`npm run dev:electron` 真实走查**（`ipc` 适配器 + 真实 SQLite，`db:reset` 后的干净库）：
    登出状态 → `admin/admin123` 登录 → 调度中心「待派任务（18）」→ 全选 → 「全部（对比）」→ 预览派发。
    界面读数与第七批的实测**逐项一致**：推荐语「推荐『贪心』：指派 9/18，加权综合分 35546.0，
    比『匈牙利』多派 5 单」；对比表贪心 `9/18 · 拒 9 · 3760 m · 52 分 26 秒 · 35546.0`、
    匈牙利 `4/18 · 拒 14 · 1950 m · 20 分 56 秒 · 51656.0`；差异对照「加权综合分 +16110.0」；
    表下公式行「加权综合分 = Σ 已派发计划的加权代价 + 未派发单数 × 3600（未派发惩罚）；被拒任务不再记 0 分。」
  - ✅ **走查当场发现并修掉 `ISS-095`**：修复前拒绝原因表 9 行的「具体情况」全是
    「预计晚点 0s，超出容忍 0s」；修复后每行各说各的真实瓶颈 ——
    `T-DEMO-0005 AGV-02 在 04:41:22 ~ 04:46:22 已被占用`、`T-DEMO-0008 CAR-02 在 04:39:02 ~ 04:42:22 已被占用`、
    `T-DEMO-0014 CAR-02 在 04:37:22 ~ 04:41:26 已被占用` …（9 行各不相同，指向被占住的那台车与该时段）。
  - > 这条基线是**目视核对**，不是自动断言：数值随预览时刻有百级漂移，
    「两策略指派数不同」「9 行拒绝原因不是同一句」才是可复核的判定依据。

- **验证基线（2026-10-03 实测·第九批：风险预检按是否依赖派发分两节）**：
  - ✅ `npm test`（**空载**）：**98 个套件 / 1091 个用例全通过**（第八批 1085 + 本批新增 6 条 ——
    `shared/src/plan-risk.test.ts` +5：每个 kind 都有归属且两节都非空 / 五类归派发节、两类归待派节 /
    只有待派时不出派发节 / 同一单两类并存**不去重** / 两节顺序与组内顺序保持扫描顺序；
    `renderer/src/pages/AlertsRisk.test.tsx` +1（`ISS-096` 回归：只待派时**只有**「待派与超时缺口」节标题、
    **不出现**「派发冲突与执行风险」）；另改 2 处 `aria-label` 与 1 处「还有 N 条」→「其中 N 条」断言。
  - ✅ `npm run typecheck` 三 workspace exit 0；`npm run build` 三端通过
    （renderer JS 722.21 kB / gzip 224.43 kB、CSS 79.56 kB / gzip 12.94 kB）；
    `npx vitest run tests/docs.test.ts` 8 条通过。
  - ✅ **`npm run dev:electron` 真实走查**（`ipc` + SQLite）：`admin` 登录 → 调度中心 → 全选 9 条待派 →
    「全部（对比）」→ 预览（贪心 6/9 · 加权综合分 12866.0 · 3080 m；匈牙利 4/9 · 19136.0 · 2100 m；
    差异 +6270.0；3 行拒绝原因各说各的、`被占用` 句里不出现「晚点」—— 第八批修复仍生效）→
    点「应用这 6 条派发」→ 确认框（列 6 条生效 + 3 条不派发）→ 确认 → 提示「已派发 6 单（贪心），
    6 单已开始执行」→ 转告警中心。
  - ✅ **分节实测**：告警中心「任务风险预检」显示 **「共 3 条 · 需留意 3」**，只渲染 **节 2「待派与超时缺口」**
    （3 行全为「未派发」：T-DEMO-0014 / 0015 / 0016），**节 1「派发冲突与执行风险」按设计不渲染** ——
    这批贪心计划本身无冲突（同屏「本批次预检」也显示「没有发现冲突或超时」），恰好演示了「空节不显示」；
    导语的两节说明、结尾行「其中 3 条完全没有安排车辆」与「去调度中心派发」链接均在位。
  - > 这条是**目视核对**：读数取自一次真实走查，判定依据是「分节标题出现 / 空节不出现」，
   而不是上面的具体条数（随预览时刻与派发批次变化）。

- **验证基线（2026-10-04 实测·第十一批：车辆人工报障 / 节 1 可达性修复）**：
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ **定向用例全绿**（本批新增 / 修改的四个面）：
    `shared/src/base-rules.test.ts` + `desktop/src/domain/base/base.service.test.ts` +
    `renderer/src/base/form.test.ts` = **118 passed**（含白名单、冲突判定、报障 / 恢复 / 幂等 / `busy` 被拒 / 审计动作）；
    `renderer/src/api/mock-parity.test.ts` + `renderer/src/pages/BaseDataPage.write.test.tsx` = **58 passed**
    （含「执行中报障两边同码」与「报障 → 恢复成功路径两边一致」）；
    `desktop/src/domain/alert/risk.service.test.ts` = **9 passed**（含新增的**端到端演示路径**：
    派发一单 → 报障 → 再扫描，`VEHICLE_UNAVAILABLE` 落在节 1）。
  - ✅ `npm run build`：三端通过；renderer 产物 `index.html` 1.94 kB + CSS 79.56 kB（gzip 12.94 kB）+
    JS 723.07 kB（gzip 224.65 kB）—— JS 比第十批（722.21 kB）**+0.86 kB**，即本批新增的行内按钮与共享规则的体积。
  - ✅ `npx vitest run tests/docs.test.ts`：8 条通过（文档结构 / 表格块 / 围栏 / ISS 引用闭环）。
  - ℹ️ `npm test` 全量未在本批复跑（`ISS-068` 的偶发负载超时与本批无关；定向执行结论见上）。
  - ✅ 契约闭环：**未新增任何错误码**（白名单越界复用 `VALIDATION.FAILED`、两类冲突复用
    `VEHICLE.STATE_CONFLICT`，具体原因放 `detail.reason`）—— 故 `errors.catalog.test.ts` 的文档闭环无需变更。

- **验证基线（2026-10-04 实测·第十批：四步主链路端到端 + 节 1 可达性）**：
  - ✅ **四步主链路在真实 `ipc` + SQLite 上逐步走通**（`db:reset` 后的干净库，`npm run dev:electron`，
    `admin/admin123`）：
    1. **新建订单**：调度中心「新建订单」建出 `T20261004-0001`（ST04 → ST11 · 普通 · 180 kg），
       toast「已新建订单…并提交到待派队列」，待派 `18 → 19`、新单**被自动勾选**、策略默认「贪心」；
    2. **派发**：`预览派发` → 「本次只跑了『贪心』：指派 1/1」、`加权综合分 260.0`、执行里程 450 m、
       指派车辆 `CAR-01` → `应用这 1 条派发` → 确认框 → 「已派发 1 单（贪心），1 单已开始执行」（`派发后立即开跑` 默认勾选）；
    3. **告警中心**：「任务分配派发」区块出现 `CAR-01 · 单趟 · T20261004-0001 … 执行中`；
    4. **地图车节点运动**：CAR-01 坐标 `300,384 → 450,300` 推进，`vehicle_tracks` 由 21 行增至 129 行，
       两张相隔 6 s 的截图 diff 出 238 个强差异像素（车辆标记位移）；任务端点进度 `0% → 100%`。
  - ✅ **节 1 用真实数据渲染出来**（本批补上的关键一环）：`T20261004-0005`（时间窗末端
    `01:50:50`，计划完成 `01:53:05`）→ 界面读数「任务风险预检：**共 9 条 · 必须处理 2 · 需留意 7**」，
    节 1「派发冲突与执行风险」**共 1 条 · 需留意 1**（`T20261004-0005 预计完成时间比时间窗末端晚 135 秒`，
    车辆 CAR-01），节 2「待派与超时缺口」**共 8 条 · 必须处理 2 · 需留意 6**
    （`T20261004-0004 / 0005` 为 `已超时`，其余为 `未派发`）。
    同一张单在节 1（预计超时）与节 2（已超时）各出现一次 —— 与第九批「保留两条、不去重」的设计一致。
  - ⚠️ **发现 `ISS-097`（待办，展示可达性）**：节 1 五类里四类在常规操作下不可达（原因见快照 ⑪），
    演示脚本若只按「新建 → 派发」走，看到的**永远只有节 2**；要展示节 1 必须用「短时间窗」配方。
  - ✅ 本批**没有改任何产品代码**（唯一的动作是用 `desktop/dist` 里的领域服务在库里造了一张
    迟到验证单，用于让节 1 出现真实数据），但改动落到 `AGENTS.md` / `docs/issues.md`，因此把三端验证照跑了一遍：
    `npm run typecheck` 三 workspace exit 0；`npm run build` 三端通过
    （renderer JS 722.21 kB / gzip 224.43 kB、CSS 79.56 kB / gzip 12.94 kB，与第九批一致）；
    `npx vitest run tests/docs.test.ts` 8 条通过。
  - ⚠️ **`npm test` 在负载下再现 `ISS-068`**：全量跑出 `5 failed / 93 passed（13 个用例失败）`，
    失败信息**清一色是 `Test timed out in 5000ms`**（没有一个断言失败）；失败文件集合**每次运行都不同**
    （三次分别是 `BaseDataPage.write` / `TasksPage.write` / `DispatchPage` / `DispatchPage.error` / `mock-parity` 的不同子集）。
    **把失败文件单独复跑全部通过**：`TasksPage.write + BaseDataPage.write` 27/27、
    `DispatchPage + DispatchPage.error + BaseDataPage.write` 25/25、`mock-parity` 38/38。
    与本表 2026-10-03 那条记录同因（并行 + 高负载把 5 s 超时窗口挤爆），**不是本批引入的回归**。
    ⚠️ 注意 `mock-parity` 也出现在失败集合里 —— 它比对的正是「两个适配器必须逐字段相同」，
    失败形态容易误读成「Mock 与主进程不一致」；判定看**失败消息是不是 timeout**。

- **验证基线（2026-10-03 实测·第六批：待派任务扩容 / 差异对照 / 派单差异）**：
  - ✅ `npm test`（**空载**）：**98 个套件 / 1078 个用例全通过**（第六批新增两处：`DispatchConsole.test.tsx`
    ＋2 条渲染断言、`dispatch/model.test.ts` ＋4 条纯函数断言／改 1 条旧断言为「取第一张表」；
    `AlertsRisk.test.tsx` 的待派编码与条数改为**从任务列表接口读**，不再硬编码 6 条）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 1.94 kB + CSS 78.98 kB（gzip 12.88 kB）+
    JS 719.21 kB（gzip 223.42 kB）。
  - ✅ `npm run db:reset`：迁移 `1, 3, 4, 5`；seed 落 `nodes:30 · edges:90 · sites:13 · restrictions:2 ·
    vehicles:5 · templates:2 · users:3 · settings:9 · tasks:13 · routes:1 · alerts:1`（13 = 1 条演示执行 + 12 条待派）；
    复跑幂等。
  - ✅ **调度对比实测（真实 SQLite + 主进程内核，12 条待派任务一起预览）**：
    - 贪心 `9/12`（拒 3，接力 5 单，执行里程 `3310 m`，行驶耗时 `40 分 42 秒`，全部完成 `04:05:11`，
      加权综合分 `2442.4`）；
    - 匈牙利 `4/12`（拒 8，执行里程 `2100 m`，行驶耗时 `23 分 26 秒`，全部完成 `04:02:51`，
      加权综合分 `1406.0`）；
    - 差异文案「匈牙利更优的地方：少跑 1210 m、少行驶 17 分 16 秒、早 2 分 20 秒完成」；
    - 「单车平均里程」贪心 `368 m` < 匈牙利 `525 m` —— 合计偏向派得少的一方，平均值把话说回来；
    - 「派单差异」列出 **9 行**不一致，其中 `T-DEMO-0008`（唯一的重货）**贪心未派发、匈牙利 CAR-02**：
      贪心把唯一能拉 900 kg 的车先用在了普通件上，重货反而排不进 —— 这正是本轮要让它「看得见」的差异。
      （行内数字来自本机一次实跑，随机器与当前时刻略有出入；判定方式是「两策略的指派数 / 拒绝数必须不同」
      与 `mock-parity.test.ts` 的结构断言，不是这些具体数值。）
  - > 本轮改动只涉及 `shared/src/seed-data.ts` 的数据、`shared/src/constants.ts` 的 id 清单与
    `renderer/` 的展示层；未重跑 Electron 端到端走查与 `npm run dev`（第五批的走查结论仍以那一节的日期为准，
    其「候选池 6→7」等数字属**当次** 6 条待派任务的实测）。

- **验证基线（2026-10-03 实测·第五批：订单派发主链路 / 派发即开跑 / 车辆中心）**：
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 1.94 kB + CSS 78.35 kB（gzip 12.75 kB）+
    JS 713.25 kB（gzip 221.79 kB）。
  - ✅ `npm run db:reset`：迁移 `1, 3, 4, 5`；seed 落 `nodes:30 · edges:90 · sites:13 · restrictions:2 ·
    vehicles:5 · templates:2 · users:3 · settings:9 · tasks:7 · routes:1 · alerts:1`；复跑幂等。
  - ✅ `npm test`（`npx vitest run`，**空载**）：**98 个套件 / 1072 个用例全通过**（13 s）。
    同一天在**负载下**复跑过两次，看到的是既有 `ISS-068`（并行负载下偶发超时，原因未定位）的真实形态：
    Electron 正在运行（执行器每秒推遥测）时 **21 条超时**、杀掉进程后同一份代码 **3 条超时**
    （`BaseDataPage.write` 2 + `TasksPage.write` 1），而那 3 条**单独复跑 27/27 全绿（1.6 s）**；
    两次失败的用例各不相同，失败信息都是 `Test timed out in 5000ms`。三行样本已记入
    `docs/issues.md` 的 `ISS-068`。**结论：本批未引入新失败；这条基线必须在空载下读。**
  - ✅ **Electron 端到端走查（真实 `ipc` + 真实 SQLite，CDP 连渲染进程）** —— 即本模块 DoD 的四条，
    逐条实测（原文与数字见 `docs/module-M4b-order-flow.md` §8.2）：
    ① 建单（`T20261003-0001`）→ 候选池 6→7 且自动勾选 → 「全部（对比）」预览 → 应用（开关默认开）→
    回执「已派发 5 单（贪心），5 单已开始执行」→ 地图上 5 台车连续三次采样 `transform` 均在变
    （`CAR-01` 6 秒内跑完转 `空闲`）→ 点「在地图上查看这 2 台车」跳地图（见下条）；
    ② 关掉开关再派一单 → 回执「已派发 2 单（贪心），尚未启动执行」并逐条给出「去任务管理页开跑」；
    ③ 新建一张**时间窗已过去**的订单 → 调度中心「本批次预检」2 条「必须处理」（`已超时` + `未派发`，
    含「已经过去 36287 秒」），告警中心同一时刻读到**同样的两条**（同一次 `scanPlanRisks`）；
    ④ 车辆中心 5 台 / 状态分桶「空闲 2 · 执行中 3」，打开 `AGV-01` 抽屉读到实时位置、当前任务
    `T-DEMO-0001` 与 80 个采样点的轨迹折线。控制台错误 0 条。
  - ✅ 走查另修三处（详见 `docs/issues.md`）：`ISS-090` 车辆中心抽屉坐标未走 `formatNumber`
    （`73.59999999999991`）、`ISS-091` 新建订单后仍挂着上一批的「在地图上查看 N 台车」、
    `ISS-092` `DispatchPage.test.tsx` 仍在断言已移除的徽标（用例与新页面漂移）。
  - > 本轮未重跑 `npm run dev`（Vite 侧未改动）与 `db:migrate` 的冷启动引导（迁移集未变），故不声称结果。

- **验证基线（2026-10-03 实测·第三批：任务风险预检 / 派发区块 / 路线列 / 派发后上地图）** —— 保留供对照：
  - ✅ `npm test`：**92 个套件 / 1041 个用例全通过**（本批新增 `shared/src/plan-risk.test.ts` 19 条、
    `desktop/src/domain/alert/risk.service.test.ts` 8 条、`renderer/src/pages/AlertsRisk.test.tsx` 3 条、
    `renderer/src/dispatch/DispatchConsole.test.tsx` 4 条；`renderer/src/ops/model.test.ts` 扩到 18 条
    —— 含本轮新加的「预检表长文本列必须能换行」CSS 护栏）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 1.94 kB + CSS 74.85 kB（gzip 12.34 kB）+
    JS 691.22 kB（gzip 215.31 kB）。**JS 体积较上批显著变大，是 `data/campus/` 路网与 M5/M4 内核进入
    单一 chunk 的结果**（Vite 已提示 > 500 kB）；二期若要做代码分割再处理，不属于本批范围。
  - ✅ `npm run db:reset`：迁移 `1, 3, 4, 5`；seed 落 `nodes:30 · edges:90 · sites:13 · restrictions:2 ·
    vehicles:5 · templates:2 · users:3 · settings:9 · tasks:7 · routes:1 · alerts:1`；复跑幂等。
  - ✅ **Electron 端到端走查（真实 `ipc` + 真实 SQLite，CDP 连渲染进程；窗口 1440×900）**：
    - 告警中心首屏实测风险清单 **6 条「未派发」**（T-DEMO-0002…0007）+ 派发区块 **1 台车 · 1 单已生效**
      （AGV-01 / T-DEMO-0001 / `执行中`，走的是「按 `routes.task_id` 回退」的第二级查法）。
    - 调度中心 `全部（对比）` 实测：**贪心 5/6 · 拒绝 1 · 2030 m · 28 分 32 秒 · 4 台（含接力 1 单）**
      与 **匈牙利 4/6 · 拒绝 2 · 1580 m · 20 分 5 秒 · 4 台**；差异行原文
      「匈牙利更优的地方：少跑 450 m、少行驶 8 分 27 秒、早 2 分 20 秒完成」；被拒的是
      `T-DEMO-0004`「AGV-01 当前状态 busy」（该车是 seed 演示执行任务占用着 —— 与实际一致）。
    - 派发明细表每一行都带**路线（载货段）**（如 `2 段 · 300 m` / `5 段 · 680 m`），无一行是空。
    - 应用派发（5 单）后提示条变为 **「已派发 5 单（贪心）」+「在地图上查看这 4 台车」**；
      点它跳 `#/map`，实测**图层面板「配送路线 6」**、选中 `CAR-01`（`车辆 · 已预留`，执行任务 T-DEMO-0007）
      —— 即「派发后在地图上可见」这条链路真的通了。
    - 告警中心刷新后实测风险清单变为 **2 条「必须处理」**：`已超时`（T-DEMO-0004 时间窗已过 7215 秒，
      任务仍是 `pending`）与 `未派发`（同一任务，升为 critical）—— **这正是 `ISS-084` 修掉的那一类**，
      修前它在 `pending` 上永不触发。派发区块同时显示 **4 台车 · 5 单已生效**，`CAR-01` 标 **`接力 2 单`**
      并列出「第 1 单 T-DEMO-0002 / 第 2 单 T-DEMO-0007」两条不重叠区间。
    - 控制台错误 0 条。
  - ✅ **走查中又修掉一处真实缺陷**：预检表沿用列表页的 `white-space: nowrap`，长文本「建议动作」被顶出
    卡片右缘，在 macOS（横向滚动条默认不可见）上表现为**文字被裁半句**；实测溢出量
    `scrollWidth 1183 > clientWidth 1146`，修后两者相等（`ISS-086`）。
  - > 本轮未重跑 `db:migrate` 的冷启动引导（迁移集未变）与 `npm run dev`（Vite 侧无改动），故不声称结果。

- **验证基线（2026-09-28 实测，第二批：车辆 / 调度对比 / 告警 / 复杂地图）**：
  - 命令：`npm run db:reset`（清新库）→ `npm run build` → 起 Electron（`--remote-debugging-port`，
    CDP 连渲染进程走真实 `ipc` + 真实 SQLite）。
  - ✅ `npm test`：**88 个套件 / 991 个用例全通过**（本轮新增 `renderer/src/map/edges/NetEdge.test.tsx` 5 条、
    `renderer/src/api/mock-parity.test.ts` 的调度对比 3 条、`renderer/src/ops/model.test.ts` 6 条、
    `renderer/src/pages/AlertsBatch.test.tsx` 2 条等）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 1.94 kB + CSS 72.75 kB（gzip 12.08 kB）+
    JS 675.37 kB（gzip 210.29 kB）。
  - ✅ `npm run db:reset`：应用 `1, 3, 4, 5` 号迁移；seed 写入
    `nodes:30 edges:90 sites:13 restrictions:2 vehicles:5 templates:2 users:3 settings:9 tasks:7 routes:1 alerts:1`；
    随后 Electron 启动时报 `migrations applied: none` / `seed changes:` 全 0（幂等）、
    `executor resumed 1 running task(s)`（把 seed 的演示执行任务接回内存续跑）。
  - ✅ **边权进入耗时**：库中 90 条边有 **7 条 `weight > 1`**（1.4–2.2），规划耗时按
    `长度 × 权重 ÷ 有效限速` 计算（`shared/src/route-search.ts`）；画布上这 7 条也确实是橙色点线。
  - ✅ **Electron 端到端（真实 ipc + 真实 SQLite）**：
    - **地图**：图层面板读数 `路网边 90 · 路网节点 30 · 配送路线 1 · 任务起终点 7 · 订单起终点 0 · 车辆 5 · 站点 13`；
      状态条 `1 未处理告警 · 1/7 执行中任务 · 0 低电车辆`；DOM 里 `path…udm-edge-net.is-slow` 命中 **7 条**、
      `is-muted` 命中当前可见全部路网边。**控制台错误 0 条。**
    - **调度中心**（勾选全部 6 条待派 → 策略「全部（对比）」→ 预览）——这一屏就是用户要的「哪个更快、快多少」：
      | 策略 | 指派/任务 | 拒绝 | 执行里程 | 行驶耗时 | 全部完成 | 用车 | 总代价 |
      | --- | --- | --- | --- | --- | --- | --- | --- |
      | 贪心 | 5 / 6 | 1 | 2030 m | 28 分 32 秒 | 12:26:32 | 4 台（含接力 1 单） | 1712.4 |
      | 匈牙利 | 4 / 6 | 2 | 1580 m | 20 分 5 秒 | 12:24:12 | 4 台 | 1205.2 |
      推荐语「推荐『贪心』：指派 5/6，总代价 1712.4，比『匈牙利』多派 1 单」；
      差异行「『匈牙利』更优的地方：少跑 450 m、少行驶 8 分 27 秒、早 2 分 20 秒完成」；
      **按车辆分组出现 4 组**，其中 `CAR-01` 是**接力 2 单**（`T-DEMO-0002 12:17:32→12:18:22`
      紧接着 `T-DEMO-0007 12:18:22→12:20:02`，首尾相接、不重叠），其余三台各一单。
      > 表中数字随**库的当前状态**变化（被派发过的车会退出候选池、手工建的车会进入候选池）；
      > 上表是清新库下的实测值，**不是断言**。跨端可复现的是「两边逐字段相同」，由 `mock-parity.test.ts` 锁定。
    - **告警中心**：表头 `级别 / 类型 / 消息 / 状态 / 停滞 / 时间`；1 行
      `警告 · 车辆离线 · DRN-01 心跳超时，疑似离线 · 待确认 · 已 不到 1 分钟未认领`；
      > 这一行的「停滞」读数**随时间变化**：`createdAt` 由 D-56 相对 seed 时刻派生，
      > 所以「刚 seed 完就读」是「不到 1 分钟」，放几分钟会变成「已 N 分钟未认领」。
      > 可复现的是**措辞规则**（未认领 / 未开始处理 / 未解决 / 已终结显示 `—`），不是那个数字。
      「批量认领本页待确认（1）」可用且 `title` 说明「逐条调用认领接口，共 1 条」（无待确认时禁用并说明原因）。
    - **基础数据 → 车辆 → 新增**：表单 10 个字段（含**所在节点**下拉，31 项 = 30 节点 + 「不绑定」）；
      真建一台车 → 列表 6→7 行，**刷新后仍在**（走 ipc 真落库，不是内存假象），
      且该车**立即进入调度候选池**（下一次预览里出现）。
  - ✅ **浏览器 Mock 与主进程的一致性**：`mock-parity.test.ts` 新增 3 条 —— 同一批请求打两边，逐字段比对
    「两条策略的计划 / 拒绝 / 小结」（剥掉墙钟量：`summary.elapsedMs`、`explain` 文案里的「耗时 Nms」、
    占用区间的**毫秒位**），并断言**接力在两侧都出现**、贪心里同车两条计划的占用区间**不重叠**；
    另加一条护栏断言渲染层**不消费 `explain`**（「Mock 恒为空数组」这一有意差异的前提）。
  - ✅ `docs/issues.md` 三处计数对齐 `82 / 82 / 82`（写入 `ISS-082` 后复跑；`tests/docs.test.ts` 8 例通过）。
  - ⚠️ **未复跑**：`docs/architecture.md` 的 Mermaid 渲染（本轮未改图）、`npm run dev`（浏览器形态由上面的
    Mock 一致性用例与 Electron 走查共同覆盖）。
  - ✅ **回写后全量复跑（2026-09-28，本轮文档写回之后）**：`npm test` **88 套件 / 991 用例**全通过、
    `typecheck` 三端 exit 0、`build` 三端通过。
    复跑**当场抓到一处 D-33 违规**：`docs/api.md` §3.2.2 把「车辆 `currentNodeId` 指向不存在节点」的报错
    写成 `BASE.NODE_NOT_FOUND`，而唯一登记处里只有 `NODE.NOT_FOUND`（站点 / 边 / 路径用的是同一个 code）。
    **修法是改文档而不是加码** —— 在 `ERROR_CODES` 里补一条 `BASE.*` 等于给同一概念开第二个 code（D-33 禁止）。
    这正是 `errors.catalog.test.ts` 的意义：文档与登记处不一致时**测试先红**，而不是使用者先撞上。

- **历史基线（2026-09-27 实测，M4 调度服务与调度中心会话）** —— 保留供对照，勿当作最新结果：
  - ✅ `npm test`（当时）：77 套件 / 860 用例全通过；`typecheck` 三端 exit 0；
    renderer 产物 CSS 66.14 kB / gzip 11.13 kB、JS 595.78 kB / gzip 187.57 kB。
  - ✅ Electron 端到端：造 3 条 `pending` → 全选 → 对比预览 → 应用二次确认 → 落库核对
    （任务 `assigned` / 车辆 `reserved` / 日志 2 条 / 审计 1 条）；同 `requestId` 再应用得
    `DISPATCH.ALREADY_APPLIED`、伪造 id 得 `DISPATCH.REQUEST_NOT_FOUND`；控制台错误 0 条。
  - ⚠️ 该段的套件/用例数与产物体积已被本轮取代。

- **历史基线（2026-09-25 / 09-22 / 09-21 / 09-20 实测）** —— 保留供对照，勿当作最新结果：
  - 2026-09-25：`npm test` 27 套件 / 223 用例；renderer JS 446.48 kB / gzip 144.10 kB、CSS 53.23 kB / gzip 9.21 kB；
    浏览器 Mock 与真实 Electron 逐页截图核对，三角色导航项数（dispatcher 7 / monitor 5 / admin 9）。
  - 2026-09-22：`npm test` 18 套件 / 110 用例；`ERROR_CODES` 125 条唯一；文档自检 14 份 Markdown。
  - 2026-09-21：`npm test` 18 套件 / 110 用例；`npm run dev` / `dev:electron` 干净检出可启动（ISS-034）。
  - 2026-09-20：`npm test` 15 套件 / 94 用例；seed `nodes 12 · edges 34 · sites 3 · vehicles 3`（**旧网格，已作废**）；
    Electron 端到端 20 节点 / 39 边；`docs/architecture.md` 23 张 Mermaid 全部渲染成功。
    以下两条至今仍是对应主题的最近一次实测：**权限过滤行为**（未登录窗口 0 条、monitor 只收 `alert.created`、
    dispatcher 收 task/vehicle/alert、`map.updated` 放行、`event_log` 照写）与
    **CSS 修复前后取值**（路线高亮 `rgb(56,189,248)`/`4px`、路网 `rgb(71,85,105)`/`1.5px`）。

- **文档**：清单见 [`README.md`](./README.md) 的「文档入口」表 —— 该表是**文档索引的唯一权威来源**（本文件与 `design.md` §10.2 不再维护副本，副本正是历史漂移成因，见 `docs/issues.md` ISS-032）。
  - 与开发最相关的三份：[`design.md`](./design.md)（需求条目 `Req-*` / 状态机 / 数据模型字段语义）、[`docs/api.md`](./docs/api.md)（接口契约 / 错误码 / 事件，其 **§0** 是「每个事实由哪份文档负责」的总表）、[`docs/issues.md`](./docs/issues.md)（问题清单，**每次提交前必须同步**）。
  - 本文件负责：项目快照、代码现状地图、提交纪律、**设计决策编号（D-xx）**、历史问题原始记录与工作日志。

## 代码现状地图（进入开发前先看这里）

| 位置 | 已有内容 | 缺口 |
| --- | --- | --- |
| `shared/src/` | `enums.ts`（角色/状态/优先级/错误原因/20 个权限点 + `ROLE_PERMISSIONS`）、`types.ts`（信封、分页、DTO（含**M2 的六个列表项**与四类地图图层契约）、调度预览类型、**`MapOverview` 快照契约 8 个接口**、**M5 的 `RoutePlan` / `RouteCompare*` / `RouteDetail`（`costDetail.travelS` 可选）**）、**`edge-code.ts`（边的业务编码唯一作者，D-35/ISS-051）**、**`route-search.ts` / `route-graph.ts` / `route-rules.ts`（M5 路径内核：图模型 + `MinHeap` + A*/Dijkstra 共用框架、`buildRouteGraph` 三层排除、`validateRouteInput` 与途经点规则；**纯函数、无 IO**，是主进程与浏览器 Mock 的同一份实现，D-49）**、**`dispatch-types.ts`（M4 快照与视图类型 + 算法常量）/ `dispatch-evaluate.ts`（占用区间 + 单车×单任务六步评估 + 代价函数）/ `dispatch-strategies.ts`（贪心 + 匈牙利，含 `solveAssignment`）/ `dispatch.ts`（`runDispatch` 分派与再导出），D-51**、`errors.ts`（**126 条**：36 运行时 + 90 导入域；**唯一登记处**，D-33。含 `DomainError`/`ok`/`fail`/`fromError`）、`errors.catalog.test.ts`（命名/severity/文档闭环断言）、`constants.ts`（`APP_NAME`、分页默认、`DISPATCH_COST_WEIGHTS`、`MIN_BATTERY_PERCENT`、`SEED_ACCOUNTS`/`SEED_IDS`（含演示任务/路线/告警 id 与**演示待派发任务 id 清单**，条数以 `seed-data.ts` 为准）、`SETTINGS_SCHEMA`）、**`campus-map.ts`（`data/campus/` 原生 5 文件 → 内部的唯一翻译层：列名 / 单位 / 派生字段 + 拥堵叠加层 + 「障碍物 → 封路 or 权重×2」的车道数判据；纯函数无 IO，D-28）**、**`seed-data.ts`（`buildSeedDataset()`：路网 / 站点 / 车辆 / 演示任务与路线的唯一推导处，seed 与浏览器 Mock 共用同一个函数，D-55）**、**`alert-state.ts`（M8 告警状态机唯一作者：迁移表 + `alertActionsOf` + `ALERT_NEXT_STEPS`）**、**`settings-rules.ts`（`validateSettingValue`，主进程与 Mock 共用）**、**`base-rules.ts`（M2 写路径的字段长度 / 数值域 / 枚举 / 自环 / 「`code` 创建后不可改」+ `SiteCreate`…`EdgePatch` 等写 DTO；主进程与 Mock 的共同作者，D-44）** | 四类数据文件的**导入管线**（订单 CSV / 车辆参数 / 算法配置的解析器；地图解析器已落地）。M2 之外的实体仍有少数派生 DTO 未收口 |
| `desktop/src/db/` | `index.ts`（`DatabaseSync` 连接、WAL/外键/busy_timeout、`run`/`get`/`all`/`tx`、`defaultDbPath`）、**`sqlite.ts`（`createRequire` 惰性加载 `node:sqlite`，规避 vite-node 解析缺陷）**、`migrate.ts`（按序单事务 + `schema_version` 幂等；**已应用 `0001` / `0003` / `0004` / `0005`**，编号规则见 D-46 / D-54）、`seed.ts`（**只做「取数（`campus-map-source.ts` 读 `data/campus/`）→ 推导（`buildSeedDataset()`）→ 落库」三步，文件里没有业务数字**；规模见 `docs/database.md` §4）+ `campus-map-source.ts`（Node 侧取数）、`repositories/`（users / settings / audit / map；**M2 的 site / vehicle / graph / restriction / template 五件套**：读列表 + 单条读写 + 状态写入 + 跨表引用计数 + 多态目标翻译；**`task.repo.ts`（M3：列表含筛选与派生列 / 详情含计划·路线·告警·审计四块 / 状态写入 / 计划作废 / 物理删除）**、**`route.repo.ts`（M5：按 id 查路线 / 写路线 / `listGraphNodes` · `listGraphEdges` 读**全量**图 / `listRestrictionRules`；构图必须读全量，走分页列表会把路线静默规划在残缺路网上）**、**`dispatch-plan.repo.ts`（M4：`insertPlan` · 三处乐观锁 `assignTaskIfPending` / `reserveVehicleIfIdle` / `releaseVehicleIfBusy` · `listAppliedPlans` · `listActiveOccupiedSlots` · `latestOccupiedTo` · `setPlansStatus` · **`hasOtherActivePlanForVehicle`（回收前必须问这一句，见 D-53 / ISS-070）**）** 与 **`dispatch-log.repo.ts`（M4：`insertLog` · `hasApplied` · `findPreviewOutput`（排序键 `created_at DESC, rowid DESC` —— 只按 `created_at` 会在同毫秒的回收日志与新预览之间取到未定义的那一行）· `listLogs`）**；**settings 的读 / 写 / 反序列化同文件**，D-40） | seed 的 `vehicle_tracks` 初始为空（由执行器采样写入）· 导入管线的 Repository 未开工 |
| `desktop/src/ipc/` | `router.ts`（**注册键 = 方法 + 路径模板；支持 `:name` 路径参数（`ctx.params`）；形状相同的两条模板在注册时直接报错**，D-43；另有鉴权/权限前置 + `traceId` + 统一信封兜底）、`api.ts`（**65 条路由**：health · auth×3 · settings×2 · users · map.overview · **M7 轨迹 `GET /api/map/tracks/:vehicleId`** · **M2 读×6 · M2 写×13**（6 类资源：4 类有启停、规则多一条 `DELETE`、模板只有 POST/PUT）· **M3 任务×6**（列表 / 详情 / 创建 / 编辑 / 状态操作 / 删除 —— 状态操作是**一段 `:action`** 而不是六个同构路由，允许的动作名由状态机导出，**不另写允许清单**）· **M5 路径×3**（`POST /api/routes/plan` · `POST /api/routes/compare` · `GET /api/routes/:id`，权限 `route:plan` —— **三条都不发事件**，规划是只读计算）· **M4 调度×6**（`strategies` · `preview` · `apply` · `manual-assign` · `recompute` · `logs`；三条写路由**显式 `method: 'POST'`**（`ISS-066` 的教训：不传 method 一律按 `GET` 索引，界面按契约发 `POST` 会得到「接口不存在」）；事件只由写路径发，装配在 `emitDispatchEffects`）· **M1 用户×4**（列表 / 新增 / 更新 / 重置密码）· **M7 监控×3 + 执行×2** · **M8 告警×5**（认领 / 解决 / 归档的暴露面派生自 `alert-state.ts`）· **M9 审计×2**（查询 / 导出）· **M10 设置写×1**；写路由只做「路径 → 权限 → 领域服务 → 事务提交后 emit 事件」装配）、`paging.ts`（分页解析，宽进，D-40）、`validators.ts`（`requireString` / `requireEnum` / `optionalEnumFilter` / `optionalString`，严出，D-40），三者均为纯函数、各有单测 | **四类数据文件的导入接口整体未开工**（`Req-M3-2` 的批量导入与它同批）；**M2 的详情接口 `GET /api/{资源}/{id}` 未实现**（界面不用它）；坐标/布尔类校验原语等有调用点再补 |
| `desktop/src/services/` | `auth.ts`（登录/锁定策略）、`password.ts`（bcryptjs）、`session.ts`（内存会话）、`audit.ts`（审计写入）、`event-bus.ts`（**按会话权限过滤后**推送领域事件，D-32；含 `EVENT_PERMISSIONS`）、`event-bus.test.ts` | 告警 / 监控 / 执行的领域服务未开工（**路径 M5 在 `domain/route/`、调度 M4 在 `domain/dispatch/`**，不在本目录）；**无持续产生 `vehicle.changed` 的执行器**（故车辆静止，M7） |
| `desktop/src/domain/base/` | **M2 领域服务**：`context.ts`（`CrudContext` + `toAuditActor` + 动作命名）、`validate.ts`（跨表校验：编码唯一 / 节点存在 / 端点存在 / 方向对唯一 / 启停取值）、`site.service.ts`、`vehicle.service.ts`（`MANAGED_STATUSES = ['idle','disabled']`，占用中停用 → `VEHICLE.STATE_CONFLICT`）、`graph.service.ts`（边长欧氏推导、换端点重算、自环与方向对校验、自定义 code 与推导值不符则拒）、`restriction.service.ts`（多态目标校验两次 + 时间窗跨字段配对 + **物理删除**）、`template.service.ts`（无删除、无状态）、`base.service.test.ts` | **详情接口**（`GET /api/{资源}/{id}`）与批量导入（`restriction.service.ts` / `template.service.ts`）；与导入管线（F2 地图导入）的衔接 |
| `desktop/src/domain/task/` | **M3 领域服务**：`task.service.ts` —— `createTask`（套模板：补齐默认值 + 校验起终点类型）/ `updateTask`（可编辑状态 + **新旧配对**的时间窗，避免撞 DDL 的 CHECK 报成 `SYS.INTERNAL`）/ `operateTask`（状态机执行器：车辆回收 + 计划作废 + 原因落列，**接受任意已登记动作**，对外暴露面由路由控制）/ `deleteDraftTask`（只有草稿）；每个写方法 = 一个 `tx()` + 一条审计，`EventBus.emit` 在事务提交之后；`task.service.test.ts` | 任务的批量导入（`Req-M3-2`）；与 M4/M7 的调用点（`assign` / `start` / `complete` / `fail` 已实现但暂无调用方） |
| `desktop/src/domain/route/` | **M5 领域服务**：`route.service.ts` —— `planRoute` / `compareRoutes` / `getRoute`；从 `settings.route.defaultAlgorithm` 取缺省算法；**五种失败原因映射到四个错误码**（节点不存在 `NODE.NOT_FOUND` 先于构图判、两点不通 `ROUTE.NOT_FOUND_PATH`、图空 `GRAPH.EMPTY`、封死 `GRAPH.BLOCKED`、途经点不可达）；`compare` 不一致时写一条审计（`module=route` / `action=compare_inconsistent`）；**只读、不落库、不发事件**；`route.service.test.ts` | M4 的 `apply`（把路线写进 `routes` 表） |
| `desktop/src/domain/dispatch/` | **M4 领域服务**：`snapshot.ts`（`loadTaskViews` / `loadVehicleViews` / `loadGraphInputs` / `loadRestrictionInputs` / `buildSnapshot` / `snapshotFingerprint`；站点→节点解析失败抛 `SnapshotProblem` 而不是让内核拿到 `undefined`）、`explain.ts`（人读文案的**唯一作者**，词表按 D-52 从 `shared` 再导出）、`dispatch.service.ts`（`listStrategies` / `preview` / `apply` / `manualAssign` / `recompute` / `listDispatchLogs`）。**apply 不重跑算法** —— 落的是预览当场存下的 `dispatch_logs.output_snapshot`，只有路线会重推（重跑会让「我确认的方案」与「实际落库的方案」不是同一个）；并发安全靠条件 UPDATE，不靠「快照没变」这种无法证伪的判据；同一辆车在一批里只预留**一次**（D-53）；`dispatch.service.test.ts`（26 例） | 跨批次的串行排程（同车在后续批次继续接单）与遗传策略（`genetic` 按设计 `enabled: false`）；执行器属 M7 |
| `desktop/src/cli/db.ts` | `migrate` / `seed` / `reset`（reset 删 `-wal`/`-shm` 后重建） | — |
| `desktop/preload.cjs` | `window.dispatchApi.invoke/on`（`udm:invoke` / `udm:event`，contextIsolation 开启）；**`invoke` 透传 `method`**（漏了它会让写请求退化成读请求并回报成功，见 `ISS-055`） | — |
| `renderer/src/` | **全套已落地**：`main.tsx`（HashRouter，Electron `file://` 必需）、`api/`（client 契约 + `ipc`/`http`/`mock` 三层适配器 + `types.ts` 再导出 shared + `mock-data.ts` 与 seed 同源 + **`mock-base-write.ts`（写路径：规则共享、存储各自）+ `mock-parity.test.ts` 用同一批请求把 Mock 与真实主进程逐字段比对**）、`store/`（session / selection）、`app/`（路由 + `RequireSession` + **`modules.ts` 信息架构**）、`styles/`（**`theme.css` 令牌 + `ui.css` 共用基元** + `layout.css` 外壳）、`components/`（AppLayout / **BrandMark** / **UserMenu** / `icons.tsx` 内联图标集）、`pages/`（登录 / 工作台 / 未实现模块说明页）、**`domain/`（跨模块共用层：`labels.ts` 枚举→中文 · `table.ts` 列定义 · `form.ts` 表单机制与载荷口径 · `paging.ts` 页码收敛 · `tone.ts` 色调类名 · `format.ts` 数字/时间格式化）**、**`api/usePagedList.ts`（列表取数、竞态丢弃与页码收敛）· `api/useApiWrite.ts`（写请求与字段级错误映射）**、`dashboard/`（**工作台 model + 6 个面板 + style**）、**`base/`（M2 基础数据：`model`（列与页签）+ `form`（M2 的表单规则）+ `EntityFormDialog`（新增 / 编辑弹层，**已归公共机制之上**），页面为 `pages/BaseDataPage.tsx`）**、**`task/`（M3 任务管理：`model` 列与筛选 · `form` 表单与时间转换 · `actions` 状态操作展示（`Record<TaskAction, …>` 保证不漏）· `TaskActionDialog` 确认层 · `TaskDetailDialog` 详情 · style）**、**`route/`（M5 路径规划：`model`（途经点解析与展示口径 —— 展示值全部由函数产出，D-48）· `RoutePlanner` 面板 · style）**、**`dispatch/`（M4 调度台：`model.ts`（策略选项 / 推荐结论 / 派发明细行 / 拒绝原因行 / 确认清单 / 日志行 / 四个请求体构造函数；**纯函数，展示文案全在这里产出**，D-48）· `DispatchConsole`（两栏）· `ConfirmDispatchDialog`（二次确认）· `DispatchLogPanel`（服务端筛选 + 分页）· **本批新增 `NewOrderDialog.tsx`（新建订单弹层，复用 M3 表单并固定 `submit: true`）·
    `applyFlow.ts`（apply + 逐单 start 的结果汇总，纯函数）** · style；挂载页 `pages/DispatchPage.tsx`（**本批改为
    「主链路常驻 + 高级操作折叠」**））**、**`fleet/`（本批新增，车辆中心：`model.ts`（分桶 / 行组装 / 轨迹投影，纯函数）·
    `useFleetList.ts`（`/api/monitor/vehicles` + 事件分层：带坐标的 `vehicle.changed` 只覆盖坐标，其余节流重拉）·
    `FleetTable` · `VehicleDrawer` · style；挂载页 `pages/FleetPage.tsx`）**、`map/`（model **12** + nodes 5 + edges 2 + hooks 6 + stage + panels + style；**`model/toFlow.ts` 是图层偏移与声明尺寸的唯一作者，`model/layout.test.ts` 守住共点不遮挡**，D-42）、`test/dom-stubs.ts` | 九个模块的页面全部落地，**当前没有任何路由指向占位页**；遗留缺口：**M2 的批量导入与详情接口未开放**、**M3 的批量导入未开放**（页面内均如实标注）· 地图缺**订单端点图层**（`ISS-011`；轨迹回放已补）· `NODE_SIZE` 与 `style/map.css` 的实际尺寸**没有断言**（改字体/内边距后需重量一次，见 D-42）· **工作台数据源仍复用 `map/overview`**（刻意保持单快照，理由见 `DashboardPage.tsx` 文件头）· 无跨包 E2E 测试 |
| `renderer/index.html` | 首屏声明：内联 `data:` SVG 图标、`color-scheme: dark`、`theme-color`（D-37）；由 `renderer/src/app/index-html.test.ts` 断言「图标色值都已登记在 `theme.css`」 | 无（该文件只需保持自包含） |
| `tests/` | `setup.ts`（全局 setup：`@testing-library/jest-dom/vitest` + 每个用例后卸载 React 树 —— **本项目未开 `globals`，自动 cleanup 不生效**，必须显式注册）、**`docs.test.ts`（仓库级文档不变量，8 例：边界行齐全 / 文档里的源码路径必须存在 / `issues.md` 索引-锚点-明细一一对应 / **`issues.md` 的 §0 分布 · 索引表 · 明细段三处计数互相对齐**（`ISS-057` 的护栏）/ `api.md` §0 含关键事实行 / 代码里的每个路由都能在 `api.md` 查到（**单向**）/ 路由字面量必须写在 `path:` 里（元护栏）；`vitest.config.ts` 的 `include` 已纳入 `tests/**`）** | 文档护栏只覆盖「结构不变量」，**不校验正文与代码的语义一致**（那需要重新发明 D-34 的指派表）；jsdom 所需的 `ResizeObserver`/`matchMedia` stub 放在 `renderer/src/test/dom-stubs.ts` 里按需引入，**不进全局 setup**（否则 node 环境的 desktop 用例会被污染） |

> 测试现状：**98 个测试文件**（用例数以最近一次实测为准，见「验证基线」—— 用例数是最易漂移的一项，
> 这里不再复述；负载下会撞上 `ISS-068` 的偶发超时）。分布（按目录，文件名即套件名）：
>
> - `shared/src/`（16）：`enums` · `errors` · `errors.catalog` · `edge-code` · `base-rules` · `task-state` ·
>   `task-rules` · `route-search` · `route-graph` · `route-rules` · `dispatch-occupancy` · `dispatch-evaluate` ·
>   `dispatch-greedy` · `dispatch-hungarian` · `dispatch`。
> - `desktop/src/`（26）：`db/db` · `db/repositories/{base-data.repo, map.repo, settings.repo, task.repo}` ·
>   `services/{auth, event-bus}` · `ipc/{router, router.dispatch, paging, validators, api.auth, api.route,
>   api.task, api.write, api.dispatch, api.ops}` · `domain/{base/base.service, task/task.service,
>   route/route.service, dispatch/dispatch.service, user/user.service, alert/alert.service,
>   settings/settings.service, execution/executor}`。
> - `renderer/src/`（55）：`api/{index, mock-data, mock-parity, mock-dispatch}` ·
>   `app/index-html` · `components/{AppLayout, UserMenu}` · `styles/classnames` ·
>   `domain/{format, paging, labels, tone}` · `base/{model, form}` · `task/{model, form, actions, execution}` ·
>   `route/model` · `dispatch/model` · **`ops/model`** · `dashboard/{model/summary, panels/dashboard}` ·
>   **`map/edges/NetEdge`**（本批新增）· `map/MapView` · `map/panels/panels` · `map/hooks/useVehicleMotion` ·
>   `map/model/{ids, projection, structural, motion, toFlow, layout, focus, metrics, detail, palette,
>   visualization, track}` · `pages/{TasksPage, TasksPage.write, DispatchPage, DispatchPage.error,
>   BaseDataPage, BaseDataPage.write, OpsPages, AlertsBatch}`；
>   **本批新增 6 个**：`dispatch/{applyFlow, NewOrderDialog, DispatchAutoStart, DispatchNewOrder}` ·
>   `fleet/model` · `pages/FleetPage`。其中三个「会改数据」的用例刻意分成 `DispatchNewOrder` /
>   `DispatchAutoStart` / `DispatchConsole` 三个文件 —— Mock 是内存库，`apply` 会把候选池搬空，
>   同文件内的后续用例会因为「池子空了」而失败（那种失败长得像功能坏了）。
> - `tests/docs.test.ts`（仓库级文档不变量）：边界行齐全 · 文档里的源码路径必须存在 · `issues.md` 索引-锚点-明细
>   一一对应 · **§0 分布 · 索引表 · 明细段三处计数互相对齐**（`ISS-057` 的护栏）· `api.md` §0 含关键事实行 ·
>   代码里的每个路由都能在 `api.md` 查到（单向）· 路由字面量必须写在 `path:` 里（元护栏）。

## 角色与权限摘要（实现必须遵守）

- 角色：`admin`（全量）/ `dispatcher`（调度执行）/ `monitor`（只读 + 告警确认）。
- 权限点清单、页面路由、种子账号（`admin/admin123` 等）见 `design.md` §3.7、§7.1。
- 权限校验以主进程服务端为准，前端隐藏按钮只算体验优化。

## 提交纪律（本项目硬性规则）

### 目的

确保「每一次提交都可解释、可追溯」：文档、代码、日志三者同步；提交前先记录，记录完再提交。

### 提交前必做流程

1. 通读本文件「工作日志」尾部与 `design.md` / `docs/api.md`，确认当前进度与未决事项。
2. 对照 `design.md` 模块需求条目（`Req-*`）核对本次改动范围，确保有需求依据；无依据的改动先评审再动工。
3. 完成代码/文档改动并**自测通过**（运行相关测试/冒烟，记录命令与结果）。
3.5 **同步问题清单** [`docs/issues.md`](./docs/issues.md)：本次修掉的问题改状态为「已解决」并在其 §2 追加一行；
   本次新发现的问题按格式新增（编号顺延）；工作日志条目中**引用相关 `ISS-xxx` 编号**。
   两边分工：本文件记「什么时候发生了什么」，`issues.md` 记「现在还剩什么问题」。
4. 在本文件「工作日志」**追加一条完整记录**，必须包含：
   - 日期与标题；
   - 本次范围与目标（对应阶段/模块/需求条目）；
   - 变更清单（新增/修改文件、关键改动）；
   - 关键设计决策（记编号并同步到「设计决策记录」，如新增则编新号）；
   - 验证与测试结果（命令 + 结果，若未跑要写明原因）；
   - 遇到的困难与解决方案（若有，同步「困难与问题记录」）；
   - 遗留问题与下一步。
5. 确认 `docs` 与实现一致（接口、枚举、状态机若变化必须回写文档）。
5.5 **错误码只改一处**（D-33）：新增/改名错误码必须**先改 `shared/src/errors.ts`**，再同步 `docs/api.md` §2 与
   `docs/data-interfaces.md` §8。反向操作（先写文档）会让 `npm test` 变红 —— `shared/src/errors.catalog.test.ts`
   会断言「文档里出现的每个 code 都已登记」。若确实需要一条只用于示例、并非 code 的 token，加入该测试的
   `DOC_ONLY_TOKENS` 白名单，而不是绕过断言。
5.6 **不复述可漂移的事实**（D-34）：数值/路径/条数类事实只在**唯一负责文档**里写一次
   （对应关系见 [`docs/api.md`](./docs/api.md) §0）；其它文档改为引用「§号 / 文件 / 编号」。
   本次改动若触碰到某个事实，**顺手检查它的唯一来源是否已更新**，而不是在各处补一句。
   写**源码路径**时必须先确认该文件/目录真实存在（路径写错不会让结论失效，只会让「按文档找文件」失败，
   任何按数值清单核对的方法都发现不了 —— 本轮 18 处里有 6 处属这一类）。
6. 只有完成上述步骤后才允许执行 `git commit`；commit message 使用 `类型(模块): 摘要`，如 `feat(dispatch): apply 派发生效流程`。

### 禁止项

- 禁止在未记录到本文件的情况下直接提交代码。
- 禁止为了「先跑通」绕过状态机校验、审计留痕或文档同步。
- 禁止引入与设计冲突的新枚举/新状态而不更新 `design.md` 与 `docs/api.md`。
- 禁止把密钥、真实设备地址等敏感信息写入任何文档或代码。
- 禁止建立**第二套错误码目录**或给同一概念起第二个 code（D-33）；唯一的登记处是 `shared/src/errors.ts`。
- 禁止在 `docs/data-interfaces.md` §8 直接新增 code 而不先改 `shared/src/errors.ts`（会导致 `npm test` 失败）。
- 禁止新增领域事件却不登记 `EVENT_PERMISSIONS`（`event-bus.test.ts` 会断言已声明事件都有权限映射）；此前事件通道曾全量群发（ISS-009）。
- 禁止删除 `docs/issues.md` 中已解决的条目（改状态、保留原文 —— 已排除的问题对后来者最有价值）。
- 禁止在非负责文档中复述**可漂移的数值**（条数、节点数、用例数、路径、默认值等）—— 同一事实只允许一个作者（D-34，对应关系见 `docs/api.md` §0）。需要时写「见 §X」。
- 禁止新增/修改文档时**不给该文档写「文档边界」行**；每份文档抬头必须声明它负责什么。
- 禁止在 `docs/issues.md` 之外另建问题/风险清单（会造成第二份真相，与本项目两次去重的教训相悖）。
- 禁止在未登记 `severity` 的情况下新增导入域错误码；`severity` 是调用点属性，不得为「同概念两种严重度」拆成两个 code。
- 禁止删除 `docs/issues.md` 中已解决的问题条目（改状态、保留原文——已排除的问题对后来者最有价值）。
- 禁止在 `docs/issues.md` 之外另建问题/风险清单（会造成第二份真相，与本项目两次去重的教训相悖）。

## 设计决策记录

| 编号 | 决策 | 理由 / 备注 | 状态 |
| --- | --- | --- | --- |
| D-01 | 技术栈定为 Electron + React + SQLite 的本地优先桌面应用，三层适配器统一契约 | 匹配需求文档 2.2；渲染层可独立 Mock 运行 | 已定 |
| D-02 | 任务状态在原始 7 态上显式增加 `paused`（running 的暂停位不做隐式字段） | 保证状态机迁移可显式校验、UI/日志清晰 | 已定 |
| D-03 | 算法层纯函数 + 输入快照（DispatchSnapshot），预览不落业务库 | 满足「算法输出不污染业务数据、先预览后生效」 | 已定 |
| D-04 | 路线/计划版本化：apply 才写 `dispatch_plans` 与 `routes`，旧计划置 superseded 不删除 | 可对比、可复核、可回放 | 已定 |
| D-05 | 坐标统一平面 `{x,y}` 米制，禁止内部混用经纬度 | 简化离线演示；二期再做真实地图转换层 | 已定 |
| D-06 | SQLite 仅主进程访问，渲染层永不直连 | 数据一致性 + 权限边界 | 已定 |
| D-07 | 删除策略：站点/车辆/节点/边一律软删（disabled），草稿任务可物理删除 | 保留审计与引用完整性 | 已定 |
| D-08 | 权限校验双轨制：前端隐藏 + 主进程服务端强制 | 防绕过 | 已定 |
| D-09 | 告警五类 + 去重窗口 + 状态机（new→acknowledged→processing→resolved→archived） | 满足来源/级别/时间/对象/状态基线 | 已定 |
| D-10 | 执行流首期用「本地模拟执行器」，二期以真实协议替换执行器且不改上层契约 | 先闭环再真实设备 | 已定 |
| D-11 | 权限点 `dispatch:read`（调度日志只读）与 `execution:start`（开始执行）在接口文档补充并生效 | 便于 dispatcher 自查调度记录并启动执行（待评审确认） | 待评审 |
| D-12 | M4 落地口径：代价权重 P4 用常量不进设置表；preview 输入规模限制 taskIds≤50、车辆≤30；apply 用「条件 UPDATE 当乐观锁」防并发双派 | 控制匈牙利复杂度与并发一致性；二期再迁移权重到系统设置 | 已定 |
| D-13 | 工程形态采用根级 npm workspaces（`shared/ desktop/ renderer/`，与 design §2.4 一致）；适配器由 `VITE_API_ADAPTER=mock / ipc / http` 切换；迁移单事务 + `schema_version` 幂等，开发库固定 `desktop/.data/app.db` | 本地一键构建、类型零成本共享；渲染层不被原生依赖阻塞 | 已定 |
| D-14 | 数据库实现采用 Node 内置 `node:sqlite` `DatabaseSync`，不引入 better-sqlite3 | 与当前 Node/Electron 运行时及零原生额外依赖目标一致；如更换驱动必须同步 `desktop/src/db/index.ts`、迁移/事务测试与构建文档 | 已定 |
| D-15 | 订单接入引入独立「地区目录」（`regions` / `region_aliases` / `region_dataset_versions`），不复用业务 `sites` 承担外部地址别名；匹配优先级为「标准编码 → 规范化名称 → 别名 → 归一化唯一命中」，多候选/无候选一律进失败明细，禁止自动猜测 | 外部地址别名数量与语义远多于业务站点；匹配结果需可复核（保存 `inputValue`/`matchType`/`confidence`/`datasetVersion`）。见 `docs/order-data-map-design.md` §3 | 待评审 |
| D-16 | CSV 导入按 `contentSha256 + mappingVersion` 幂等，重复上传默认不重复建任务；导入分「预检预览（零副作用）+ 确认导入」两步，单行失败不回滚其它合法行，仅批次级系统错误整体回滚 | 满足「先预览后生效」与部分成功反馈；避免重复导入污染任务表。见 `docs/order-data-map-design.md` §2/§4.3 | 待评审 |
| D-17 | 四类数据文件（订单 CSV / 仿真地图 / 车辆参数 / 算法配置）共用一套导入契约：统一 JSON 信封 `schemaVersion+kind+meta+data`、统一 `ImportIssue` 错误模型、统一 `mode`（validateOnly/merge/replace/appendOnly）与幂等键 `contentSha256+schemaVersion+mappingVersion+targetScope` | 管线与错误模型完全一致，前端只需一套导入向导；避免四套各自为政的导入语义。见 `docs/data-interfaces.md` §2。**待评审** | 待评审 |
| D-18 | 文件内一律用业务 `code` 引用、不使用数据库 ID；引用必须能在同一文件内解析（`merge` 模式可放宽为库内解析） | ID 由系统生成，外部文件无法预知；用 code 才能让地图/车队文件自洽、可手写、可 diff。见 `docs/data-interfaces.md` §4.2 | 待评审 |
| D-19 | 车辆参数文件**只承载物理参数与服务能力**，禁止出现运行态字段（status/x/y/currentNodeId/battery/loadKg）；出现即报错阻断，不静默忽略 | 静默忽略会让使用者误以为配置生效；运行态由调度与执行器独占管理。见 `docs/data-interfaces.md` §5.1 | 待评审 |
| D-20 | 算法配置以「导入型配置集 + 版本化（active/superseded）」落地，不接管运行时 `settings` 热更新；与 `settings` 重叠项以 `settings` 优先并给 info 提示 | 兼顾 D-12（P4 权重走常量）与仿真可复现诉求；不静默覆盖用户显式设置过的项。见 `docs/data-interfaces.md` §6.4 | 待评审 |
| D-21 | M6 地图渲染改用 **React Flow（`@xyflow/react` v12，仅 renderer 依赖）** 替换原「自研 SVG/Canvas 平面图层」；`map/overview` 为画布唯一数据入口；地图只渲染路线不自行搜索路径；车辆位置以事件为权威、插值仅补帧且禁止外推；图层开关用 `hidden` 而非过滤元素 | React Flow 是节点/边图渲染器，与 D-05 的平面 `{x,y}` 米制路网模型天然匹配，且视口/命中/标签/箭头等均为其成熟能力，省去自研；提出时 M6 尚未实现，属**零迁移成本替换**（现已按此落地）。实测：Vite 6 构建通过、体积 +187 KB（gzip +61 KB）、产物无 Worker/WASM/动态 import、Electron `loadFile` 正常渲染、2000 节点+3910 边 20 Hz 刷新仍 60 fps。见 `docs/module-M6-map.md`。剩余未决项仅为 Q-1（React Flow 署名策略），见 `docs/issues.md` ISS-019 | 已定 |
| D-22 | 渲染层适配器默认值按「有没有 preload 桥」判定（有桥 → `ipc`，无桥 → `mock`），**不再**一律默认 `mock` | 打包后的 Electron 用 `loadFile` 加载产物，构建时通常不带 `.env`，`VITE_API_ADAPTER` 为 `undefined`；若默认 mock，桌面端会**静默显示假数据**（不读 SQLite、不报错），是最难排查的一类问题。实测生产 `file://` 形态下已自动选中 `ipc`。见 `renderer/src/api/index.ts` | 已定 |
| D-23 | 地图事件**分层处理**：结构类事件（`map.updated`/`task.changed`/`alert.*`）重拉快照并节流 250ms；位置类事件（`vehicle.changed`/`execution.progress`）**只写入 `positionsRef`（ref）**，由 `updateNode` 定向更新，绝不进入 React state | 把位置类事件也接成全量重拉，会每秒重建 `nodes`/`edges`，使 React Flow 反复重挂载，**边间歇性渲染不出来**（实测 `edges=0`）；另引入 `model/structural.ts` 结构签名（排除车辆位置、电量取整）避免轮询兜底每秒换引用。见 `docs/module-M6-map.md` §11.5 | 已定 |
| D-24 | `GET /api/map/overview` 的 `eventSeq` 取 `sqlite_sequence`（**单调水位线**），而非 `MAX(event_log.seq)` | 实测：插入两条事件后删掉最高位那条，`MAX(seq)` 从 2 回退到 1；渲染层用该值丢弃重放/乱序事件，一旦回退就会把旧事件当新事件重放。`event_log.seq` 为 AUTOINCREMENT，`sqlite_sequence` 记录历史分配过的最大值，删除行不会减小 | 已定 |
| D-25 | 快照中的**派生字段在读取层计算**，不冗余落库：车辆的 `taskId` 由 `tasks.assigned_vehicle_id` 反查；路线的 `status` 由 `dispatch_plans.status` 派生（`routes` 表**没有** status 列） | 冗余列会在改派/重算时产生两处不一致（与 D-07 引用完整性同思路）。实测踩坑：`routes` 无 `status` 列，若照文档想当然写 SQL 会直接报错；`dispatch_plans.status='applied'` 需映射为路线的 `active` | 已定 |
| D-26 | seed 增加**一条自洽的演示执行数据**（任务 `running` + 路线 + 告警，并把 AGV-01 置 `busy`、`load_kg` 与任务一致） | 真实业务中 `tasks`/`routes` 初始为空、由调度流程产生，导致地图上永远只有路网，**路线高亮与车辆动画没有任何可见样本**。演示数据必须状态自洽（不能 running 任务挂 idle 车），且路线每一段都必须是库中真实存在的边。见 `docs/database.md` §4 | 已定 |
| D-27 | `mock-data.ts` 的演示数据**改为从 `shared` 的 `SEED_IDS` 与 seed 同规则派生**，并用测试直接比对「mock 快照 == seed 库经 `getMapOverview` 的快照」 | 实测事故：mock 手写了 `seed-n-N1`/`seed-veh-AGV-01`，真实 seed 生成 `seed-n01`/`seed-veh-agv01`；两边形状相似但不相等，浏览器里一切正常，**切到 Electron 后选中态、事件匹配、告警角标全部静默失效** | 已定 |
| D-28 | 导入契约区分**原生形态**（数据方实际交付：地图 5 文件包 / 车辆 YAML / 26 或 32 列 CSV）与**标准形态**（系统内部单 JSON 信封或规范化 CSV）；「原生 → 标准」的适配是导入器职责，前端只消费标准形态与 `ImportIssue`；多文件输入的幂等键为**全部输入文件按名排序后的哈希合并** | 实测样本根本不是单文件信封：`1_仿真地图/` 是 3 CSV + 1 XML + 1 GeoJSON 的工程目录，`3_车辆参数/vehicle_params.yaml` 顶层是 `meta`+`fleet`+`vehicles{}`。要求数据方改造工具链不现实，而让前端感知原生差异会把 4 套解析逻辑塞进渲染层。只哈希主文件会漏掉站点/GeoJSON 变更。见 `docs/data-interfaces.md` §2.2/§4.1.1 | 待评审 |
| D-29 | 订单时间采用**「当日秒数」口径**（`*_s` 列为权威，基准日由批次参数 `serviceDate` 决定，默认导入当天），文本列仅展示；文本与秒数比对**按分钟下取整**（实测 197/200 行秒数非 60 整数倍）。订单 `priority` 的 `1/2/3` 显式映射为 `normal/high/urgent`，并**同时保存 `priority_raw`** | 样本全列无日期、无时区（`order_time=08:07:06` / `order_time_s=29226`），ISO 8601 会把「无日期」的仿真数据强行钉到某日，破坏「同一文件重跑得到相同调度输入」的可复现前提（§2.7）。数值优先级与内部四值枚举数量级接近但不相等，直接透传会错位且丢失可追溯性。见 `docs/data-interfaces.md` §3.3/§3.4 | 待评审 |
| D-30 | 地图站点改为**边绑定 + 泊位**模型：`sites` 新增 `edge_id`/`lane_id`/`berth_start_pos_m`/`berth_end_pos_m`/`berth_length_m`/`berth_capacity`/`category`，`node_id` **改为可空**（双写过渡）；节点新增 `node_type`，边新增 `road_type`/`num_lanes`/`priority`，并新增 `road_types` 与 `obstacles` 表 | 实测 13/13 站点都绑定在**边**上（`edge_id` + 车道 + 泊位区间 55–85 m + 容量 4/6），既有 `sites.node_id` 模型无法表达「只能停 4 台车」，而泊位容量正是 M7 泊位占用约束的输入。保留 `node_id` 可空而非改成边绑定并二选一，是为了不打断已通过的 M6 渲染与 seed。见 `docs/data-interfaces.md` §4.3/§4.7 | 待评审 |
| D-31 | 车辆参数单位口径统一为 **kWh/km**（废弃 Wh/km 的 `consumptionWhPerKm`/`batteryCapacityWh`，改用 `energyConsumptionKwhPerKm`/`batteryCapacityKwh`/`socMinPct`）；样本自带的 **9 条 `consistency_rules` 由服务端求值**、错误码由系统固定（不从文件读）；`[A/B/C/D]` 可信级别**随参数落库并在 UI 展示、可筛选，但不阻断导入** | 样本口径是 `energy_consumption_kwh_per_km`（0.155）× 里程，与 2026-09-15 记录的 `kmToWh` 量纲错误同属一类问题，必须一次定死单位。规则表达式若交前端或数据方求值会引入第二套实现，两边迟早不一致。车辆文件的 129 个数值字段中 66 个（51.2%）是 `[D]` 级工程假设（样本两份文件合计 218 个 / D 132 / 60.6%），不展示就等于把假设当实测，但报错会阻断正常使用。见 `docs/data-interfaces.md` §5.4/§5.7/§5.9 | 待评审 |
| D-32 | `EventBus` **按会话权限过滤后再推送**（deny-by-default），事件落 `event_log` 不受过滤影响；`EVENT_PERMISSIONS` 显式登记「事件类型 → 所需权限点」，未登记的类型视为公开；窗口在 `attach` 时绑定会话、登录/登出经 `bindSession` 升降权；`EventBus` 构造器要求 `sessions` 必填 | D-08 定了「权限双轨制」，但事件通道此前是**绕过接口层强制校验的旁路**：`emit()` 对全部 `webContents` 无条件群发，第二个窗口就能收到与其角色无关的业务对象事件（ISS-009）。deny-by-default 而非 allow-by-default，是因为漏登记一个新事件的后果（收不到）远比漏过滤一个敏感事件的后果（越权）轻。见 `desktop/src/services/event-bus.ts` | 已定 |
| D-33 | 错误码**唯一登记处**为 `shared/src/errors.ts` 的 `ERROR_CODES`；命名统一为 **`域.原因`** 两段式（对应 Google AIP-193 `ErrorInfo` 的 `domain`+`reason`），域按**业务概念**而非「文件来源」划分；**同一概念只允许一个 code**；`severity`（error/warning/info）是单次问题出现的属性、不是 code 的身份，故同一 code 可在不同调用点有不同 severity（如 `GRAPH.EMPTY` 导入预检 warning、调度预览 error） | 项目曾同时存在两套目录（34 条 vs 97 条，**零重叠**），两份文档各自声称「唯一登记处」，同一概念两个名字（`GRAPH.EMPTY` vs `MAP.EMPTY_GRAPH`）。前端按 code 做文案映射，两套 key 会直接打挂本地化（ISS-001）。AIP-193 明确：同一个 `(reason, domain)` 对**必须**用于同一个错误、且**不得**用于不同错误 —— 即「概念唯一」优先于「文件族前缀统一」。合并后 123 条（34 运行时 + 89 导入域；后续按同一登记处继续增加，**当前条数以 `docs/api.md` §2 为准**），并以 `shared/src/errors.catalog.test.ts` 把该规定变成可执行断言（文档里出现未登记 code 会 `npm test` 失败） | 已定 |
| D-34 | **文档事实单一来源（SSOT）**：`docs/api.md` §0 用一张表把每个易漂移事实指派给**唯一负责文档**（错误码→`shared/src/errors.ts`、接口/事件→`docs/api.md`、DDL→`docs/database.md`、`Req-*`/状态机→`design.md`、导入字段契约→`docs/data-interfaces.md`、脚本/验收→`docs/build-plan.md`、问题→`docs/issues.md`、决策→`AGENTS.md`、索引→`README.md`），其余文档**只能引用 §号、不得复述数值**；每份文档抬头用「**文档边界**」一行自声明其负责范围 | 历史上同一事实最多有**三种写法**（ISS-032：迁移目录、seed 规模、适配器默认值等 12 处），根因不是「写错了」而是**多处各写一份**——同一天在不同文档里写对、也同时写错。单点纠正只能修一次，指派唯一来源才能防复发。这与 D-33（错误码只改一处）是同一原则在不同层面的应用：**每个事实只有一个作者**，其余都是读者。见 `docs/api.md` §0 | 已定 |
| D-35 | `edges` 新增业务 `code` 列（`TEXT NOT NULL UNIQUE`）作为 D-18 引用的**持久键**：缺省按两端节点 code 推导 `E_<fromCode>_<toCode>`，反向边加 `_R`；`/api/edges` 暴露并支持按 `code` 查询，`code` 创建后不可改。**文件内 `edge_id` 字段语义 = 边的 `code`**（导入器解析为内部 `id` 后落库，如 `sites.edge_id` 列存 id）；库内 JSON 列（`routes.edge_ids`）继续存 **id**，与 `routes.node_ids` 保持一致 | `docs/data-interfaces.md` §4.2/§4.3 要求「文件内一律用 code 引用」（D-18），且样本 `campus_edges.csv` 的 `edge_id` 列映射为 `edges[].code`；`sites.onEdgeCode` / `obstacles.affectsEdgeCodes[]` / `codeOfReverse` / `restrictions` 目标都指向 `edges[].code`。但 `nodes`/`sites`/`vehicles`/`task_templates`/`tasks` **都有 code 列，唯独 `edges` 没有** —— 契约要求一个无处落库的键，`merge` 模式的「库内解析」也无从实现（只能靠 `(from_node_id,to_node_id)` 反推，与文件里的 `code` 无法互相校验）。落库随 `0002_data_import.sql`（加列 + 按 `E_<from>_<to>` 回填既有行），列建议见 `docs/data-interfaces.md` §10。见 `docs/module-M2-base-data.md` §8 | 待评审 |
| D-36 | 渲染层引入**设计系统与信息架构两层共用地基**，并把「复用规则」写成可执行约束：① `styles/theme.css` 承载全部设计令牌（颜色 / 字号 7 档 / 间距 6 档 / 动效 / 层级）；② 新增 `styles/ui.css` 承载**被 2 处以上使用**的基元（`.udm-btn` / `.udm-panel` / `.udm-card` / `.udm-kv` / `.udm-badge` / `.udm-swatch` / `.udm-chip` / `.udm-progress` / `.udm-empty` / `.udm-field` / `.tone-*`），`map.css` 与 `layout.css` 只留**本模块特有**的布局；③ 新增 `app/modules.ts` 作为「模块 → 路由 / 标题 / 权限 / 图标 / 计划能力」的**唯一作者**，导航分组、顶栏标题、占位页说明三处共用；④ 新增 `domain/labels.ts`（枚举→中文，原 `map/model/labels.ts` 上移）与 `dashboard/`（工作台 model + panels + style） | 起因是三条实测到的具体问题：**(a)** 通用基元（`.udm-btn--ghost` / `.udm-icon-btn` / `.udm-panel` / `.udm-kv` / `.tone-*` / `.udm-swatch`）当时**只存在于 `map/style/map.css`** —— 地图之外的模块要复用一个幽灵按钮，就得 import 画布样式表或再抄一份，二者都会制造第二套真相（D-34）；**(b)** 「导航项 / 页面标题 / 未实现模块说明」此前各写一份，改名时必然漏改；**(c)** `map/model/labels.ts` 在被工作台共用时出现「import 地图模块」的尴尬依赖。判定规则取**「按谁在用划分」**而非「按文件类型」：被 2 处以上使用 → `styles/ui.css`；只服务画布 → `map/style/map.css`；只服务外壳与页面 → `styles/layout.css`；只服务工作台 → `dashboard/style/dashboard.css`。`theme.css` 的令牌值仍受既有 `palette.test.ts` 断言（CSS 变量 ↔ `palette.ts` 字面量一致），故本次拆分**未引入任何新色值** | 已定 |
| D-37 | 渲染层**首屏声明**与它的**防漂移护栏**：`renderer/index.html` 必须自包含「内联 `data:` SVG 图标 + `color-scheme: dark` + `theme-color`」，并新增 `renderer/src/app/index-html.test.ts` 断言「图标里出现的每个色值都已在 `theme.css` 登记」「`theme-color` == `--udm-bg`」；`index.html` 因此被纳入**被测试覆盖的范围**（它原先在 `tsconfig.include` 与全部既有测试之外） | 起因是 `ISS-041`（浏览器形态每次冷启动都去请求 `/favicon.ico` 并拿 404）。修法本身只是一行 `<link rel="icon">`，但**两处容易被顺手写错**：① `index.html` 在**任何 CSS 之前**被解析，图标色值与 `color-scheme` **只能写字面量**，读不到 CSS 变量 —— 于是它天然会变成 `theme.css`、`palette.ts` 之后的**第三套色值**；② favicon 与主题对不上、冷启动闪白一帧，都是**没人会报错**的问题（不像错误码那样有调用点）。因此把「不许漂移」变成断言：色值必须已在 `theme.css` 出现（与 `palette.test.ts` 同一思路，那条测试已证明这种护栏有效）。护栏**已做过反向验证**：把图标里一个色值改成未登记的 `#ff00ff`，测试如期变红（`expected [ '#ff00ff' ] to deeply equal []`）。见 `renderer/src/app/index-html.test.ts` | 已定 |
| D-38 | 渲染层的**弹层键盘语义契约**（本项目不引第三方 UI 库，因此每个弹层都要自己写对）：菜单项按 ARIA 的 roving focus 带 `tabindex="-1"`；`ArrowDown` / `ArrowUp` **打开菜单并落焦点**（焦点不在菜单内时进入首项/末项，而不是原地不动）；`Home` / `End` 跳首尾；`Esc` 关闭并**把焦点送回触发按钮**；`Tab` 关闭菜单并把焦点**交接给菜单外的相邻可聚焦元素**（不让焦点掉到 `<body>`）；触发按钮声明 `aria-haspopup` / `aria-expanded` / `aria-controls`；菜单项必须有 `:focus-visible` 焦点环 | 起因是用户在会话中要求「继续完成其它内容」，实测发现用户菜单的键盘操作**是空的**：菜单项带 `tabindex="-1"`（Tab 够不到），而 `Escape` 之外的按键全部无处理 —— 即**键盘用户根本进不去这个菜单**，而界面上看不出任何异常。`tabindex="-1"` 与「方向键移动」是**配套的一对**：只写前一半是一个看起来实现了 ARIA 菜单、实际不可用的状态，因此必须以契约形式写死。焦点环在这里不是装饰：它由方向键驱动，缺了它「移动焦点」在视觉上等同于「毫无反应」。见 `renderer/src/components/UserMenu.tsx` | 已定 |

| D-39 | `className` 与 CSS 的关联必须**可断言**：新增 `renderer/src/styles/classnames.test.ts`，用 `\.(udm-…)` 扫出全部已定义类名、用 `className=` 属性提取全部被引用类名，断言「被引用 ⇒ 已定义」；判定范围**刻意收窄到 `className` 属性**（不做全文匹配），动态类名的 `--` 前缀按「存在同前缀的已定义类」放行，并要求护栏**自检**（定义数 > 50、引用文件数 > 3，否则报错而非静默通过） | 起因是 `ISS-048`：`className="udm-planned__iface"` 在 JSX 里被使用，但全项目**没有任何 CSS 定义**，于是占位页把四个权限点渲染成 `alert:readalert:ackalert:resolvealert:archive`。这类缺陷的共性是**三不**：不报错、不违反类型、不被任何既有测试覆盖 —— 页面上只是「这块样式没生效」。更麻烦的是它**只在特定数据形态下显形**：只有一个接口的模块（用户管理）看起来完全正常，列出多项时才是坏的，因此人工逐页核对极易漏过。收窄判定范围是必须的：全文匹配 `udm-*` 会把 CSS 变量、元素 `id`、`aria-controls` 全部误判，而**满屏误报的护栏等于没有护栏**（写这条时先跑了一次宽口径扫描，16 个「未定义」里 12 个是误报）。配套清理：顺带删掉 3 个父元素已居中、因而**无任何作用**的类名（`.udm-node-endpoint__glyph` 等，见 ISS-049）。见 `renderer/src/styles/classnames.test.ts` | 已定 |
| D-40 | **传输层的参数校验与分页**从 `ipc/api.ts` 抽出，归属与口径固定：① `ipc/validators.ts` 只判「字段在请求里是否**成形**」（类型 / 非空），失败一律 `VALIDATION.FAILED`，**不判业务合法性**；② `ipc/paging.ts` 的分页参数一律**宽进**（非数字 / 负数 / 0 回落默认、小数向下取整、超上限夹取），**从不因分页参数报错**；③ 业务合法性（编码唯一、引用存在）归领域层 `domain/base/validate.ts`，只有那里返回 `SITE.CODE_DUPLICATE` 这类具体错误码；④ 「序列化写入」与「反序列化读出」是同一件事的两端，**必须同文件**（`settings.repo.ts` 的 `upsertSetting` / `parseSettingsValues`），解析失败原样返回字符串而不抛错 | 起因是 `ISS-015`（分页与参数校验内联在 `api.ts`）。抽取**提前于原计划的触发条件**（原文写「接口数超过 ~12 条前抽」）：真正触发的是 **M2 要一次新增 20 余个列表 / 写接口**，等它们写出来再抽就得同时改 20 处调用点并重测。三条口径都是**会分叉**的地方：**(a)** 若某个列表接口选择「非法 `page` 报 400」而其它回落默认，前端就得为每个列表写不同的兜底 —— 分页是**展示偏好**不是业务数据，为 `?page=abc` 弹一个与操作意图无关的错误页没有意义（反过来，必填字段不成形就必须报错，两者口径相反**是有意的**，所以它们是两个文件而不是一个）；**(b)** 传输层与领域层混在一起时，「改一个字段的校验」必须读懂整个接口；**(c)** `settings.value` 是 TEXT 存 `JSON.stringify` 的结果，读写的两端原先分居 `api.ts` 与 `settings.repo.ts`，改存储格式时只会改一半（`parseSettingsValues` 即由此迁入仓库层）。只抽 `requireString` 一个原语同样是**有意的**：先写没有调用点的校验函数，只会得到一批没被真实场景检验过的代码。见 `desktop/src/ipc/paging.ts` · `desktop/src/ipc/validators.ts` · `desktop/src/db/repositories/settings.repo.ts` | 已定 |
| D-41 | M2 的**读取路径先于写入路径**落地，且顺序不可颠倒：四个 `GET` 列表（`/api/sites` · `/api/vehicles` · `/api/nodes` · `/api/edges`）直连仓库层、**不经领域服务**；写路径必须等 `domain/base/*` + 审计 + `OBJECT_TYPES` 扩项（M2 §11 Q1）就绪后再开工。派生字段（边的业务 `code`）在**读取层**计算，命名规则写在 `shared/src/edge-code.ts`（唯一作者，主进程与 Mock 共用）；页面层凡未实现的能力**就近说明**，不留「点了没反应」的按钮 | 起因是把「基础数据」页从占位推进到可用。三处判断：**(a)** 读取不依赖 §11 的待决项（Q1 影响的是审计的 `object_type`），却能让这一页立刻显示**真实库**、并把 D-40 的分页/筛选口径先固定下来给 20 余个写接口复用 —— 先做写路径则相反，要先评完 Q1 才能动；**(b)** 只读接口不经领域服务是**有意的边界**：领域服务的存在理由是「多表业务规则 + 事务 + 审计 + 事件」（见 `docs/module-M2-base-data.md` §4），单个列表查询套一层空壳服务只会让「哪层该改什么」变模糊；**(c)** 派生字段不冗余落库是 D-25 的延续，而「命名规则必须只有一个作者」由 ISS-051 的教训直接推出（D-27 那次事故的翻版）。见 `desktop/src/db/repositories/{site,vehicle,graph}.repo.ts` · `shared/src/edge-code.ts` · `renderer/src/pages/BaseDataPage.tsx` | 已定 |
| D-42 | **共点图层必须各领一个互不遮挡的锚点**（图层避让规则，而非个案规避）：`toFlow.ts` 的 `LAYER_OFFSET` 是唯一作者（站点抬起 `+54px`、任务/订单起终点让到左右 `±64px`），符号换算只有 `toCanvasOffset` 一处；**车辆与路网节点不参与偏移**；新增共点图层时必须给它不重叠的锚点，并由 `layout.test.ts` 的不变量守住。`NODE_SIZE` 是「声明尺寸」的**唯一作者**，需与 `style/map.css` 的实际几何对齐 | 起因是 `ISS-053`（同一节点上 AGV-01 与站点 A-01 的标签框完全重叠，默认首屏可见）。**同类问题此前已发生过一次**（任务起终点被车辆整个盖住），当时按「给端点加个对角偏移」的个案处理、没留下规则，于是换个数据形态又复现 —— 本项目两次修同一类缺陷，是这条决策要写成规则而不是补丁的直接理由。四处判断：**(a)** 偏移量必须只有一处：位置若在 `toFlow.ts` 与 `map.css` 各定义一份，改一处不会改另一处，且这种不一致**只在共点时显形**，代码评审与截图都抓不住；**(b)** 让位的必须是**静止**图层：车辆位置就是「车在哪」这条信息本身，且 `useVehicleMotion` 沿路段插值，整体挪 20px 会让车「压在路外」—— 那是把排版问题换成坐标错误；**(c)** 避让距离按「**看得见**」定而非「不重叠」定（实测 46px 只剩约 7px 间隙，视觉仍粘连，故取 54px），因为「刚好贴边」在几何上合法、在阅读上不成立；**(d)** 判断遮挡用的是**声明尺寸**而非真实测量（jsdom 不做布局），而 `NODE_SIZE` 同时喂缩略图 —— 因此它必须与 CSS 实际尺寸同源，尺寸漂移会让不变量算出**看似成立**的结论。见 `renderer/src/map/model/toFlow.ts` · `renderer/src/map/model/layout.test.ts` · `docs/issues.md` ISS-053 | 已定 |

| D-43 | **IPC 路由按「方法 + 路径模板」注册**：`Route.method` 缺省 `GET`（老调用点 `invoke({ path })` 行为完全不变，这是有意的向后兼容）；`Route.path` 支持 `:name` 段并把命中值放进 `ctx.params`；**形状相同**的两条模板（如 `:id` 与 `:code`）在**注册时**直接抛错；`Router.paths()` 返回 `方法 + 路径` 供文档断言使用 | 起因是 `ISS-054`：写接口落地时 `POST /api/sites`（创建）与 `GET /api/sites`（列表）无法共存 —— 只按 path 索引的注册表**结构性装不下** REST 契约，硬塞会被「重复注册」检查拦下（后注册的覆盖先注册的）。三处判断：**(a)** 缺省方法取 `GET` 而不是「必须显式声明」：现有十余个调用点全部按读接口写，要求它们补 `method` 会让一次纯增量的改动变成大范围返工，而**默认值是兼容面最小的一侧**；**(b)** 形状冲突在**注册时**报错而不是运行时匹配不到：`:id` 与 `:code` 同形，运行时无法区分，后注册的那条会永远 404 —— 而「接口在、但永远 404」几乎无法从报错里看出原因；**(c)** 路径参数走 `ctx.params` 而不是塞进 `payload`：`payload` 是**请求体**，把路径里的 id 混进去会让「更新哪一条」在参数校验与审计里都失去可核对的位置。见 `desktop/src/ipc/router.ts` · `desktop/src/ipc/router.dispatch.test.ts` · `docs/issues.md` ISS-054 | 已定 |
| D-44 | **M2 写路径的字段规则唯一作者是 `shared/src/base-rules.ts`，主进程与浏览器 Mock 只共享规则、各自存储**：长度 / 数值域 / 枚举 / 自环 / 「`code` 创建后不可改」都在该文件，主进程的 `domain/base/*.service.ts` 与 Mock 的 `mock-base-write.ts` 都调它；**存储那一半**（唯一性、引用存在、写表）各查各的（SQLite vs 内存数组）；空值语义固定为三档 —— **不发**（缺省由服务端决定，如站点坐标跟随绑定节点）/ **发 `null`**（真的清空可空列）/ **报必填**；编辑一律**只提交真正改过的字段**，且编码永远不进补丁 | 起因是 `ISS-051` 的同类担心（边编码曾准备在主进程与 Mock 各写一份）：两份规则不会同时改，而分叉**只在切换形态时显形**，最容易被当成「Mock 不准」放过（D-27 的事故形态）。三处判断：**(a)** 规则放在 `shared` 而不是领域层：领域层只能被主进程 import，Mock 取不到，放那里等于逼 Mock 抄一份；**(b)** 与 `ipc/validators.ts` 的分界不是「谁更严」而是**能不能给出字段级原因**：传输层判形状（是不是字符串 / 非空）且失败时无法归因到具体字段，业务合法性判在 `base-rules.ts` 与领域层、能给出 `detail.fields`；**(c)** 编辑只发改动过的字段不是省流量：站点的坐标在「只改了绑定节点」时要**跟随新节点**（`resolveXY`），若每次编辑都把 `x`/`y` 一起带上，那个派生逻辑永远不会触发，站点会留在旧坐标上而界面看起来一切正常。见 `shared/src/base-rules.ts` · `renderer/src/base/form.ts` · `desktop/src/domain/base/` · `docs/issues.md` ISS-051 | 已定 |
| D-45 | **`OBJECT_TYPES` 扩项定案：新增 `restriction` 与 `taskTemplate`；`order` 暂不加入** —— 取值用 camelCase（与既有成员 `taskTemplate` 风格一致），并用迁移 `desktop/migrations/0003_object_types.sql` 重建 `alerts.object_type` 的 CHECK（新表 + 搬迁 + 改名三步）。护栏：`desktop/src/db/db.test.ts` 往 `alerts` 插入各枚举值的探针行 —— 枚举加了值而 CHECK 没跟上会直接报红 | 起因是 `ISS-039` / 模块文档 §11 Q1：M2 两类主数据（禁行规则、任务模板）的审计 `objectType` 无处安放，而 `system` 兜底会让审计页无法按对象筛选（等于把缺口藏起来）。**为什么不是「先写代码、等评审」**：审计的 `object_type` 一旦写错就是历史数据，事后只能靠迁移猜着改 —— 因此先定枚举、再写服务。**为什么 `order` 仍不加**：订单是导入域的中间实体，是否落库、是否写审计取决于 D-15 的导入管线（评审批次 ISS-017/ISS-018）；在写入点出现之前先给取值定名，等于让枚举走在数据模型前面。地图侧的 `SelectableEntityType` 仍含 `'order'` —— 那是**图层**类型，与审计对象类型不是一回事（差别写在 `renderer/src/domain/labels.ts`）。**护栏为什么必须是「真插一行」而不是「比对两份清单」**：后者会在两边同时漏改时保持通过，而前者走的是真实的 CHECK 约束（曾把迁移文件移走验证它确实会红） | 已定 |
| D-46 | **迁移编号由 `docs/database.md` 的登记表独占**：新迁移取登记表里**下一个空号**（本轮为 `0003`），即使它前面还有未落地的 `0002`（导入管线）也**不占用、不插队**；执行顺序按文件名排序、跳过已应用者，因此 `0003` 会先于将来的 `0002` 应用 —— 两者互不依赖（0003 只动 `alerts` 的 CHECK） | 起因：`0002_data_import.sql` 已被登记表指派给导入管线（草案未落地），而 M2 这边确实需要一条新迁移。直觉做法是「0002 还没人写，先用它」——代价会在导入管线落地那天出现：要么让导入管线改号（那条已经来不及了），要么把这条改名，而 `schema_version` 里记的是**文件名**，改名等于让每个已应用过的库再执行一次。**编号一旦被应用就不能再改**（`schema_version` 里记的是文件名），所以宁可留一个空号。**第二个原因**：CHECK 约束是「就地不可改」的（SQLite 无 `ALTER COLUMN`），每次枚举扩项都要重建表；把它写成一条独立、可复现的迁移，比事后手工 `ALTER` 可靠。**`audit_logs.object_type` 没有 CHECK**，因此不需要同批重建 —— 这一点容易反过来想（见 `desktop/migrations/0003_object_types.sql` 的注释） | 已定 |
| D-47 | **列表 / 弹层 / 表单的公共骨架与通用机制归 `renderer/src/domain/*` + `renderer/src/api/*` + `renderer/src/styles/ui.css`，不归「先落地的那个模块目录」**：M2 的 `base/model`（列与筛选）/ `base/form`（表单模型）/ `base/useBaseDataList` / `base/useBaseDataWrite` 在上移后分别落到 `domain/{table,form,paging,tone,format,labels}.ts`、`api/usePagedList.ts`、`api/useApiWrite.ts`，样式从 `base/style/base.css` 搬进 `styles/ui.css`，类名前缀由 `udm-base__*` 上收为 `udm-list__*`；只有**本页特有**的排版（如任务页的进度单元格、确认层、详情分区）留在模块目录下的 `style/*.css`（D-36 的延续：被 2 处以上使用 → 归设计系统） | 起因是 M3 任务页要复用 M2 的列表骨架，而它们住在 `base/` 下 —— 「`base`」这个名字会让 M3 的调用点变成 `import { useBaseDataList } from "../base/useBaseDataList"`，读者只能靠猜知道「base」指的是 M2 而不是「基础工具」。三处判断：**(a)** 判断标准是**使用处数**而不是「谁先写的」：先落地者把骨架放进自己的目录是自然的，但第二个模块一旦复用，那个目录就从「某模块的实现」变成了「公共设施」，此时**不动就是让名字说谎**；**(b)** 类名前缀同理：`udm-base__toolbar` 出现在任务页上会让「改样式会不会影响基础数据页」无法回答，上收为 `udm-list__*` 后「按前缀定位影响面」恢复可用；**(c)** 这次上移**顺手删掉了 `base/style/base.css`**，因为它的内容已全部属于公共部分 —— 留一个只 import 别处的空壳样式表，下一个要加 M2 专属样式的人会往那里写，公共/专属的边界会再次模糊。见 `renderer/src/domain/table.ts` · `renderer/src/api/usePagedList.ts` · `renderer/src/api/useApiWrite.ts` · `renderer/src/styles/ui.css` | 已定 |
| D-48 | **「展示口径」必须由函数产出可核验的具体名字，禁止在调用点拼字符串**：色调统一走 `renderer/src/domain/tone.ts` 的 `toneClass(tone, prefix)`（**原样拼接**，前缀由调用点给全）与 `badgeToneClass(tone)`；`tone.test.ts` 的断言从「函数返回了什么字符串」升级为**直接读 `styles/*.css` 核验该类名存在**。同一原则适用于其它展示口径：状态 / 优先级 / 动作 / 告警级别的中文只在 `domain/labels.ts` 写一份 | 起因是 `ISS-060`（实测）：`toneClass` 早先自己补一个横线（`` `${prefix}-${tone}` ``），而三个调用点传的前缀**已经带尾横线**，于是拼出 `udm-progress---ok` / `udm-badge-ok` / `udm-fleet__seg---ok` —— 三个**样式表里都不存在**的类名，进度条、状态徽标、车队分布条的色调**从来没有生效过**，且不抛异常、不打日志、不会让任何用例变红。三处判断：**(a)** 拼接约定横跨「调用方」与「被调方」两侧，而两侧各自看都合理 —— 这类缺陷**不能靠改对那一行解决**，必须让类名只有一个产生点（所以 `badgeToneClass` 是新增的，而不是让调用点自己拼 `udm-badge--`）；**(b)** 断言必须读到**样式表**为止：「函数返回 `udm-progress--ok`」与「`.udm-progress--ok` 真的存在」是两件事，前者的绿灯掩盖了 `ISS-048`（类名无定义）与 `ISS-049`（类名无人用）这两次事故，只有后者能同时挡住改名与拼错；**(c)** 这与 D-33（错误码只改一处）、D-34（每个事实只有一个作者）是同一条原则在**展示层**的应用 —— 一个可漂移的字符串只允许一个作者，其余都是读者。见 `renderer/src/domain/tone.ts` · `renderer/src/domain/tone.test.ts` · `docs/issues.md` ISS-060 | 已定 |
| D-49 | **路径搜索内核放 `shared/`（`route-search.ts` / `route-graph.ts` / `route-rules.ts`），不放 `desktop/src/algorithms/`**：算法是**纯函数、无 IO**，主进程（真实 SQLite）与浏览器 Mock（内存库）**要用同一份实现**，两侧只各自提供「从自己的存储读出图」；错误码 / 常量 / 类型同样只在 `shared/` 定名 | 起因是架构直觉：`design.md` §2 画的算法层在主进程侧，`docs/module-M4-dispatch.md` 也把算法规划在 `desktop/src/algorithms/`。但 M5 落地时出现了第二个调用方 —— **浏览器 Mock 形态**（`VITE_API_ADAPTER=mock`，用户可在没有 Electron 的环境里开发与演示）。若把内核放主进程，Mock 只有两条路：**(a)** 渲染层再抄一份（两份实现的分叉**只在切换运行形态时显形**，而两端各自的用例都是绿的 —— 与 `ISS-061` 同一类事故）；**(b)** 渲染层 `import` 主进程代码（Electron 打包后路径不成立，且把 Node 侧依赖拖进浏览器）。选择第三条：**算法纯函数放 `shared/`，存储各自**（`desktop/src/db/repositories/route.repo.ts` 读 SQLite，`renderer/src/api/mock-data.ts` 读内存）。判断标准是**「这段代码有没有 IO」**：有 IO 的留主进程，没有 IO 的按调用方数量决定归属。见 `shared/src/route-search.ts` · `docs/module-M5-route.md` §3 | 已定 |
| D-50 | **`slow_edge` 警告只在「全网速度确实有差异」（`maxSpeedMps > minSpeedMps`）时产生**：速度一致的路网上不产生任何 `slow_edge`，回执的 `warnings` 为空数组 | 起因是 `ISS-063`：判据原写作 `speedMps <= graph.minSpeedMps`，而 seed 的四类道路速度**恰好完全一致** —— 于是**每一条边、每一条路线**都满足，规划 `n01 → n12` 这条理想路线也带一句「途经边 … 为全网最低速段」。三处判断：**(a)** 这条警告的语义是「有更快的路可走」，落不到「当前全网一个速度」的输入上 —— 判据缺了前提；**(b)** **永远出现的提示等于没有提示**：一旦每条路线都报，使用者的正确反应是「忽略它」，那么它真正该报警的那次也会被忽略；**(c)** 因此修法是**先判差异存在**（`maxSpeedMps > minSpeedMps`）再逐边比较，而不是把比较符从 `<=` 改成 `<`（后者只治标：只要有一条边恰好等于最小值，仍会误报）。见 `shared/src/route-search.ts` · `docs/issues.md` ISS-063 | 已定 |
| D-51 | **M4 调度内核放 `shared/src/dispatch-*.ts`，不放 `desktop/src/algorithms/dispatch/`**（模块文档 §3 原计划在桌面侧）：与 M5 同一条理由 —— 内核是**纯函数、无 IO**，而浏览器 Mock 形态必须给出与主进程一致的结果（三层一致性是项目不变量），**迟早要复用同一份实现**；快照的读取留在各端（主进程 `repositories/`、Mock 内存库） | 落笔时按模块文档 §3 把内核写在了 `desktop/src/algorithms/dispatch/`（当时只有一个调用方，符合 D-49 的「按调用方数量决定归属」）。回头对照 D-49 才意识到 M4 与 M5 处境相同：M5 的内核之所以进 `shared/`，就是因为 Mock 要复用；M4 的 `preview` 同样必须两端一致，等 Mock 落地再搬要动 700 行代码 + 5 个测试文件，**而此刻没有第二个调用方，移动零成本**。判断依据仍是 D-49 的那一句：**「这段代码有没有 IO」** —— 没有 IO 且「两端都要用」的进 `shared/`，有 IO 的留主进程。同时把模块文档 §3 的目录树与 §4 的快照形状一起回写（快照带**原始图输入**而不是一张已裁剪的图：构图与禁行判定要**按车种**各做一次，AGV 与无人机默认速度不同） | 已定 |
| D-52 | **调度的三张词表（策略名 / 拒绝原因 / 日志动作）唯一作者放 `shared/src/constants.ts`**（`DISPATCH_STRATEGY_LABELS` / `REJECT_REASON_LABELS` / `DISPATCH_LOG_ACTION_LABELS`）；主进程 `domain/dispatch/explain.ts` 只做再导出（`STRATEGY_LABEL` / `REJECT_REASON_LABEL` 保持旧名给既有调用点），渲染层的 `domain/labels.ts` 也再导出，**不在任何一端重写中文** | 这三张表有**三个**使用方且跨进程：主进程（`explain.ts` 出人读文案、`api.ts` 的日志回执）、浏览器 Mock（`mock-dispatch.ts` 要给出与主进程相同的回执）、渲染层（调度台表格的策略列 / 拒绝原因列 / 日志动作列）。任一处各写一份中文，**分叉只在切换形态或换个角色看同一个对象时显形** —— 与 D-49 / D-51 是同一个判断（「这段代码有没有 IO」之外再加一句：**有没有多个使用方**），也是 `ISS-061`（两形态文案不同）与 `D-27`（mock 与 seed 形状相同、内容不同）的同类防线。**与 D-33 的分工**：错误码的 `message` 由 `shared/src/errors.ts` 独占（那是「这个 code 是什么」），这里的词表负责**枚举取值到中文**的映射（那是「这个值怎么称呼」），两者不重叠 —— `REJECT_REASON_LABELS` 里没有 code，只有 `RejectReason` 的取值 | 已定 |
| D-53 | **「预留」不是可重入动作、「回收」只释放这一单的占用**：`apply` 内同一辆车只走**一次** `idle → reserved`（用 `reservedInBatch` 区分「本批次已由我们预留」与「被别的批次抢走」），同一辆车在一批里出现多条计划是**合法形态**（内核按半开占用区间排，见 `docs/module-M4-dispatch.md` §6）；回收（重算 / 取消）前先问 `hasOtherActivePlanForVehicle`，该车仍被其它生效计划占用时**不置 `idle`**。**跨批次仍保守拒接**：车辆处于 `reserved` 就不进下一次预览的候选（更细的跨批次串行排程留给二期） | 起因是实测的两个连通缺陷（`ISS-069` / `ISS-070`）：把「一车一批一单」当成不变量写进了落库层，而内核从来不保证这件事 —— 内核保证的是**区间不重叠**。两处的后果正好相反却同源：前者**能派却拒绝**（还报一句与事实无关的「车辆状态不允许该操作」），后者**不能派却放行**（车辆显示空闲、身上挂着未完成计划，下一次调度把车派出去，两条计划真重叠而查不出是哪一步错了）。**为什么不去掉跨批次的保守边界**：那需要把「谁先占用、谁等谁」变成可解释的排程语义（涉及优先级、时间窗与执行器反馈），属于二期；此刻宁可少派一单并如实说明原因，也不要派出一单后面谁也说不清的计划。**为什么加「同车占用重叠 → `DISPATCH.PLAN_EXPIRED`」这道守卫**：`apply` 读的是预览存档，存档是过去某一刻算出来的，内核保证当时不重叠，但存档可能被改动或来自旧版实现 —— 与其把两条互相矛盾的占用写进库，不如拒绝并要求重新预览 | 已定 |

| D-54 | `edges` 新增 **`weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 1)`**（`desktop/migrations/0005_edge_weight.sql`）：语义是**耗时惩罚系数**而不是长度 —— 通行耗时 = `length_m × weight ÷ 有效限速`；`>= 1` 是**硬约束**（不是随手写的下限），因为 A* 的启发式是「欧氏直线距离 ÷ 全网最高速度」，只有边代价 ≥ 未加权代价时才不高估剩余代价，允许 `weight < 1` 会让 A* **静默返回非最优路线**（不报错，只是偶尔绕远） | 起因是「让调度更复杂」这个诉求在**数据上无处表达**：样本的静态路网里长度只有 80/150/160 m 三档、限速只有 10/15/20 km/h 三档，于是任意两点间往往只有一条时间最优路 —— 贪心与匈牙利给出**完全一样**的计划，界面上的「哪个策略更快、快多少」恒等于 0。**为什么不能借用现有两列**：`length_m` 是物理事实，用它表达拥堵等于谎报距离（对比表里「少跑 450 m」会变成一句假话）；`speed_limit_mps` 是交规事实，为了表达拥堵而改写它，会让「这条路限速多少」这个可查证的问题变得不可信。现实里「同一段长度可能更贵」（施工占道 / 限流 / 路面差 / 高峰）必须有第三列。**为什么是 ≥ 1 而不是 > 0**：见左栏 —— 这是算法正确性约束，不是取值风格；写入小于 1 的值报 `VALIDATION.FAILED`。见 `docs/api.md` §3.2.4（契约）、迁移文件头（完整理由）、`renderer/src/map/edges/NetEdge.tsx`（画布上的橙色点线） | 已定 |
| D-55 | seed 与浏览器 Mock 的演示数据**改为同一个函数推导**（`shared/src/seed-data.ts` 的 `buildSeedDataset()`），`desktop/src/db/seed.ts` 只做「取数（读 `data/campus/`）→ 推导 → 落库」，`renderer/src/api/mock-data.ts` 调的是**同一个函数** | 这是 D-27 的升级，不是重复：D-27 说「mock 用 `SEED_IDS` 与 seed 同规则派生」，落地后仍是**两份代码各推一遍**，比对靠测试。换成一份推导之后，**比对不可能失败，因为它不再有两份** —— 而「不可能失败」比「失败得很快」更根本。同时把业务数字从代码里赶了出去：`seed.ts` 与 `docs/database.md` §4 里都不再写「12 节点 / 34 边 / 间距 20 m」这类会漂移的数值，它们住在 `data/campus/` 的 CSV 与推导函数里（D-34 的同一原则：每个事实只有一个作者）。代价是 seed 依赖 `data/campus/` 存在 —— 因此那四个文件**必须纳入版本控制**（`.gitignore` 的 `.db` 规则不覆盖它们） | 已定 |
| D-56 | **演示数据的时间戳必须相对「现在」派生，不得写成常量**（`renderer/src/api/mock-data.ts` 的 `MOCK_AT` 改为模块加载时刻；演示待派任务的时间窗在 seed 复跑时刷新，且**只在任务仍为 `pending` 时**刷新） | 起因是本轮实测的两个连通缺陷（`ISS-077` / `ISS-078`）：`MOCK_AT` 被写成 `'2026-01-01T00:00:00.000Z'`，而调度用的 `now` 是真实时刻 —— 于是**浏览器形态下 6 条演示任务 100% 报「时间窗冲突」**，看起来像算法或校验坏了；同一个常量还让演示告警的「停滞时长」显示成「已 9 个月未认领」。两个后果形态不同、根因相同：**把「一个具体日期」当成了「相对当前时刻的关系」**（与 `ISS-073` 是同一族）。**为什么只在 `pending` 时刷新**：任务一旦被派发/执行，时间窗就是业务数据，seed 无权改写 —— 幂等不等于「每次启动都重置」 | 已定 |
| D-57 | **任务风险预检不是告警**：`GET /api/alerts/risks` 不读不写 `alerts` 表、不进状态机、没有 `id`、不能认领；判据（7 类风险）的唯一作者是 `shared/src/plan-risk.ts` 的 `scanPlanRisks`，主进程与浏览器 Mock 调**同一个函数**；报告一次给出「风险清单 / 已生效派发 / 未派发缺口」三个视图，`assignments` 的排序由服务端定死 | 起因是「告警中心要能把任务冲突与超时都列出来」这个诉求 —— 但**把它们做成告警是错的**：告警是「已经发生」的事（车辆离线了），有状态机、要人认领、要留处置结论；「**预计**会超时」被认领掉没有任何意义，它要么被处理掉（改派 / 调窗口），要么等它真的超时、由执行器落一条真告警。把两者混在一张表里会立刻产生两个恶果：① 预检每次刷新都新增一批「告警」（去重窗口也救不了，因为数字每次都在变）；② 使用者去点「认领」而不知道该做什么。**为什么判据放 `shared` 而不是渲染层**：`renderer/src/ops/model.ts` 只做展示，「这条计划会不会超时」是业务判断 —— 放渲染层会立刻产生第二个裁判（界面说超时 5 分钟、内核按同一份数据放行），使用者只能猜哪个对。**为什么三个视图合在一个回执里**：它们是同一次读取的三个切面，分成三次请求就会出现「风险说某车撞单，而派发区块里那两单已经不在」。见 `docs/api.md` §3.8.3 | 已定 |
| D-58 | **「派发后立即开跑」在渲染层组合，不改服务端契约**：调度中心的 apply 仍是 `POST /api/dispatch/apply`（只到 `assigned` / `reserved`）；apply 成功后，若开关开启且会话拥有 `execution:start`，渲染层**逐单顺序**调用 `POST /api/execution/tasks/{id}/start`，并把逐单结果（成功 / 失败原因）显式展示。开关默认值 = 会话是否有 `execution:start`，无权限则整块隐藏并说明原因 | 使用者要求「订单应用后车就能在地图上跑起来」，而 D-11 把「派给谁」（`dispatch:apply`）与「现在开跑」（`execution:start`）分成两个权限点。三条路里：①服务端 apply 自动 start —— 合并权限点、推翻 D-11，且事务里混入执行器副作用，「apply 失败」与「start 失败」会退化成同一个错误码；②保持纯手动 —— 不满足诉求，地图上永远没有刚派发的车在动；③渲染层组合 —— 契约与权限点不变，代价是存在「已派发未开跑」的显式中间态。选③，并把中间态**展示出来**而不是藏起来（部分失败不掩盖成功部分）。待评审见 `docs/issues.md` ISS-088 | 已定 |
| D-59 | **车辆中心 `/fleet` 是运行态读模型，不是第二套车辆 CRUD**：数据源为 `GET /api/monitor/vehicles` + `GET /api/map/overview` + `GET /api/map/tracks/{vehicleId}`；页面准入复用 `monitor:read`（**不新增权限点**）；`base:write` 才显示「编辑 / 启停」入口，且**跳转到基础数据页**执行，不在本页复制车辆表单 | 车辆表单与校验的唯一作者已确定（`renderer/src/base/` + `renderer/src/pages/BaseDataPage.tsx`，M2 已落地）；在 `/fleet` 再写一份 vehicle 表单会得到两处各自演化的字段清单与校验（D-34）。把「加车」留在基础数据、把「看车」独立成一页，是本轮成本最低且不产生第二作者的切法。页面路由/导航的唯一作者仍是 `renderer/src/app/modules.ts`；需求条目见 `design.md` §4.2 的 Req-M2-8 | 已定 |
| D-60 | **批次「加权综合分」必须包含未派发惩罚**：`summary.totalCost` = `Σ(已派发计划的加权代价) + 未派发单数 × DISPATCH_UNSERVED_PENALTY_S`；算法唯一作者是 `shared/src/dispatch-evaluate.ts` 的 `compositeScoreOf(plans, rejectedCount)`，全部 7 处汇总点（`shared/src/dispatch-strategies.ts` 2 处 · `desktop/src/domain/dispatch/dispatch.service.ts` 2 处 · `renderer/src/api/mock-dispatch.ts` 3 处）**都调它**，不各自写一份 `reduce` | 缺陷是旧口径只累加**已派发**计划的 `cost`，被拒任务贡献 0 —— 于是「拒得越多分越低」。实测（18 条待派）贪心派 9 单加权综合分 35546、匈牙利派 4 单 51656；但**旧口径**下匈牙利 1256 < 贪心 3146，指标会把「少干 5 单活」推成推荐策略，与「指派数优先」的推荐口径自相矛盾。惩罚取值必须**严格大于任何单条计划代价**，否则出现「故意拒掉贵单反而分更低」的反向激励：本演示路网实测单条计划代价上界 ≈ 2773 加权秒（空驶 + 执行 + 晚点 / 续航最坏项），取 3600 留约 1.4 倍余量。`desktop/src/domain/dispatch/dispatch.service.test.ts` 用**真实 seed 穷举** `max(plan.cost)` 断言它小于惩罚 —— 地图变大或惩罚调小时该用例先红。属**口径常量**，二期接真实成本模型（违约赔付 / SLA）时改为可配置。见 `docs/module-M4-dispatch.md` §7.3 / §7.4 | 已定 |
| D-61 | **拒绝原因按「离能跑还差多少」排序，不按六步评估的步骤号取第一条**：`mostInformativeReject(fails)` 的 `REJECT_STEP_ORDER` 为「班次冲突 / 电量不足（只差资源，任务本身可做）> 车辆不可用（临时状态）> 载重 / 可达性 / 禁行（这台车对这条任务的**固有**约束）」，`NO_AVAILABLE_VEHICLE` 兜底恒排最后；并列时保留先遇到的那条（`snapshot.vehicles` 顺序稳定 → 结果可复核）。贪心改为收集**全部**失败后取最优，匈牙利步骤 1 同步 | 起因是 `runGreedy` 原先取「遍历到的第一个失败车辆」，而 `AGV-01` 恒 `busy` 且恒在 `snapshot.vehicles` 首位 —— 十几条占用区间冲突全被报成同一句「AGV-01 不可用」，真实瓶颈（四台可用车班次排满）读不出来。**不能直接按步骤号排序**：步骤 1 的 `VEHICLE_NOT_AVAILABLE` 会把「有车能装但暂时被占」误报成「装不下」；反向反例同样必须成立 —— 900 kg 任务在唯一的大车 `CAR-02` 被预留后，其余车全是 `LOAD_EXCEEDED`，优先报它又说成「没有车装得下 900 kg」，而**事实是有的、只是不可用**。两个方向的反例各写成一条用例。修掉 `ISS-093`。见 `shared/src/dispatch-strategies.ts` | 已定 |
| D-62 | **车辆状态管理接口增加唯一一个运行态端点 `fault`（人工报障）**：白名单 `MANAGED_VEHICLE_STATUSES = idle / disabled / fault`、冲突判定 `vehicleStatusConflictOf(from,to)`（返回 `disableOccupied` / `faultRunning`）都放 `shared/src/base-rules.ts`，主进程领域服务与浏览器 Mock **共用同一个函数**；基础数据页车辆行加「标记故障 / 恢复可用」，走的是既有 `PATCH /api/vehicles/{id}/status`；审计动作 `fault` 与 `disable` 分开 | 起因是 `ISS-097`：演示四步流程的第三步「告警中心对新订单的冲突进行提示」在界面上**看不见** —— 节 1 五类风险里 `VEHICLE_UNAVAILABLE` 的触发条件（车状态 ∈ `offline`/`fault`/`charging`/`disabled`）没有任何常规操作能造出来。三条路里 ①「只用短时间窗配方」不改代码但只覆盖 `LATE_FINISH` 一类、②「执行器低电置 `charging`」要等十几单才耗到 20%、③ 给运维一个手动入口 —— 选③，因为**「现场先知道车坏了」是真实业务事实**，不是演示糖：没有它只能在「什么都不能做」与「停用（软删，语义更重、且不能停在已派发车上）」之间二选一。**为什么只给 `fault` 一个**：`offline`/`charging` 是纯设备/电量读数，人工置它们等于伪造读数；`fault` 是「人观察到的结论」。**为什么不下放到演示数据**：常驻一条冲突会重新踩 `ISS-096`（「我什么都没做，它凭什么说我有冲突」）—— 正确形态是**可手动触发**。**护栏**：`busy`（执行器正在驱动）既不能停用也不能报障（`faultRunning`，否则「故障车还在跑」），`reserved`（已派发未开跑）**可以**报障（改派代价最低的时刻）。见 `docs/api.md` §3.2.2 / `docs/module-M2-base-data.md` §6.1 | 已定 |

| 2026-09-28 | 站点锚定路网节点一律取边的 `fromCode`，演示路线里程虚增近一倍 | 「边的第一个端点」是**文件里的书写方向**，被当成了「站点实际在哪一端」 | 改为按几何最近端点判定（`nearestEndpointOf`，端点缺失即抛错） | `shared/src/seed-data.ts`（ISS-076） |
| 2026-09-28 | 浏览器 Mock 形态下 6 条演示待派任务**全部**被拒（`TIMEWINDOW_CONFLICT`），Electron 形态正常 | 演示数据的时间基准写成常量 `2026-01-01`，而调度用的 `now` 是真实时刻 —— 任务窗在 1 月、车的可用区间在 9 月 | 改为模块加载时刻派生（D-56）；写明「演示数据的时间戳不能冻结」 | `renderer/src/api/mock-data.ts`（ISS-077） |
| 2026-09-28 | 告警中心的「停滞」列显示「已 9 个月未认领」 | 与上一条是**同一个常量**的第二次发作：演示告警手写了冻结的 `createdAt` | 演示告警改为从与 seed 同源的 `mockSeedDataset().demoAlert` 取 | `renderer/src/api/mock-ops.ts`（ISS-078） |
| 2026-09-28 | 车辆表单新增「所在节点」后该下拉**永远为空**，而站点页签的同名字段正常 | 「谁需要候选清单」是页面里手写的页签判断，与字段定义各有各的作者；漏改不报错（空下拉只是一个空框） | 候选需求改由字段定义推导（`optionNeedsOf(tabKey)`），页面只调用 | `renderer/src/base/form.ts`（ISS-079） |
| 2026-09-28 | 新增的「慢边橙色点线」不生效，顺带发现 `is-muted` / `is-disabled` 两条**旧规则也从未生效** | 标志类被 React Flow 拼到外层 `<g>`，而 CSS 选择的是 `BaseEdge` 渲染的 `<path>` —— 不是同一个元素 | 类名改由边组件从 `data` 派生；新增**反向**护栏：从 `map.css` 提取 `path` 选择器，断言都能被组件产出 | `renderer/src/map/edges/NetEdge.tsx` · `NetEdge.test.tsx`（ISS-080） |
| 2026-09-28 | seed 换地图后 14 个套件、142 条用例失败，失败信息看起来像跨端分叉 | 夹具里写死了上一版 seed 的形状（网格节点 id、坐标、边编码）；引用不存在的行会得到一句「合理但与夹具有关」的业务错误 | 夹具改用由数据推导的 id（`campusNodeId('N00')` 这类）；断言绑定性质而非具体数字 | `renderer/src/api/mock-parity.test.ts` 等（ISS-081） |
| 2026-09-28 | 文档写回后复跑 `npm test`，`errors.catalog.test.ts` 变红：`docs/api.md` 里写着 `BASE.NODE_NOT_FOUND`，登记处没有这个 code | 写 §3.2.2 时按「域 = 业务模块」的直觉起了个 `BASE.*` 名，而代码里这一概念叫 `NODE.NOT_FOUND`（站点 / 边 / 路径共用一个）。**直觉命名与登记处不一致，且没有任何人比对过** | **修文档而非加码**：把 §3.2.2 改成 `NODE.NOT_FOUND`（加一条 `BASE.*` 等于给同一概念开第二个 code，D-33 禁止）。交给 `errors.catalog.test.ts` 兜底 —— 文档与登记处不一致时测试先红 | `docs/api.md` §3.2.2 |

## 困难与问题记录

| 日期 | 问题现象 | 原因分析 | 解决/状态 |
| --- | --- | --- | --- |
| 2026-09-07 | 原始需求文档落在误建目录 `/Users/sunsetflower/myJobs/js/831:n`（文件名带冒号） | 建目录时误输入 `:n` | 已迁移至本仓库 `docs/requirement-raw.md` 并删除误建目录 |
| 2026-09-07 | 使用 `apply_patch` 写入大段中文 Markdown 时偶发「空行无补丁前缀」报错 | 空行缺少 `+` 前缀，补丁原子回滚 | 已按行加前缀分段写入；后续大文件改动沿用分段写入法 |
| 2026-09-14 | `npm test` 的 5 个测试套件均在收集前失败 | `tests/setup.ts` 引用了 `@testing-library/jest-dom/vitest`，但依赖中未安装或未声明 | **已解决（2026-09-20）**：补齐依赖；实际还有第二个原因（`node:sqlite` 在 vite-node 下不可解析），见本表 2026-09-20 对应行。现 15 套件 / 94 用例全通过 |
| 2026-09-14 | renderer 没有 `src/main.tsx` | 只有 Vite 壳层文件，`index.html` 已指向不存在的入口 | **已解决（2026-09-20）**：补齐入口与全套渲染层（适配器 / store / 路由 / 页面 / React Flow 地图），`npm run build` 与 Electron 端到端均已通过 |
| 2026-09-14 | `design.md` §2.3 仍写作 `better-sqlite3`，与实现及 D-14 不一致 | 文档阶段选型未随 P1 实现更新 | **已解决（2026-09-20）**：`design.md` 数据层行已统一为 Node 内置 `node:sqlite` |
| 2026-09-14 | `docs/build-plan.md` §2 前置条件与 §7 风险表仍以 `better-sqlite3` + `@electron/rebuild` 为前提 | 同上，构建计划未随 D-14 更新 | **已解决（2026-09-20）**：§2 改为「无原生编译依赖」，§7 风险替换为 `node:sqlite` 版本下限与 vite-node 解析风险 |
| 2026-09-14 | `renderer/` 同时存在嵌套 `node_modules`（Vite 6.4.3），根 `node_modules` 为 Vite 5.4.21 | renderer 依赖未完全提升；两套 Vite 并存 | 属正常 workspaces 现象，但需注意：`renderer/vite.config.ts` 由 Vite 6 执行，根 `vitest.config.ts` 由 Vite 5 执行；排查构建/测试问题时要区分版本 |
| 2026-09-14 | `npm run build` 在 renderer 阶段失败，`npm run dev` 看似正常但拿不到入口 | `renderer/index.html` 引用 `/src/main.tsx`，该文件不存在；dev server 用 SPA 兜底返回 `index.html`，被误判为 200 成功 | **已解决（2026-09-20）**：入口已补齐，`npm run build` 三端全通（renderer JS 379.34 kB / gzip 124.00 kB） |
| 2026-09-14 | `npm run dev:electron` 端到端链路从未验证 | renderer 无入口，Electron 加载 `http://localhost:5173` 必然白屏 | **已解决（2026-09-20）**：已端到端验证 —— 登录 → 地图渲染 20 节点 / 39 边 / 5 路线标签，与 seed 一致；生产 `file://` 形态亦通过 |
| 2026-09-15 | 能耗估算缺乏量纲正确的模型：代码注释中出现 `kmToWh(总里程)`，把「里程」直接当「耗电」 | 设计阶段只有「按里程估算」一句，未定义单位与电池容量口径 | 已在 `docs/data-interfaces.md` §5.4 固定为「每公里耗电 × 里程」并给缺容量时的退化口径 + warning。**⚠️ 本行的 `Wh/km` 与 `batteryCapacityWh` 口径已被 2026-09-21 的 D-31 取代为 `kWh/km` 与 `batteryCapacityKwh`（以样本为准）**；实现 M4 时按 §5.4 现行版本改写 |
| 2026-09-15 | 算法配置存在两处可改同一参数的隐患（`settings` 表 vs 导入型配置集） | D-12 决定权重走常量、D-20 引入配置集，二者边界未定义 | 已定为「重叠项以 `settings` 优先 + info 提示」（`docs/data-interfaces.md` §6.4）；**待评审** |
| 2026-09-15 | 导入进度无承载通道：现有事件总线仅有 `task.changed` 等业务事件，不适合承载批次进度 | 导入为长耗时操作，IPC 默认等待不足 | 记为待评审问题 Q6（倾向先轮询 `GET /api/imports/{id}`），未擅自新增事件名 |
| 2026-09-20 | Chrome 直接打开 `file://` 产物时 React Flow 不渲染，一度疑似打包缺陷 | Chromium 以 CORS 规则拦截 `file://` 下的 ES module 脚本；用最小复现（纯 `type="module"` 脚本 BLOCKED、同内容的传统 `<script src>` 正常）确认与 React Flow 无关 | **已排除**：真实 Electron 44 用 `loadFile()` 实测渲染正常（视口/节点/边/边路径 DOM 齐全）。验收请用 `dev:electron` 或 `vite preview`，不要用 Chrome 开 `file://`。兜底为单文件 IIFE 构建（实测在 `file://` 下可渲染）。见 `docs/module-M6-map.md` §11 |
| 2026-09-20 | jsdom 中 `render(<ReactFlow/>)` 直接抛 `ReferenceError: ResizeObserver is not defined` | React Flow 依赖 `ResizeObserver` 测量节点尺寸，jsdom 未实现该 API | 已给出最小 stub（`ResizeObserver` + `matchMedia`）并实测通过；但**必须先修复 `tests/setup.ts` 的既有依赖缺失**，否则新增用例同样无法收集。见 `docs/module-M6-map.md` §10.1 |
| 2026-09-26 | 抽出 `api.ts` 的分页/校验工具后，`DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` / `DomainError` 成了未使用导入，而 `npm run typecheck` 照样 exit 0 | tsconfig 未开 `noUnusedLocals` / `noUnusedParameters`，未使用导入不算错误；`vite build` 也会 tree-shake 掉，两处都不会报 | 逐个 `rg` 确认无引用后删除。**教训**：类型检查不会替你发现这类残留，重构后需自查一次文件的导入表 |
| 2026-09-26 | 自写的文档自检脚本在最后一项（扫全仓库 `ISS-xxx` 引用是否都已登记）抛 `IndexError` 退出，而前 5 项结论已正常打印 | 归一化函数写错：把锚点 `iss015` 按 `ISS-015` 的形态 `split('-')` 取第 2 段，越界 | 改为按数字归一化，修后实测 `none`。**教训**：脚本「先打印一部分结论再崩」会让人以为检查跑完了 —— 这类脚本应把结论汇总到最后统一输出，或在退出码上体现 |
| 2026-09-26 | 基础数据页的列工厂 `column<T>(key: keyof T & string, …)` 内部仍要 `row as T` 两次强制转型，`column<SiteListItem>('x', …, { cell: (row) => point(row.x, row.y) })` 才能过编译 | 列是「异构同构表」：`cell` 需要按具体实体的字段取值，而列的**存储类型**只能是与具体实体无关的 `Column`；这个 gap 无法用泛型消除，只能在一处收口 | 保留该工厂并集中转型（只在工厂内部出现，使用处完全类型安全），另在 `model.test.ts` 里逐列断言显示口径 —— 转型的风险由**测试**兜住而不是靠类型系统 |
| 2026-09-26 | Mock 与主进程的列表接口天然是两份实现（浏览器跑不了 SQLite），最容易静默分叉的是 `keyword` 的**大小写**：SQLite `LIKE` 对 ASCII 不区分，JS `includes` 区分 | 两套运行时的字符串比较语义不同，而差异只在「大写关键词搜小写数据」时才显形 | Mock 侧显式 `toLowerCase()` 并在注释里写明原因；`mock-parity.test.ts` 用 7 组参数（含 `keyword: 'a'` 这类大小写混合场景）同时打两边比对，把「两份实现」的差异变成红灯 |
| 2026-09-26 | `listEdges({ code: '' })` 返回全量 34 条，而测试起初期望空结果 | `''` 在**仓库层**表示「未给筛选」（传输层 `optionalString` 已把空串转成 `undefined`）—— 同一形态在两层语义不同 | 用例里把 `''` 从「非法 code」清单中移出并写明分界。**教训**：`''` 在这类链路里同时可能是「没填」与「填错」，转义点只能有一处（本项目的选择是传输层） |
| 2026-09-20 | `@xyflow/react` 自带 `zustand@4.5.7`，与项目 `zustand@5.0.15` 并存两份 | React Flow 的 `dependencies` 固定 `zustand ^4.4.0`，npm 无法将其提升为根的单版本 | **属正常现象**，两者互不干扰（React Flow 只用自己那份）；排查版本问题需注意 `node_modules/@xyflow/react/node_modules/zustand`（实测：`@xyflow/react` 被提升到**仓库根**，嵌套那份也在根下；`renderer/node_modules/` 只有独立安装的 `vite` / `esbuild`）。已记入文档，与既有「两套 Vite」同类 |
| 2026-09-15 | 迁移编号可能冲突：`order-data-map-design.md` 建议 `0002_order_ingestion.sql`，`data-interfaces.md` 建议 `0002_data_import.sql` | 两份设计分别编号，均未落地 | **已解决**：统一为 `0002_data_import.sql`，`0002_order_ingestion.sql` 作废（见本文件 Q7 与两文档去重说明） |

| 2026-09-20 | `npm test` 的 5 个套件修完 setup 依赖后**仍全失败**：`Failed to load url sqlite` | 存在**两个**独立原因，此前只发现第一个：① `tests/setup.ts` 缺 `@testing-library/jest-dom`；② `node:sqlite` 在 Vite 5 / vite-node 下无法解析 —— vite-node 的内置模块白名单是打包时固化的（`prefixedBuiltins` 仅硬编码 `node:test`），且 `nodeBuiltins = builtinModules.filter(id => !id.includes(':'))`；Node 25 只在**带前缀**形式暴露 `node:sqlite`（`builtinModules` 无裸名 `sqlite`），于是前缀被剥成裸 `sqlite` 后查不到。另实测 esbuild 在任何 target 下都**不会**改写 `node:` 前缀，故非转译问题 | **已解决**：① 补 `@testing-library/jest-dom@^6.6.3`（实装 6.10.0）；② 新增 `desktop/src/db/sqlite.ts`，用 `createRequire(import.meta.url)('node:sqlite')` 惰性加载（`require` 不参与 Vite 静态解析）。已在真实 Electron 44.3.0（内置 Node 24.20.0）下复测通过 |
| 2026-09-20 | 表数量口径自检不一致：`db.test.ts` 期望 17 张业务表，实测 16 | 原口径把 `schema_version` 也算进了业务表；实际业务表 16 张 + `schema_version` = 17 张表 | **已解决**：修正测试为 16 并新增「精确表集合」断言；同步 `docs/architecture.md`（§6 标题与表）、`docs/database.md` §2 规模说明、`README.md`、本文件项目快照。**历史工作日志行按「只追加不篡改」原则保留原文** |
| 2026-09-20 | 地图渲染后**边全部消失**（`edges=0`），5 秒后才出现 | `vehicle.changed` 每秒触发一次全量快照重拉 → `nodes`/`edges` 每秒被重建 → React Flow 重新测量节点，测量完成前不渲染边 | **已解决**：事件分层（D-23），位置类事件只写 `positionsRef`；并加 `model/structural.ts` 结构签名避免轮询每秒换引用。实测修复后 250ms 内即出现 39 条边 |
| 2026-09-20 | `<MiniMap>` **一个方块都不画**，只剩空框 + 遮罩，且不报错；`resize` / `zoomIn` / `fitView` 均无法恢复 | React Flow 只为「有尺寸」的节点画方块（`nodeHasDimensions` 读 `measured?.width ?? width ?? initialWidth`）。实测画布渲染完成后用户节点的 `measured` 仍未落位。已用最小复现（官方推荐写法）确认**非本项目配置问题** | **已解决**：`model/toFlow.ts` 给每类节点补 `initialWidth`/`initialHeight`（`NODE_SIZE`，与 CSS 对应；不能用 `width`/`height`，避免与真实测量竞争）。实测 `minimap-node` 0 → 20；已加回归用例。见 `docs/module-M6-map.md` §11.5.1 |
| 2026-09-20 | 路线高亮**视觉上完全看不出**，但页面不报错 | `.udm-edge-route.is-active path` 这类「祖先 + 后代」选择器永远匹配不到：`<BaseEdge>` 把 `className` **拼到 `<path>` 自身**（`cc(['react-flow__edge-path', props.className])`），并不存在外层 `<g class="udm-edge-route">`。同类死选择器还有 `.react-flow__node.is-selected`（React Flow 用的是 `selected`） | **已解决**：改为 `.react-flow__edge-path.udm-edge-route.is-active` 与 `.react-flow__node.selected`。实测路线 `stroke` 由 `rgb(177,177,183)`/`1px`（默认灰）变为 `rgb(56,189,248)`/`4px`，节点选中光晕由 `none` 变为有效。见 `docs/module-M6-map.md` §11.5.2/§11.5.3 |
| 2026-09-20 | 深色画布上 `Controls`/`MiniMap` 是**一块白方块** | 两者用 React Flow 自带浅色默认样式，且不提供深色变量 | **已解决**：`style/map.css` 显式覆盖为 `theme.css` 变量；`MiniMap` 另传 `bgColor`/`maskColor`/`nodeColor`（按图层配色） |
| 2026-09-20 | 生产形态（`loadFile`）会**静默使用假数据** | 打包构建不带 `.env`，`VITE_API_ADAPTER` 为 `undefined`，原逻辑默认落 `mock` | **已解决**：默认值按「有没有 preload 桥」判定（D-22），并用 `api/index.test.ts` 锁死。实测生产 `file://` 形态自动选中 `ipc` |
| 2026-09-20 | seed 写入的路线 `edge_ids` 全部指向**不存在的边**（`seed-e-n01-n05`），无任何报错 | `edges.id` 里的 code 是**大写**（`seed-e-N01-N05`），节点 id 是小写（`seed-n01`）；`edge_ids` 是 JSON 文本列、**没有外键保护**，写错不报错，只在前端按 `edgeIds` 高亮时静默匹配不上 | **已解决**：改为用节点序号推导 `nodeCode()`；并在 `db.test.ts` 新增断言「每一段边都存在且相邻节点真实连通」 |
| 2026-09-20 | mock 快照与真实 seed 库的数据**形状相同但内容不同**（id 不一致） | `mock-data.ts` 声称与 `seed.ts` 保持一致，但是**手抄**的 id（`seed-n-N1` vs `seed-n01`、`seed-veh-AGV-01` vs `seed-veh-agv01`），电量与车辆状态也未同步 | **已解决**：mock 改为从 `SEED_IDS` 与 seed 同规则派生（D-27），并新增「mock 快照 == seed 库快照」的逐字段比对用例与「边按 id 排序」对齐，防止再次漂移 |
| 2026-09-20 | `design.md` §2.3 与 `docs/build-plan.md` §2/§7 仍以 `better-sqlite3` + `@electron/rebuild` 为前提 | 文档阶段选型未随 D-14 更新（自 2026-09-14 起挂账） | **已解决**：`design.md` 数据层行改为 Node 内置 `node:sqlite`；`build-plan.md` 前置条件改为「无原生编译依赖」，风险表替换为 `node:sqlite` 版本下限与 vite-node 解析风险 |
| 2026-09-20 | `README.md` 状态段仍写「P0 文档阶段 / 尚未 git init」 | 长期未同步（自 2026-09-14 起挂账） | **已解决**：改为「P1 地基已通 + M6 地图已实现」，补三端现状、命令与测试数 |
| 2026-09-20 | 车辆在地图上**不会移动**（位置恒定） | 无任何组件持续产生 `vehicle.changed`（模拟执行器属 M7，尚未开工）；前端补帧逻辑本身已实现并单测覆盖 | **未解决（待 M7）**：记为待评审 Q-6，执行器落地后接入；不得为了「看起来会动」在前端伪造位置 |
| 2026-09-21 | `docs/data-interfaces.md` 的 F1/F2/F3 三章字段契约与真实样本**大面积不符** | 三章写于 2026-09-15，当时**没有样本文件**，字段是按「通用订单/地图/车辆」的常识推演的：把时间假设成 ISO 8601、把优先级假设成 `low/normal/high/urgent`、把站点假设成节点绑定、把能耗假设成 Wh/km | **已解决**：按 `第三次课_数据准备/` 三类样本逐字段重写（§3/§4/§5），并新增 §13 实测速查表与 D-28…D-31。教训：**没有样本时不要写「字段级契约」**，应只写管线与错误模型；字段表一旦被下游当依据，重写成本远高于留白 |
| 2026-09-21 | 样本订单 `tw_start` 文本与 `tw_start_s` 秒数**对不上**（197/200 行） | 文本是**分精度**（`08:21`），秒数列可含非零秒（30066 = 08:21:06）。若按「秒级严格相等」校验，会把 197/200 行误判为错误数据 | **已解决**：契约明确「比对按分钟下取整」（§3.3），并把「实际存在非零秒」写进 §13 速查，避免实现时按直觉写严格相等 |
| 2026-09-21 | `campus.geojson` 一度被怀疑是 **WGS84 经纬度** | 文件**没有 `crs` 成员**，而坐标形如 `[[0,0],[150,0]]`、量级 0–760。已知样本场景是 760 m 见方的校园，若按经纬度解析会得到「0 度附近一张空白图」，且不报任何错 | **已确认非问题**：平面米制，与 D-05 一致。已在契约中把 `meta.coordinateSystem` 固定为 `planar-meters` 并在非该值时直接拒绝（`MAP.COORDINATE_SYSTEM_UNSUPPORTED`），把这类静默错误变成显式报错 |
| 2026-09-21 | 全项目存在**两套错误码目录**（34 条 vs 97 条，**零重叠**），且两份文档各自声称「唯一登记处」 | 「文档先行」阶段两份文档各写一套命名，均按「文件族」而非「业务概念」划分前缀；`data-interfaces.md` 是后写的、自称唯一，但实现与测试早已锁在 `errors.ts` 上 | 定 D-33：以 `shared/src/errors.ts` 为唯一登记处，两套合并为 123 条；命名统一为 `域.原因`（AIP-193 口径）；冲突时保留**更通用**的名字（`GRAPH.EMPTY` 胜过 `MAP.EMPTY_GRAPH`）。新增 `errors.catalog.test.ts` 把「文档中每个 code 都必须已登记」变成断言 · 出处：`shared/src/errors.ts` / `docs/api.md` §2 / `docs/data-interfaces.md` §8（ISS-001） |
| 2026-09-21 | 「导入时 warning、运行时 error」是否应拆成两个 code | 直觉上「严重度不同就该有不同 code」，但这正是本次要修的错误的翻版（同概念两个名字/两个 key，前端文案映射照样打挂） | 定 `severity` 为**调用点属性**：目录里存 `severity` 作为默认值，`ImportIssue.severity` 可覆盖；同一 code 只有一条登记记录，测试断言其唯一性 · 出处：`shared/src/errors.ts`（D-33） |
| 2026-09-21 | `EventBus` 把领域事件**无条件群发给所有窗口**，绕过 D-08 的服务端权限校验 | `emit()` 遍历 `this.targets` 直接 `send`，`attach()` 不绑定会话，事件类型也没有权限映射概念 | 定 D-32：`EVENT_PERMISSIONS` 显式登记「事件→权限点」，`attach(target, token)` / `bindSession()` 绑定会话，**未登录窗口收不到任何登记过权限的事件**；`event_log` 照写不误（只过滤推送） · 出处：`desktop/src/services/event-bus.ts`（ISS-009） |
| 2026-09-21 | mock 适配器返回主进程并不存在的错误码 `AUTH.INVALID_CREDENTIALS`，浏览器正常、Electron 下会静默失配 | mock 的失败助手 `failure(code: string, ...)` 接收任意字符串，未把 code 约束到 `ERROR_CODES` 的类型上；页面只读 `message` 所以看不出问题 | 删除该助手，改用 `fromCatalog(code: ErrorCode)` 并从目录取 `source`/`message`；新增 `mock-parity.test.ts` 锁死三层适配器错误码一致。**属 ISS-001 审计的附带产出** · 出处：`renderer/src/api/mock.ts`（ISS-030） |
| 2026-09-21 | 用脚本改写 `shared/src/errors.ts` 时**重复插入**整块 code（一度出现 212 个键、123 条唯一） | 生成脚本不幂等却被执行了两次；没有在插入前做存在性检查 | `git checkout` 回滚后重跑，并在每个插入点加 `assert` 防重；写入后用「唯一键数 == 总键数」自检。**教训：生成脚本必须自带幂等断言，不能依赖「只跑一次」** · 出处：`shared/src/errors.ts`（本轮） |
| 2026-09-21 | `docs/api.md` §2 原先只登记 33 条，`API.ROUTE_NOT_FOUND` 已实现且被 `router.test.ts` 断言却漏登 | §2 是手写维护的表，实现先加了 code 但没回写文档 | §2 改为**从 `ERROR_CODES` 派生的完整表**（34+89），并由 `errors.catalog.test.ts` 断言「文档中出现但未登记 → 测试失败」，此类漏登不会再发生 · 出处：`docs/api.md` §2（ISS-002） |
| 2026-09-21 | 一度以为 `UGV-L` 的 `kerb_weight_kg = 500`（与 `UGV-S` 同值）是笔误 | 逐行核对 `vehicle_params.yaml` 后发现该值标为 `[B]` 并附推导说明：源报道给出的是「满载质量 1000 kg」，样本按 50% 拆分为整备质量 | **已修正自己的判断**：契约中明确标注「有意为之，不要当笔误改掉」。教训：怀疑样本前先读该字段的 `[A/B/C/D]` 标注与 `references` 摘录——样本对**每个**字段都给了出处 |
| 2026-09-21 | 自检时发现我在文档里写的「Solomon 56 个已转 CSV」「Li & Lim 各 52–55 行」**是错的** | 实际 `2_订单数据集/solomon/` 里只有 `solomon_c101_orders.csv` **1 个** CSV（另有 56 个 JSON 算例）；`li_lim_pdptw/` 的 56 个 CSV 行数范围是 **50–55**（分布 50×6/51×22/52×7/53×17/54×3/55×1） | **已修正**：两处均为我在本次核对中的笔误，已在 §3.1 与 §13.2 更正并注明真实分布。说明「凭印象写数字」在数据类文档里是最危险的习惯，必须逐个 `ls`/`wc` 复核 |
| 2026-09-21 | 样本三件套（地图/订单/车辆）是否自洽，原本只能靠人工核对 | 三方引用的正确性分散在各自的列里（订单端点 ⊂ 站点、站点边 ⊂ 路网边、车辆限速键 == 道路类型） | **已实测自洽**：6 项交叉检查全部通过（0 偏差），已写入 §2.7 作为场景包校验的**验收基线**。实现时若对样本报出这些 error，应先怀疑校验代码而不是数据 |
| 2026-09-21 | 同一事实在 13 份 Markdown 里出现 **18 处写法不一致**：12 处是数值（迁移目录、seed 规模、适配器默认值、文档索引等），6 处是**源码路径**（`desktop/db/…` vs `desktop/src/db/…`、`shared/enums/` vs `shared/src/enums.ts` 等），其中 9 处与实现不符 | 根因不是「写错了」，而是**多处各写一份**：文档阶段每份都由不同上下文生成，各自复述同一批数值与路径。单点纠正只能修一次，下一轮仍会漂移。**路径类最隐蔽**：写错不影响任何结论，按数值清单核对时系统性地发现不了 | **已解决**：先指派**唯一负责文档**（`docs/api.md` §0），再逐处改为「引用 §号」；路径用脚本逐个校验「反引号路径是否真实存在」（0 悬空）；索引收敛为 `README.md` 一份；每份文档加「文档边界」行；纪律新增第 5.6 步与 2 条禁止项（D-34） |
| 2026-09-21 | 「逐份重读」时又发现 2 处不在清单里的漂移（`design.md` §2.2 的 `localStorage`、§8 的「一键重置演示数据」） | 上一轮是**按清单打勾**式核对：清单之外的内容不会被读到 | **已解决**：改为要求每份文档都必须写「文档边界」行 —— 写这一行必然要通读开头并确权，等于给每份文档一次自检机会 |
| 2026-09-21 | `.env.example` 里「默认 mock」的注释与代码实际行为不符 | 这类「藏在注释里的默认值」不属于任何 Markdown，按文档清单核对时会被整体漏掉 | **已解决**：改为注释掉 `VITE_API_ADAPTER` 并写明「不设置时按 preload 桥判定（D-22）」。教训：**受管事实的载体不止 Markdown，还包括 `.env.example`、脚本注释** —— §0 的映射按「事实」而非「文件类型」指派 |
| 2026-09-21 | 干净检出上 `npm run dev` / `npm run dev:electron` 起不来：Vite 打印 `ready in 113 ms` 且 `/` 返回 200，但页面**白屏**，终端刷 `Failed to resolve entry for package "@udm/shared"` | `shared/package.json` 的 `main`/`exports` 指向 `./dist/index.js`，而 `dist/` 被 `.gitignore` 排除；`renderer`（`hasPermission`/`ERROR_CODES`/`SEED_IDS`）与 `desktop`（`APP_NAME`/`SETTINGS_SCHEMA`…）都有**运行时**导入。`test`/`typecheck`/`db:*` 早已带 `build:shared`，**唯独两个 dev 脚本漏加** —— 不是设计取舍，是遗漏 | **已解决**：`dev` 前置 `build:shared`；`dev:electron` 再前置 `build:desktop`（它执行 `electron dist/main.js`）。改动仅 2 行，与既有四个脚本写法一致。删掉两个 `dist/` 后复跑两条命令一次通过 · 出处：`package.json`（ISS-034） |
| 2026-09-21 | 「Vite 打印 ready + `/` 返回 200」被当成「启动成功」 | 这正是 2026-09-14 记录过的 SPA 兜底陷阱的**第二种形态**：当时是入口文件缺失，这次是入口**依赖**解析失败。两次都表现为「服务器在、页面白」 | 验证必须看到**渲染结果**（DOM/无障碍树里的实际内容），而不是只 curl `/`。本次用窗口无障碍树确认了 `12 节点 / 34 边`、图层面板与车辆节点才判定通过 · 出处：本表 2026-09-14 行、`docs/issues.md` ISS-034 |
| 2026-09-21 | 地图包里漏了 `campus.add.xml`，把输入写成「4 个文件」 | 目录里有 17 个文件，只挑了名字最像 CSV/GeoJSON 的四个；`add.xml` 是 SUMO 的命名习惯（`additional`），不带 `.csv` 后缀，按「数据文件」的直觉筛不到 | **已修正**：地图包定为 **5 个文件**（3 CSV + `add.xml` + GeoJSON），并新增辅助输入 `campus.obstacles.rou.xml`。教训：**按文件名直觉筛选会漏掉非典型扩展名**——应以「这个字段的来源在哪」反查文件，而不是先列文件再找字段。泊位可退回站点表，障碍物没有替代来源，故新增 `MAP.OBSTACLES_UNAVAILABLE` warning |
| 2026-09-21 | `docs/data-interfaces.md` §5.9 把 `[D]` 级占比写成「218 个 / 60.6%」，被当作**车辆文件**的统计 | 218 是 `5_数据校验/数据可信级别.csv` 的**全表行数**，覆盖 `vehicle_params.yaml`(129) + `dispatch_constraints.yaml`(89) **两份**文件 | **已修正**：拆成两列（车辆文件 129 / 样本合计 218），并把「预检报告只报本文件口径」写进契约。教训：**引用汇总表时要先确认它的 `WHERE` 条件**——口径错在文档里表现为「数字没错、含义错了」，比数值错更难发现 |
| 2026-09-21 | `campus.add.xml` 与错误码 `MAP.OBSTACLES_UNAVAILABLE` 引入后，`ERROR_CODES` 已是 124 条，但多处仍写 123 条 | 条数是「派生事实」：它随登记处变化，却被抄进了快照、验证基线、代码地图、SSOT 表与架构图 | **已修正为 124 条**，并在 `docs/api.md` §2 声明「**条数不在此处固化**」、其它文档改引 §2。与 ISS-032 同类，但这次漂移在**同一文档内部**（定义处改了、引用处没跟上） |
| 2026-09-21 | 为 `campus.add.xml` 插入用例时占用了已存在的编号，§11.3 出现两条 `M17` | 插入时只看「最后一条是 M20」，没检查想用的号是否已被占用 | **已修正**：新用例编 `M17`，其余顺延为 `M18…M21`。教训：**编号是唯一键，插入前必须 `rg` 全表**——重复编号会让「M17 失败」指向两个用例 |
| 2026-09-22 | `PATCH /api/vehicles/{id}/status` 的文档取值 `enabled` **不在车辆状态枚举里**，按契约实现会写库失败 | 该段从 `sites` 的启停写法复制而来（`sites`/`nodes`/`edges` 确有 `enabled`），而车辆 7 态没有这个取值；同段落还把「更新基础属性」写成可含 `status` | 改为 `disabled` / `idle`，显式声明「车辆域没有 `enabled`」、占用中停用被拒、`PUT` 不含 `status`。**教训：任何数值/结构清单都查不出这类错 —— 只有把契约与 `enums.ts` / DDL 的 CHECK 逐项对表才会暴露** · 出处：`docs/api.md` §3.2.2（ISS-036） |
| 2026-09-22 | 差点把「尚未落地」的 `edges.code` 列写进 `docs/database.md` §2 的 `0001_init.sql` DDL | 该节声明与迁移文件一致；我为了记录 D-35 直接改了 DDL，等于宣称该列已存在 | 回滚，改为在 §6 的 `0002_data_import.sql` 登记行注明，并在 `design.md` §6.2 用「**待加列**」区分现有与目标。**教训：新增「尚未实现」的内容时，版式上必须与「已实现」可区分，否则文档会骗人** · 出处：`docs/database.md` §2/§6 · `design.md` §6.2（D-35） |
| 2026-09-22 | `docs/issues.md` §0.2 的 **37 条索引链接渲染后全部点不动**（源码里看不出异常） | 只写了 `](#iss037)`，但从未写入对应的 `<a id="iss037">`；明细标题渲染出的锚点是 `iss-037-标题…` 形态 | 每条标题前补 `<a id="iss0xx">`（38 个），锚点 ↔ 链接 ↔ 明细三者闭环。**教训：结构自检的覆盖面本身就是风险 —— 之前只查列数/围栏/编号，漏了链接可解析性，已补进脚本** · 出处：`docs/issues.md`（ISS-038） |
| 2026-09-25 | 同一份「登录响应」在两种适配器下给出**不同的 `permissions`**：mock 返回 `[]`、主进程返回该角色的完整权限点 | `renderer/src/api/mock.ts` 手写了三个演示账号并把 `permissions` 一律填 `[]`，而 `desktop/src/services/auth.ts` 用的是 `permissionsOf(row.role)`。页面只按**角色**判断导航（`hasPermission(role, …)`）时完全看不出差别，因此该字段长期无人读取、也就无人发现 | **已解决**：mock 改为 `permissionsOf(role)` 派生，并在 `mock-parity.test.ts` 新增「两种形态的 permissions 口径一致」断言。发现路径值得记录——它是在新写的顶栏用户菜单「顺手显示权限点数」时才暴露的：**一个从未被读取的字段，一旦被读就立刻暴露两套口径** · 出处：`renderer/src/api/mock.ts` · `renderer/src/api/mock-parity.test.ts`（ISS-040） |
| 2026-09-25 | 工作台的地图预览首次渲染时，路网被顶到画布左边缘、且此后**永不重试** | 预览照抄了地图页 `useReactFlow().fitView()` 的手调写法，但**漏了它配套的 `useNodesInitialized()` 门控**：手调版本在节点尺寸仍为 0 时就算包围盒，算出的边界是错的。地图页早已记录过这次实测（`MapView.tsx` 注释），但那条知识**只存在于那个文件的注释里** | **已解决**：预览改用 `<ReactFlow fitView fitViewOptions={…}>` 内置 prop，由 React Flow 自己在测量完成后适配，少一份需要维护的时序代码。**教训：跨模块复用代码时，同一处注释里的「为什么」不会跟着代码一起被复用到新位置** · 出处：`renderer/src/dashboard/panels/MapPreview.tsx` |
| 2026-09-25 | 通用 UI 基元（`.udm-btn--ghost` / `.udm-icon-btn` / `.udm-panel` / `.udm-kv` / `.tone-*` / `.udm-swatch`）**只存在于 `map/style/map.css`**；「导航项 / 页面标题 / 未实现模块说明」三处各写一份 | 地图模块先落地并把基元顺手写进了自己的样式表；随后工作台要复用同一个幽灵按钮，就只剩两条路：import 画布样式表（把画布样式带进工作台）或再抄一份（制造第二套真相，D-34 明令禁止）。同理 `app/App.tsx` 的 7 个占位路由把标题写死了一遍，而侧栏导航另写一份 | **已解决**：定 D-36 —— 抽 `styles/ui.css`（规则：**被 2 处以上使用 → 归设计系统**）、`app/modules.ts`（模块元数据唯一作者）、`domain/labels.ts`（枚举文案上移）。`map.css` 由 1004 行降至 866 行 · 出处：`renderer/src/styles/ui.css` · `renderer/src/app/modules.ts`（ISS-043） |
| 2026-09-25 | 2026-09-25 的**地图现代化改动（含 `map/panels/` 全套与 10+ 个新测试）没有留下任何工作日志**，工作区已积压 19 改 + 14 新增 | 该批次完成时未按纪律执行「先记录、后提交」，改动一直停在未提交状态；本会话开始时的基线 `e9a6100` 因此与实际代码不符 | **已解决**：本条日志与本轮日志一并补记该批次的客观内容（文件清单、测试结论），并在 `docs/issues.md` 登记 ISS-042。**教训：纪律的价值恰在于「累的时候也要写」——不写不会立即出错，只会让后来者拿着错误的基线判断** · 出处：`AGENTS.md` 工作日志 · `docs/issues.md`（ISS-042） |
| 2026-09-25 | 浏览器 Mock 形态下控制台各页面稳定出现 1 条 `favicon.ico` 404 | `renderer/index.html` 未声明图标；属既有现象，非 2026-09-25 改动引入 | **待办（ISS-041）**：可在 `index.html` 内联一个 `data:` URI 的 SVG 图标（零在线依赖，与 D-21/M6 §1.3 的约束一致）。未一并修，是为避免把无关改动混进本批 |
| 2026-09-25 | 两份文档**没有「文档边界」行**，其中 `docs/api.md` 在**本批次里刚被改过**（§0 指派表补 3 行）—— 规则存在、也在被引用，却没被执行 | 该禁令与 D-33（错误码有 `errors.catalog.test.ts`）、索引锚点（有 `dangling/unused` 断言）不同：**它没有任何自动化断言**，「文档边界」只靠人记。凡是只靠人记的规则，都会在「顺手改一下」时被跳过；`requirement-raw.md` 更是从建立起就没人补过 | **已解决**：两份补齐边界行 —— `docs/api.md` 声明自己兼「**SSOT 指派总表**」（它是指派者，不只是读者，故另加这句）；`docs/requirement-raw.md` 声明为「**需求原文存档、只追加不修改**，不是可执行契约，冲突时以现行文档为准」。并用脚本一次性复核 14 份文档边界行齐全、围栏配平、62 条相对链接 0 悬空 · 出处：`docs/api.md` · `docs/requirement-raw.md`（ISS-044） |
| 2026-09-26 | `AGENTS.md` 验证基线与工作日志把「调度员可见导航项数」写成 **6 项**，实测 **7 项** | 该数字是**由「9 项里少了 2 个」推得**的，而当时页面上真实渲染的列表**并未逐个读出**。同一段里另外两个数（权限点 16 项 == `permissionsOf('dispatcher').length`）都是对的，说明错在「数了一遍没数对」而非权限模型理解错。**推论比实测便宜，所以人总会顺手推论** | **已解决（2026-09-26 复测三角色）**：dispatcher 导航 7 项 / 权限点 16；monitor 5 / 6；admin 9 / 20 —— 使该行**自洽可复核**（权限点可对 `docs/api.md` §3.1，导航项可对「9 项减去缺失项」）。教训：**凡写进「验证基线」的数字，都必须来自一次实际读取，不能由其它数字推算** · 出处：`AGENTS.md`「验证基线」· `renderer/src/app/modules.ts` · `shared/src/enums.ts`（ISS-045） |
| 2026-09-26 | 给用户菜单加键盘支持时，`import type { KeyboardEvent } from 'react'` **遮蔽了 DOM 的同名全局类型**，`tsc` 报 TS2769，而 `vite build` **照样通过** | 该文件里同时要写 React 的合成事件参数类型（`ReactKeyboardEvent<HTMLDivElement>`）与原生 `document.addEventListener('keydown', …)` 的回调。两者都叫 `KeyboardEvent`，而 React 的导入会把它遮蔽掉 —— 于是原生那一处解析成了 React 类型，参数不匹配 | **已解决**：显式改名为 `KeyboardEvent as ReactKeyboardEvent` 并写明原因。**值得记的是「谁抓到了它」**：`npm run build` 全程绿灯（Vite 只转译不做类型检查），只有 `npm run typecheck` 变红 —— 这就是本项目的门禁里**同时**保留两者的理由 · 出处：`renderer/src/components/UserMenu.tsx` |
| 2026-09-26 | `.udm-sr-only`（仅读屏可见的工具类）**写在 `styles/theme.css` 里**，而 `theme.css` 按 D-36 的定位只该放**设计令牌** | 它是早期「随手找个地方放」的产物，后来被外壳（折叠按钮的可读名称）与地图详情面板等多处使用。按 D-36 已写明的判定规则「**被 2 处以上使用 → 归 `styles/ui.css`**」，它早该归位 | **已解决**：移入 `styles/ui.css` 并注明归属理由；移动后实测元素仍是 1×1 的隐藏盒子（`{'w':'1px','h':'1px'}`），没有因为改文件而失效。**教训：规则写下来之后还要回头扫一遍存量** —— 否则规则只约束新增代码，存量会长期停留在「规则之前的样子」· 出处：`renderer/src/styles/ui.css`（ISS-046） |
| 2026-09-26 | 占位页把四个权限点渲染成一串 `alert:readalert:ackalert:resolvealert:archive` | `PlaceholderPage.tsx` 用了 `className="udm-planned__iface"`，但**全项目没有任何 CSS 定义** —— `<code>` 默认是行内元素，多个挨在一起就连成一片。**这个缺陷只在「列出多项」的模块上显形**：只有一个接口的「用户管理」看起来完全正常，因此人工逐页核对极易漏过。发现路径也值得记：它是被**读截图**发现的，而那次截图的目的是核对另一件事 | **已解决**：补 `.udm-planned__iface` 定义（inline-block 徽标 + 等宽字体，实测四个权限点 x 坐标 1099/1184/1263/1368）；并新增 `styles/classnames.test.ts` 把「被引用 ⇒ 已定义」变成断言（D-39），**反向验证**过它会失败 · 出处：`renderer/src/styles/layout.css` · `renderer/src/styles/classnames.test.ts`（ISS-048） |
| 2026-09-26 | 3 个 `className`（`udm-node-endpoint__glyph` / `udm-node-order__glyph` / `udm-topbar__live`）**从未被定义过，因而全无作用** | 父元素已经是居中 flex，子元素加不加这些类视觉上没有差别；写代码时顺手给了个「以后可能要用」的名字，之后没人删。它们与上一条（缺定义）是同一类缺陷的两种形态 | **已解决**：三处类名删除（保留元素与 `aria-hidden`，视觉零变化）。这类「看起来像有作用的僵尸类名」比缺失定义更难发现 —— 它不坏、也不对，只在有人误以为样式已挂在那个类上时才出问题 · 出处：`renderer/src/map/nodes/TaskEndpointNode.tsx` · `OrderEndpointNode.tsx` · `renderer/src/components/AppLayout.tsx`（ISS-049） |
| 2026-09-26 | 新写的「图层不遮挡」不变量测试**在空集上假通过**了一整轮 | `layout.test.ts` 把选项对象当 `toFlow` 的第二个参数传入，而真实签名是 `(overview, visibility, selection, vehiclePositions)` —— 于是每个 `visibility.*` 都是 `undefined`、全部图层被判为隐藏。`expect([]).toEqual([])` 恒真，测试「绿」得毫无意义。**同类风险对任何「两两都不许冲突」形状的断言都成立**：没有冲突往往意味着没有样本 | **已解决**：改为按真实签名调用，并在不变量断言前加「跨图层共点对 ≥ 3」的**防空跑**前置检查（seed 的 N01 上站着站点 + 车辆 + 任务起点，两两比较即 3 对）。教训：**断言必须自带「样本非空、比较确实发生过」的门槛**，否则它只是在证明空集合里没有冲突 · 出处：`renderer/src/map/model/layout.test.ts`（ISS-053） |
| 2026-09-26 | 修完遮挡后，`layout.test.ts` 报出 3 条「车辆压在路网节点上」的冲突，**看起来像新缺陷** | 那不是缺陷：路网节点只是一个 12×12 的圆点，没有文字、不可交互，被车辆/站点压住正是设计意图（否则车会「飘」在路外）。**把「锚点重合 ⇒ 不许相交」理解成对所有图层成立，是规则写宽了** —— 需要保护的其实只有「带文字标签或需要点击」的四个图层 | **已解决**：比较时显式排除 `net` 层（注释写明理由：没有文字、不参与交互），并保留「跨图层共点对 ≥ 3」的防空跑门槛。教训：**不变量要写清楚「保护的是哪一类东西」**，范围写宽了会产出假阳性，而假阳性会让人开始忽略测试输出 · 出处：`renderer/src/map/model/layout.test.ts`（ISS-053，D-42） |
| 2026-09-26 | 写路径的一致性用例一上来就有 2 条红：Mock 对所有写请求返回 `API.ROUTE_NOT_FOUND` | `mockBaseWrite` 用 `request.segments.slice(2)` 取资源名，而 `segments` 是 `['api','sites']`（只有**一个**前缀段），正确偏移是 `slice(1)`；切片后落到空数组 → 直接返回「不是写路由」，而**这个「未命中」是正常控制流、不打日志不抛异常** | **已解决**：修正偏移并在该处写明切片语义；捕获它的是**先写好的**一致性用例（同一批请求同时打 Mock 与主进程），不是人去读代码。教训：语义错误会**伪装成能力缺失**（看起来像「写接口没实现」），排查方向天然跑偏 · 出处：`renderer/src/api/mock-base-write.ts`（ISS-056） |
| 2026-09-26 | Electron 里点「新增站点」弹出绿色提示「已新增站点记录」，而 `sites` 表里**一条也没有** | 当时运行的 Electron 是**旧构建**：`preload.cjs` 还没把 `method` 转发给主进程，于是 `POST /api/sites` 按缺省方法 `GET` 解析，落到同路径的**读接口**上返回 `code: 0` + 一个列表，渲染层把它当成新增成功。**假成功**：界面、日志、控制台全无异常 | **已解决**：① 渲染层写路径加一致性守卫（`code===0` 但 `data` 是列表信封 → 报「写请求被当成了读请求」，绝不报成功，并有用例注入该响应）；② 主进程与 preload 均已转发 `method`；③ 把「改完主进程 / preload 必须**重启 Electron 进程**再验证」写进验证基线。教训：`ISS-028`（用 Chrome 开 `file://` 误判）是**验证方法**给出了错结论，这次更隐蔽 —— 是**产品行为**给出了错结论 · 出处：`renderer/src/api/useApiWrite.ts`（ISS-055 当时写作 `base/useBaseDataWrite.ts`，D-47 重构后改名并搬出 `base/`）· `renderer/src/pages/BaseDataPage.write.test.tsx`（ISS-055） |
| 2026-09-26 | 给弹层表单写第一条用例时，`getByLabelText('编码')` 全部找不到，6 条用例一起红 | 「必填 / 创建后不可改」两个视觉角标放在 `<label>` **里面**，于是标签的可访问名变成「编码 必填」；用 `aria-hidden` 藏起来又会连同语义一起丢掉 | **已解决**：角标移到 `<label>` **外面**、必填语义交给输入框自己的 `required`（`aria-hidden` 也不用了）—— 视觉不变，而可访问名就是字段名本身。教训：**测试查询失败往往不是测试写错了，而是无障碍名字真的被污染了** · 出处：`renderer/src/base/EntityFormDialog.tsx` |
| 2026-09-26 | 新增站点用例里「选了 N04」但保存后坐标仍是 `0,0`、绑定节点为空 | 节点下拉的选项是**异步**拉来的（弹层打开后才发 `/api/nodes`），而 `<select>` 的 `value` 在选项还不存在时会被浏览器**丢弃**（jsdom 同样如此）—— 于是「选了」实际什么也没选，且不报错 | **已解决**：测试里抽 `pickNode()` 先等选项出现再改值（这正是使用者看不到的那段等待时间）；产品侧同时补了**缺失端点选项**（编辑边时，若它当前绑定的节点不在选项里，浏览器会静默显示第一项并在保存时**改掉数据**）· 出处：`renderer/src/pages/BaseDataPage.write.test.tsx` · `renderer/src/pages/BaseDataPage.tsx` |
| 2026-09-26 | `docs/issues.md` §0 写着「共 53 条」，而严重度分布 `5+32+15` 只有 52 —— 少 1，且从未被发现 | 同一份文件维护**三处**数字（§0 的严重度分布、§0 的状态分布、逐条索引行），全靠手抄，且没有任何断言要求「两个维度的合计 = 总数」；与 `ISS-033` / `ISS-045` 同因 | **已解决**：按明细段重算修正（P3 15 → 16），并在 `tests/docs.test.ts` 新增「三处计数互相对齐」的断言（分布表 · 索引表 · 明细段，含编号与状态逐行比对），**用负向改动验证过它真的会红**。教训：注释里写「必须相等」不算护栏 · 出处：`tests/docs.test.ts` · `docs/issues.md`（ISS-057） |
| 2026-09-26 | 禁行规则的「适用车辆类型」留空、模板的「起终点类型」留空，建出来却带着具体值（`agv` / `depot`） | `<select>` 的取值必须落在选项里，而「可空」在表单模型里是用 `emptyMeans: 'null'` 表达的 —— 缺了「空值」那一项，浏览器就把 `value=''` 退回第一项；`emptyFormValues` 又对所有 `select` 一律取首项，于是「不限」在界面上**不可达** | **已解决（ISS-058）**：`FormField.emptyLabel` + 弹层渲染空值项 + 初始化置空；三条用例覆盖（初始值 / 提交 `null` / 列表显示「全部车辆」） |
| 2026-09-26 | `mock-parity` 纳入 `/api/task-templates` 后立刻报红：同一页在 Mock 与真实库里是**不同的行** | Mock 在内存数组上 `filter`，顺序 = 插入顺序；主进程是 SQL `ORDER BY`。此前四类主数据的构造顺序碰巧与 SQL 一致，把这个差异掩盖了 | **已解决（ISS-059）**：Mock 两个新分支各自显式排序并注明对齐的是哪条 `ORDER BY`；一致性由逐字段比对守住 |
| 2026-09-26 | 「枚举加了值但迁移没跟上」这条规则，光靠文档没人复核 | 与 `ISS-044`（文档边界行）、`ISS-052`（路由必须写进契约）同族：规则只靠人记 | **已解决**：`desktop/src/db/db.test.ts` 增加「枚举 ↔ DDL 漂移」用例 —— 真的往 `alerts` 插入各枚举值的探针行，用真实 CHECK 约束判定；**已用「临时移走 0003」验证过它会红** |
| 2026-09-26 | 上面那条护栏「看起来没牙齿」：移走迁移后重跑单个测试文件仍全绿 | 同一 vitest 进程内 `@udm/shared` 命中 `shared/dist` 的**旧构建**，探针用的是旧枚举；`npm test` 会先 `build:shared`，单跑不会 | **已解决（纪律）**：改过 `shared/src` 之后**先 `npm run build:shared` 再单跑 vitest**；已写入验证基线。这类「护栏本身失效」比漏报更糟（它给出的是「已经检查过了」的错觉） |

| 2026-09-26 | E2E 脚本第一次全绿、第二次同一个脚本却报红：`模板页有 2 行 seed 数据` 只数到 3 行 | 库里还留着上一轮走查建的模板 —— 脚本的「初始态断言」比较的不是初始态，而是**上一轮的残留**。红绿都失去意义 | **已解决（做法）**：跑带初始态断言的 E2E 之前先 `npm run db:reset`，走查完再复位一次；开发库不进版本控制，复位零成本。与 `ISS-055` 同族：**验证方法本身会给出错结论** · 出处：`/tmp/udmshot/batchE-e2e.mjs` · `desktop/src/cli/db.ts` |
| 2026-09-26 | 进度条 / 状态徽标 / 车队分布条的色调**一直没有生效**，而控制台与用例全绿 | `toneClass` 自己补一个横线，三个调用点传的前缀**已经带尾横线**，拼出 `udm-progress---ok` / `udm-badge-ok` / `udm-fleet__seg---ok` —— 样式表里都不存在。类名拼错不抛异常、不打日志、不让任何用例变红 | **已解决**：`toneClass` 改为原样拼接 + 新增 `badgeToneClass` 作为徽标唯一入口；`domain/tone.test.ts` 的断言升级为**直接读 CSS 文件核验类名存在**（D-48）。与 `ISS-048`（类名无定义）/ `ISS-049`（类名无人用）同族：**拼接出来的名字没人负责** · 出处：`renderer/src/domain/tone.ts`（ISS-060） |
| 2026-09-26 | 删除任务的失败提示在浏览器与桌面端文案不同（`code` 相同、`message` 不同） | `mock-parity` 此前只比对 `code`（部分用例比对 `detail.fields` 键集合），`message` 从未进入比对范围；主进程习惯性带状态机的可引导文案，Mock 只 `fromError(code)` 取目录兜底文案 | **已解决**：Mock 复用 `checkTaskTransition(...).failure.message`；`mock-parity` 增加「`message` 也必须逐字相同」断言，比对范围扩为 code + message + detail 键集合 · 出处：`renderer/src/api/mock-tasks.ts`（ISS-061） |
| 2026-09-26 | 按 `design.md` §4.3「暂停时写暂停原因」实现时，发现 `tasks` **没有这一列** | `0001_init.sql` 建表按当时的字段清单落列，§4.3 的「写暂停原因」是后补的副作用说明；两侧都改过，但没有一处断言把「状态机要求写什么」与「表里有哪些列」对上（同族：`ISS-039` 枚举缺取值、`ISS-036` 车辆取值不在枚举里） | **已解决**：新增迁移 `desktop/migrations/0004_task_pause_reason.sql`（新增可空列，不做「新表 + 搬迁」，因为它不破坏既有读写）；`resume` 时清空该列 · 出处：`desktop/migrations/0004_task_pause_reason.sql`（ISS-062） |
| 2026-09-26 | 任务页提示里把状态中文写成「待派发」，而 `TASK_STATUS_LABEL` 是「待派」 | 提示句是**在 JSX 里手写**的一段中文，与枚举文案表并列成了第二份；两者只差一个字，界面看起来完全正常 | **已解决**：改为用 `UNFINISHED_STATUSES.map(labelOf)` 从**同一份**文案表拼出来。教训与 D-48 一致：**说得出来的名字都该来自唯一作者**，哪怕它只有两个字 · 出处：`renderer/src/pages/TasksPage.tsx`（ISS-060 同批） |
| 2026-09-26 | （脚本问题，非产品缺陷）E2E 里的「取消后车辆是否回 idle」探测报告 `AUTH.REQUIRED` | 探测用 `page.evaluate` 直连 `window.dispatchApi.invoke('/api/vehicles')`，**没带 token** —— 而会话只存在 zustand store 里，桥本身不记得登录状态 | **已解决**：改从界面上读状态徽标（或先取 store 里的 token）；同时确认主进程日志里那两条 `AUTH.REQUIRED` 正是本次探测发出的 —— **报错是真的，但它是脚本的错**，没有去改产品 · 出处：`/tmp/udmshot/m3-e2e.mjs`（不入库） |
| 2026-09-26 | M5 `plan` 走查时，一条**理想路线**（`n01 → n12`，就是网络里的最短路）也带警告：「途经边 … 为全网最低速段」 | 判据写成 `speedMps <= graph.minSpeedMps`，而 seed 四类道路速度**恰好完全一致** → 每条边都满足；漏了前提「速度确实有差异」。**永远出现的提示等于没有提示** | **已解决**：先算 `maxSpeedMps > minSpeedMps`，仅在其为真时逐边产生 `slow_edge`（D-50）。**不是**把 `<=` 改成 `<` —— 那只是让误报变少见 · 出处：`shared/src/route-search.ts`（ISS-063） |
| 2026-09-26 | `compare` 的一致性用例断言「A* 与 Dijkstra 的节点序列逐项相等」而失败：两个算法各选了一条**里程与耗时完全相同**的不同路线 | 把「最短路」当成「唯一的那条路」。契约里的 `consistent` 是**里程 / 耗时一致**，不是节点序列一致；用例却把任意的 tie-break 结果写成了契约 | **已解决**：改为断言性质（里程 / 耗时 / 边数 / `consistent`），并在用例里写明**为什么不能断言序列** · 出处：`desktop/src/domain/route/route.service.test.ts`（ISS-064） |
| 2026-09-26 | 用来覆盖 `ROUTE.NOT_FOUND_PATH`（两点不通）的用例，把 `n6` 当成「孤岛」删掉 —— 但 `n6` 是 3×3 网格的**中心节点**，图仍然连通，该断言实际测的是另一条路 | 手工挑了一个「看起来边缘」的节点，没回头核对生成函数；构造输入与断言写在同一个文件里，**没人保证「图真的长成我以为的样子」** | **已解决**：改用网格外的 `n9`，并补一条前置断言「图里确实没有这个节点」 · 出处：`shared/src/route-search.test.ts`（ISS-065） |
| 2026-09-26 | 照 `docs/api.md` §3.1.1 用 `POST /api/auth/login` 登录 → `API.ROUTE_NOT_FOUND`；改 `GET` 才通，而**界面登录一直正常**、全部用例全绿 | `Route.method` 可省略，省略按 `GET` 注册（为兼容早期读接口的有意设计）；而所有调用点也都不传方法 —— 两边**互相吻合**，只有**照文档调用**才暴露；路由 ↔ 契约的断言只比对路径，方法从未进入比对范围 | **已解决**：两条认证路由显式 `method: 'POST'`，Mock 删掉 `GET` 分支；新增 `api.auth.test.ts`（含「不得同时存在 `GET` 形态」的反向断言）· 出处：`desktop/src/ipc/api.ts` · `desktop/src/ipc/api.auth.test.ts`（ISS-066） |
| 2026-10-03 | 告警中心给 seed 的演示任务报「缺路线」假红 —— 而车正按那条路线在跑 | 取数只查 `dispatch_plans`，没实现执行器那套「计划优先、按 `routes.task_id` 回退」的两级查法；这条规则此前在三个地方各写一遍 | **已解决**：抽成 `shared/src/plan-risk.ts` 的 `planInputsOf`（唯一作者），主进程与 Mock 共用；回退区间 = 起始时刻 + 路线时长，与执行器推进任务的时间轴同口径（ISS-085） |
| 2026-10-03 | 风险预检的「已超时」对 `pending` 任务**永不触发** —— 最容易超时的一类恰好被过滤掉了 | 超时循环与「占用着车辆」循环共用了 `ACTIVE_TASK_STATUSES`，把「占用车辆」当成了「还没结束」 | **已解决**：拆出 `UNFINISHED_TASK_STATUSES`（比占用集合多一个 `pending`）专供超时判断；先确认回归用例在改动前会转红（ISS-084） |
| 2026-10-03 | 预检表的「建议动作」在真实 Electron 里被裁半句，而 DOM / 单测 / 控制台**全绿** | 沿用了列表页的 `white-space: nowrap`；溢出的 37px 交给 `.udm-table__wrap` 的 `overflow-x: auto`，而 macOS 默认不显示滚动条 | **已解决**：该两列显式 `white-space: normal` + 建议列 `max-width`；护栏改成读 `ops.css` 断言（jsdom 量不出布局）。教训：**布局缺陷不在 DOM 里，只在真实渲染尺寸下**（ISS-086） |
| 2026-10-03 | 车辆中心的抽屉里坐标显示成 `73.59999999999991`，而同一页表格里是 `73.6` | 抽屉直接插值 `{vehicle.x}`，绕过了展示口径的唯一作者 `domain/format.ts` 的 `formatNumber`（表格走了它，抽屉没走） | **已解决**：坐标与轨迹采样点一律走 `formatNumber`。教训同 `ISS-086`：**「同一事实两处渲染」必须走同一个函数**，否则只有打开抽屉才看得见（ISS-090） |
| 2026-10-03 | 新建订单的提示旁边仍挂着**上一批**的「在地图上查看这 2 台车」，看起来像新单已经派了车 | `onOrderCreated` 清了 `runSummary` 与提示，却漏了 `applied`（那个按钮的渲染条件）；派发路径清了，建单路径没清 | **已解决**：建单时一并 `setApplied(null)`，并补一条「先断言按钮存在、再断言它消失」的回归用例（先确认「本来有」才能证明「被清掉了」）（ISS-091） |
| 2026-10-03 | 调度中心精简后 `DispatchPage.test.tsx` 变红（`Unable to find an element with the text: 路径规划可用`），看起来像页面渲染坏了 | 用例断言的是「页头有某句文案」这种**与信息架构强耦合**的细节，而本轮把路径规划收进了折叠区、页头徽标也改了口径 | **已解决**：用例改为「断言折叠区默认收起 → 点开 → 照旧操作」，锁**行为与层级**而不是锁文案；同类教训见 `ISS-081`（用例引用旧节点 id）与 `ISS-073`（把未来时间写死）（ISS-092） |
| 2026-10-03 | 同一份代码跑 `npm test`：Electron 运行中 21 条失败、杀掉进程后 3 条失败、单独复跑全绿 | `ISS-068` 的偶发超时 —— jsdom 用例的 5 s 超时窗口在并行 + 高负载下不够；失败信息是 `Test timed out in 5000ms`，与功能无关 | **未修（待办）**：本轮只把它当证据记录（负载越重失败越多、失败用例每次不同、单独跑全绿）。修它要单独成批，并在改超时 / 并行度前后各测一次影响（ISS-068） |
| 2026-10-03 | 第一版「预留任务」用**未来时间窗**实现后，`mock-parity.test.ts` 的「两条策略逐字段相同」当场变红（加权综合分 4931.6 vs 4902.3、完成时刻差 9 s） | 时间窗起点晚于 seed 时刻后，`waitTimeS = 窗口起点 − 到达时刻`，而「窗口起点」来自**数据基准时刻**（Mock 取模块加载时刻、主进程取 seed 运行时刻）、「到达时刻」来自**预览时刻** —— 两者必然不同，差异于是**从时间字段泄漏进等待时间与加权综合分**。而这个项目此前明确写着「两种形态的差异只有时间字段」（`renderer/src/api/mock-data.ts` 文件头），一致性护栏正是为这种「看起来只是时间、其实进了业务数字」的静态排除项而设 | **已解决（改为不用时间窗错开）**：放弃未来时间窗，改用**任务端点设计**制造可接力的空档（短途件塞进某台车班次之间），差异照样拉开。教训与 `ISS-068` / D-34 同族：**「只有时间字段不同」是一个必须被守住的不变量，不是一句描述** —— 任何让时间进入业务数值的设计（等待、超时、费用）都会让两层适配器在同一份数据上给出不同的数字，而这种差异在界面上只表现为「两个形态的推荐结论不一样」· 出处：`shared/src/seed-data.ts` · `renderer/src/api/mock-parity.test.ts` · [`docs/seed-dispatch-diversity.md`](./docs/seed-dispatch-diversity.md) §3 |
| 2026-10-03 | 待派任务扩到 19 条以上时 `api.task.test.ts` 与 `TasksPage*.test.tsx` 变红（首屏读不到 seed 的演示执行任务） | 任务列表默认一页 20 条：1 条演示执行 + 19 条待派 = 20，再多一条就把演示任务挤到第 2 页，而用例断言它首屏可见 —— 这个上限是**分页契约**造成的，不是算法问题 | 待派上限锁 18（1 + 18 = 19 ≤ 20）；其成因（浏览器 Mock 的新建记录时间戳与演示数据同基准 `MOCK_AT`，刚建的任务排在列表末尾）登记为 **`ISS-094`（待办）**，要修得改适配层的记录时间戳口径 | `shared/src/seed-data.ts` / `docs/issues.md`（ISS-094） |
| 2026-10-03 | 第一版「未派发惩罚」取 2700 加权秒，仍可能被单条贵计划反超 | 惩罚必须**严格大于任何单条计划代价**；按本演示路网「空驶 + 执行」上限 1673 s，再叠加晚点容忍与续航风险的最坏项，理论值约 2773 s > 2700 | 取 3600（3600 ≈ 2773 × 1.3），并新增一条按**真实 seed 穷举** `max(plan.cost)` 的用例把「惩罚足够大」变成可执行断言 | `shared/src/dispatch-types.ts` / `dispatch-evaluate.test.ts`（D-60） |
| 2026-10-03 | 改「拒绝原因取哪一条」时，第一版直接按六步**步骤号**排序，实测把要修的反例原样复现 | 步骤号顺序恰好把 `VEHICLE_NOT_AVAILABLE` 排在 `LOAD_EXCEEDED` 之前 —— 而这正是「有车能装、只是没空」被误报成「装不下」的形态；两个方向都能举出反例，说明判据不是「谁先失败」而是「离能跑还差多少」 | 改为按 `REJECT_STEP_ORDER` 的**信息量**定序（窗口冲突 / 电量 → 车辆不可用 → 载重 / 可达 / 禁行），两个方向各写一条用例（`shared/src/dispatch-greedy.test.ts`） | `shared/src/dispatch-strategies.ts`（D-61 / ISS-093） |
| 2026-10-03 | 真实 Electron 走查：调度中心「拒绝原因」表 9 行的「具体情况」**全是同一句**「预计晚点 0s，超出容忍 0s」，而真实原因是占用区间冲突 | `TIMEWINDOW_CONFLICT` 一个 code 覆盖两种情形，主进程 `explain.ts` 用「有没有 `lateS`」分辨、渲染层的同口径副本没分（`?? 0` 于是拼出「晚点 0s」）——**两份实现各推一遍判据，只改一边就漂移** | 判据上移到产出方：`detail.kind`（`late` / `occupied`）+ 共享的 `isLateWindowConflict`，主进程与渲染层都调它；补「两种情形 + 旧快照回退」的用例，并断言「被占用」那句里不出现「晚点」 | `shared/src/dispatch-evaluate.ts` / `desktop/src/domain/dispatch/explain.ts` / `renderer/src/dispatch/model.ts`（ISS-095 / D-61 邻域） |
| 2026-10-03 | 一条任务都没派发，告警中心却在报「冲突」；面板写「共 12 条」而待派只有 9 条（3 条各被报两遍） | 七类风险里只有五类依赖已生效派发；另外两类（`WINDOW_EXPIRED` 窗口已过 / `UNASSIGNED_TASK` 还没排上车）对同一条 `pending` 任务可同时成立，却与派发类风险平铺在一张表、共用一个「冲突与超时」标题，读者无法分辨「哪些是派发造成的」 | **已解决**：不改判定、不去重，按「是否依赖已生效派发」分两节呈现（节 1 空则不渲染）；分类判据上收到 `shared/src/plan-risk.ts` 作单点作者，渲染层只渲染不判断（ISS-096）。教训：**这类问题单测与文档都看不出，只有人读那 12 行才会发现**，与 ISS-084 / ISS-090 / ISS-095 同族 | `shared/src/plan-risk.ts` / `renderer/src/ops/RiskPanels.tsx`（ISS-096） |
| 2026-10-04 | 「告警中心对新订单提示冲突」这一环在演示里**只看到空白**：按用户点名的四步流程走完「新建 → 派发」后，节 1「派发冲突与执行风险」连续 3 次都是空的（本批次预检写「没有发现冲突或超时」） | 该节五类风险**都不是常规操作能造出来的**：`VEHICLE_OVERLAP` 被派发前校验挡掉、`VEHICLE_UNAVAILABLE` 的管理白名单只有 `idle`/`disabled`（`disabled` 对 `reserved`/`busy` 还会被拒，`offline`/`fault`/`charging` 归执行器而执行器从不设置）、`BATTERY_RISK` 每单只掉 1–2% 且低电车辆在派发阶段就被拒、`PLAN_WITHOUT_ROUTE` 因 `apply` 必建路线而不可达。**代码是对的，是「看不到」** | 已登记 `ISS-097`（待办，展示可达性）；本批给出可复现配方「新建一张时间窗只有几分钟的单 → 派发」，实测节 1 出现 `预计超时 …晚 135 秒`、节 2 出现同一单的 `已超时`。教训与第九批同族：**「功能实现了」不等于「在界面上看得见」**，演示脚本要按可达性设计 | `shared/src/plan-risk.ts` / `desktop/src/domain/base/vehicle.service.ts`（ISS-097） |
| 2026-10-04 | 给「派发冲突」这一节补可达性时，第一版把「更具体的原因」写成 `DomainError` 的 message，`mock-parity.test.ts` 当场变红（同一条 `占用中停用` 请求两边 message 不一致） | 该用例断言「同一请求两边 message 一字不差」，而 Mock 的 `fail()` 只从 `ERROR_CODES` 取文案 —— 在主进程单方面加一句更具体的话，就会让两边对同一个冲突说两种话（正是这条护栏要防的形态） | **已解决（保持目录原话）**：`VEHICLE.STATE_CONFLICT` 的文案不动，具体原因放 `detail.reason`（`disableOccupied` / `faultRunning`）+ `detail.hint`；针对性说明由渲染层 `statusBlockedReason` 在**点之前**给出。教训与 D-34 同族：**「更友好」不能只在一边加**，两层适配器的文案也是一份契约 | `desktop/src/domain/base/vehicle.service.ts` / `renderer/src/api/mock-base-write.ts`（D-62） |

## 工作日志

### 2026-09-21 — 修复「干净检出无法启动」：`dev` / `dev:electron` 漏构建 `shared`（ISS-034）✅

- **范围与目标**：以「**让项目能顺利运行**」为目的做最小修复。先实测现状，再只改真正阻断运行的地方。
  **不含功能新增、不含重构**；业务代码零改动，仅 `package.json` 两行。对应 `docs/issues.md` 的 **ISS-034**（新增，P1，已解决）。
- **变更清单**：
  - `package.json`（唯一改动文件，2 行脚本）：
    - `dev`：`npm run build:shared && npm run dev --workspace renderer`
    - `dev:electron`：`npm run build:shared && npm run build:desktop && concurrently …`
      （桌面端要跑 `electron dist/main.js`，`desktop/dist` 同样不能假定已存在）
  - `docs/issues.md`：新增 **ISS-034**（P1 / 可运行性，含现象、影响、原因表、未选方案与验证）、§2 追加一行、
    §0 总览与 §1.1 计数同步（33 → 34 条；P1 4 → 5；已解决 13 → 14）。
  - 本文件：本条工作日志 + 「困难与问题记录」2 行。
- **关键设计决策**：**无新增 D 编号**。这不是设计问题而是**脚本遗漏** ——
  `test` / `typecheck` / `db:migrate` / `db:seed` / `db:reset` 五个脚本早已带 `build:shared`，
  只有 `dev` 与 `dev:electron` 漏了；修复方向是「向既有约定看齐」，不引入新机制。
  未采纳的替代方案：① 改 `shared` 的 `exports` 指向 `src`（会让 Electron 主进程直接加载 `.ts`）；
  ② 放到 `prepare` 钩子（拖慢 `npm install`，且对只跑 renderer 的场景不必要）。
- **验证与测试结果（2026-09-21 实测）**：
  - ✅ **先复现**：把 `shared/dist` 与 `desktop/dist` 移走后执行 `npm run dev`，
    终端出现 `[vite] Pre-transform error: Failed to resolve entry for package "@udm/shared"`，
    且 `/src/components/AppLayout.tsx` 返回 SPA 兜底的 HTML 而非 JS —— **确认是真故障，非误判**。
  - ✅ **修复后复跑（从零构建）**：删除两个 `dist/` 目录后执行 `npm run dev` ——
    `build:shared` 先跑（`tsc`），随后 Vite `ready in 113 ms`；`AppLayout.tsx` 返回 **200 且内容含 `hasPermission`**；
    日志中 `Pre-transform error` 计数为 **0**。
  - ✅ **`dev:electron` 端到端**：同样从零构建，`build:shared` + `build:desktop` 后 Electron 拉起；
    **无障碍树实测**：窗口标题 `无人物流调度管理软件`、URL `localhost:5173/#/map`、
    `12 节点 / 34 边`、3 站点 / 3 车辆、图层面板 7 项（含「车辆 常显」disabled）、
    路线标签与 `AGV-01 busy 电量 100%` 均在 —— 与 seed 数据一致，**不是白屏**。
  - ✅ `npm test`：18 套件 / 110 用例全通过；`npm run typecheck` 三 workspace exit 0；`npm run build` 三端全通。
  - ✅ **全新数据库引导**：删除 `desktop/.data/` 后 `npm run db:migrate` 应用 `0001` 并 seed 成功
    （nodes 12 / edges 34 / sites 3 / vehicles 3 / tasks 1 / routes 1 / alerts 1），`db:seed` 复跑幂等（各表新增 0）。
  - ✅ **文档结构自检**：13 份 Markdown 共 **231 个表格块**列数逐块一致（0 处不一致）；
    **216 处代码围栏**全部偶数配对。
- **遇到的困难与解决方案**（详见「困难与问题记录」本轮 2 条）：
  1. **「看起来启动了」比「启动失败」更危险**：Vite 打印 ready、`curl /` 返回 200，
     但依赖解析失败只在**请求具体模块时**才暴露。这与 2026-09-14 的 SPA 兜底陷阱同源，
     故本轮把判定标准明确为「看到渲染结果（DOM 内容）才算通过」。
  2. **判断「是不是真的坏了」需要先排除自己造成的干扰**：本轮先用移走 `dist/` 的方式精确复现，
     确认故障与代码无关、只与「未构建」有关，才动手改脚本 —— 避免把环境噪声当成项目缺陷。
- **遗留问题与下一步**：
  1. 本条**未提交**；工作区含既有 13 份文档改动 + `.env.example` + `shared/src/errors.ts` + 本轮 `package.json`。
  2. **本次没有顺手扩范围**：地图 XML 仿真、`sites` 边绑定、导入管线等仍是设计态（`ISS-013`/`ISS-014`/`ISS-024`），
     未因「让它跑起来」而提前动工。
  3. 若后续新增 workspace 包，**所有 `dev*` 脚本都要检查是否需要在启动前构建其依赖包**（本条即此教训）。

### 2026-09-21 — 按样本复核修正未传播的问题：地图包 4→5 文件 / 错误码 123→124 条 / 用例编号去重（ISS-023 · ISS-033）✅

- **范围与目标**：上一轮「按真实样本核对订单 / 地图 / 车辆三章」把地图包从「4 个文件」改判为「5 个文件」
  （新增 `campus.add.xml`），并为此新增错误码 `MAP.OBSTACLES_UNAVAILABLE`。本次是**收尾与补正**：
  把该修正的**派生引用**（同文档内的其它小节、其它文档、架构图、条数统计）全部对齐，
  并补上「地图包缺 `campus.add.xml`」的回归用例。本次**不含业务代码改动**（仅 `shared/src/errors.ts` 增加 1 条 code）。
  对应 `docs/issues.md` 的 `ISS-033`（新增，P2，已解决）与 `ISS-023`（口径更正）。
- **变更清单**：
  - `shared/src/errors.ts`：按 **D-33 先改登记处**，新增
    `MAP.OBSTACLES_UNAVAILABLE`（`validation` / `warning`），`ERROR_CODES` **123 → 124 条**（34 运行时 + 90 导入域）。
    新增原因：`campus.add.xml` 缺失时泊位可退回站点表（两者实测 13/13 一致），**障碍物没有替代来源**，
    只能为空——必须让用户知道「不是没有障碍物，是没有来源」，静默给空数组会被误解为路网确实无遮挡。
  - `docs/api.md`：§2.1 地图段登记新 code；**§2 抬头改为「条数不在此处固化」**（实时值 =
    `Object.keys(ERROR_CODES).length`），并要求其它文档引用条数时改引 §2；§0 的 SSOT 表同步去掉硬编码条数。
  - `docs/data-interfaces.md`（本文件仍是四类文件字段契约的唯一来源）：
    - **地图包文件数 4 → 5** 的五处派生引用：§0 四类文件表（F2 实测形态）、§2.7 场景包
      （地图 5 + 车辆 1 + 算法 1 = **7 份文件**，`scenarioId` 哈希范围同步）、§4.1 标题
      （「四个文件」→「五个文件」）、§7.2 `sourceBundle`（增 `addXml` 键，并注明缺 `addXml` 的结果）、
      §9 组件表 / F-4 / Q10。
    - §2.2 信封示例的 `meta.sourceFiles` 补齐为 5 个文件名；§4.1 补「辅助输入」说明并把「不参与导入」的
      清单改成实测的 17 个文件里的真实剩余项（原写法漏了 `campus_demo.rou.xml` / `tripinfo.xml` / 两个 `build_network.*`）。
    - §4.1.2 加一行指引（CSV/GeoJSON 的映射在本节，XML 的映射在 §4.1.3），避免读者以为 XML 未覆盖。
    - §11.3 **修掉重复编号**：新增 `M17`（缺 `campus.add.xml` → `MAP.OBSTACLES_UNAVAILABLE`），
      原 `M17…M20` 顺延为 `M18…M21`。
    - §5.9 与 §13.3 的**「本文件 vs 样本合计」双口径**已在上一轮建立，本次核对无偏差（见下）。
  - `docs/architecture.md` §8.3 图内数字同步为 **124 条 / 导入域 90 条**（该图属「图表视图」例外，需与来源一致）。
  - `AGENTS.md`：项目快照、验证基线、代码现状地图、D-33 备注、D-28 的「地图 4 文件包」全部对齐；
    历史工作日志里的旧值按既有惯例**加删除线保留**（不改写历史）。
  - `docs/issues.md`：新增 **ISS-033**（含现象表与根因）、§2 追加一行、§0 总览与 §1.2/§1.3 计数同步；
    **ISS-023** 补「口径更正」块（`[D]` 级占比的 129 / 51.2% 与 218 / 60.6% 两种口径并列）。
- **关键设计决策**：**无新增 D 编号**。本次是**事实修正与传播**，不是新设计 ——
  它执行的是 D-34（同一事实只允许一个作者）与 D-33（错误码只改一处、先改登记处）的既有约定。
  唯一带「新规则」性质的改动是 `docs/api.md` §2 的「**条数不在此处固化**」：把「数字」降级为「查询方式」，
  因为条数是随登记处增长的派生事实，抄成常数必然过期。
- **验证与测试结果（2026-09-21 实测）**：
  - ✅ **样本事实独立复核（脚本，非沿用上一轮结论）**：地图包 17 个文件、5 个可导入 + 1 个辅助输入；
    节点 30（traffic_light 9 / priority 21）；边 90（45 正向 + 45 `_R`）；`campus.add.xml` 内
    `parkingArea` 14 / `poly` 15（12 building + 2 construction + 1 water）；GeoJSON 133 features；
    GeoJSON 的 `junction.properties` 实测键 **仅 `id` / `kind` / `node_type`**（无 `name`，与 §4.1.2 一致）。
  - ✅ **车辆文件键数复核**：`UGV-S` **38** 个顶层键（含 `scene_avg_speed_kmh = 5.0`）；
    **`UGV-M` / `UGV-L` 各 37 个，均无该键** —— §13.3 标注的「（无此键）」与 §5.3 的「缺省 `null`」一致。
  - ✅ **`[A/B/C/D]` 双口径复核**：`5_数据校验/数据可信级别.csv` 共 **218 行**，按 `配置文件` 分组为
    `vehicle_params.yaml` **129**（D 66 / B 43 / C 20，D 占 **51.2%**）与 `dispatch_constraints.yaml` **89**
    （D 66 / B 19 / C 4）；合计口径 D 132 / 62 / 24（60.6%）。**文档中「车辆文件 129」与「样本合计 218」两列均已正确区分。**
  - ✅ **错误码闭环**：`ERROR_CODES` **124 条唯一**；`errors.catalog.test.ts` 断言通过。
    注：该断言的方向是**文档 → 登记处**（文档里出现的 code 必须已在 `ERROR_CODES`），
    因此「先改文档」会立刻变红；反之「只改登记处、未回写文档」**不会报错** —— 这正是本条 ISS-033 的成因，
    也说明第 5.5 步（回写 §2 与 §8）不能靠测试兜底，只能靠流程。
  - ✅ `npm test`：**18 个套件 / 110 个用例全通过**。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通（renderer JS 394.27 kB / gzip 128.81 kB）。
  - ✅ **文档结构自检**：13 份 Markdown 共 **229 个表格块列数逐块一致**（0 处不一致）；
    **214 处代码围栏全部偶数配对**（本轮新增 `ISS-033` 的 2 张表，故总数由 227 增至 229）。
  - ⚠️ 未执行（原因）：`npm run dev:electron` —— 本次只改文档与 1 条错误码常量，未触及运行链路；
    端到端结论沿用 2026-09-20 基线。
- **遇到的困难与解决方案**（详见「困难与问题记录」本轮 4 条）：
  1. **按文件名清单核对发现不了「口径错」**：218/60.6% 这个数字本身没错，错的是**它被贴到了「车辆文件」名下**。
     这类错误要对着**数据源的 `WHERE` 条件**读（这里是 `配置文件` 列），而不是对着汇总值核对。
  2. **点状修正必然留下派生引用**：地图包从 4 改 5 时，只改了定义处的表格；标题、场景包总数、`sourceBundle`、
     组件表、Q10 都还写着 4。结论：改完任何「事实」都要 **`rg` 回扫同一概念的全部出现点**，
     这条已可与 D-34 配套使用（唯一作者 + 全员回扫）。
  3. **重复编号**：插入 `M17` 时未检查占用，出现了两条 `M17`。已顺延修正；教训是编号属唯一键，插入前必须全表检索。
  4. **条数不该被抄成常数**：错误码条数在 5 处被写成 123，其中 4 处是「派生引用」。
     与其逐处改，不如把 `docs/api.md` §2 定义成条数的唯一出处并写明查询方式。
- **遗留问题与下一步**：
  1. **`ISS-033` 已解决，`ISS-023` 仍为「已接受」**（属「诚实的不确定性」，非缺陷）。
  2. **本次改动已提交**（当时工作区含 13 份文档 + `.env.example` + `shared/src/errors.ts`（1 行）；
     落在 `076714e`／`84fa028` 一带的文档提交里 —— 具体归属已无法逐笔分辨，因为那一批也是使用者合并提交的）。
     按提交纪律，本条日志即提交前记录；提交时 `shared/src/errors.ts` 应与文档同批，避免「文档有 code、登记处没有」。
  3. **F4 仍未按样本核对**（`ISS-020` / Q16）：`4_调度约束/dispatch_constraints.yaml` 需做与 F3 同等的逐字段核对，
     届时 §5.9 与 §13.3 的「样本合计 218」应随 F4 落地改为按来源分别展示。
  4. **D-28…D-31、Q10-Q16 待评审**（`ISS-017` / `ISS-018`），地图包的 5 文件形态也在其中。

### 2026-09-21 — 文档统一：修复 ISS-032 的 18 处事实分歧（数值 12 + 源码路径 6），建立「事实单一来源」机制（D-34）✅

- **范围与目标**：以「**统一文档中的内容**」为目标，对全部 13 份 Markdown 做交叉核对，
  收拾「同一事实多处各写一份」造成的漂移。本次**不含业务代码改动**（除 `.env.example` 的注释口径外）。
  对应 `docs/issues.md` 的 `ISS-032`（文档一致性，P2）与 `ISS-031`（表格被裸 `|` 截断，P3），两者均已解决。
- **变更清单**：
  - **新增机制** `docs/api.md` **§0 文档事实单一来源（Single Source of Truth）**：一张表把每个易漂移事实
    指派给唯一负责文档，并写明「其余文档只能引用、不得复述具体数值」。这是本次的核心产物 ——
    18 处修正是**一次性**的，§0 才是防复发的那一半。
  - **第 13~18 处（本轮新发现）**：写「文档边界」行时逐份重读，又发现**同一类漂移的第二个家族 —— 源码路径**：
    M1 `desktop/db/seed.ts` → `desktop/src/db/seed.ts`；M2 `desktop/domain|algorithms|db`（缺 `src/`）
    → `desktop/src/...`；M3 `shared/{types,enums,errors,constants}/`（规划为四个子目录）→ 实测为
    `shared/src/*.ts` **扁平文件**；M4 `renderer/map/`、`renderer/pages|api|store`（缺 `src/`）→ `renderer/src/...`；
    M5 `shared/apiClient` 不存在 → 实为 `renderer/src/api/index.ts` 导出；M6 `shared/i18n/dispatch.ts` 从未存在
    → 改为「当前仍内联在 `renderer/src/pages/`」。另修正 `design.md` §2.4 与 `README.md` 的**目录树**为实测形态。
  - **12 处逐条修正**：A 登录示例 `permissions` 8→20 项（`docs/api.md` §3.1.1）；B 迁移目录
    `desktop/db/migrations/` → `desktop/migrations/`（`docs/database.md` §0 · `docs/build-plan.md` §4）；
    C 第二个迁移 `0002_seed.sql` → `0002_data_import.sql`；D seed 规模改为实测表（`docs/api.md` §5）；
    E「一键推进/重置演示数据」标注**未实现**、改指向 `npm run db:reset`（`docs/api.md` §5 · `design.md` §8）；
    F `MockAdapter`「内存 + localStorage」→ **纯内存**（`design.md` §2.2 · `docs/build-plan.md` §3.2 · `docs/architecture.md` §1）；
    G 适配器默认值「默认 mock」→ 按 **preload 桥**判定（D-22；`.env.example` 同步改为注释掉 `VITE_API_ADAPTER`）；
    H `design.md` §6.2 补「16 张业务表 + `schema_version`」规模口径；I `README.md` 去掉「脚手架就绪后生效」
    与「以上命令为规划占位」，命令改为实测可跑清单；J `docs/api.md` §4 事件表补「所需权限点」列（D-32）；
    K `design.md` §3.7 密码表删除，改为指向 `shared/src/constants.ts` 的 `SEED_ACCOUNTS`；
    L 文档索引**三份副本收敛为一份**（`README.md`「文档入口」），`design.md` §10.2 与 `AGENTS.md` 改为指针。
  - **`docs/issues.md` 自身的口径修正**：§1.2/§1.3 的小节标题条数与实际条数不符（P2 实为 20 条，
    其中 2 条已解决被排进了 §1.3），已在标题里写明「本节条数 / 全量条数」；§0 总览与索引同步为
    「32 条 / 已解决 12 / 待办 10」；`ISS-029` 的现象段更新为「代码已分三批提交，现仅剩文档」。
  - **`ISS-031` 表格修复**：`docs/api.md` §3.1/§3.2 与 `docs/module-M4-dispatch.md` §6 里单元格内的裸 `|`
    改为 `/` + 「（二选一）」；改后全量 13 份 Markdown 的表格块列数**逐块一致（0 处不一致）**。
  - **每份文档抬头新增「文档边界」行**（`design.md` · `README.md` · `docs/` 下 9 份）：自声明负责范围 +
    指向 §0 的对应关系。让「谁该写什么」在打开文件的第一屏就可见。
  - **纪律与决策**：提交纪律新增 **第 5.6 步**（不复述可漂移事实，改动时顺手检查唯一来源）；
    禁止项新增 2 条（禁止复述数值、禁止文档缺「文档边界」行）；新增决策 **D-34**。
  - 本文件：项目快照「文档」段由**完整清单**改为**指向 `README.md` 的指针**；决策表 + D-34；本日志条目。
- **关键设计决策**：新增 **D-34**（文档事实单一来源）。与 D-33（错误码只改一处）是同一条原则
  ——「每个事实只有一个作者」—— 在不同层面的落地：D-33 管代码与错误码，D-34 管文档与事实。
- **验证与测试结果（2026-09-21 实测）**：
  - ✅ **漂移扫描（修复后）**：`rg` 全仓搜索 `desktop/db/migrations` / `0002_seed.sql` / `内存 + localStorage` /
    「一键推进」/「脚手架就绪后生效」/「规划占位」—— 剩余命中**全部落在 `docs/issues.md` §1.3 与 §2
    的历史记载里**（该文件按规则「不删条目、保留原文」），正文与其它文档**0 处残留**。
  - ✅ **文档结构自检**：13 份 Markdown 共 **227 个表格块，列数逐块一致（0 处不一致）**；
    **214 处代码围栏全为偶数配对**。改动前 `docs/api.md` 与 `docs/module-M4-dispatch.md` 各 2 处 BAD（即 ISS-031），现已消除。
  - ✅ **路径存在性检查（脚本）**：扫描全部文档里反引号包裹的 `shared/` `desktop/` `renderer/` `tests/` 路径，
    **悬空路径 0 条**（改动前 2 条：`desktop/db/seed.ts` 缺 `src/`、`shared/i18n/dispatch.ts` 从未存在）。
  - ✅ **索引唯一性核对**：`README.md`「文档入口」**14 行覆盖全部文档**；`design.md` §10.2 与 `AGENTS.md`
    均已改为指针，全仓不再存在第二份索引（`rg "文档入口|文档索引"` 仅剩引用语）。
  - ✅ `npm test`：**18 套件 / 110 用例全通过**（含 `errors.catalog.test.ts` 对文档 code 的闭环断言
    —— 证明本次文档改动未引入未登记 code）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 0.42 kB + CSS 24.45 kB（gzip 4.51 kB）
    + JS 394.11 kB（gzip 128.75 kB），与改动前基线一致。
  - 未执行（原因）：`npm run dev:electron`。本次为纯文档改动 + `.env.example` 注释，渲染/IPC 链路未受影响，
    无新增目视验证价值；上一次端到端结论见「历史基线」。
- **遇到的困难与解决方案**：
  1. **「统一」不等于「把对的数字抄到所有地方」**：最初想逐处把数字改成正确值，但那样下一轮仍会漂移 ——
     本轮 12 处里有 6 处就是这么来的（同一天在不同文档里写对、也同时写错）。
     改为「**先指派唯一来源、再改**」，并把「不复述」写进纪律与禁止项，才真正闭环（D-34）。
  2. **最大的一批残留不是数值，而是路径**：`desktop/db/…`、`shared/enums/…`、`renderer/map/…` 这类写法
     在文档里读起来完全合理，但仓库实际是 `desktop/src/db/…`、`shared/src/enums.ts`、`renderer/src/map/…`。
     它们既不改数字也不改结论，所以任何「按数值清单核对」的方法都发现不了 ——
     是靠**写脚本检查每个反引号路径是否真实存在**才挖出来的（最终 0 悬空）。
     结论：文档一致性的检查项至少要覆盖「数值 + 路径 + 编号」三类，只查数值会有系统性盲区。
  3. **`design.md` 里还有两处本轮才发现的残留**：`§2.2` 的「内存 + localStorage」与 `§8` 的
     「一键重置演示数据入口」并不在最初登记的 12 处里，是写「文档边界」行时逐份重读才撞见的。
     说明**逐份重读**比「按清单打勾」更能发现漂移 —— 已把「新增/修改文档必须写文档边界行」写进禁止项，
     让每份文档被重读时都有一次自检机会。
  4. **历史记录里必须保留「错误写法」**：`docs/issues.md` 的修复表要引用原始错误串，`AGENTS.md`
     「困难与问题记录」按规则「只追加不篡改」，两者都会持续命中漂移扫描。
     故验证时按「命中是否位于历史记载上下文」判定，而不是简单追求 0 命中 —— 否则就得删历史，与纪律冲突。
  5. **`.env.example` 的默认值注释本身也是「事实」**：它写「默认 mock」，但代码实际按 preload 桥判定。
     这类「注释里的默认值」最容易被漏掉（它不在任何 Markdown 里）。已一并改为注释掉该变量、并说明判定规则。
- **遗留问题与下一步**：
  1. **本轮未提交**；按纪律须先完成本日志（已完成）再提交，提交信息建议
     `docs: 统一文档事实来源，修复 ISS-031/ISS-032（D-34）`。
  2. `ISS-017` / `ISS-018`（D-11 / D-15…D-20 / D-28…D-31 与 `data-interfaces.md` §12 的 Q1-Q16）**仍待评审** ——
     这是当前唯一的 P1 剩余项，决定导入模块的表结构与错误码；建议与需求方合并评审一次。
  3. `ISS-029`（工作区未提交改动量大）在本轮之后仍成立：本轮又叠加了 13 份文档的改动。
     建议本轮提交后即把工作区分批清空，避免基线继续远离。
  4. §0 的「事实 → 唯一负责文档」映射目前是**人工纪律**，尚无自动断言。若漂移再次发生，
     可考虑加一条测试扫描「非负责文档中是否出现受管数值」（类似 `errors.catalog.test.ts` 的做法）。

### 2026-09-21 — P1 收口：错误码单一登记处（D-33）+ 事件总线权限过滤（D-32）✅

- **范围与目标**：按「选定其中一个错误码、放弃另一个；其它问题以业界/大厂规范为准且必须解决冲突」处理 P1 与相关 P2。
  本次**含业务代码改动**（`shared/` · `desktop/` · `renderer/`），非纯文档条目。对应 `docs/issues.md` 的
  `ISS-001` / `ISS-009`（P1）与 `ISS-002`…`ISS-008`（P2/P3），另新发现并修掉 `ISS-030`。
- **变更清单**：
  - `shared/src/errors.ts`：`ERROR_CODES` **34 → 123 条**（新增 89 条导入域 code），新增 `ErrorSeverity` 与 `ErrorDefinition.severity?`；
    `NODE.NOT_FOUND` / `EDGE.NOT_FOUND` 的 message 加注「导入时指引用的编码/边无法解析」，使其同时覆盖运行时与导入两处语义。
  - `shared/src/errors.catalog.test.ts`（**新增**，5 条断言）：命名两段式、source/httpStatus/message 完整性、
    severity 仅导入域、**文档中出现的 code 必须已登记**、导入域四类齐备且废弃码不复活。
  - `renderer/src/api/mock-parity.test.ts`（**新增**，3 条断言）：mock 与主进程错误码一致（ISS-030 的回归锁）。
  - `renderer/src/api/mock.ts`：删除自造的 `failure()`，改用 `fromCatalog(code: ErrorCode)` 并从 `ERROR_CODES` 取 source/文案
    —— 修掉 mock 返回 `AUTH.INVALID_CREDENTIALS`（目录中不存在）而主进程返回 `AUTH.LOGIN_FAILED` 的静默失配。
  - `desktop/src/services/event-bus.ts`：新增 `EVENT_PERMISSIONS`（事件→权限点）、`attach(target, token?)` / `bindSession()`，
    `emit()` 由「无条件群发」改为 **deny-by-default 过滤后推送**；`sessions` 构造参数改为**必填**。
  - `desktop/src/services/event-bus.test.ts`（**新增**，8 条用例）：未登录 / monitor / dispatcher / 登出降权 / 公开事件 /
    日志照写 / 已销毁窗口 / 权限映射完备性。
  - `desktop/src/main.ts`：`EventBus` 注入 `sessions`；`udm:invoke` 在登录成功与登出后调用 `bindSession` 同步窗口身份。
  - `desktop/src/ipc/router.test.ts`：构造 `EventBus` 时传入 `sessions`。
  - `package.json`：`engines.node` `>=20.11` → **`>=22.5`**。
  - `docs/api.md` §2 **重写**：2.1 运行时业务错误码（34 条，按域分组）/ 2.2 导入域错误码（89 条，带 severity）/
    2.3 调度拒绝原因；声明 `shared/src/errors.ts` 为唯一登记处。`API.ROUTE_NOT_FOUND` 随之登记（ISS-002）。
  - `docs/data-interfaces.md` §8 **重写**为注册表的按章视图（不再是独立目录），移除「唯一登记处」声明；
    正文旧命名同步：`MAP.EMPTY_GRAPH`→`GRAPH.EMPTY`、`MAP.GRAPH_DISCONNECTED`→`GRAPH.DISCONNECTED`、
    `MAP.ISOLATED_NODE`→`GRAPH.ISOLATED_NODE`、`MAP.EDGE_NODE_NOT_FOUND`→`NODE.NOT_FOUND`、
    `MAP.SITE_EDGE_NOT_FOUND`→`EDGE.NOT_FOUND`、`ORDER.ROUTE_NOT_FOUND`→`ROUTE.NOT_FOUND_PATH`。
  - `docs/order-data-map-design.md` / `docs/issues.md`：同步上述改名。
  - `docs/architecture.md`：§8.3 更新为「截至 2026-09-21」，移除【阻塞】节点与「P1 剩余缺口」段（改为历史注记）；
    §10 事件流补上「按会话权限过滤后推送」。
  - `docs/build-plan.md` §2/§7、`docs/module-M6-map.md` 头部与 §1.1：同步 Node 下限与 M6 已实现的状态。
  - `docs/issues.md`：`ISS-001`…`ISS-009` 标记 `已解决` 并逐条补「解决」段；新增 `ISS-030`；
    §0 总览与 §0.1 处理顺序更新；§2 已解决表追加 7 行。
  - 本文件：项目快照、文档索引、代码现状地图同步；决策表新增 **D-32 / D-33** 与独立「状态」列。
- **关键设计决策**：
  - **D-33（错误码唯一登记处与命名口径）** —— 选定 `shared/src/errors.ts`，废弃 `data-interfaces.md` §8 的独立目录。
  - **D-32（`EventBus` 按会话权限过滤）** —— 补齐 D-08 在事件通道上的缺口。
  - 冲突消解口径（本次的判据，后续沿用）：
    1. **以业界规范为准**：错误码取 Google AIP-193（`ErrorInfo` 的 `domain` + `reason`，且明确「同一 `(reason, domain)` 对必须用于同一错误、不得用于不同错误」）
       → 因此「同一概念一个 code」优先于「同一文件族统一前缀」。
    2. **以已实现、已被测试锁定的为准**：`errors.ts` 已类型化并被 `errors.test.ts` 锁定，`api.md` 是既有对外契约，改动面最小。
    3. **两份来源冲突时，保留更通用的那个名字**：`GRAPH.EMPTY`（图的性质）胜过 `MAP.EMPTY_GRAPH`（限定地图文件）；
       `NODE.NOT_FOUND`（运行时也会用）胜过 `MAP.EDGE_NODE_NOT_FOUND`（只在导入时出现）。
    4. **不让同一概念留下第二个名字**：改名后正文、图、其它文档一并同步，并由测试兜住（不存在「两边都留着」的中间态）。
- **验证与测试结果（2026-09-21 实测）**：
  - ✅ `npm test`：**18 套件 / 110 用例全绿**（本条目前 15 套件 / 94 用例；新增 `errors.catalog.test.ts` 5 条、
    `event-bus.test.ts` 8 条、`mock-parity.test.ts` 3 条）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：`build:shared` / `build:desktop` / `build:renderer` 全部通过；renderer 产物 394.11 kB（gzip 128.75 kB）。
  - ✅ 错误码闭环（脚本 + 测试双重校验）：`ERROR_CODES` **123 条唯一**；`docs/api.md` 与 `docs/data-interfaces.md` 中出现的
    code **0 处未登记**（豁免项为 §8 明示「不作为 code 使用」的 3 条速记前缀与 2 条废弃码说明）。
  - ✅ 表格/围栏完整性：`AGENTS.md` / `docs/issues.md` / `docs/api.md` / `docs/data-interfaces.md` 逐块列数一致（0 处不齐）。
  - ✅ 权限过滤行为实测（单测覆盖）：未登录窗口收到 0 条登记过权限的事件；monitor 只收到 `alert.created`；
    dispatcher 收到 task/vehicle/alert；`map.updated` 仍放行；`event_log` 照写不误。
  - 未执行：`npm run dev:electron`（本次改动涉及主进程事件推送，但该链路需人工开窗目视，未在本条目内做端到端冒烟）。
- **遇到的困难与解决方案**：
  1. **同一概念两套命名（6 处）**，直接改名会打断既有测试与文档。解法：先定「谁更通用」的判据（决策 3），
     把「并入既有 code」与「纯改名」分开处理，改名后用脚本全库扫描确认无残留，再用 `errors.catalog.test.ts` 把口径锁死。
  2. **`severity` 到底属于 code 还是属于调用点** —— 若按「导入 warning / 运行时 error」拆成两个 code，
     就正好重犯本次要修的错误（同一概念两个名字）。解法：定为**调用点属性**，作为 `ErrorDefinition.severity` 的**默认值**存放，
     `ImportIssue.severity` 可覆盖；`errors.catalog.test.ts` 断言同一 code 只登记一次。
  3. **`EventBus` 过滤后「静默丢事件」比「越权」更难排查** —— 若 `sessions` 可选且被省略，全部事件会被静默丢弃。
     解法：构造参数改为**必填**，把运行时故障提前成编译期错误；并规定未登记的**新**事件默认放行（收不到新事件不影响安全，漏过滤敏感事件才是越权）。
  4. **`apply_patch` 写大段中文仍易失败**：本轮所有大改动改用 `/tmp/*.py` 生成后写入，避免补丁围栏问题（沿用既有经验）。
  5. 脚本两次执行导致 `shared/src/errors.ts` 出现**重复插入**（212 行 `'XXX': {` 键、123 条唯一）。已 `git checkout` 回滚后重跑，
     并在每次插入前加 `assert` 防重。**教训：幂等性要显式断言，不能依赖「只跑一次」**。
- **遗留问题与下一步（按优先级）**：
  1. **评审仍待办**：`ISS-017`（D-11 / D-15…D-20 / D-28…D-31）与 `ISS-018`（Q1-Q16）合并评审 —— 这是导入模块（`ISS-013`）开工前的唯一阻塞，属**等人的决策**。
  2. **未实现的导入链路**：`0002_data_import.sql` 迁移、导入/导出接口（`ISS-013` / `ISS-014`）——错误码口径已收口，可直接按 `data-interfaces.md` §8 动工。
  3. **其余 P2**：`ISS-011`（map overview 的 `include` 参数）、`ISS-012`（轨迹回放）、`ISS-016`（车辆状态机迁移表）、`ISS-024`（`sites` 边绑定迁移）。
  4. **提交**：工作区仍有大量未提交改动（`ISS-029`）。按纪律本条目已记录，可据此提交；建议拆两次
     —— `refactor(shared): 统一错误码登记处`（含导入域 89 条 + 测试）与 `fix(desktop): 事件总线按权限过滤`，文档随各自提交。
  5. `docs/architecture.md` 待补一张「四类数据文件导入」流程图（依赖 F4 章核对完成，见 `ISS-020`）。
  6. 本轮另**登记**了一条与本次改动无关的既有缺陷：`ISS-031`（`docs/api.md`/`docs/module-M4-dispatch.md` 有两处 Markdown 表格
     被单元格内的裸竖线截断）。按纪律「不修无关缺陷、但要登记」，未在本条目内修改。

### 2026-09-07 — P0 文档阶段：设计文档 + 接口文档 + 本文件定稿 ✅

- **范围与目标**：按需求「优先设计文档与接口文档、暂不落地代码」，为后续顺利构建提供可追踪依据。
- **变更清单**：
  - 新建 `design.md`：1-10 章，含架构分层、运行形态与适配器、全局规范（命名/数据/状态/错误/日志/接口）、角色权限、10 个首期模块（目标/要求规范 `Req-*`/接口概览/验收）、二期统计模块预留、算法设计、SQLite 数据模型（17 张表）、交互与页面、非功能需求、实施里程碑。
  - 新建 `docs/api.md`：通用信封与鉴权、分页、枚举目录、错误码目录、调度拒绝原因、M1-M10 全量接口明细、事件订阅、种子数据说明。
  - 新建 `README.md` 与本 `AGENTS.md`；原始需求归档 `docs/requirement-raw.md`。
- **关键设计决策**：D-01 ~ D-11（见上表）。
- **验证结果**：文档自洽性人工核对（状态机 / 枚举 / 接口路径 / 权限点一致性）；本阶段无代码、未运行测试。
- **遗留与下一步**：
  1. 与需求方评审 D-02（任务 `paused` 态）、D-11（新增 `dispatch:read`、`execution:start` 权限点）。
  2. 仓库尚未 `git init`；评审通过后按需初始化并提交本记录（提交前按纪律先记录）。
  3. 评审后进入 P1 脚手架（另起一条工作日志）。

### 2026-09-07 — 新增 M4 调度引擎模块开发文档 ✅

- **范围与目标**：为 P4 编码提供 M4 单模块详档（面向开发），使开发者不回头翻全量文档即可实现。
- **变更清单**：
  - 新建 `docs/module-M4-dispatch.md`（452 行）：模块定位/范围依赖、代码文件划分与边界、核心 TS 类型与方法签名、单车×单任务约束评估顺序与拒绝原因映射、占用区间模型、greedy/hungarian 策略与代价函数、explain 规则、preview/apply/manualAssign/recompute 时序与事务边界（条件 UPDATE 乐观锁）、快照失效与幂等、日志/审计/事件、错误映射、测试清单（U1-U11/S1-S8/契约）、验收走查 1-7、开发顺序与 DoD、风险备注。
  - 同步索引：`README.md` 文档入口、`design.md` §10.2 文档索引。
- **关键设计决策**：新增 D-12（M4 落地口径：常量权重、规模上限、条件更新乐观锁）。
- **验证结果**：与 `design.md` §4.4/§5 及 `docs/api.md` §3.4 逐项对齐（状态迁移、枚举、权限点、requestId 语义）；补丁围栏配平、无残留续写标记；本阶段无代码、未运行测试。
- **遗留与下一步**：
  1. D-11、D-12 随 P4 评审一并确认。
  2. 若其它模块也要开发详档，按本文格式扩展（`docs/module-Mx-*.md`）并回写 README/design/AGENTS。

### 2026-09-14 — 补齐构建就绪文档：数据库设计 + 构建计划 ✅

- **范围与目标**：为「计划进行项目构建」补齐开工所需文档，不写业务代码。
- **变更清单**：
  - 新建 `docs/database.md`（385 行）：通用约定（ID/时间/枚举/PRAGMA）、17 张表 DDL（含 CHECK 约束与外键）、18 条索引、seed 规则（固定 `seed-*`、bcrypt 不入明文）、5 条 Repository 参考查询、迁移演进规则。
  - 新建 `docs/build-plan.md`（126 行）：开工前置条件、npm workspaces 形态与根脚本、shared/desktop/renderer 骨架、迁移与 seed 落位、P1-P6 任务与验收命令/期望、风险缓解、开工 Checklist。
  - 同步索引：`README.md` 文档入口、`design.md` §9 与 §10.2。
- **关键设计决策**：新增 D-13（根级 workspaces、适配器环境开关、迁移/seed 幂等与库路径）。
- **验证结果**：DDL 与 `design.md` §6.2 逐表核对（表数 17、枚举与非空/唯一约束一致）；构建计划目录形态与 design §2.4 一致；全量 markdown 围栏配平、无残留标记与引号伪影；本阶段无代码、未运行测试。
- **遗留与下一步**：
  1. 评审 D-02 / D-11 / D-12 / D-13 后执行 `git init` 并提交全部文档（提交前按纪律先记录）。
  2. 进入 P1：按 `docs/build-plan.md` §8 开工清单落地脚手架，届时新建工作日志记录。
  3. 如需其它模块开发详档（如 M3/M5），按 `docs/module-M4-dispatch.md` 格式扩展。

### 2026-09-14 — P1 基线复核：同步 AGENTS 与实际代码状态 ✅

- **范围与目标**：读取当前仓库实现、脚本与测试输出，修正本文件中过时的阶段/技术栈/验证描述，建立后续开发基线。
- **变更清单**：更新项目快照；明确 renderer 缺少 `src/main.tsx`；补充 Node 内置 `node:sqlite` 决策 D-14；新增测试依赖缺失与 renderer 入口缺失的问题记录。
- **关键设计决策**：D-14（数据库驱动以实现为准，采用 `node:sqlite`）。
- **验证结果**：`npm run typecheck` 通过；`npm test` 失败，原因是 `tests/setup.ts` 无法解析 `@testing-library/jest-dom/vitest`；未执行提交。
- **遗留问题与下一步**：补齐测试依赖或调整 setup；实现 renderer 最小入口与适配器；随后运行 `npm run build`、`npm test`、`npm run db:migrate`/`npm run db:seed`，并回写本日志。

### 2026-09-14 — 基线复测与 AGENTS 维护：纠正「未跑迁移 / build 未验证」等过时描述 ✅

- **范围与目标**：按要求通读项目（根脚本、`shared/` · `desktop/` · `renderer/` · `tests/` 全量源文件、`package.json` × 4、`vitest.config.ts`、`.env.example`、`.npmrc`、`.gitignore`、迁移 SQL）并复测全部可用构建/运行命令，把 `AGENTS.md` 从「推断描述」修正为「实测描述」。本条目**不含业务代码改动**。
- **变更清单**：
  - `AGENTS.md` 项目快照：修正阶段描述（渲染层未接通）、补全 7 条已实现接口、更新工作区状态（新增未跟踪的 `docs/order-data-map-design.md`）、把技术栈从范围写法改为 `node_modules` 实测精确版本、把验证基线由「推断」重写为 6 条实测结论（含成功/失败标记）。
  - `AGENTS.md` 新增「代码现状地图」小节：按目录列出已有内容与缺口，并给出 5 个测试文件的现状说明。
  - `AGENTS.md` 文档索引：补入 `docs/order-data-map-design.md` 并标注为设计态、无实现。
  - `AGENTS.md` 设计决策记录：新增 D-15（独立地区目录与匹配优先级）、D-16（CSV 导入幂等与两阶段导入）。
  - `AGENTS.md` 困难与问题记录：新增 4 条（`build-plan.md` 遗留 `better-sqlite3` 前提、renderer 双 Vite 版本、renderer 构建/入口失败、`dev:electron` 链路从未验证）。
- **关键设计决策**：D-15、D-16（来源为 `docs/order-data-map-design.md`，本条目仅做**登记与编号**，尚未回写 `design.md` / `docs/api.md`）。
- **验证与测试结果（2026-09-14 20:16-20:18 实测）**：
  - `npm run db:migrate` ✅ 应用 `0001`；seed 结果 nodes 12 / edges 34 / sites 3 / vehicles 3 / templates 2 / users 3 / settings 9；库文件 `desktop/.data/app.db` 首次生成（约 256 KB）。
  - `npm run db:seed` ✅ 复跑幂等，全部 `seed changes` 为 0。
  - `npm run typecheck` ✅ shared / desktop / renderer 全部 exit 0。
  - `npm run dev --workspace renderer` ✅ Vite 6.4.3，107 ms 就绪，`GET /` 200；但 `GET /src/main.tsx` 返回 `text/html` 的 SPA 兜底页而非 JS 模块。
  - `npm test` ❌ 5 个套件全在 setup 阶段失败：`Failed to load url @testing-library/jest-dom/vitest`；实际执行测试数 0。已确认该包在 `package.json` 与 `package-lock.json` 中均不存在。
  - `npm run build` ❌ `build:shared` / `build:desktop` 通过，`build:renderer` 报 `[vite:build-html] Failed to resolve /src/main.tsx from renderer/index.html`。
  - `0001_init.sql` ✅ 17 张业务表 + `schema_version`、18 条索引，与 `docs/database.md` §2/§3 一致。
  - `shared/src/errors.ts` ✅ 34 条错误码（auth 7 / validation 2 / business 24 / system 1：仅 `SYS.INTERNAL`），无重复键；`fromError` 的兜底分支也落到 `SYS.INTERNAL`。
  - 未执行（原因）：`npm run dev:electron`（renderer 无入口，必白屏）；`npm run test` 的 renderer 部分（renderer 目前 0 个测试文件）。
- **遇到的困难与解决方案**：
  1. 首轮 `npm test` 的失败信息只暴露 setup 崩溃，容易误判为「测试代码有问题」。逐文件核对后确认 5 个测试文件本身完整，问题单点在 `tests/setup.ts` 的一行 import —— 已记入问题记录，修复方式应二选一：补 `@testing-library/jest-dom` 依赖，或把该 setup 拆为 renderer 专用（`environmentMatchGlobs` 已把 `renderer/**` 指向 jsdom，但 setup 是全局的）。
  2. dev server 对不存在的入口返回 200，容易被误读为「dev 可用」。通过检查 `Content-Type: text/html` 与响应体确认为 SPA fallback，已把该陷阱写进验证基线。
  3. `renderer/node_modules` 与根 `node_modules` 存在两套 Vite（6.4.3 / 5.4.21），排查时需明确「构建用 Vite 6、测试用 Vite 5」。
- **遗留问题与下一步（按优先级）**：
  1. **解阻塞**：修 `tests/setup.ts`（补依赖或拆分 scoped setup），恢复 5 个既有套件的收集 —— 这是唯一挡住全量门禁的问题。
  2. **补 renderer 入口**：落地 `src/main.tsx`、三层适配器（`VITE_API_ADAPTER=mock|ipc|http`）、store 与最小健康页，随后重跑 `npm run build` 并做一次 `npm run dev:electron` 端到端冒烟。
  3. **文档同步（待评审）**：把 D-14 落到 `design.md` §2.3、`docs/build-plan.md` §2/§7；把 D-15/D-16 与 `docs/order-data-map-design.md` §8 的接口草案回写到 `design.md`、`docs/api.md`、`docs/database.md`（含 `0002_order_ingestion.sql` 迁移草案与新增错误码）。
  4. **README 同步**：`README.md` 仍写「P0 文档阶段 / 尚未 git init / 命令为规划占位」，与实测不符，需一并更新文档入口表与运行说明。
  5. 评审 D-02 / D-11 / D-12 / D-13 / D-15 / D-16 后，再按提交纪律提交（本次未提交）。

### 2026-09-14 — 新增架构图集 `docs/architecture.md`（22 张 Mermaid，可导出） ✅

- **范围与目标**：为汇报/评审产出可直接导出为 PPT / Word / PDF / 图片的架构图。仅新增文档，**不含业务代码改动**；图中事实全部来自既有代码与文档，不新增设计。
- **变更清单**：
  - 新建 `docs/architecture.md`（932 行，11 章 + 图例，共 22 张 Mermaid 图）：系统分层架构、进程模型、一次调用链路（含统一信封与鉴权时序）、认证与角色权限、任务/车辆/告警/派发计划四个状态机、17 张表 ER 图与日志表分组、M4 调度引擎（预览与生效、约束评估短路顺序、占用区间、代码边界）、模块全景、P1-P6 路线图、事件流、部署与配置。
  - 统一实现状态标记 `【已实现】/【部分实现】/【设计中】/【二期】/【阻塞】/【注意】`，避免把设计态误读为已完成。
  - 写入实测可用的导出命令（`@mermaid-js/mermaid-cli`）与参数说明表。
  - `.gitignore` 新增 `docs/export/`：导出产物是可由 md 重建的构建产物，不纳入版本控制。
  - `AGENTS.md` 文档索引补入本文件。
- **关键设计决策**：无新增 D 编号。本文件定位为**既有设计与代码的可视化视图**，凡与 `design.md` / `docs/api.md` / `docs/database.md` 冲突，一律以那三者为准。
- **验证与测试结果（实测）**：
  - ✅ 22 张图全部渲染成功（`npx -y @mermaid-js/mermaid-cli -i docs/architecture.md -o docs/export/architecture.md -e png -w 1500 -s 2 -a docs/export/assets`，exit 0），导出 md 内含 22 条图片引用。
  - ✅ 逐张目视检查：emoji 原本在导出图中显示为方块（豆腐块），已全部替换为中文方括号标记；第 1 张图因嵌套 subgraph + 跨层连线产生大量空白，已重构为扁平分层并加 `wrappingWidth`，出图 1526×2268（此前为 3168×5692）。
  - ✅ 事实核对：权限点 4（admin 独占）+ 6（三角色共有）+ 10（dispatcher 额外）= 20，与 `ROLE_PERMISSIONS` 一致；错误码 34 条；业务表 17 张 + `schema_version`；索引 18 条；车辆 7 态；任务 8 态。
  - ⚠️ 已知取舍：`docs/export/` 已生成 3.6 MB PNG（22 张），因已 gitignore 故不进版本库；如需分发，重新执行导出命令即可。
- **遇到的困难与解决方案**：
  1. **Mermaid 类图 `+成员` 语法与 `apply_patch` 的 `+` 前缀冲突**，补丁被判为无效 hunk。改为在 classDiagram 中直接书写中文属性说明，不再使用 `+` 可见性修饰符。
  2. **emoji 在导出图中渲染为方块**：`【已实现】` 等中文标记替换后正常；同时发现两处替换后语义冗余（如「已实现【已实现】」），一并对齐为「【部分实现】」。
  3. **子图嵌套导致 dagre 布局出现大片空白**：改为扁平分层节点 + `style` 着色 + `wrappingWidth: 520`，图形高度从 5692px 降到 2268px。
  4. **误用 `-C` 覆盖字体反而导致文字溢出节点框**：字体度量在布局之后生效；已把该条改为「不建议用 `-C` 覆盖 font-family」，并注明 macOS 本地中文渲染本身正常（已实测）。
  5. **未在 `docs/database.md` 复核车辆状态机**：发现 `charging`/`offline`/`fault` 的迁移条件在任何文档中都未成稿，故图中只画已定义迁移并明确标注缺口，不臆测补全。
- **遗留问题与下一步**：
  1. 图中标注的三处**实现缺口**需在后续阶段闭合：`EventBus` 未按会话权限过滤事件（M6/M8 落地时补）、车辆状态机迁移表未成稿（M2/M7 补）、renderer 全层未实现。
  2. 待 D-15 / D-16 评审通过、`docs/api.md` 回写订单接口后，本图集需补一张「订单接入与地图联动」流程图。
  3. 未提交（按纪律，等评审后统一提交）。

### 2026-09-15 — 新增数据文件接口规范 `docs/data-interfaces.md`（四类文件，草案） ✅

- **范围与目标**：为新需求设计四类可导入数据文件的接口契约 —— 订单数据集 CSV、仿真地图、配送车辆参数、配送算法配置。需求方明确「仍在调研」，故本次**只做接口文档设计，不写实现**，并把不确定项集中列为待评审问题而非擅自定论。
- **变更清单**：
  - 新建 `docs/data-interfaces.md`（1092 行，12 章 + 2 张 Mermaid 图）：
    - §2 通用文件契约：编码/体积、JSON 信封（`schemaVersion`+`kind`+`meta`+`data`）、统一导入管线（12 阶段）、统一 `ImportIssue` 错误模型、幂等与批次、四种 `mode`、场景包组合校验。
    - §3 F1 订单 CSV：表头/分隔符/编码嗅探（含 GBK）、字段契约、列名映射两层策略、名称解析与歧义、重复策略、公式注入防护。
    - §4 F2 仿真地图：`nodes`/`edges`/`sites`/`restrictions` 完整示例与字段契约、**用 code 引用**的规则、图结构校验（连通分量/孤立节点等 7 项）、导入模式差异。
    - §5 F3 车辆参数：与既有 `vehicles` 表的分工（物理参数 vs 运行态）、能耗模型（量纲修正）、服务能力、与地图交叉校验、导入模式差异。
    - §6 F4 算法配置：与 `DISPATCH_COST_WEIGHTS` 等既有常量逐键对齐、权重量纲与约束、路径参数与 A* 可采纳性、规模上限、与 `settings` 表冲突优先级、生效时机。
    - §7 接口草案：统一 `{kind}` 参数化的 6 个导入接口 + 各 kind 权限/专属参数 + 算法配置 dry-run 预览 + 对称的导出能力（含往返一致要求）。
    - §8 错误码汇总：54 条，按管线/订单/地图/车辆/算法/路径/场景分组，每条带 severity。
    - §9 前端落地要点：导入向导状态机、组件拆分、性能与体验要点、三层适配器差异。
    - §10 数据模型新增建议（4 张表 + 索引）、§11 测试清单（C1-C5 / O1-O7 / M1-M7 / V1-V5 / A1-A6）、§12 待评审问题 Q1-Q9。
  - `design.md` §10.2 文档索引、`README.md` 文档入口表：补入本文件与另两份未索引的文档（`order-data-map-design.md`、`architecture.md`）。
- **关键设计决策**：新增 D-17（四类文件共用一套导入契约）、D-18（文件内用 code 引用）、D-19（车辆文件禁止运行态字段）、D-20（算法配置版本化，不接管 settings 热更新）。**四条均标注「待评审」**。
- **验证与测试结果**：
  - ✅ 文档结构自检：代码围栏 32 处（偶数配对）；52 个 Markdown 表格列数**逐块一致**（脚本校验，0 处不一致）。
  - ✅ 错误码闭环校验：文中出现的 54 个错误码与 §8 声明集合**完全一致**（脚本比对，无「用了未声明」或重复声明）。初稿有 3 处不一致（`MAP.IN_USE_CONFLICT` 与实际使用的 `IMPORT.IN_USE_CONFLICT` 混用、`ROUTE.VIA_NOT_ALLOWED` 与 `ROUTE.DETOUR_EXCEEDED` 未声明），已修正。
  - ✅ 2 张 Mermaid 图（导入管线、向导状态机）渲染成功（`@mermaid-js/mermaid-cli`，exit 0）。
  - ✅ 与既有实现的对齐核对：`costWeights` 五个键名与 `DISPATCH_COST_WEIGHTS` 完全一致；`priorityWeight` 与 `PRIORITY_WEIGHT` 一致；`limits` 缺省值与 D-12 的 `taskIds≤50`/车辆≤30 一致；`minBatteryPercent` 缺省与 `MIN_BATTERY_PERCENT` 一致；枚举取值均取自 `shared/src/enums.ts`。
  - 未执行：无代码改动，未运行 `npm test` / `npm run build`。
- **遇到的困难与解决方案**：
  1. 能耗模型量纲不成立（既有注释 `kmToWh(总里程)` 把里程当耗电），已在新文件 §5.4 固定为「每公里耗电 × 里程」并引入 `batteryCapacityWh`，同时给出缺容量时的退化口径与 warning，同步记入问题记录。
  2. 算法配置与 `settings` 表存在双写同一参数的隐患，定为「重叠项 settings 优先 + info 提示」，不静默覆盖，列为 Q3 待评审。
  3. 大文件路径的三层适配器差异（Electron 传 `filePath`、浏览器传 base64）会导致同一份前端代码行为分叉，已明确写入接口契约与前端要点，避免实现时「渲染层先读成 base64 再传」的性能陷阱。
  4. 预检长耗时与 IPC 等待的现实矛盾：引入 `options.previewLimit` 截断 + `truncated` 标记，并要求前端显式提示「仅预检前 N 行」，避免用户误判已全文校验。
- **遗留问题与下一步**：
  1. **Q1-Q9 待评审**，其中 Q2（配置确认权限用 `settings:write` 还是 `dispatch:apply`）、Q3（配置与 settings 边界）、Q7（迁移编号合并）影响面最大。
  2. 评审通过后回写：`docs/api.md`（新增导入/导出接口与 54 条错误码）、`docs/database.md`（4 张新表 DDL）、`design.md`（§6 数据模型、§7 权限矩阵）。
  3. 与 `docs/order-data-map-design.md` 合并去重：两份文件在订单导入、地区目录、错误分类上有重叠，需统一为单一来源，避免又一处文档漂移。
  4. 未提交（按纪律，等评审后统一提交）。

### 2026-09-15 — 两份订单/数据文档去重，消除口径分歧 ✅

- **范围与目标**：`docs/order-data-map-design.md`（v1.0）与 `docs/data-interfaces.md`（v0.1）在「文件怎么收、怎么校验、怎么报错、接口长什么样」上大面积重复，且已产生**三处实际口径分歧**。本次做一次性去重，确立「同一主题只有一处定义」并补齐交叉引用。仅文档改动，无代码。
- **变更清单**：
  - 重写 `docs/order-data-map-design.md`（144 行 → 201 行）：**只保留订单领域语义** —— 地区目录与匹配语义（§3）、订单数据文档（§4）、地图联动（§5）、订单专属接口（§6）、权限审计（§7）、落地节奏（§8）。新增 §0「去重说明」表，逐条列出被移除的 11 个重复主题及其唯一来源。
  - `docs/data-interfaces.md`（v0.1 → v0.2）：新增「与 `order-data-map-design.md` 的分工」表；§3.4 名称解析改为引用订单文档 §3.1，只保留错误码与 severity；§10 表清单登记订单领域三组表的**归属**（主定义在订单文档）并说明同属一个 `0002` 迁移；Q7 标记为已定。
  - `AGENTS.md`：问题记录的「迁移编号冲突」标记为**已解决**；新增本日志条目。
- **关键设计决策**：无新增 D 编号。本次是**既有设计决策的归属整理**，不改变任何设计内容的实质。
- **修正的三处口径分歧**（去重的主要收益）：
  1. **错误码命名**：v1.0 用无命名空间形式（`FILE_INVALID` / `FIELD_REQUIRED` / `DUPLICATE_ORDER` / `REGION_NOT_FOUND` / `REGION_AMBIGUOUS` / `ROUTE_NOT_FOUND` / `SITE_DISABLED`），与 `data-interfaces.md` §8 的 `IMPORT.*` / `ORDER.*` 形式冲突。现统一以 `data-interfaces.md` §8 为唯一错误码登记处。
  2. **批次表**：v1.0 的 `order_import_batches` 与 `data-interfaces.md` 的 `import_batches` 重复。现合并为一张 `import_batches`（`kind='orders'`）。
  3. **导入接口路径**：v1.0 的 `POST /api/orders/import/preview|confirm` 与 `data-interfaces.md` 的 `POST /api/imports/preview|confirm` 重复。现统一为后者 + `kind="orders"`，订单文档不再另立导入入口。
  - 附带解决 **Q7**：迁移编号统一为 `0002_data_import.sql`，`0002_order_ingestion.sql` 作废。
- **验证与测试结果**：
  - ✅ 结构自检：`order-data-map-design.md` 5 个表格列数一致、代码围栏 2 处配对；`data-interfaces.md` 54 个表格列数一致、围栏 32 处配对。
  - ✅ 1 张 Mermaid 图（订单领域流程）重新渲染成功，`data-interfaces.md` 2 张图仍正常（`@mermaid-js/mermaid-cli`，exit 0）。
  - ✅ 去重效果核验：脚本检索订单文档，确认「20 MB 上限 / BOM / 分隔符 / 流式解析 / 字段必填表 / onDuplicate / 公式注入」等主题**仅以引用形式出现**，无重复定义。
  - ✅ 残留引用扫描：全仓无 `order_import_batches`、`/api/orders/import`、`FILE_INVALID`、`HEADER_MISSING` 等已废弃标识的遗留使用（仅存在于去重说明表与历史日志中，属有意保留）。
  - 未执行：无代码改动，未运行 `npm test` / `npm run build`。
- **遇到的困难与解决方案**：
  1. 去重的难点不是删字，而是**判断每个主题该归谁**。判据定为：「文件格式/管线/横跨四类文件的通用规则」归 `data-interfaces.md`；「订单业务语义」归订单文档。据此把 `orders` / `order_import_rows` 留在订单文档，把 `import_batches` / `import_issues` 收归通用文档。
  2. `order_import_rows` 与 `import_issues` 语义相近易被合并，已明确分工并写入文档：前者是**每行结果**（含成功行，供数据文档还原），后者是**问题清单**（仅问题项）。二者不互相替代。
  3. 历史工作日志（2026-09-14 条目）中出现已作废的 `0002_order_ingestion.sql`。按工作日志**只追加不篡改**的原则保留原文，改由本条日志与问题记录表标注「已解决」，避免历史被悄悄改写。
- **遗留问题与下一步**：
  1. Q1-Q6、Q8、Q9 仍待评审（Q7 已定）。
  2. 评审通过后仍须回写 `docs/api.md`（导入/导出接口 + 错误码）、`docs/database.md`（新增表 DDL + `0002` 迁移）、`design.md`（§6 数据模型、§7 权限矩阵）。
  3. 未提交（按纪律，等评审后统一提交）。

### 2026-09-20 — 地图渲染选型改为 React Flow + 新增 M6 模块方案文档 ✅（已并入 `66fa7d2`）

- **范围与目标**：按需求「用 React Flow 做配送车辆地图以更好地可视化路线」，为 M6（地图可视化）定制落地方案并同步受影响文档。本次**只做方案与文档，不写业务代码**；`renderer/` 当前仍无入口，属纯新增设计。
- **变更清单**：
  - 新建 `docs/module-M6-map.md`（470 行，13 章）：选型结论与**实测数据**、React Flow 的能力边界、代码结构规划（`renderer/src/map/` 全展开）、数据映射（`map/overview` → 节点/边，含 id 命名空间与坐标变换）、节点与边类型系统（含 Handle 策略二选一）、视口与交互、路线高亮与车辆插值动画、事件接入与去重节流、性能预算与护栏、测试清单（含 jsdom stub）、打包与离线、风险与待评审、开发顺序与 DoD。
  - `design.md`：§2.1 分层图「地图画布」→ React Flow；§2.3 技术选型表地图行改为 React Flow（v12，仅 renderer）；§2.4 目录规划展开 `renderer/`（补 `main.tsx` 缺失说明与 `map/` 子结构）；§4.6 M6 职责补实现方案链接、Req-M6-4/5 补验收细节、**新增「渲染层约束」4 条**；§10.2 文档索引补 M6 方案。
  - `docs/architecture.md`：第 1、2 章两张图中的「SVG Canvas」改为 React Flow；新增 §8.2「地图渲染链路（M6 · React Flow 方案）」图（数据流与职责边界 + 4 项实现缺口），原 §8.2 顺延为 §8.3；图数 22 → 23，同步导出注释。
  - `README.md`：文档入口表补 `docs/module-M6-map.md`；图集数量 22 → 23。
  - `AGENTS.md`：文档索引补 M6 方案；新增决策 **D-21**；新增 3 条问题记录；本日志条目。
- **关键设计决策**：新增 **D-21**（M6 改用 React Flow，`@xyflow/react` v12，仅 renderer 依赖；`map/overview` 为唯一数据入口；地图只渲染路线不自行搜索路径；车辆位置禁止外推；图层开关用 `hidden`）。**待评审**。
- **验证与测试结果（2026-09-20 实测）**：
  - ✅ 依赖可解析：`@xyflow/react@12.11.6` + React 18.3.1，26 包，无 peer 冲突；license MIT；peer `react >= 17`。
  - ✅ Vite 6.4.3 构建（renderer 同形态）：186 模块 431ms；产物 JS 330.62 kB（gzip 106.66 kB）+ CSS 15.87 kB（gzip 2.67 kB）。
  - ✅ 体积增量：对照基线（仅 React+react-dom）143.65 kB → +186.97 kB（gzip +60.58 kB）。
  - ✅ 离线核验：产物中 `new Worker` / `WebAssembly` / `eval(` / 动态 `import(` 均为 0；仅含 `reactflow.dev` 署名链接字符串，**无运行时网络请求**。
  - ✅ Electron 44 端渲染：`loadFile()` 后真实 DOM 有 1 视口 / 1 节点 / 1 边，边 `<path d>` 与节点包围盒正常。
  - ✅ 车辆沿折线移动：按进度插值更新节点位置，3 次采样屏幕坐标 (229,119) → (508,319) → (337,148)，确在移动。
  - ✅ 性能：1200 节点/2330 边 + 20 Hz 刷新 → 中位 8.3 ms、p95 9.0 ms；2000 节点/3910 边 → 中位 8.3 ms、p95 16.7 ms（仍 60 fps）。
  - ✅ jsdom 组件测试：Vitest 2.1.9 分别在 Vite **6.4.3** 与 **5.4.21**（本仓库根配置）下各 1 passed；需 `ResizeObserver` + `matchMedia` stub。
  - ✅ 关键行为实测（均已写入文档）：handle **不会**自动就近选择（不指定时取声明顺序第一个）；同源同目标边路径完全重合且按数组顺序绘制（后者在上）；`hidden: true` 对节点与边均生效；显式 `sourceHandle`/`targetHandle` 生效；`EdgeLabelRenderer` 自定义边标签渲染成功。
  - ✅ `file://` 归因：Chrome headless 下 `type="module"` 脚本被拦、同内容传统脚本正常（最小复现），确认是 Chromium 的 `file://` 模块 CORS 行为；**真实 Electron `loadFile()` 实测正常**；单文件 IIFE 构建在 `file://` 下亦可渲染（兜底）。
  - 未执行：`npm test` / `npm run build` / `npm run db:migrate`（本次**无代码改动**，且 `tests/setup.ts` 既有阻塞项未修，跑了也只会复现已知失败）。所有验证均在 `/tmp` 下的独立探针工程与 Electron 44 中完成，未污染本仓库依赖。
- **遇到的困难与解决方案**：
  1. 首轮 Electron 验证只输出消息、拿不到渲染结果：改用 `executeJavaScript` 读取真实 DOM 计数与几何（节点数、边 `<path d>`、包围盒），才拿到可信结论。
  2. `file://` 不渲染一度疑似打包缺陷：设计对照实验（模块脚本 vs 传统脚本）确认是浏览器行为而非 React Flow 问题，再用真实 Electron 复核，避免把错误结论写进文档。
  3. 「自定义边未生效」的假警报：实际是探针 HTML 入口指向了旧文件（构建输入未更新），修正入口后 `edgeTypes` 正常工作。已在文档中保留「自定义边可用」的正面结论。
  4. 几个凭印象容易写错的点被实测推翻（自动就近选 handle、重复边自动错线），这三条若照印象写文档会直接导致实现返工，已改为「实测事实」并给出强制写法。
- **遗留问题与下一步**：
  1. **Q-1…Q-4 待评审**（是否隐藏 React Flow 署名、`PIXELS_PER_METER` 是否自适应、Handle 方案 A/B、超规模降级顺序）。
  2. D-21 待评审；通过后再落地 `renderer/package.json` 依赖与 `src/map/`。
  3. **前置阻塞未变**：`tests/setup.ts` 缺 `@testing-library/jest-dom` 导致 5 个既有套件无法收集；M6 渲染层测试依赖此项先修复（且需补 `ResizeObserver` stub）。
  4. 既有待办仍在：`design.md` §2.3 的 `better-sqlite3`（本次**仅改了地图行**，数据层行仍待按 D-14 修正）、`docs/build-plan.md` §2/§7、`README.md` 状态段与运行命令、D-15…D-20 评审。
  5. 按纪律：本次**未提交**，等评审后再统一提交。

### 2026-09-20 — 修复测试阻塞 + 实现渲染层与 React Flow 地图（P1 地基打通 · M6 落地）✅（已并入 `121af4d`）

- **范围与目标**：按需求「用 React Flow 做配送车辆地图以更好地可视化路线」把 M6 从**方案**推进到**可运行实现**，同时解掉长期挂账的测试阻塞。对应阶段：P1 地基收口 + M6 实现；需求条目：Req-M6-1/2/3/4/5（路由与选中、事件刷新、图层开关、单一数据入口）。
- **变更清单**：
  - **解阻塞（测试）**：`tests/setup.ts` 依赖补 `@testing-library/jest-dom`；新增 `desktop/src/db/sqlite.ts`（`createRequire` 惰性加载 `node:sqlite`），`db/index.ts` 改用它 —— 这是让 5 个套件能真正跑起来的**第二个**原因。
  - **主进程**：新增 `desktop/src/db/repositories/map.repo.ts`（`getMapOverview` 快照读取层）；`desktop/src/ipc/api.ts` 新增 `GET /api/map/overview`（`map:read` 权限）；8 条接口。
  - **shared**：`types.ts` 新增 `MapOverview` 与 8 个快照子类型（唯一契约来源）；`constants.ts` 的 `SEED_IDS` 补演示任务/路线/告警 id。
  - **seed**：新增 `seedDemoExecution`（演示任务 + 路线 + 告警，并把 AGV-01 置 `busy`、`load_kg` 同步）；`SeedSummary` 增 `tasks`/`routes`/`alerts`。
  - **渲染层（从 0 到 1，此前完全为空）**：`main.tsx`（HashRouter）、`api/`（client 契约 + ipc/http/mock 三层 + `types.ts` 再导出 shared + `mock-data.ts` 与 seed 同源）、`store/`（session / selection）、`app/`（路由 + `RequireSession`）、`components/AppLayout`、`pages/`（登录 / 工作台 / 占位页）、`map/`（model：projection/ids/layers/toFlow/motion/structural；nodes 5 类；edges 2 类；hooks 4 个；stage；style）、`test/dom-stubs.ts`。
  - **测试**：新增 `desktop/src/db/repositories/map.repo.test.ts`（8）、`renderer/src/api/mock-data.test.ts`（7）、`renderer/src/api/index.test.ts`（2）、`renderer/src/map/MapView.test.tsx`（5）与 map/model 5 个纯函数套件；`db.test.ts` 与 `router.test.ts` 各补断言。
  - **文档同步**：`docs/architecture.md`（§8.2 状态改为【已实现】、新增事件分层节点与实现缺口表、`API Routes 8 条`）；`docs/module-M6-map.md`（新增 §11.5 实现期实测五条结论、Q-5/Q-6）；`design.md` 数据层行；`docs/build-plan.md` §2/§7；`README.md` 状态段与文档入口；`docs/database.md` §4 seed 表新增演示数据行；本文件（快照 / 代码现状地图 / 验证基线 / D-22…D-27 / 14 条问题记录）。
- **关键设计决策**：新增 **D-22**（适配器默认值按 preload 桥判定）、**D-23**（地图事件分层：结构类重拉 / 位置类只写 ref）、**D-24**（`eventSeq` 用 `sqlite_sequence` 单调水位线）、**D-25**（派生字段在读取层算，不冗余落库）、**D-26**（seed 增加自洽的演示执行数据）、**D-27**（mock 演示数据从 `SEED_IDS` 派生并与真实快照做等价断言）。D-22…D-27 均**待评审**。
- **验证与测试结果（实测）**：
  - ✅ `npm test`：**15 套件 / 94 用例全通过**（会话开始时为 68/70，其中 2 个失败是 jsdom 限制造成的断言写法问题，已改为按 DOM 结构等待）。
  - ✅ `npm run typecheck`（三 workspace）与 `npm run build` 全部 exit 0。
  - ✅ `npm run db:migrate` / `db:seed`：迁移幂等；seed 结果 `tasks 1 · routes 1 · alerts 1` 新增，复跑各表新增 0。
  - ✅ **Electron 端到端（真实 ipc 适配器 + 真实 SQLite）**：登录 → 地图 **20 节点 / 39 边（34 路网 + 5 路线）/ 3 站点 / 3 车辆 / 2 任务端点 / 5 路线标签 / 20 迷你图方块**，与 seed 一致，无控制台错误。
  - ✅ **生产 `file://` 形态**（`win.loadFile('renderer/dist/index.html')`，无 `.env`）：自动选中 `ipc`，渲染结果与 dev 相同。
  - ✅ **浏览器 mock 形态**：渲染结果与 ipc **逐项相同**（20/39/5/20），三层适配器行为一致。
  - ✅ **交互**：点车辆选中（图例「已选中：vehicle · AGV-01」，7s 后保持）、点空白清空、图层开关 20→8→20 且选中不丢。
  - ✅ `node:sqlite` 在 Electron 44.3.0（内置 Node 24.20.0）正常；`docs/architecture.md` 23 张 Mermaid 全部渲染成功。
  - 未执行（原因）：无。
- **遇到的困难与解决方案**（均记入「困难与问题记录」，此处摘关键四条）：
  1. **测试仍全红，但换了一个错**：修完 setup 依赖后变成 `Failed to load url sqlite`。逐层排查 vite-node 源码，确认其内置模块白名单是打包时固化的、且会剥掉 `node:` 前缀，而 Node 25 的 `node:sqlite` **只有带前缀**形式。改用 `createRequire` 惰性加载（并保留还原条件注释），Electron 下复测通过。
  2. **边会间歇性消失（`edges=0`）**：`vehicle.changed` 每秒触发全量快照重拉 → 每秒重建 `nodes`/`edges` → React Flow 重新测量。修复为事件分层 + 结构签名（D-23）。**这条恰好是我自己在 `docs/module-M6-map.md` §9 写下的护栏，首版实现却违反了它** —— 文档是对的。
  3. **路线高亮「看不出来」但不报错**：`<BaseEdge>` 把 `className` 拼在 `<path>` 自身，`.udm-edge-route.is-active path` 是死选择器；同类问题还有 `.react-flow__node.is-selected`（React Flow 用 `selected`）。改用「同元素多类」写法后实测 `stroke` 与 `box-shadow` 才真正生效。
  4. **迷你图一个方块都不画**：React Flow 只为「有尺寸」的节点画方块，而用户节点的 `measured` 在渲染后仍未落位。用**官方推荐写法的最小复现**确认不是本项目配置问题后，给节点补 `initialWidth/initialHeight`（实测 0 → 20）。
- **遗留问题与下一步**：
  1. **D-15…D-27 全部待评审**；本条目未提交，等评审后统一提交。
  2. 地图缺口：`include=orders,orderEndpoints`（待订单摄入 `0002_data_import`）、`/api/map/tracks/{vehicleId}` 轨迹回放、`EventBus` 未按会话权限过滤。
  3. **车辆在地图上静止**：无组件持续产生 `vehicle.changed`（模拟执行器属 M7），已记为待评审 Q-6；不在前端伪造位置。
  4. 业务页仍为占位（任务 / 调度 / 告警 / 基础数据 / 设置 / 用户），下一步按 M2 → M3 → M4 推进。

### 2026-09-21 — 按真实样本核对并重写订单 / 地图 / 车辆三章接口契约（`docs/data-interfaces.md` v0.2 → v0.3） ✅

- **范围与目标**：读取 `/Users/sunsetflower/myJobs/data/第三次课_数据准备/` 中的 `1_仿真地图`、`2_订单数据集`、`3_车辆参数` 三类数据（**用户明确限定只这三类**），逐字段核对既有接口文档，把「凭常识推演的字段契约」改写为「与真实文件一致」。
  本条目**仅改文档，不含业务代码改动**；`4_调度约束` / `5_数据校验` / `6_数据说明文档` 与 `scripts/`、`docs/` **未纳入**（F4 章因此保持 v0.2，已列为待评审 Q16）。
- **变更清单**：
  - `docs/data-interfaces.md`（1117 → 1928 行，v0.2 → v0.3）：
    - **头部**：版本/状态/样本依据/范围声明；去重表补入「错误码登记处」与 `module-M6-map.md` 归属；新增「地区目录在本样本上无实例，仍属未验证」的待办。
    - **§0 阅读提示**：四类文件表补「实测样本形态 vs 系统侧标准形态」两列；新增样本**三层来源**表（① 真实基准 ② 文献参数 ③ 仿真构造）。
    - **§2.2 信封**：区分**原生形态 / 标准形态**；`kind` 补 `orders`（原缺）；新增 `meta.sourceFiles`、`meta.coordinateSystem`；说明 F3 样本无 `kind`/`data` 的适配方式；新增 `IMPORT.SCHEMA_VERSION_ASSUMED`（样本本就不含版本字段）。
    - **§2.5 幂等**：多文件输入的 `contentSha256` 改为「全部输入文件按名排序后逐个哈希再合并」，批次记录逐文件留痕。
    - **§2.7 场景包**：明确一个完整场景是 ~~**6 份文件**~~ **7 份文件**（地图包实为 5 个文件；2026-09-21 见「按样本复核」条目）；新增三件套自洽性 **6 项实测基线**表（全部 0 偏差）。
    - **§3 F1 订单（整章重写，11 小节）**：三类数据集与来源分层；**26 列**字段契约 + `li_lim` 32 列变体；**当日秒数时间口径**（含分精度比对规则、跨日、`order_time` 晚于时间窗）；**优先级 1/2/3 → normal/high/urgent 映射**（附实测分布 159/13/28 与 `priority_raw` 保留）；**订单类型 ↔ 端点 `DEPOT` 不变量**（实测 200/200 成立）；派生列定位为「校验而非信任」；`data_origin` 前缀约定。
    - **§4 F2 地图（整章重写，8 小节）**：明确输入是 ~~**4 文件包**（3 CSV + GeoJSON）~~ **5 文件包**（3 CSV + `campus.add.xml` + GeoJSON；2026-09-21 见「按样本复核」条目）而非单 JSON；`roadTypes` **road_type ↔ 限速/车道/优先级**映射表；**站点改为边绑定**（`edge_id` + 车道 + 泊位区间 + 泊位容量）；`_R` 反向边约定与 `bidirectional` 三种写法的落库结果；障碍物分「仅渲染 / 生成禁行」两类；`roadType` 缺失的保守推断；图结构校验 9 项（附实测）；**§4.7 与既有数据模型的差异表**（7 处列级变更建议）。
    - **§5 F3 车辆（整章重写，10 小节）**：与既有 `vehicles` 表的字段对应表；**45 行逐字段契约**（38 个顶层键 + 7 个 `cargo_box.*`，按 8 组分类）；**能耗单位改为 kWh/km**（废弃 Wh/km 口径）并说明为何首期不做载重修正；三种速度语义辨析；`fleet` 与 `vehicles` 的一致性约束；与地图的 5 项交叉校验；**9 条 `consistency_rules` 的错误码/severity 分级表**；**§5.8 跨文件单位口径对照表**（升 vs 立方米等）；`[A/B/C/D]` 溯源处理（含 `[D]` 级实测占比，并区分「车辆文件 129」与「样本合计 218」两种口径）。
    - **§7 接口**：各 kind 专属 options 扩至 `priorityMapping`/`serviceDate`/`sourceBundle`/`inferRoadTypes`/`executeConsistencyRules`/`keepProvenance` 并逐项释义；导出能力补 `?format=csv-bundle` 与「JSON ↔ CSV 包必须无损」要求。
    - **§8 错误码（整章重写）**：12 → **97 条**，按 通用/订单/地图/车辆/算法/路径/场景 分组；新增 **§8.8 分维度速查表**（文件级/结构级/引用级/语义级/数据质量级）；登记 2 条废弃码。
    - **§9 前端落地要点**：组件表新增 5 个（来源徽标 / 地图包选择 / 泊位表 / 一致性规则面板 / 可信级别筛选）；新增 **§9.5 五条前端专属约定**（F-1…F-5）。
    - **§10 数据模型**：新增「本次核对新增/变更的列」表（`orders` 6 列 + `road_types`/`obstacles`/`vehicle_type_params`/`vehicle_param_provenance` 四张新表 + `nodes`/`edges`/`sites` 变更），并给出迁移影响面提示。
    - **§11 测试清单**：C1-C7 / O1-O18 / ~~M1-M20~~ **M1-M21** / V1-V18 / A1-A6 / **W1-W8（前端专项）**（地图段扩 1 条 `campus.add.xml` 用例，2026-09-21）；用例编号与断言值直接取自样本实测。
    - **§12 待评审**：保留 Q1-Q9，新增 **Q10-Q16**（多文件包 / 站点边绑定 / 优先级映射 / 时间口径 / 溯源落库 / 规则求值位置 / F4 待核对）与 **§12.3「无需评审」项**（5 条实测已定论）。
    - **§13 新增：实测数据速查**（地图 / 订单 / 车辆三张表），既是设计依据也是 §11 的断言值来源。
- **关键设计决策**：新增 **D-28**（原生形态 vs 标准形态；多文件幂等哈希）、**D-29**（订单当日秒数口径 + 优先级显式映射并保留原值）、**D-30**（站点边绑定 + 泊位模型，`node_id` 保留可空双写过渡）、**D-31**（车辆 kWh/km 单位定死 + `consistency_rules` 服务端求值 + `[A/B/C/D]` 落库展示不阻断）。**四条均待评审**；D-17/D-18/D-19 的既有口径未变（本次只是让字段表与真实文件对齐）。
- **验证与测试结果（2026-09-21，全部为脚本实测）**：
  - ✅ **文档结构自检**：代码围栏 30 处（偶数配对）；**96 个 Markdown 表格块列数逐块一致**（0 处不一致）；2 张 Mermaid 图 fence 完整。
  - ✅ **错误码闭环**：§8 声明 **97 条**；正文引用的 code 与声明集合**完全一致**（0 处「用了未声明」）。过程中修掉 2 处（`SCENARIO.SPEED_LIMIT_CONFLICT` 与 `VEHICLE.SPEED_LIMIT_CONFLICT` 同一语义两个码，已统一为后者并删去前者；`VEHICLE.SITE_TYPE_UNCOVERED` 声明未引用，已在 §5.6 补引）。
  - ✅ **章节交叉引用**：文中 `§x.y` 引用 **0 处悬空**（逐个比对 91 个标题）。
  - ✅ **订单样本核对**（`campus_orders.csv` 200 行全量）：`order_id` 无重复；`order_type` 132/40/28；`priority` 159/13/28 且与类型强相关；坐标与站点表 **0 偏差**；`euclid_dist_m`、`min_travel_min` 复算 **0 偏差**；`HH:MM:SS` 与 `order_time_s` **0 偏差**；`tw_start` 文本与秒数列 **197/200 不严格相等**（分精度所致，已据此定契约）；类型 ↔ 端点不变量 **200/200 成立**。
  - ✅ **地图样本核对**：节点 30（traffic_light 9 / priority 21）；边 90 = 45 正向 + 45 `_R`（反向齐全、无重复、无自环）；**45/45 边长 == 两端欧氏距离**；道路类型 3 种且 90/90 行的限速/车道/优先级与 `campus.typ.xml` 一致；连通分量 1、孤立节点 0；站点 13 个**全部边绑定**且泊位区间在边长内；GeoJSON 133 features 且**无 `crs`、坐标为平面米制**；障碍 15 个 `poly` + 14 个 `parkingArea`。
  - ✅ **车辆样本核对**：3 车型 × 38 个顶层键（§5.3 展开为 45 行）；**9 条 `consistency_rules` 三型全部通过**；`fleet` 与 `vehicles` 键一致；`[A/B/C/D]` 在**车辆文件**为 A 0 / B 43 / C 20 / D 66（129 个数值字段，51.2% 为工程假设）。~~先前记为「218 个 / B 62 / C 24 / D 132 / 60.6%」是**两份文件合计**（含 `dispatch_constraints.yaml` 89 个），口径标错~~（已于 2026-09-21 更正）。
  - ✅ **三件套自洽性**：6 项交叉检查全部通过（订单端点 ⊂ 站点、订单坐标 == 站点坐标、站点边 ⊂ 路网边、车辆限速键 == 道路类型、最大货重 ≤ 最小车型载重、泊位在边长内）。
  - ⚠️ **修正了我在本次核对中自身写错的两处**：① 原写「Solomon 56 个已转 CSV」，实际 `solomon/` 内**只有 1 个** CSV（`c101`，另有 56 个 JSON 算例）；② 原写「Li & Lim 各 52–55 行」，实际 56 个文件行数 **50–55**。两处均已更正并写入问题记录。
  - ✅ `npm test`：**15 套件 / 94 用例全通过**（2.11 s）。本次**无代码改动**，跑一遍是为了确认文档改动没有意外波及既有基线。
  - 未执行（原因）：`npm run typecheck` / `npm run build`——本次未触碰任何 `.ts`/`.tsx`/配置，`npm test` 已覆盖类型与打包外的实际行为。
  - 未执行（原因）：`4_调度约束` / `5_数据校验` 的核对——**用户明确限定只读三类数据**，已列为 Q16。
- **遇到的困难与解决方案**：见「困难与问题记录」新增 7 条，其中方法论上有价值的三条：
  1. **没有样本时写字段级契约是高风险动作**：本次三章几乎全部重写，根因是 v0.2 在无样本情况下按常识推演字段。结论已写入问题记录——无样本时应只写管线与错误模型，字段表留待有样本后再定。
  2. **自检发现自己的笔误**：两处数字（Solomon CSV 数量、Li & Lim 行数）是凭印象写的，逐个 `ls`/`wc` 复核后更正。数据类文档中的每个数字都应可追溯到一条命令。
  3. **「怀疑样本」之前先读样本的溯源标注**：`UGV-L` 的整备质量曾被我判为笔误，实际样本对该值有 `[B]` 级依据与拆分说明。
- **遗留问题与下一步**：
  1. **D-28…D-31 与 Q10-Q16 待评审**；本条目**未提交**，等评审后统一提交（按纪律：先记录，后提交）。
  2. **F4 章需按同样标准核对**：拿到 `4_调度约束/dispatch_constraints.yaml` 后重做一遍（Q16），并让 §6 与 §5 的单位/时间口径对齐。
  3. **回写其它文档（待评审通过后）**：`docs/database.md`（§10 的新增/变更列 → `0002_data_import.sql` DDL）、`docs/api.md`（97 条错误码 + 导入导出接口）、`design.md`（§6 数据模型 + §3.7 权限矩阵）、`docs/architecture.md`（补一张「订单/地图/车辆三件套导入」流程图）。
  4. **实现侧待办**：站点边绑定迁移时**不要**在同一迁移里把 `node_id` 改成非空边绑定（会打断 M6 与 seed，见 §4.7 与 §10 的迁移影响面提示）。

### 2026-09-21 — 新建项目问题汇总 `docs/issues.md`（Issue Register），并把它接入提交纪律 ✅

- **范围与目标**：把散落在 `AGENTS.md`「困难与问题记录」、各文档「待评审/风险/缺口」小节、以及源码实测中发现的
  问题，**汇总为一份可持续维护的清单**，解决「问题散落在 6 份文档、无定级、无法一眼看出还剩什么」的现状。
  本条目**以文档为主**，另含 2 处代码/配置级问题的**登记**（未修，见 ISS-008 / ISS-009）；不含业务代码改动。
- **变更清单**：
  - **新建 `docs/issues.md`**（713 行）：全项目唯一的「问题/风险/待决」清单。
    - **§0 总览**：29 条的严重度分布（P1 4 / P2 18 / P3 7）与状态分布；**§0.1 建议处理顺序**（5 条）；
      **§0.2 全部问题索引**（带锚点，可跳转）。
    - **§1 问题明细**（按 P1/P2/P3 分组，每条含「现象 / 影响 / 建议动作 / 出处」四段 + 严重度/状态/类型/领域四属性）：
      P1 四条 —— **ISS-001** 错误码两套并存（`api.md` §2 的 34 条 vs `data-interfaces.md` §8 的 97 条，
      **零重叠**且两份文档各自声称「唯一来源」）、**ISS-009** `EventBus` 未按会话权限过滤（安全边界）、
      **ISS-017/ISS-018** 决策与开放问题待评审；
      P2 十八条 —— 4 条文档过期（architecture §8.3 停在 09-14、仍标「【阻塞】tests/setup.ts」、
      build-plan §4「M6 尚未实现」、module-M6-map 头部「尚未实现」）、设计决策表标注与日志口径不一致（ISS-007）、
      `engines.node` 与 `node:sqlite` 下限不符（ISS-008）、M2-M10 未开工、`include=orders` 与 `tracks` 未实现、
      `0002_data_import` 与导入导出接口未实现、车辆状态机缺迁移表、F4 章未按样本核对（ISS-020）、
      地区目录别名/歧义无样本可验证（ISS-022）、`sites` 边绑定迁移风险（ISS-024）、工作区大量未提交（ISS-029）等；
      P3 七条 —— `API.ROUTE_NOT_FOUND` 未登记、分页工具内联、`[D]` 级假设占车辆文件 51.2%、跨日时间窗、
      两套 Vite / 两份 zustand、`apply_patch` 中文大文件、Chrome 开 `file://` 的误判。
    - **§2 已解决问题（20 条，保留备查）**：从 `AGENTS.md` 汇总，保留「现象 → 根因 → 解法 → 出处」。
    - **§3 如何使用**（评审前 / 开发中 / 提交前三个场景）+ **§4 统计口径说明**（严重度与状态判定标准、不收录什么）。
  - **接入索引与纪律**：
    - `README.md` 文档入口表、`design.md` §10.2 文档索引、`docs/architecture.md` 抬头关联行：补入本文件。
    - `AGENTS.md` 文档索引补入；**提交纪律新增第 3.5 步**（提交前同步 `issues.md` + 工作日志引用 `ISS-xxx`）；
      **禁止项新增 2 条**（禁止删除已解决条目、禁止另建第二份问题清单）。
- **关键设计决策**：**无新增 D 编号**。本文件是**既有事实的汇总视图**，不引入新设计；
  与 `AGENTS.md` 的分工在文件头明确：本文件记「**现在还剩什么问题**」，`AGENTS.md` 记「**什么时候发生了什么**」。
- **验证与测试结果（2026-09-21 实测）**：
  - ✅ **文档结构自检**：713 行；**37 个表格块列数逐块一致**（0 处不一致）；无未闭合代码围栏。
  - ✅ **锚点闭环**：29 个明细小节 ↔ 29 条索引锚点，**0 处悬空**（脚本比对）。
  - ✅ **编号唯一性**：29 条 `ISS-xxx` 无重复；严重度/状态分布与 §0 总览一致。
  - ✅ **逐条事实核对**（写入清单的每条都复核过来源，非凭印象）：
    `shared/src/errors.ts` **34 条**、`docs/api.md` §2 **35 个**（含 2 个误匹配的 `detail.fields`/`data.failed`，实为字段引用 → 故 ISS-002 只登记 `API.ROUTE_NOT_FOUND` 一条）、
    `docs/data-interfaces.md` §8 **97 条**、两者交集 **0**；`renderer/src/app/App.tsx` **7 个 `PlaceholderPage` 路由**；
    `desktop/src/ipc/api.ts` **8 条路由**；`package.json` `engines.node = ">=20.11"`；
    `EventBus.emit()` 对 `targets` **无条件群发**（无权限过滤）；决策表中仅 **D-11/D-17/D-21** 带「待评审」字样，
    而日志声明 D-15…D-31 待评审（→ ISS-007）。
  - ✅ `npm test`：**15 套件 / 94 用例全通过**；`npm run typecheck` 三 workspace exit 0；`npm run build` 通过
    （renderer 产物 JS 379.34 kB / gzip 124.00 kB）——确认本轮文档改动未影响构建基线。
  - 未修复（本次仅登记）：`ISS-008`（`engines.node`）与 `ISS-009`（`EventBus` 权限过滤）**只登记未改代码**，
    因为前者涉及运行环境约定、后者属安全边界且需与评审一起定方案，不宜夹在文档提交里顺手改。
- **遇到的困难与解决方案**：
  1. **判断「错误码 34 vs 97」是重复还是分叉**：一开始两个数字看起来只是「清单不全」。
     用脚本取交集后发现 **交集为 0**——不是漏登记，而是**两套命名体系**（`GRAPH.EMPTY` vs `MAP.EMPTY_GRAPH`）。
     性质完全不同：前者补几行即可，后者必须先定口径。已升级为 **P1 / ISS-001**，并给出两个可选方案与倾向。
  2. **避免制造「第二份真相」**：本项目已两次因「同一主题两处各写一份」产生分歧（订单文档与接口文档、迁移编号）。
     故在文件头用一张分工表明确本文件与 `AGENTS.md`/各文档 §12/§7 的边界，并在禁止项里写死「禁止另建第二份清单」。
  3. **严重度定级不能凭感觉**：把「M2-M10 未开工」这类**计划内**工作与真实缺陷混在一起会让 P1/P2 失去意义。
     因此新设 `计划内` 与 `已接受（非缺陷）` 两种状态——缺口可见，但不占用优先级的注意力。
  4. **写清单本身要防「凭印象」**：上一轮刚因凭印象写数字出过两次错（Solomon CSV 数量、Li & Lim 行数）。
     本次每条都跑脚本复核（含 `renderer` 路由数、`api.ts` 路由数、`engines` 字段、`EventBus` 是否有过滤），
     并把复核结果写进验证记录。
- **遗留问题与下一步（按优先级）**：
  1. **`ISS-001` 必须先定**（错误码口径）：它阻断 `ISS-013`（`0002_data_import`）与 `ISS-014`（导入接口）。
  2. **`ISS-017` / `ISS-018` 合并评审**（D-17、D-28…D-31 与 Q1-Q16 是一体两面），评审后同步决策表状态列（`ISS-007`）。
  3. **`ISS-009`（EventBus 权限过滤）** 属安全边界，建议不等到 M8，提前排期。
  4. 四条**文档过期**（`ISS-003`…`ISS-006`）改动小、收益直接，可随手清掉。
  5. 本条目**未提交**；按纪律，提交时须一并把 `issues.md` 的状态与本条引用关系对齐。

### 2026-09-22 — 为 P2 阶段开工补齐 M2 模块文档；修车辆状态取值缺陷与 issues 索引锚点，暴露 `edges` 缺业务键（ISS-035/036/037/038）✅

- **范围与目标**：`docs/build-plan.md` §6 的 **P2 阶段第一项是「M1 + M2」**，但 `docs/` 下只有 M4 / M6 两份模块开发文档，
  M2 的口径散落在三份文档里，开工前需自行拼装。本次以「**按规范进行文档内容的修改和补充，为业务代码的实现做准备**」为目标：
  补齐 M2 模块开发文档，并把编写过程中暴露的**契约缺陷**修掉。**不含业务代码改动**。
- **变更清单**：
  - **新增 [`docs/module-M2-base-data.md`](./docs/module-M2-base-data.md)**（310 行，按 `module-M4-dispatch.md` 的格式）：
    模块定位与边界（明确**不负责**什么）、代码结构规划（`desktop/src/domain/base/` 五个服务 + Repository 划分）、
    服务契约与事务边界（「读旧值→校验→写表→写审计」，事件与告警评估放**事务提交后**）、
    **13 级固定校验顺序**、软删与 `BASE.NODE_IN_USE` 的判定范围、审计动作命名（`module=base`）、
    错误映射表、B1-B16 测试清单、6 步 DoD、6 个待决项（§11）。
  - **修复 `docs/api.md` §3.2.2（ISS-036）**：`PATCH /api/vehicles/{id}/status` 原写 `{ "status": "disabled" / "enabled" }`，
    但车辆 7 态枚举**没有 `enabled`**（那是 `sites`/`nodes`/`edges` 的取值）→ 改为 `disabled`（软删）/ `idle`（启用），
    并写明「车辆域没有 `enabled`」、占用中停用 → `VEHICLE.STATE_CONFLICT`、`PUT /api/vehicles/{id}` **不含 `status`**。
  - **补登 `RESTRICTION.NOT_FOUND`**：`PUT`/`DELETE /api/restrictions/{id}` 此前没有可用的「不存在」错误码。
    按 D-33 先写 `shared/src/errors.ts`（**唯一登记处**）→ `docs/api.md` §2.1 → 被 `module-M2-base-data.md` §8 引用。
    `ERROR_CODES` **124 → 125 条**（35 运行时 + 90 导入域）。
  - **新增 D-35（`edges` 业务键）**：见下「关键设计决策」。
  - **`design.md` §4.2 补「车辆状态迁移（M2 拥有的部分）」表**：只列 M2 真正拥有的 `idle ↔ disabled` 两条，
    并标注 `charging`/`offline`/`fault` 仍待 M7（ISS-016）。
  - **`docs/issues.md` 索引锚点修复（ISS-038）**：全部 37 条索引链接**渲染后 0 条可跳转**（缺 `<a id="iss0xx">`），
    已补 38 个显式锚点；并把「锚点可解析」加入结构自检。这是**静默失效**：Markdown 源码看不出问题，
    历次「列数 / 围栏 / 编号」自检都抓不到。
  - **索引与口径同步**：`README.md` 文档入口补 M2 文档；`docs/build-plan.md` §6 的 P2 行指向 M2 文档；
    `docs/architecture.md` 车辆状态机图补 `disabled → idle`、把「M2 与 M7 落地时补写」改为「M2 已定稿、其余待 M7」；
    `docs/database.md` §6 的 `0002_data_import.sql` 登记行补 `edges.code`；`docs/data-interfaces.md` §10 变更表补 `code` 列；
    `AGENTS.md`「项目快照 / 代码现状地图 / 验证基线」的错误码条数同步为 125。
- **关键设计决策**：新增 **D-35**（状态 `待评审`，并入 ISS-017 评审批次，**未改代码**）：
  `edges` 新增业务 `code` 列（`TEXT NOT NULL UNIQUE`，缺省 `E_<fromCode>_<toCode>`，反向边加 `_R`），
  作为 D-18「文件内一律用 code 引用」的**持久键**；**文件内 `edge_id` 字段语义 = 边的 `code`**，
  而库内 JSON 列（`routes.edge_ids`）继续存 **id**（与 `routes.node_ids` 一致）。
  理由：契约有四处指向 `edges[].code`（`sites.onEdgeCode` / `obstacles.affectsEdgeCodes[]` / `codeOfReverse` / 禁行边目标），
  且样本 `campus_edges.csv` 的 `edge_id` 列就是它 —— 而 `nodes`/`sites`/`vehicles`/`task_templates`/`tasks` **都有 code 列，唯独 `edges` 没有**。
  契约要求一个无处落库的键：`merge` 模式的「库内解析」无从实现，反向边 `_R` 约定也无法持久化。
  同时明确**区分**两个此前含混的概念：文件里的 `edge_id`（= code）与库内 `routes.edge_ids`（= id）。
- **验证与测试结果（2026-09-22 实测）**：
  - ✅ `npm test`：**18 个套件 / 110 个用例全通过**（新增的 `RESTRICTION.NOT_FOUND` 未破坏 `errors.catalog.test.ts` 的闭环断言）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 JS 394.36 kB（gzip 128.82 kB）+ CSS 24.45 kB（gzip 4.51 kB）。
  - ✅ **错误码闭环**：`ERROR_CODES` **125 条唯一**（脚本核 125 == 35 + 90）；`docs/api.md` §2.1/§2.2 行数 35 / 90，
    与 §2 抬头「125 条（35 运行时 + 90 导入域）」一致；`docs/api.md` / `docs/data-interfaces.md` 中出现的 code **0 处未登记**。
  - ✅ **文档结构自检**：14 份 Markdown（原 13 份 + 本轮新增 M2 文档），**248 个表格块**列数逐块一致（0 处不一致）、**224 个代码围栏**全部闭合。
  - ✅ **`docs/issues.md` 闭环**：38 条索引 ↔ 38 条明细 ↔ 38 个锚点，**重复 0 / 悬空 0 / 未用 0**；
    严重度 5 P1 + 24 P2 + 9 P3 = 38；状态合计 38；§2 已解决表 33 行。
  - ✅ **悬空路径扫描**：6 条命中均为**故意保留的历史提及**（`desktop/db/seed.ts` ×3、`shared/i18n/dispatch.ts` ×3，
    出现在「错误写法 → 实为」的对照里），非新增漂移。
- **遇到的困难与解决方案**：
  1. **「文档里写了一个不存在的东西」比「数字写错」更难发现**：`enabled` 那处（ISS-036）单个词，
     但它会让 M2 的车辆启停按契约实现后**写库必失败**。这类缺陷的任何数值清单都查不出来 ——
     只有把文档逐条与 `shared/src/enums.ts`、`0001_init.sql` 的 CHECK 对照才会暴露。
     结论：写模块文档时**必须把契约与枚举/DDL 逐项对表**，这是本次唯一发现该缺陷的方式。
  2. **差点制造新的漂移**：为记录 D-35 我一度把 `code` 列直接加进 `docs/database.md` §2 的 `0001_init.sql` DDL ——
     但该节声明「与 `0001_init.sql` 一致」，写了就等于宣称该列已存在。已回滚，改为在 §6 的 `0002_data_import.sql`
     登记行里注明，并在 `design.md` §6.2 用「**待加列**」显式区分「现有」与「目标」。
     教训：**新增「尚未实现」的东西时，必须与「已实现」在版式上可区分**，否则文档会骗人。
  3. **索引锚点是静默失效**：`](#iss037)` 在 Markdown 源码里完全正常，只有渲染后才知道点不动。
     我是在登记 ISS-037 时顺手验证锚点才发现的 —— 说明**结构自检的覆盖面本身就是一种风险**：
     之前只查列数/围栏/编号唯一性，就漏掉了链接可解析性。已把该项补进自检。
  4. **拿不准「M2 文档是否算新设计」**：`design.md` 是 `Req-*` 与状态机的唯一来源（D-34），
     所以车辆那两条迁移必须写回 `design.md` §4.2，不能只在模块文档里定；模块文档只承载**实现口径**。
- **遗留问题与下一步**：
  1. **D-35 待评审**（并入 ISS-017，现为 12 项）；通过后随 `0002_data_import.sql` 加列与回填，届时需重跑全量测试。
  2. **`module-M2-base-data.md` §11 的 6 个待决项**需评审，其中 Q1（`OBJECT_TYPES` 缺 `restriction` / `task_template`）
     会影响审计写入，**M2 开工前需先定**；若扩枚举，须按 `docs/database.md` §6 规则 4 用新迁移重建 `alerts.object_type` 的 CHECK。
  3. **M1 仍无模块开发文档**（P2 阶段另一项）；若按本次标准做，可与 M2 文档一并评审。
  4. **已提交**：`84fa028`（`docs(base-data): 补 M2 模块开发文档并修两处契约缺陷`），含 10 份文档修改
     + 新增 `docs/module-M2-base-data.md` + `shared/src/errors.ts`（**1 行**：`RESTRICTION.NOT_FOUND`）。
     `shared/src/errors.ts` 与 `docs/api.md` §2 **同批**提交，未出现「文档有 code、登记处没有」。
     提交前已跑全量门禁（`npm test` 18 套件 / 110 用例 · `typecheck` 3 workspace · `build` 三端）全通过；
     提交后工作区干净，基线由 `076714e` 推进到 `84fa028`，`ISS-029` 关闭。

### 2026-09-22 — 提交 M2 文档批次并回写基线：关闭 ISS-029，工作区清空 ✅

- **范围与目标**：把上一轮已按纪律记录的 M2 文档批次**落成提交**，并回写「基线提交号 / 工作区状态」两处事实，
  关闭 `docs/issues.md` 的 `ISS-029`（工作区长期存在大量未提交改动）。**不含业务代码改动**（`shared/src/errors.ts` 仅 1 行，随上一条日志提交）。
- **变更清单**：
  - 提交 `84fa028`（`docs(base-data): 补 M2 模块开发文档并修两处契约缺陷`）：10 份文档修改
    + 新增 `docs/module-M2-base-data.md` + `shared/src/errors.ts`（`RESTRICTION.NOT_FOUND`）。
    `errors.ts` 与 `docs/api.md` §2 **同批**提交，满足 D-33「文档有 code、登记处必须有」。
  - 本文件：**仓库状态**基线由 `076714e` → `84fa028`，并写明工作区已清空；上一条日志的「未提交」段改为「已提交」。
  - `docs/issues.md`：`ISS-029` 状态 `待办` → `已解决（2026-09-22）`，明细块由 §1.2 迁至 §1.3，§0 总览
    （已解决 17 → 18 / 待办 10 → 9）、§0.1 处理顺序（`ISS-029` 移出待办表）、§0.2 索引状态、两处小节标题条数、§2 已解决表 各同步一行。
- **关键设计决策**：无新增 D 编号。本条只做**提交与状态回写**，不引入新口径。
- **验证与测试结果（2026-09-22 复跑，提交前）**：
  - ✅ `npm test`：**18 套件 / 110 用例全通过**（`errors.catalog.test.ts` 对文档 code 的闭环断言通过，证明同批提交未产生「有 code 无登记」）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace exit 0。
  - ✅ `npm run build`：三端全通；renderer `index.html` 0.42 kB + CSS 24.45 kB（gzip 4.51 kB）+ JS 394.36 kB（gzip 128.82 kB）。
  - ✅ **文档结构自检**：14 份 Markdown、**248 个表格块**列数逐块一致、**224 个代码围栏**全部闭合。
  - ✅ **`docs/issues.md` 闭环**：38 条索引 ↔ 38 条明细 ↔ 38 个锚点，悬空 0 / 未用 0；严重度 5 P1 + 24 P2 + 9 P3 = 38。
  - ✅ **错误码闭环**：`ERROR_CODES` 125 条唯一；`docs/api.md` §2.1 = 35 行 / §2.2 = 90 行，**0 处未登记**。
  - ✅ 提交后 `git status --porcelain` 输出为空（工作区干净）。
- **遇到的困难与解决方案**：
  1. **「已解决」的状态回写比修问题本身更容易漏**：`ISS-029` 的现象段里写着「工作区有未提交改动」，
     提交后这句话就变成了**新的漂移**（文档说没提交、实际已提交）。故本条把「回写状态」与「提交」视为同一步，
     一次性改完 §0 计数 / §0.1 顺序 / §0.2 索引 / 小节标题 / §2 表 五处派生引用 —— 正是 `ISS-033` 踩过的
     「只改定义处、不回扫派生引用」的坑。
  2. **`ISS-029` 的迁移会让 P2 小节少一条**：把明细块移到 §1.3 后，§1.2 的标题「本节 19 条」会失真，
     已一并改为 18 条并列出移出的 6 条已解决 P2，避免「标题条数 ≠ 实际条数」再次发生（`ISS-032` 同类问题）。
- **遗留问题与下一步**：
  1. **`ISS-017` / `ISS-018` 仍待评审**（12 项决策 + `data-interfaces.md` §12 的 Q1-Q16），
     与 `docs/module-M2-base-data.md` §11 的 6 个待决项建议**合并成一次评审**；其中 Q1（`OBJECT_TYPES`
     缺 `restriction` / `task_template`）是 **M2 开工前必须先定**的项。
  2. **M1 仍无模块开发文档**（P2 阶段另一项）。
  3. 下一步业务代码：按 `docs/build-plan.md` §6 的 P2 顺序落地 M1 → M2；开工前先清 Q1。

### 2026-09-25 — 渲染层设计系统与信息架构落地：现代化外壳 + 监控工作台 + 登录页（D-36，ISS-040/041/044/045）

- **范围与目标**：使用者要求「维护 AGENTS.md，并参考 React Flow 官方案例，设计一个现代、直观的可视化前端」。
  侦察后的结论是：**地图页（M6）已经现代化**（`121af4d` 之后的一批改动：面板、指标条、图层面板、
  详情卡、快捷键、缩放自适应），但**应用外壳、监控工作台、登录页仍是 P1 时期的极简版** ——
  工作台只有三行会话信息、导航是纯文字列表、登录页是一张 340px 的居中卡片。
  本次把这四处对齐到地图页的水准，并把「为什么这么改」沉淀成设计系统与信息架构两层地基。
  **不含业务接口改动**（主进程 8 条接口与契约不变）。
- **变更清单**：
  - **设计令牌补全（`renderer/src/styles/theme.css`）**：新增字号 7 档、间距 6 档（4 的倍数）、
    动效时长与缓动、外壳尺寸（侧栏两档 / 顶栏高）、层级（sticky / menu）。此前界面上散落着
    10/11/12/13/15/18/20/26px 八种字号与 3/5/7/9px 的随机留白 —— 层级感就是被这种「随手一个数」磨掉的。
  - **`renderer/src/styles/ui.css`（新增）**：把**被 2 处以上使用**的基元从 `map/style/map.css` 与
    `layout.css` 中抽出并归位：`.udm-btn`（含 `--ghost` / `--primary` / `--danger` / `--block`）、
    `.udm-icon-btn`、`.udm-panel`、`.udm-card`（head/body/foot/aside）、`.udm-kv`、
    `.udm-badge`、`.udm-swatch`、`.udm-dot`、`.udm-chip`、`.udm-progress`、`.udm-empty`、
    `.udm-field` / `.udm-alert`、`.tone-*`。`map.css` 从 1004 行降到 866 行，并只保留画布专有部分。
  - **`renderer/src/app/modules.ts`（新增）**：导航分组（监控 / 调度 / 系统）、9 个导航项的
    「路由 / 标题 / 图标 / 权限点 / 一句话说明」，以及 7 个未实现模块的**自我介绍**
    （模块编号 + 计划能力 + 每条能力的 `Req-*` 编号 + 依赖接口与权限点）。
  - **`renderer/src/components/BrandMark.tsx`（新增）**：内联 SVG 标识（路线 + 三个节点 + 虚线边），
    配色取 `theme.css` 的画布变量，离线可用、随主题变化。
  - **`renderer/src/components/UserMenu.tsx`（新增）**：顶栏用户下拉 —— 角色、**当前会话的权限点数**
    （取自 `user.permissions`）、当前适配器、退出登录。含点击外部关闭 / Esc 关闭 / 焦点回位 /
    `aria-expanded`。**刻意不按角色本地重算 `ROLE_PERMISSIONS`**：那是「前端自己算权限」，
    与服务端实际下发的授权可能不一致，而这正是排查越权时最容易把人带偏的地方（D-08）。
  - **`renderer/src/components/AppLayout.tsx`（重写）**：左侧分组导航（可收起，状态存 `localStorage`，
    收起后靠 `title` 与读屏文本保住可访问性）+ 顶栏（当前页标题 / 说明 / 实时徽标 / 适配器徽标 / 用户菜单）
    + 跳转到主内容的 skip-link。导航按权限过滤，但**明确仍只是体验层**（D-08）。
  - **`renderer/src/domain/labels.ts`（由 `map/model/labels.ts` 上移）**：补齐 `ALERT_TYPE_LABEL`
    与 `ALERT_STATUS_LABEL`（文案取自 `design.md` §4.8）；`detail.ts` 的告警文案由机器值
    （`vehicle_offline · 警告`）改为中文类型名（`车辆离线 · 警告`）。
  - **`renderer/src/dashboard/`（新增）**：`model/summary.ts`（纯函数：KPI / 车队分布 / 任务行 / 告警行）、
    `panels/`（KpiCards、FleetBreakdown、TaskProgress、AlertFeed、MapPreview、SourceCard）、
    `style/dashboard.css`。
  - **`renderer/src/pages/DashboardPage.tsx`（重写）**：四张 KPI 卡 + 车队状态 / 任务执行 / 告警三栏 +
    实时地图预览 + 数据源卡片。
  - **`renderer/src/pages/LoginPage.tsx`（重写）**：左栏品牌与能力说明（CSS 渐变网格背景，无图片）、
    右栏表单 + 演示账号一键填入 + 适配器形态说明。
  - **`renderer/src/pages/PlaceholderPage.tsx`（重写）**：从「该模块尚未实现」四个字，改为
    「模块编号 + 计划能力（带 `Req-*`）+ 依赖接口与权限点 + 回查指引」。
  - **`renderer/src/api/mock.ts`（修缺陷）**：见下「关键设计决策」。
  - **文档（本文件 + `docs/issues.md` + `README.md` + `docs/module-M6-map.md` + `docs/api.md`）**：
    补记地图批次与本轮两条工作日志、新增 D-36、`docs/issues.md` 登记 ISS-039～ISS-044、
    `docs/api.md` §0 指派表补 3 行（模块元数据 / 设计令牌与基元归属 / 枚举文案）。
  - **`docs/api.md` 与 `docs/requirement-raw.md` 补「文档边界」行（ISS-044）**：两份文档此前没有该行，
    而 `api.md` **本批次刚被改过**。前者声明自己兼「SSOT 指派总表」（它是指派者，不只是读者），
    后者声明为「需求原文存档、不是可执行契约」。
  - 测试：新增 `domain/labels.test.ts`（12 例）、`dashboard/model/summary.test.ts`（19 例）、
    `dashboard/panels/dashboard.test.tsx`（5 例，jsdom 渲染冒烟）、`api/mock-parity.test.ts` 补 1 例；
    `map/model/detail.test.ts` 中的 labels 段落随文件的移动迁到新文件。
- **关键设计决策**：
  1. **新增 D-36（已定）**：见「设计决策记录」—— 设计令牌 / `ui.css` 归属规则 / `app/modules.ts` 单一作者 /
     `domain/` 上移，四条一起构成「复用规则」。
  2. **工作台的数据来源如实标注，不冒充 M7**：工作台读的是 `GET /api/map/overview`
     （Req-M6-5 的「画布唯一数据入口」），页面上写明「M7 运行监控的专属接口 `/api/monitor/*` 尚未实现，
     因此本页指标与地图页同源」。**不新增接口**（那属 M7 的活），全部指标由已有快照派生。
  3. **地图预览刻意做成不可交互**（对齐官方案例里静态预览画布的做法）：`panOnDrag` / `zoomOnScroll`
     / `zoomOnPinch` / `zoomOnDoubleClick` 全部关闭、`elementsSelectable={false}`、
     `preventScrolling={false}`。原因写在组件注释里：约 320px 高的画布嵌在长页面里，
     若滚轮被画布吃掉，页面会「卡住不动」—— 这是嵌入式画布最常见的体验事故。
     `fitView` 用**内置 prop** 而非 `useReactFlow().fitView()` 手调：内置机制会在节点测量完成后
     再适配一次，手调只在挂载时执行一次（实测手调版本量到 0 尺寸，图被顶到画布左边缘）。
  4. **修一个跨适配器不一致的真实缺陷（新登记 ISS-040）**：`renderer/src/api/mock.ts` 把三个演示账号的
     `permissions` **一律硬编码为 `[]`**，而主进程 `services/auth.ts` 用的是 `permissionsOf(row.role)`。
     即同一份契约在浏览器形态下每个账号 0 个权限点、在 Electron 下是各自角色的完整权限。
     界面只按角色判断导航时看不出问题（`hasPermission(role, …)` 仍按角色算），
     但任何**信任 `user.permissions`** 的地方会静默显示错值 —— 本次顶栏用户菜单正好是第一个这种调用点
     （修复前显示「权限点 0 项」，修复后 admin 显示其完整权限数）。
     已改为 `permissionsOf(role)` 派生，并在 `mock-parity.test.ts` 加断言锁住「两者口径一致」。
     这与 mock 曾自造错误码是同一类问题（适配器之间行为不一致）。
  5. **`computeMetrics` 复用而不复制**：工作台的 KPI 与地图的指标条共用同一份 `map/model/metrics.ts`
     计算（同一口径只算一次）。`dashboard` → `map` 的依赖是**有意为之并已注明**：
     因为工作台当前就建在 `map/overview` 之上；M7 接口落地后只需替换数据源 hook。
- **验证与测试结果（2026-09-25 实测）**：
  - ✅ `npm test`：**27 个套件 / 223 个用例全通过**（本次 +36 例）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 0.42 kB + CSS **53.23 kB**（gzip 9.21 kB）
    + JS **446.48 kB**（gzip 144.10 kB）。CSS/JS 增量为新增的设计系统、工作台与登录页所必需。
  - ✅ **浏览器 Mock 形态（Playwright + 系统 Chrome，1512×945 @2x）**：登录 → 工作台 → 地图 → 占位页
    逐页截图核对；控制台错误仅 1 条 favicon 404（与本次改动无关）。窄屏 1280 / 1024 复核：
    KPI 在 1024 下折成 2×2 而非 3+1（`minmax` 下限由 200px 调到 176px）。
  - ✅ **真实 Electron 形态（CDP 连渲染进程，真实 IPC + SQLite）**：适配器自动判定为 **`ipc`**；
    登录后顶栏用户菜单显示 **调度员 · 权限点 16 项**（与 `permissionsOf('dispatcher')` 一致）；
    左侧导航**只出现该角色可见的 7 项**（9 项中缺「审计日志」「用户管理」，验证权限过滤生效）；
    **2026-09-26 复测**三角色：dispatcher 7 项 / monitor 5 项 / admin 9 项，权限点数依次 16 / 6 / 20
    （见「困难与问题记录」——此处原写「6 项」，是当日算错且未经实测的错误数字）；
    地图页节点计数 `{总 20, 路网 12, 站点 3, 车辆 3, 任务端点 2}`、缩略图 20 个方块，与 seed 一致；
    控制台错误 0 条。主进程日志：`migrations applied: none`、seed 各表新增 0（幂等）。
  - ✅ **favicon 404 的说明**：浏览器形态下 `index.html` 未声明图标，请求 `/favicon.ico` 落 404。
    属既有现象、非本次引入；未一并修（避免把无关改动混进本批），已记入 ISS-041 待办。
  - ✅ **文档一致性脚本自检**：14 份 Markdown **边界行齐全**、围栏 112 对**全部配平**、
    表格 255 块、**62 条相对链接 0 悬空**；`docs/issues.md` 索引 ↔ 明细 ↔ 锚点 **44 / 44 / 44**，
    悬空 0 / 未用 0；严重度合计 5+29+10=44、状态合计 22+10+7+1+3+1=44。
- **遇到的困难与解决方案**：
  1. **`fitView` 的时序坑（第二次踩）**：工作台的地图预览首次渲染时图被顶到画布左边缘。
     原因是照抄了地图页 `useReactFlow().fitView()` 的手调写法，但**漏了它配套的
     `useNodesInitialized()` 门控** —— 手调版本在节点尺寸还是 0 时就算包围盒，且此后永不重试。
     地图页早有记录（`MapView.tsx` 里写着这次实测），但那条知识**只存在于那个文件的注释里**。
     解法：预览改用 `<ReactFlow fitView fitViewOptions={…}>` 内置 prop，由 React Flow 自己
     在测量完成后适配，少一份需要维护的时序代码。**教训：跨模块复用代码时，
     同一处注释里的「为什么」不会跟着代码一起被复用到新位置。**
  2. **组件测试里 `getByText` 命中多个元素的假失败**：工作台用例断言「任务起点显示 A-01」时，
     站点编码同时出现在任务行与地图预览节点上，`getByText` 因命中多个元素而失败 ——
     失败信息与被测组件的行为无关，极易误导。解法：用 `within(container.querySelector('.udm-tasks'))`
     把断言限定到任务列表内。**教训：断言范围要跟着「这条断言的意图」收窄，而不是跟着选择器的方便程度。**
  3. **KPI 网格在 1024 窗口下折成「3+1」**：第四张卡孤零零占一行，视觉上像漏了一张。
     解法：把 `minmax` 下限从 200px 调到 176px（1024 窗口 + 216 侧栏 + 页面留白仍能放下 4 列的下限）。
  4. **本轮改动在一个「多实现者并存」的位置上暴露了契约不一致**：见「关键设计决策」第 4 条（ISS-040）。
     值得记的是**发现路径**：它是被新写的用户菜单「顺手显示权限点数」这个动作暴露的 ——
     一个此前无人读取的字段，一旦被读就立刻暴露了两套口径。
- **遗留问题与下一步**：
  1. **新增 `ISS-039`（待评审）**、**`ISS-040`/`ISS-044`/`ISS-045`（已解决）** 与 **`ISS-041`（待办）**，
     见 `docs/issues.md` §1 与 §2。
  5. **2026-09-26 追加**：为「运行项目」复跑一次三端实测时，发现并改正了本批次日志里的一个错数字
     （可见导航项数 6 → 7），已登记 `ISS-045`；同日三角色实测见「验证基线」。
  2. **工作台的数据源待随 M7 迁移**：当前复用 `map/overview`。`/api/monitor/overview` 落地后，
     替换 `DashboardPage` 的数据源即可，`dashboard/model/summary.ts` 与全部面板不用改
     （它们只依赖快照字段，已由单测锁住口径）。
  3. **M1-M10 仍未开工的模块**：占位页现在会说明「计划能力 + 依赖契约」，但仍是占位
     （`ISS-010` 保持「计划内」）。按 `docs/build-plan.md` §6 的 P2 → P6 顺序推进。
  4. **本批改动已随 `64d9eea`（`地图 build`）提交** —— 该笔把「地图现代化」与「设计系统与信息架构」两批
     合成一笔（见「项目快照 · 仓库状态」的纪律偏差说明）。提交信息拟为
     `feat(renderer): 落地设计系统与信息架构，现代化外壳/工作台/登录页`。

### 2026-09-26 — 运行项目并补完外壳：首屏声明（D-37）+ 弹层键盘语义（D-38）+ 类名护栏（D-39）（ISS-041/045/046/047/048/049）✅

- **范围与目标**：使用者先要求「为我运行项目」，再要求「继续完成其它内容」。
  因此本条含两段：**(1)** 把项目以真实形态跑起来（`npm run dev:electron` 等价方式）并**实测**，
  **(2)** 用这次实测暴露的问题驱动一批外壳收尾（首屏 favicon / 深色闪白、用户菜单键盘可达性、
  以及两处「规则写下了但存量没扫」）。**不含业务接口与主进程改动**。
- **变更清单**：
  - **`renderer/index.html`（修改）**：新增内联 `data:` URI 的 SVG 图标（与 `components/BrandMark.tsx` 同语义：
    折线路线 + 三节点 + 虚线边，色值全部取自 `theme.css`）、`<meta name="color-scheme" content="dark">`
    与 `<meta name="theme-color" content="#0f172a">`（后者防冷启动先闪一帧白，Electron `loadFile` 下尤其明显）。
    文件体积 0.42 kB → 1.94 kB（gzip 1.20 kB），**不发任何额外请求**（离线可用）。
  - **`renderer/src/app/index-html.test.ts`（新增，3 例）**：`index.html` 的防漂移护栏 ——
    断言「图标是内联 `data:`」「图标里每个色值都已登记在 `theme.css`」「`theme-color` == `--udm-bg`」。
    这是本项目**第一次把 `index.html` 纳入测试覆盖**（它此前同时落在 `tsconfig.include` 与全部既有测试之外）。
  - **`renderer/src/components/UserMenu.tsx`（修改，D-38）**：补齐弹层键盘语义 ——
    方向键打开并落焦点（`ArrowDown`→首项 / `ArrowUp`→末项）、焦点在菜单内时循环移动、
    `Home`/`End` 跳首尾、`Esc` 送回焦点、`Tab`/`Shift+Tab` 关闭并把焦点**交接给菜单外的相邻元素**、
    触发按钮补 `aria-controls`、菜单项补 `tabindex="-1"`。
  - **`renderer/src/components/UserMenu.test.tsx`（新增，8 例）**：把上面每条行为逐一锁死；
    另含一条「权限点显示会话里那一份、不按角色本地重算」的断言（D-08 的回归护栏）。
  - **`renderer/src/components/AppLayout.test.tsx`（新增，6 例）**：外壳的**导航权限过滤**测试 ——
    三个角色各自「该有的有、不该有的没有」（按**具体条目**断言而非条数）、
    「当前页标题取自模块元数据且与导航项一致」、未知路由不回退到第一个模块、
    以及 `localStorage` 不可用时外壳照常渲染且折叠按钮仍生效。
  - **`renderer/src/components/AppLayout.tsx`（修改）**：把 `aria-label="主导航"` 从外层 `<aside>` 移到
    `<nav>` 上 —— `<aside>` 里还有品牌与折叠按钮，把「主导航」这个名字给它，读屏会念成与内容不符的补充区域。
  - **`renderer/src/styles/layout.css`（修改）**：补 `.udm-menu__item:focus-visible` 焦点环 ——
    菜单项现在由方向键驱动，焦点环是键盘用户**唯一的位置提示**。
  - **`renderer/src/styles/ui.css` / `theme.css`（修改，ISS-046）**：把 `.udm-sr-only` 从 `theme.css`
    移入 `ui.css` —— 按 D-36 已写明的规则（**被 2 处以上使用 → 归 ui.css**）它早该归位，`theme.css` 只该放令牌。
  - **`renderer/src/styles/layout.css`（补定义，ISS-048）**：补上 `.udm-planned__iface` ——
    该 class 在占位页里一直有使用，却**全项目没有任何 CSS 定义**，导致「依赖契约」卡把多个接口/权限点
    渲染成一串（实测 `alert:readalert:ackalert:resolvealert:archive`）。7 个说明页里 5 个受影响。
  - **`renderer/src/styles/classnames.test.ts`（新增，2 例，D-39）**：`className` ↔ CSS 定义的护栏。
    判定范围**刻意收窄到 `className` 属性**（先跑过一次全文 `udm-*` 的宽口径扫描，16 个「未定义」里 12 个是误报）；
    动态类名的 `--` 前缀按「存在同前缀的已定义类」放行；并要求护栏自检（定义数 > 50、引用文件数 > 3）。
  - **顺带清理 3 个僵尸类名（ISS-049）**：`.udm-node-endpoint__glyph` / `.udm-node-order__glyph` /
    `.udm-topbar__live` 从未被定义过、因而全无作用（父元素已居中 flex），删除后视觉零变化。
  - **`docs/module-M6-map.md` §2.1 与 `AGENTS.md`「困难与问题记录」（修路径，ISS-047）**：
    嵌套 zustand 的路径由 `renderer/node_modules/@xyflow/react/node_modules/zustand`
    改为实测的 `node_modules/@xyflow/react/node_modules/zustand`（`@xyflow/react` 被**提升到仓库根**）。
    由一次「扫文档里源码路径」的脚本发现：扫 824 处、命中 22 处，其中 21 处是**有意保留的历史错误路径**
    （`ISS-032` 的更正表、M2 规划结构）或省略写法，**只有这一处是真错**。
- **关键设计决策**：
  1. **新增 D-37（已定）**：首屏声明与它的防漂移护栏。见「设计决策记录」。
  2. **新增 D-38（已定）**：弹层键盘语义契约（roving focus + 方向键 + 焦点交接）。
  3. **这条护栏是「可失败」的，而且我做了反向验证**：写完立刻把图标里一个色值改成未登记的 `#ff00ff`，
     测试如期变红（`expected [ '#ff00ff' ] to deeply equal []`），再还原。
     **不能失败的护栏等于没有护栏** —— 本项目已有 `palette.test.ts` 的同类经验，故这次直接照做。
  4. **`.udm-sr-only` 的移动只为一个理由**：规则早就写下了，但存量没扫过。
     这类「规则只约束新增代码」的漏洞不会自己暴露（页面一切正常），只能靠回头核对。
- **验证与测试结果（2026-09-26 实测）**：
  - ✅ **项目已运行**：`dev` 侧起 Vite（5173）、`start` 侧起 `electron dist/main.js`；
    主进程日志 `migrations applied: none`、seed 各表新增 0（迁移与 seed 均幂等）。
    为读取渲染进程内部状态额外开了 `--remote-debugging-port=9222`，**此外与 `dev:electron` 等价**。
  - ✅ `npm test`：**31 个套件 / 242 个用例全通过**（本次 +4 套件 / +19 例）。
  - ✅ `npm run typecheck`：三 workspace exit 0（**它抓到了一次 `vite build` 放过的错误**，见「困难与问题记录」）。
  - ✅ `npm run build`：三端全通；`index.html` 1.94 kB（gzip 1.20 kB）+ CSS 53.32 kB（gzip 9.22 kB）
    + JS 447.78 kB（gzip 144.63 kB）。
  - ✅ **真实 Electron 形态实测（CDP）**：适配器 `ipc`；菜单 `ArrowDown` 后焦点落在 `.udm-menu__item`、
    `aria-controls="udm-user-menu"`；`Esc` 关闭且焦点回到 `.udm-user__button`；
    `Tab` 关闭并交接给**菜单之后**的按钮（`.udm-btn--ghost`，即「刷新」），**未掉到 `<body>`**；
    首屏 `color-scheme=dark` / `theme-color=#0f172a` / 图标已渲染；控制台错误 0 条。
  - ✅ **三角色实测（同日）**：dispatcher 导航 7 项 / 权限点 16、monitor 5 / 6、admin 9 / 20
    （与 `docs/api.md` §3.1 的角色权限数一致；见 `ISS-045`）。
  - ✅ `.udm-sr-only` 移动后实测仍为 1×1 隐藏盒子，未因换文件失效。
  - ✅ **文档路径审计**：扫 824 处源码路径 → 22 处未命中 → 21 处经核对为**有意保留**（历史错误路径 / 规划结构 / 省略写法），
    1 处为真错（`ISS-047`，已修）；修后该路径实测存在。
  - ✅ **类名护栏两次反向验证**：① 删掉刚补的 `.udm-planned__iface` → 如期变红
    （`"pages/PlaceholderPage.tsx: udm-planned__iface"`）；② 把扫描根指到空目录 → 自检项如期变红
    （`expected 0 to be greater than 50`），证明它不会「扫到 0 个而静默通过」。
  - ✅ **占位页修复实测**：告警中心四个权限点 x 坐标 1099 / 1184 / 1263 / 1368（已分开），
    基础数据 5 个接口 + 2 个权限点同样分列；控制台错误 0 条。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 2 行（React `KeyboardEvent` 遮蔽 DOM 同名类型，
  以及 `.udm-sr-only` 归属与 D-36 规则不符）。
- **执行过程中的外部变化（如实记录）**：本会话进行中，**使用者本人提交了 `64d9eea`（`地图 build`）**，
  把此前积压的**批次 ①（地图现代化）+ 批次 ②（设计系统与信息架构）**合成一笔提交（68 文件）。
  因此「仓库状态」由「三批未提交」变为「仅本批未提交」。两处与本项目纪律的偏差已记在「项目快照 · 仓库状态」：
  message 未用 `类型(模块): 摘要` 格式；且两批合成一笔，事后无法从 `git log` 分辨两次变更。
  **这不影响本轮工作**（本轮全部改动均不在该提交内，逐项核对过），但它说明「提交纪律」里
  关于**拆分与命名**的部分目前只靠人记 —— 与 `ISS-044`/`ISS-046`/`ISS-047` 同一类问题。
- **遗留问题与下一步**：
  1. **`ISS-041` 关闭**（favicon 404 已修并加了护栏）；**新增 `ISS-046`～`ISS-049`（均已解决）**；
     本条同时关闭了 `ISS-045`（前一轮留下的错数字）。
     `ISS-044` / `ISS-046` / `ISS-047` 与 `ISS-048`/`ISS-049` 是**同一类问题的不同实例**：都是「文档/代码的核对只靠人想起去跑」。
     `ISS-048` 这类**可以在测试环境里断言**的已经固化成护栏（D-39），另有一个方向的缺口也已记录：
     D-39 防的是「引用但无定义」，**防不住「定义了却没人用」**（死 CSS，见 `ISS-049` 遗留）。
     剩下的三项（文档边界行齐全、`theme.css` 不含类选择器、文档中的路径存在）**本次仍未做，留待评审** ——
     它们与 D-39 是同一种做法、成本很低，**是本轮之后最值得优先处理的技术债**。
  2. **仍待办**：`ISS-011`…`ISS-015`（订单 / 轨迹 / 导入等实现缺口）、`ISS-016`/`ISS-024`/`ISS-035`
     等数据模型项，以及 `ISS-010`（M1-M10 未开工，计划内）。按 `docs/build-plan.md` §6 顺序推进。
  3. **弹层契约（D-38）目前只有用户菜单一个实现**。图层面板 / 未来的筛选与下拉若做成弹层，
     必须按 D-38 补齐，否则会出现「有的弹层能用键盘、有的不能」的不一致。
  4. **本批仍未提交**（按纪律：本条日志与 `docs/issues.md` 已同步，现在可提交）。
     工作区现含 **三部分**：`e9a6100` 之后的 ① 地图现代化批次（补记于上一轮）、
     ② 设计系统与信息架构批次、③ 本轮首屏声明与键盘语义批次。
     拟提交信息：`fix(renderer): 内联首屏图标与深色声明，补齐弹层键盘语义`。

### 2026-09-26 — 抽出传输层分页与校验工具（D-40），并把三条「只靠人记」的规则固化成断言（ISS-015/044/047）✅

- **范围与目标**：承接上一条日志的遗留（「文档边界行齐全、`theme.css` 不含类选择器、文档中的路径存在**留待评审**」），
  并把 `ISS-015`（分页 / 参数校验内联在 `ipc/api.ts`）一并清掉 —— 后者的真正触发点是 **M2 马上要新增
  20 余个列表 / 写接口**，等接口写完再抽就得同时改 20 处调用点。**本批不含任何渲染层视觉改动与主进程业务逻辑改动**。
- **变更清单**：
  - **`desktop/src/ipc/paging.ts`（新增）**：`parsePagination`，从 `api.ts` 迁出。口径**宽进**：
    非数字 / `NaN` / 负数 / 0 → 回落默认值，小数向下取整，超过 `MAX_PAGE_SIZE` 夹取到上限，
    空串 `keyword` 视为**未给**（否则 `LIKE '%%'` 退化成全表扫描）。
  - **`desktop/src/ipc/validators.ts`（新增）**：只抽了实际用到的 `requireString`，口径**严出**
    （不成形即 `VALIDATION.FAILED`），并写明「传输层判成形、领域层判业务」的分界。
  - **`desktop/src/db/repositories/settings.repo.ts`（修改）**：新增 `parseSettingsValues`，
    把 `api.ts` 里的 `parseSettings` 移进来 —— 与 `upsertSetting` 的 `JSON.stringify` 构成同一件事的两端；
    解析失败**原样返回字符串**而不抛错。
  - **`desktop/src/ipc/api.ts`（修改）**：删掉三块内联实现，改为 import；文件头写明它只负责
    「路径 → 权限 → 处理函数」的装配。顺带删掉 `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` / `DomainError`
    三个**已无引用**的导入，以及一个只为消参而写的 `void ctx;`。
  - **新增单测 3 个文件**：`desktop/src/ipc/paging.test.ts`（9 例）、`desktop/src/ipc/validators.test.ts`（4 例）、
    `desktop/src/db/repositories/settings.repo.test.ts`（6 例，含「解析失败原样返回字符串」与 upsert 往返）。
  - **`tests/docs.test.ts`（新增，5 例）· `vitest.config.ts`（修改）**：把上一条日志里「留待评审」的三条文档规则
    变成仓库级断言 —— ① 每份 Markdown 都有「文档边界」行；② 文档里出现的**完全限定源码路径必须存在**
    （白名单只放 2 条历史更正记录里的「改前」写法，且另有一条断言禁止把已存在的路径留在白名单里）；
    ③ `issues.md` 的索引 / 锚点 / 明细一一对应；④ `api.md` §0 含关键事实行。`include` 新增 `tests/**/*.test.ts`
    —— 这是 **`tests/` 目录第一次承载用例**（此前只有 `setup.ts`）。
  - **文档回写**：`docs/issues.md`（`ISS-015` 关闭 + 新增解决段 + `ISS-044` 补「后续」段 + §0 计数与索引同步）、
    `docs/api.md` §0（新增「传输层校验与分页归属」一行）、`docs/module-M2-base-data.md` §2.3（依赖表指向新文件）、
    本文件的决策表 / 代码现状地图 / 项目快照 / 验证基线。
- **关键设计决策**：**新增 D-40（已定）**：传输层校验与分页的归属与两种相反口径（分页**宽进**、字段**严出**），
  以及「序列化写入 / 反序列化读出必须同文件」。仅抽 `requireString` 一个原语、以及不把它做成「一个校验工具集」，
  都是**有意**的（详见决策表该行）。
- **验证与测试结果**：
  - ✅ `npm run typecheck`：shared / desktop / renderer 三 workspace 全部 exit 0。
  - ✅ `npm test`：**35 个套件 / 268 个用例全通过**（本批 +5 套件 / +26 例）。
  - ✅ `npm run build`：三端全通；renderer `index.html` 1.94 kB / gzip 1.20 kB、CSS 53.60 kB / gzip 9.25 kB、
    JS 447.70 kB / gzip 144.62 kB（样式与入口本批未改，与上一遍一致）。
  - ✅ **文档自检（脚本 + 断言双跑）**：14 份 Markdown 边界行齐全 · 261 个表格块 · 围栏 112 对配平 ·
    62 条相对链接 0 悬空；`issues.md` 索引/锚点/明细 **49 / 49 / 49**，悬空 0 · 未用 0；
    全仓库 `ISS-xxx` 引用**全部已登记**（此前该项因脚本自身缺陷**从未真正跑到底**，本轮修好后实测 `none`）。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 2 行（未使用导入类型检查不报错；自写校验脚本崩溃却已打印部分结论）。
- **遗留问题与下一步**：
  1. **`ISS-015` 关闭**；上一条日志里「留待评审」的三条已全部落地（边界行、`theme.css` 无类选择器、路径存在）。
     `ISS-044` 的遗留（「规则只靠人记」）随之关闭。
  2. **仍未做、且已明确记录**：`D-39` 的反方向——「CSS 里定义了却没人用」（死 CSS）**没有护栏**；
     `docs/api.md` §3 的接口路径 ↔ `desktop/src/ipc/api.ts` 的 `path:` 一致性**也没护栏**
     （风险：`api.md` 里含规划中、尚未实现的接口，直接对扫会满屏误报，需先评估误报率再决定）。
  3. **M2 开工前的最后一个技术前提已具备**：分页与字段校验有了统一入口，M2 的 20 余个接口可以直接服用；
     仍待评审的是 `docs/module-M2-base-data.md` §11 的 Q1（`OBJECT_TYPES` 缺 `restriction` / `task_template` / `order`）
     与 `ISS-017`/`ISS-018`（可合并评审）。
  4. **本批与上一批仍未提交**（两批同日、互相咬合：上一批的首屏与键盘语义、本批的工具抽取与文档护栏）。
     日志与 `docs/issues.md` 均已同步，**现在可提交**。
     拟提交信息：`refactor(ipc): 抽出分页与校验工具，并把文档规则固化为断言`。

### 2026-09-26 — 落地 M2 读取路径与「基础数据」页：四张表接真实库（D-41，ISS-050/051/052）✅

- **范围与目标**：使用者要求「继续完成项目」。上一条日志的遗留里，`ISS-015` 已关闭、文档护栏已固化，
  剩下的技术债（死 CSS 护栏、`api.md` ↔ `api.ts` 一致性护栏）都属于「整洁性」；
  因此本批转入**真实功能推进**，按 `docs/build-plan.md` §6 的顺序做 **M2 基础数据**。
  但 M2 的**写**路径卡在 `docs/module-M2-base-data.md` §11 的 Q1（`OBJECT_TYPES` 缺
  `restriction` / `task_template` / `order`，影响审计写入）上 —— **读取路径不受它阻塞**，故本批做读取：
  站点 / 车辆 / 路网节点 / 有向边四张表的查询、搜索、筛选与分页，并把「基础数据」页从占位换成真实页面。
- **变更清单**：
  - **`shared/src/edge-code.ts`（新增，ISS-051）**：边的**业务编码**唯一作者 ——
    `deriveEdgeCode`（`E_<字典序小>_<字典序大>`，反方向加 `_R`）与 `parseEdgeCode`（反向解析）。
    主进程与浏览器 Mock 共用它，SQL 里不再出现拼 code 的表达式。配套 `edge-code.test.ts`（7 例，
    含与真实样本 `E_N00_N10` / `E_N00_N10_R` 的对照）。
  - **`shared/src/types.ts`（修改）**：`VehicleListItem` 扩展为完整字段（含 `type` / 载重 / 坐标 / 心跳），
    并新增 `SiteListItem` · `NodeListItem` · `EdgeListItem`。`enums.ts` 给 `EdgeStatus` 补了一句
    「`sites`/`nodes`/`edges` 三表共用」的说明（类型名保持 `Edge` 前缀不破坏既有引用）。
  - **`desktop/src/db/repositories/`（新增 3 个）**：`site.repo.ts` · `vehicle.repo.ts` · `graph.repo.ts`
    （节点与边同文件）。共同口径：投影成驼峰 DTO 紧挨产生这些列的 SQL；排序固定（`code` / 两端有序对）
    以保证分页不重复不漏行；`online` 在投影时把 `0/1` 还原成布尔（否则离线车会显示成在线）。
  - **`desktop/src/ipc/api.ts`（修改）**：新增 `GET /api/sites` · `/api/vehicles` · `/api/nodes` · `/api/edges`
    四条路由（权限均 `base:read`），**8 → 12 条**。`validators.ts` 新增 `optionalEnumFilter`（严出）
    与 `optionalString`（无合法取值集可校验，故不抛错）。
  - **`renderer/src/api/mock-data.ts` · `mock.ts`（修改）**：Mock 补齐四个列表接口，分页（宽进）与筛选（严出）
    口径与主进程逐条对齐，`keyword` 大小写不敏感（对齐 SQLite `LIKE`）。
  - **`renderer/src/base/`（新增）**：`model.ts`（列定义 / 页签 / 载荷翻译 / 页码收敛）、
    `useBaseDataList.ts`（请求 hook，含竞态丢弃与卸载保护）、`style/base.css`（只放本页布局）。
    **`renderer/src/pages/BaseDataPage.tsx`（新增）**：页签 + 防抖搜索 + 状态筛选 + 表格 + 分页，
    未实现的写操作在页面内如实说明。`components/icons.tsx` 新增 `IconSearch`。
  - **`renderer/src/app/{App.tsx,modules.ts}` · `domain/labels.ts`（修改，ISS-050）**：`base-data` 改指真实页面、
    从 `PLANNED_MODULES` 移除（清单头部写明「已落地的模块不放这里」）；`labels.ts` 新增
    `VEHICLE_TYPE_LABEL` 与 `ENABLED_STATUS_LABEL`。
  - **`docs/api.md`（修改）**：§0 指派表补「边的业务编码」一行（指向 `shared/src/edge-code.ts`）；
    §3.2 开头加「已实现范围」说明（读接口已落地、写接口待 Q1）。
  - **`docs/architecture.md` · `docs/issues.md`（修改）**：§8.3 的流程图节点由「8 条接口 / 18 套件 110 用例」
    更新为 12 条接口 / 39 套件 325 用例，日期改 2026-09-26（图集按 §0 的「图表视图」例外允许嵌数字，
    但仍必须是对的）；`ISS-010`（M2-M10 未开工）加「进度更新」段 —— 占位页 7 → 6 个、
    接口 8 → 12 条，**状态保持「计划内」**（M2 写路径与 M3-M10 未开工），原文按「不删条目」原则保留。
  - **`docs/module-M2-base-data.md`（修改）**：§3 开头写明已落地的读取路径与「为什么读取先于写入」，
    并记录一处与规划图的有意差异（code 推导放在 `shared`）。
  - **`tests/docs.test.ts`（修改，ISS-052）**：新增 2 条断言 ——
    ① 每个 `path:` 字面量都能在 `docs/api.md` 里查到（单向，含「至少扫到 12 条」的自检）；
    ② `api.ts` 里出现的 `/api/…` 字面量必须都在 `path:` 里（元护栏，防止路径被拼成字符串让 ① 漏掉）。
- **关键设计决策**：**新增 D-41（已定）**：M2 读取路径先于写入路径落地、只读接口**不经领域服务**、
  派生字段在读取层算且命名规则只有一个作者、未实现能力就近说明。三处理由见决策表该行。
- **验证与测试结果**：
  - ✅ `npm run typecheck`：三 workspace exit 0。
  - ✅ `npm test`：**39 个套件 / 325 个用例全通过**（M2 读取批次 +4 套件 / +57 例）。
  - ✅ `npm run build`：三端全通；renderer `index.html` 1.94 kB + CSS 56.21 kB（gzip 9.67 kB）
    + JS 459.33 kB（gzip 147.90 kB）。
  - ✅ **真实 Electron 形态实测（CDP + 真实 IPC + SQLite，`admin` 与 `monitor` 两个角色）**：
    站点 3 / 车辆 3 / 节点 12 / 边 34 条（分两页 20 + 14）；**控制台错误 0 条**；
    车辆行实测 `AGV-01 AGV 一号 AGV 执行中 500 100 1.5 100 在线 seed-n01`（与 seed 的演示执行数据一致）。
  - ✅ **按 `code` 查找的定向性实测**：`E_N01_N05` → 1 行（`N01 → N05`）、
    `E_N01_N05_R` → 1 行（`N05 → N01`，另一条边）、`E_N05_N01_R` → 0 行；
    非法写法（`E_N12_N01`）返回空结果而不是 400（一个对象两个 code 是 D-33 禁止的形态）。
  - ✅ **筛选与搜索实测**：「已停用」筛选空表并给出解释文案；车辆搜索 `agv-01`（小写）命中 AGV-01。
  - ✅ **Mock 与真实主进程逐项一致**：`mock-parity.test.ts` 用 4 个接口 × 7 组参数（含 `page: 'abc'` /
    `pageSize: -3` / 超上限 / 空关键词）比对返回，并断言「比对次数 == 28」以防循环提前退出；
    非法筛选值两边都返回 `VALIDATION.FAILED`。
  - ✅ **护栏反向验证**：临时插入 `/api/undocumented-probe` 路由 → `tests/docs.test.ts` 如期变红
    （`expected [ '/api/undocumented-probe' ] to deeply equal []`）；删除后恢复全绿。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 3 行
  （column 工厂的类型逃逸、Mock 的两份实现必须显式对齐大小写、`code=''` 的语义分界）。
- **遗留问题与下一步**：
  1. **`ISS-050` / `ISS-051` / `ISS-052` 新增并关闭**，另**新增 `ISS-053`（待办）**：
     回归截图里发现 AGV-01 的标签与站点 A-01 的标签在同一节点处**完全重叠**（两块都读不清）。
     属地图模块的标签避让问题、不属本批范围，已如实登记并给出三种修法（详见 `docs/issues.md` §1.3）。
  2. **M2 写路径开工前必须先评 `docs/module-M2-base-data.md` §11 的 Q1**（`OBJECT_TYPES` 扩项），
     它与 `ISS-017` / `ISS-018` 可合并评审 —— 这是 M2 剩余部分的**唯一**阻塞。
  3. **仍未做的两处护栏**（与上一条日志的遗留合并）：D-39 的反方向「CSS 定义了却没人用」（死 CSS）；
     以及 `docs/api.md` §3.2 里**写接口**的路径 ↔ 代码一致性（本批只覆盖了已实现的读取路径）。
  4. **本批仍未提交**（日志与 `docs/issues.md` 已同步）。
     ⚠️ 本会话累积了两批未提交改动：上一条日志的「传输层工具 + 文档护栏（D-40）」与本条的「M2 读取路径（D-41）」。
     拟提交信息：`feat(base-data): 落地 M2 读取路径与基础数据页`。

### 2026-09-26 — 修复地图共点图层遮挡（D-42，ISS-053）：把「个案规避」升格为图层避让规则 ✅

- **范围与目标**：清掉上一条日志留下的 `ISS-053`（默认首屏里 AGV-01 的标签压住站点 A-01 的标签）。
  它不属 M2（M2 本批只做基础数据读取），归地图模块 `renderer/src/map/`。
  目标不只是「让这两个框分开」，而是**让这一类缺陷不再靠人看截图发现**
  —— 同类问题此前已出现过一次（任务起终点被车辆整体盖住），当时按个案打了补丁、没留下规则，于是又复现。
- **变更清单**：
  - **`renderer/src/map/model/toFlow.ts`（修改）**：
    - 新增 `LAYER_OFFSET`（导出）作为图层偏移的**唯一作者**：`site: { x: 0, y: 54 }`（抬起）、
      `taskEndpoint` / `orderEndpoint`: `from { x: -64, y: 0 }` / `to { x: 64, y: 0 }`（让到两侧）。
      文件内写明符号约定（`+y` = 屏幕上移，与 `toFlowXY` 的翻转方向相反）、ASCII 布局图与三条纪律。
    - 原 `shiftEndpoint`（在**米制业务坐标**上偏移、需除以比例尺）替换为 `shiftFlow` + `toCanvasOffset`：
      偏移改为在 `toFlowXY` **之后**叠加到画布坐标上，符号换算收敛到 `toCanvasOffset` 一处。
      顺带删掉因此不再需要的 `PIXELS_PER_METER` 导入。
    - 新增导出 `layerCanvasOffset(type, role)` 与 `anchorOfFlow(node)`：前者供调试面板与测试读取声明偏移，
      后者从节点落点**反推锚点**，让「哪些元素共点」这件事可被断言（而不是各写一份偏移量去猜）。
    - `NODE_SIZE` 按 Electron 实测尺寸校正：站点 `96×26 → 66×32`、车辆 `84×42 → 90×46`
      （卡片是内容撑开的，旧值是按「大概这么宽」估的）。
    - `toCanvasOffset` 里加 `|| 0` 把 `-0` 归一成 `0`：业务 `y=0` 取负得 `-0`，数值相等但
      `Object.is` / `toEqual` / 调试输出会现形。
  - **`renderer/src/map/model/layout.test.ts`（新增，4 例）**：把「锚点重合 ⇒ 声明矩形不相交」写成不变量。
    只比**跨图层且共点**的组合 —— 不同锚点的元素偶尔相交是正常的（车辆开过某个端点标记），
    路网节点（12×12 无文字无交互）明确排除在比较之外，否则会得到 3 条「车压在路口圆点上」的假阳性。
  - **两条旧测试随缺陷一同更新**（它们锁的是「实测缺陷」，缺陷变了记录也得变）：
    `toFlow.test.ts` 的站点回退坐标改为按 `LAYER_OFFSET` 推导；
    `visualization.test.ts` 里「车辆与站点必须完全同位」断言反转为「四者两两可分辨」，方向也要对。
  - **文档回写**：`docs/issues.md`（`ISS-053` 关闭 + 解决段 + §0 计数与索引同步 + §2 追加 2 行）。
- **关键设计决策**：**新增 D-42（已定）**：共点图层各领不重叠锚点、偏移量唯一作者、车辆不参与偏移、
  避让距离按「看得见」定、遮挡判定基于与 CSS 同源的声明尺寸。四处理由见决策表该行。
- **验证与测试结果**：
  - ✅ `npm run typecheck`：shared / desktop / renderer 三 workspace 全部 exit 0。
  - ✅ `npm test`：**40 个套件 / 329 个用例全通过**（本批 +1 套件 / +4 例）。
  - ✅ `npm run build`：三端全通；renderer `index.html` 1.94 kB / gzip 1.20 kB、
    CSS 56.21 kB / gzip 9.67 kB、JS 459.64 kB / gzip 147.99 kB。
  - ✅ **真实 Electron 形态实测（CDP 取值，加载 Vite 5173 的 dev 源，zoom 160%）**：
    站点 A-01 底边 667 / 车辆 AGV-01 顶边 691 → **24px 可见间隙**；
    起点标记右边缘 340 / 车辆左边缘 355 → 15px 间隙；控制台错误 **0 条**；
    截图目录 `/Users/sunsetflower/.codex/visualizations/2026/09/26/map-layers/`。
  - ✅ **文档自检（`/tmp/doccheck.py`）**：14 份 Markdown 边界行齐全 · 265 表格块 · 112 围栏配平 ·
    64 条链接 0 悬空 · `issues.md` 索引/锚点/明细 **53 / 53 / 53** · `ISS-xxx` 引用全部已登记。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 2 行
  （不变量测试在**空集上假通过**、以及「站点抬起」这条新规则与 `NODE_SIZE` 的绑定关系）。
  **其中第一条值得单独强调**：`layout.test.ts` 初版把选项对象当 `toFlow` 的第二个参数传入，
  真实签名是 `(overview, visibility, selection, vehiclePositions)` —— 于是所有图层被判为隐藏，
  `expect([]).toEqual([])` 恒真、测试「绿」了一轮。已改为按真实签名调用，并在不变量断言前加
  「跨图层共点对 ≥ 3」的**防空跑**前置检查。教训：**任何「两两都不许冲突」形状的断言，
  都必须先证明样本非空、比较确实发生过**。
- **遗留问题与下一步**：
  1. **M2 写路径开工前必须先评 `docs/module-M2-base-data.md` §11 的 Q1**（`OBJECT_TYPES` 扩项），
     与 `ISS-017` / `ISS-018` 可合并评审 —— 这仍是 M2 剩余部分的**唯一**阻塞。
  2. **D-39 的反方向护栏仍未做**：现在是「被引用 ⇒ 已定义」，缺「已定义 ⇒ 有人用」（死 CSS）。
  3. **`toFlow.ts` 的 `LAYER_OFFSET` 与 `style/map.css` 的一致性仍靠人眼**：`NODE_SIZE` 与 CSS
     实际尺寸之间没有断言（本批只把它写进注释与 D-42）。若将来改字体/内边距，
     需要在 Electron 里重新量一次 —— 这一条**已知、未自动化**。
  4. **本批仍未提交**（日志与 `docs/issues.md` 已同步）。工作区现含三批：D-40 传输层工具、
     D-41 M2 读取路径、D-42 图层避让。拟提交信息依次为
     `refactor(ipc): 抽出分页与校验工具，并把文档规则固化为断言` →
     `feat(base-data): 落地 M2 读取路径与基础数据页` →
     `fix(map): 共点图层互不遮挡`。

### 2026-09-26 — 落地 M2 写路径与「方法 + 路径参数」路由（D-43 / D-44，ISS-054/055/056/057）✅（已并入 `a22ae16`）

- **范围与目标**：把 M2 基础数据从「只能查」推到「能维护」——站点 / 车辆 / 路网节点 / 有向边四类资源的
  创建（`POST`）、更新（`PUT`）、启停（`PATCH .../status`）共 **12 条写路由**，主进程与浏览器 Mock 行为一致，
  全部经领域服务（事务 + 审计 + 跨表校验）。对应 `design.md` 的 `Req-M2-1 / Req-M2-2 / Req-M2-3 / Req-M2-6`
  （建站点 / 建车辆并启停 / 建节点与边 / 审计可查）。
- **变更清单**：
  - **共享规则（新增，唯一作者）**：`shared/src/base-rules.ts`（`FIELD_LIMITS` / `readText` / `readNumber` /
    `readEnum` / `fieldError` / `requiredWhen` / `assertCodeImmutable` + 四个 `validate*Input`（**函数重载**：
    `create` 出完整对象、`patch` 出补丁）+ `SiteCreate`…`EdgePatch` 写 DTO）与 `base-rules.test.ts`（29 例）；
    `shared/src/index.ts` 导出。
  - **路由分发**：`desktop/src/ipc/router.ts` **重写** —— `Route.method`（缺省 `GET`）+ `:name` 路径参数
    （`ctx.params`）+ 形状去重 + `paths()` 返回「方法 + 路径」；新增 `router.dispatch.test.ts`（10 例）。
  - **领域层（新增）**：`desktop/src/domain/base/` 的 `context.ts`（`CrudContext` / `toAuditActor` / `BASE_ACTIONS`）、
    `validate.ts`（跨表校验）、`site.service.ts`、`vehicle.service.ts`、`graph.service.ts` 与 `base.service.test.ts`（34 例）。
  - **仓库层**：`site` / `vehicle` / `graph` 三个 repo 文件补写方法（`insert*` / `update*Row` / `set*Status` /
    `find*ByCode` / `countNodeReferences` / `findEdgeByDirection`）。
  - **传输层**：`desktop/src/ipc/api.ts` 追加 12 条写路由（权限 `base:write`，事件在领域方法返回后 emit）；
    `validators.ts` 追加 `requireEnum`；新增 `api.write.test.ts`（14 例）。
  - **渲染层写能力**：`renderer/src/base/form.ts`（写表单模型：字段定义 / 空值三态 / 载荷只发改动字段）、
    `EntityFormDialog.tsx`（弹层表单，错误按 `detail.fields` 标红）、`useBaseDataWrite.ts`（写请求 +
    字段级错误映射 + **列表信封守卫**）、`BaseDataPage.tsx` 改造（新增 / 编辑 / 启停按 `base:write` 渲染、
    成功提示、行内动作、节点选项按需拉取）；`renderer/src/api/mock-base-write.ts`（Mock 写路径）与三条
    适配器链路的 `method` 透传（`client` / `ipc` / `http` / `mock` / `preload.cjs` / `main.ts`）。
  - **测试**：`base/form.test.ts`（14）、`pages/BaseDataPage.write.test.tsx`（10）、`mock-parity.test.ts` 追加写路径用例、
    `tests/docs.test.ts` 追加「路由 ↔ 契约」与「`issues.md` 三处计数对齐」断言（阈值 12 → 24）。
  - **文档回写**：`docs/api.md` §3.2（已实现范围含写接口 + 三条落地口径 + 车辆停用的差异说明 + 边封路事件的现状）、
    `docs/module-M2-base-data.md`（§3 落地清单与三处有意差异、Q1/Q4 更新、§9.3 走查结论、§10 进度、版本 v1.1）、
    `docs/architecture.md` §8.1/§8.3（模块状态与「不手抄用例数」）、`README.md`、`docs/issues.md`、本文件。
- **关键设计决策**：新增 **D-43**（路由按「方法 + 路径模板」注册，含三处判断）与 **D-44**（M2 写规则唯一作者 +
  空值三态 + 编辑只发改动字段），均见「设计决策记录」。
- **验证与测试结果**：
  - ✅ `npm test`：**46 个套件 / 445 个用例全通过**（本批 +6 套件 / +116 例）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer `index.html` 1.94 kB / gzip 1.20 kB、
    CSS 59.00 kB / gzip 10.13 kB、JS 482.29 kB / gzip 154.29 kB（**产物内无 `node:sqlite` / `createRequire`
    等主进程符号**，已用源映射核对 —— D-06 的「渲染层永不直连」仍成立）。
  - ✅ **Mock ↔ 主进程写路径一致性（`mock-parity.test.ts`）**：20 组写请求（字段 / 唯一 / 引用 / 状态四类失败）
    两边返回**同一个 code**，且 `detail.fields` 的**键集合**逐条相同；成功路径两边都能创建同一编码、
    第二次都报 `BASE.CODE_EXISTS`；`method` 不匹配一律 `API.ROUTE_NOT_FOUND`。
  - ✅ **真实 Electron 形态（CDP + 真实 IPC + SQLite）**：新增站点（绑定 N04、坐标留空）→ 落库 `x=60, y=0`；
    编辑只改名称 → 列表即时更新；停用 → 状态列「已停用」、再启用恢复；`audit_logs` 四条（create / update /
    disable / enable）**`trace_id` 互不相同**、actor 均为 admin；地图页站点节点 3 → 4；控制台错误 **0 条**；
    截图目录 `/Users/sunsetflower/.codex/visualizations/2026/09/26/base-write/`。
  - ✅ **权限（真实形态）**：`monitor` 下「新增 / 编辑 / 停用」一个都不渲染，页面说明改为「当前角色只能查询」；
    占用中（`busy`）的 AGV-01 停用按钮 disabled 且 `title` 说明原因。
  - ✅ **文档自检（`/tmp/doccheck.py`）**：14 份 Markdown 边界行齐全 · 270 表格块 · 112 围栏配平 ·
    链接 0 悬空 · `issues.md` 索引/锚点/明细 **57 / 57 / 57** · `ISS-xxx` 引用全部已登记。
  - ✅ **开发库复位**：本批 E2E 在开发库里留下的站点已用 `npm run db:reset` 清掉（迁移 `0001` + seed 成功，
    各表回到 seed 规模），避免演示数据被测试污染。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 5 行 —— Mock 分发切片偏移（`ISS-056`）、
  Electron 假成功（`ISS-055`，本批最重要的一条）、表单标签可访问名被角标污染、
  异步节点下拉的 `<select>` 值被丢弃（含一个**会静默改数据**的产品侧隐患）、`issues.md` 计数差 1（`ISS-057`）。
- **遗留问题与下一步**：
  1. **M2 剩余两类主数据**：禁行规则（`restrictions`，含物理删除）与任务模板（`task_templates`）；
     开工前仍需评 `docs/module-M2-base-data.md` §11 的 Q1（`OBJECT_TYPES` 扩项，与 `ISS-039` 同一件事）。
  2. **详情接口 `GET /api/{资源}/{id}` 未实现**（界面不用它）——已在 `docs/api.md` §3.2 与模块文档如实标注；
     真要做时先想清楚「为什么列表行不够」。
  3. **`restrictions` / `task_templates` 的两类写规则尚未进 `shared/src/base-rules.ts`**：
     该文件目前只覆盖四类已落地资源，新增资源时**必须继续往这里加**，不要在 Mock 侧另起一份（D-44）。
  4. **本批仍未提交**（日志与 `docs/issues.md` 已同步，可提交）。工作区现含四批：D-40 传输层工具、
     D-41 M2 读取路径、D-42 图层避让、D-43/D-44 M2 写路径。拟提交信息依次为
     `refactor(ipc): 抽出分页与校验工具，并把文档规则固化为断言` →
     `feat(base-data): 落地 M2 读取路径与基础数据页` →
     `fix(map): 共点图层互不遮挡` →
     `feat(base-data): 落地 M2 写路径与路由方法/路径参数`。

### 2026-09-26 — M2 收口：禁行规则 + 任务模板落地，`OBJECT_TYPES` 扩项并做成断言（D-45 / D-46，ISS-039/058/059）✅（已并入 `a22ae16`）

- **范围与目标**：把 M2 剩下的两类主数据 —— **禁行规则（`Req-M2-4`）与任务模板（`Req-M2-5`）** ——
  按前四类同一套口径（`shared` 规则 → 仓库 → 领域服务 → 传输层 → 渲染层 → Mock → 测试）落地，
  使 `docs/module-M2-base-data.md` §2.1 的 `Req-M2-1..7` 中**不依赖其它模块**的部分全部可用；
  同时清掉长期挂账的 `ISS-039`（`OBJECT_TYPES` 缺两项，会阻塞这两类的审计写入）。
  用户指令为「继续实现」——即在前几批之后**自行定案并继续推进**，不再等待评审。
- **变更清单**：
  - **共享层**：`shared/src/enums.ts`（`OBJECT_TYPES` 增 `restriction` / `taskTemplate`；
    新增 `RESTRICTION_STATUSES`）；`shared/src/types.ts`（`RestrictionListItem`（含**派生** `targetCode`）、
    `TaskTemplateListItem`）；`shared/src/base-rules.ts`（`readTime` 的 ISO 可解析校验 +
    `validateRestrictionInput` / `validateTemplateInput`（重载 create/patch）+ 两组写 DTO）。
  - **迁移**：新增 `desktop/migrations/0003_object_types.sql` —— 按 `docs/database.md` §6 规则 4 的
    「新表 + 搬迁 + 改名」重建 `alerts` 的 `object_type` CHECK，并重建它的 3 条索引。
    编号取 `0003` 而非 `0002` 的理由见 **D-46**（`0002` 已被登记表指派给导入管线）。
  - **仓库层（新增）**：`desktop/src/db/repositories/restriction.repo.ts`（`LEFT JOIN` 现算 `targetCode`：
    目标被删后规则**仍在列表里**）、`template.repo.ts`（只读 + 写，无删除无状态）。
  - **领域层（新增）**：`desktop/src/domain/base/restriction.service.ts`（多态目标校验、时间窗跨字段配对、
    **物理删除** + `action='delete'` 审计）、`template.service.ts`（无 `delete` / 无 `setStatus` ——
    契约之外不提供入口）；`validate.ts` 增 `ensureRestrictionTargetExists` / `ensureRestrictionWindow`；
    `context.ts` 的 `BASE_ACTIONS` 增 `delete`。
  - **传输层**：`desktop/src/ipc/api.ts` 追加 **7 条路由**（读 2 + 写 5：规则 POST/PUT/DELETE、模板 POST/PUT），
    事件按**影响**分类：规则发 `map.updated`，模板**不发**（与地图无关）。
  - **渲染层**：`renderer/src/base/model.ts`（第 5、6 个页签 + 类型筛选 + `removable` / `statusToggle` 能力位 +
    时间窗列）、`renderer/src/base/form.ts`（两组表单规则 + `kind: 'target'` 多态选择 + `emptyLabel` + `defaultValue`）、
    `EntityFormDialog.tsx`（空值选项 + 候选补齐 + 按 `dependsOn` 切换候选）、`pages/BaseDataPage.tsx`
    （类型筛选、切换类型清空已选目标、**二次确认的物理删除**、候选清单按页签按需拉取）、
    `domain/labels.ts`（规则类型 / 规则状态 / 任务优先级三张文案表）。
  - **Mock**：`mock-data.ts`（模板数据与 seed 同源、规则初始为空）、`mock.ts`（两类列表 + 显式排序）、
    `mock-base-write.ts`（两类写路径：规则含物理删除与时间窗校验，模板含编码唯一）。
  - **样式**：`styles/ui.css`（`.udm-btn--danger` 与确认层里的实心危险按钮）、`base/style/base.css`（`.udm-dialog--confirm`）。
  - **测试（都在既有套件内）**：`shared/src/base-rules.test.ts`（+7）、`desktop/src/db/repositories/base-data.repo.test.ts`（+6）、
    `desktop/src/domain/base/base.service.test.ts`（+10）、`desktop/src/ipc/api.write.test.ts`（+5）、
    `renderer/src/api/mock-parity.test.ts`（+4：两个列表的 7×2 组参数比对 + 两条「创建 → 读回 → 改 → 删」成套用例 +
    18 组新写请求的错误码比对）、`renderer/src/base/model.test.ts`（+6）、`form.test.ts`（+9）、
    `pages/BaseDataPage.write.test.tsx`（+5）、`domain/labels.test.ts`（+3，改表驱动）。
  - **文档回写**：`docs/api.md` §3.2（已实现范围扩到六类资源 + 两类的不对称说明 + §3.2.5/§3.2.6 的实现口径）、
    `docs/database.md` §6（`0003` 登记行 + 规则 4 注明已有可执行护栏）、`docs/module-M2-base-data.md`
    （v1.2：状态「已实现」、§3 清单、§7.1 `objectType` 表与护栏、§9.1 B12 的口径更正、§9.3 走查、§10 进度、
    §11 Q1 定案）、`docs/architecture.md`（模块状态与 D10/D11/P2 节点）、`README.md`、
    `docs/issues.md`（关闭 `ISS-039`，新增 `ISS-058` / `ISS-059`，§0 计数与索引同步）、本文件。
- **关键设计决策**：新增 **D-45**（`OBJECT_TYPES` 扩项定案：加 `restriction` / `taskTemplate`，`order` 留给导入管线；
  护栏是「往 `alerts` 真插一行探针」）与 **D-46**（迁移编号由 `docs/database.md` 登记表独占，
  即使前面的号还没落地也不插队；CHECK 约束必须靠新迁移重建）。
- **验证与测试结果**：
  - ✅ `npm test`：**46 个套件 / 501 个用例全通过**（本批 +56 例；未新增测试文件）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer `index.html` 1.94 kB / gzip 1.20 kB、
    CSS 59.45 kB / gzip 10.21 kB、JS 495.64 kB / gzip 158.15 kB。
  - ✅ **Mock ↔ 主进程一致性**：两类新列表各 7 组参数逐字段相同（含排序）；18 组新写请求两边返回同一个 code
    与同一批 `detail.fields` 键集合；「规则创建 → 改状态 → 物理删除」与「模板创建 → 更新」两条成套用例两边逐步一致。
  - ✅ **真实 Electron 形态（CDP + 真实 IPC + SQLite）**：建边规则 → 列表显示派生编码 `E_N01_N05`；
    把结束时间改到开始之前 → 字段级报错且弹层不关；删除 → 二次确认 → 行消失 + `audit_logs` 一条 `action='delete'`；
    模板新增（优先级默认「普通」、起终点默认「不限」）→ 改名 → 回读一致；`monitor` 角色下两页**没有任何写入口**。
    走查后 `npm run db:reset` 复位开发库（迁移 `0001` + `0003` + seed 成功）。
  - ✅ **迁移与护栏**：`0003` 在既有库上应用一次、复跑为 `none`；枚举 ↔ DDL 漂移护栏**已验证会红**
    （临时移走 `0003` 后 `db.test.ts` 报错，放回即绿）。
  - ✅ **文档自检**（`/tmp/doccheck.py`）：14 份 Markdown 边界行齐全 · 273 表格块 · 112 围栏配平 ·
    62 条相对链接 0 悬空 · `issues.md` 索引/锚点/明细 **59 / 59 / 59** · `ISS-xxx` 引用全部已登记。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 4 行 —— 可空下拉框无法表达「不限」（`ISS-058`，产品侧静默收窄语义）、
  Mock 列表顺序与 SQL 不一致（`ISS-059`）、「枚举 ↔ DDL 漂移」护栏的落地方式、
  以及**护栏因 `shared/dist` 陈旧而假绿**（单跑 vitest 前必须先 `npm run build:shared`）。
- **遗留问题与下一步**：
  1. **详情接口 `GET /api/{资源}/{id}`**：仍不在范围内（列表行已带齐字段），已在 `docs/api.md` §3.2 如实标注。
  2. **`order` 未加入 `OBJECT_TYPES`**：等 D-15 的导入管线定案（评审批次 `ISS-017` / `ISS-018`），见 D-45。
  3. **M2 之后的最小闭环**：M3 任务状态机（`docs/api.md` §3.3）—— 它是「模板创建任务」走查（`Req-M2-5`）
     与工作台指标的前置；M4 调度引擎则依赖 M3。
  4. **本批仍未提交**（日志与 `docs/issues.md` 已同步，可提交）。工作区现含五批：D-40 传输层工具、
     D-41 M2 读取路径、D-42 图层避让、D-43/D-44 M2 写路径、本批（规则 + 模板 + `OBJECT_TYPES` 扩项），
     共 **73 处**改动（43 修改 + 30 新增）。拟提交信息依次为
     `refactor(ipc): 抽出分页与校验工具，并把文档规则固化为断言` →
     `feat(base-data): 落地 M2 读取路径与基础数据页` →
     `fix(map): 共点图层互不遮挡` →
     `feat(base-data): 落地 M2 写路径与路由方法/路径参数` →
     `feat(base-data): 落地禁行规则与任务模板，并把 OBJECT_TYPES 扩项做成断言`。

### 2026-09-26 — 落地 M3 任务管理：状态机 + 任务页，并把「展示口径」上收为单一作者（D-47 / D-48，ISS-060/061/062）✅（已并入 `a22ae16`）

- **范围与目标**：把 `design.md` §4.3 的任务生命周期从契约变成可用的功能 ——
  **单任务创建（套模板 / 手填）、编辑、六类状态操作（提交 / 暂停 / 继续 / 取消 / 重排 / 重派）、
  草稿物理删除、只读详情**，主进程与浏览器 Mock 行为一致，全部经状态机校验 + 事务 + 审计 + 事件。
  对应 `Req-M3-1 / 3 / 4 / 5 / 6 / 7`；`Req-M3-2`（批量导入）**不在本批**，页面与文档已如实标注。
  用户指令为「继续 / 继续完成项目 / 继续实现」——即在前几批之后**自行定案并继续推进**，不再等待评审。
- **变更清单**（按层）：
  - **共享状态机（新增，唯一作者）**：`shared/src/task-state.ts` —— `TASK_ACTIONS`（11 个）·
    `TASK_TRANSITIONS`（`Record<TaskAction, …>`，**漏一条边编译期报错**）· `checkTaskTransition`（失败时给出
    「当前状态 + 期望状态」的可引导文案）· `taskActionsOf` · `isTaskAction` · **`TASK_EDITABLE_STATUSES`**；
    `shared/src/task-rules.ts`（字段规则，复用 `base-rules.ts` 的原语 + `taskWindowError` / `taskEndpointError`
    两个**创建与编辑共用**的跨字段纯判定）；`shared/src/types.ts`（`TaskListItem` / `TaskDetail` /
    `TaskTransitionInfo`）；测试 `shared/src/task-state.test.ts` · `task-rules.test.ts`。
  - **迁移**：新增 `desktop/migrations/0004_task_pause_reason.sql`（`tasks.pause_reason`，见 `ISS-062`）。
  - **仓库层**：新增 `desktop/src/db/repositories/task.repo.ts`（列表含筛选与派生列 / 详情含计划·路线·告警·审计
    四块 / 单条读写 / 状态写入 / 计划作废 / 物理删除）+ `task.repo.test.ts`。
  - **领域层**：新增 `desktop/src/domain/task/task.service.ts` —— `createTask`（套模板：补齐默认值 +
    校验起终点类型）/ `updateTask`（可编辑状态 + **新旧配对**的时间窗）/ `operateTask`（状态机执行器，
    含车辆回收、计划作废、原因落列）/ `deleteDraftTask`（只有草稿）+ `task.service.test.ts`。
  - **传输层**：`desktop/src/ipc/api.ts` 追加 6 条任务路由（路由总数 → **37**）；
    状态操作的暴露面**派生自**状态机（`TASK_API_ACTIONS - {delete}`），未登记动作一律 `API.ROUTE_NOT_FOUND`；
    `desktop/src/ipc/api.task.test.ts` 断言「注册的 POST 动作集合 == 派生集合」。
  - **渲染层（本批主体）**：新增 `renderer/src/task/`（`model.tsx` 九列 + 五个筛选项 + 逗号多值的「进行中（未结束）」·
    `form.ts`（`datetime-local` 与 ISO 双向转换 + 跨字段预校验）· `actions.ts`（`Record<TaskAction, …>` 保证不漏 +
    `needsConfirm`）· `TaskActionDialog.tsx`（原因必填时禁用提交）· `TaskDetailDialog.tsx`（计划 / 路线 / 告警 /
    最近操作四块）· `style/task.css`）与 `renderer/src/pages/TasksPage.tsx`（+ 读 / 写两个测试文件）。
  - **渲染层公共机制上移（D-47）**：`udm-base__*` → `udm-list__*`；列表骨架 + 弹层 + 表单从
    `base/style/base.css`（**已删除**，故不写成完全限定路径 —— 它已不存在）搬进 `renderer/src/styles/ui.css`；
    `base/useBaseDataList.ts` 变薄包装（内部调新增的 `api/usePagedList.ts`）、`base/useBaseDataWrite.ts`
    迁为 `api/useApiWrite.ts`（返回 `data`，供页面读 `transition`）；`base/form.ts` 的通用机制迁为
    `renderer/src/domain/form.ts`（新增 `kind: 'datetime' | 'vehicle' | 'edge'`、`lockedLabel`、
    `buildFormPayload` / `emptyFormValuesOf` / `formValuesOf`）；共用的 `domain/{table,format,paging,tone}.ts` 新增。
  - **适配层**：`renderer/src/api/mock-tasks.ts`（+ `mock-data.ts` 的 `MockTaskStore`）—— 浏览器形态的读写路径，
    **规则与状态机共享、存储各自**；`mock-parity.test.ts` 扩到任务（列表逐字段 / 详情四块 / 错误 **含 message**）。
  - **应用外壳**：`renderer/src/app/App.tsx` 的 `/tasks` 换成 `TasksPage`；`app/modules.ts` 移除 `tasks` 条目
    （否则「已实现」与「未实现」会有两个说法）。
  - **文档**：新增 **`docs/module-M3-task.md`**（模块开发文档，`docs/api.md` §3.3.6 早已引用它）；
    `docs/api.md` §3.3 增「已实现范围」块；`README.md`（状态 + 文档入口表 + 三端现状 + 下一步）；
    `docs/architecture.md`（模块状态、§8.3 D10-D14、路线图 P3、`EventBus` 差距段改为「已补（D-32）」）；
    `docs/issues.md`（新增并关闭 ISS-060/061/062，§0 计数、索引、明细、§2 表同步）；本文件。
- **关键设计决策**：新增 **D-47**（列表 / 弹层 / 表单骨架与通用机制归 `domain/` + `api/` + `styles/ui.css`，
  不归先落地的模块目录；类名前缀随之上收）与 **D-48**（展示口径必须由函数产出**可核验的具体名字**，
  禁止在调用点拼字符串；断言要读到样式表为止），均见「设计决策记录」。
- **验证与测试结果（2026-09-26 实测）**：
  - ✅ `npm test`：**59 个套件 / 645 个用例全通过**（0 失败）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer `index.html` 1.94 kB / gzip 1.20 kB、
    CSS **61.36 kB / gzip 10.41 kB**、JS **531.30 kB / gzip 169.21 kB**。
  - ✅ **真实 Electron 形态（CDP + 真实 IPC + SQLite，重启进程后跑新构建）**，
    截图落 `/Users/sunsetflower/.codex/visualizations/2026/09/26/m3-task/`：
    - 新建任务 → `T20260926-0001`（**编码连续、创建为草稿**）→ 提交 → 提示「（草稿 → 待派）」；
    - 取消：确认层逐字显示副作用（「取消会回收车辆、把已生效的计划置为已作废（superseded）」）+
      原因**必填**（未填时提交按钮 disabled，实测 `true` → 填入后 `false`）→ 提交后状态「已取消」，
      详情页「取消原因」显示所填文字；
    - 暂停：原因入库（详情可见），列表状态「已暂停」+ 原因；恢复后**暂停原因清空**、状态回「执行中」；
    - 取消已派发任务 → `AGV-01` 由 `busy` **回到 `idle`**（直接查库确认），
      任务行「执行车辆」由 `AGV-01` 变 `—`、`assigned_vehicle_id` 置空（Req-M3-6）；
    - 草稿删除：二次确认 → 行消失；`audit_logs` 留下 `action='delete'`（**`before` 有全量快照、`after` 为空**）；
    - `audit_logs`（`module='task'`）逐条对上：`create` / `submit` / `cancel` ×2 组、`delete`、
      seed 任务的 `pause` / `resume` / `cancel` —— **每个写操作一条，失败请求 0 条**；
    - 权限：`monitor` 下「新建任务」按钮 **0 个**、行内操作按钮 **0 个**、表头无「操作」列，
      但详情链接可点、详情可读；`dispatcher` 有新建按钮（有 `task:write`）；
    - **控制台错误 0 条**；九个页面（工作台 / 地图 / 任务 / 基础数据 / 调度 / 告警 / 审计 / 设置 / 用户）
      逐个导航，**错误累计始终为 0**，无白屏。
  - ✅ **浏览器 Mock 形态**（Playwright `channel: 'chrome'` + 5173）：适配器判定为 `mock`，
    同一套操作提示**逐字相同**（「已暂停“T-DEMO-0001”（执行中 → 已暂停）」），取消后车辆同样回收（列显示 `—`），
    控制台 0 错误。
  - ✅ **文档自检（`/tmp/doccheck.py`）**：15 份 Markdown 边界行齐全 · 285 表格块 · 112 围栏配平 ·
    62 条相对链接 0 悬空 · `issues.md` 索引 / 锚点 / 明细 **62 / 62 / 62** · `ISS-xxx` 引用全部已登记。
  - ✅ **开发库复位**：走查后 `npm run db:reset`（`migrations applied: 1, 3, 4`；
    seed 12 节点 / 34 边 / 3 站点 / 3 车辆 / 2 模板 / 3 账号 / 9 设置 / 1 任务 / 1 路线 / 1 告警）
    并重启 Electron，避免演示残留被当成 seed 的一部分。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 5 行 —— 色调类名拼接静默失效（`ISS-060`，本批最重要的一条）、
  两形态的 `message` 不一致（`ISS-061`）、`tasks` 缺 `pause_reason` 列（`ISS-062`）、
  任务页提示里的状态中文手写成第二份、以及一次**脚本自身**的未鉴权探测（报错是真的，但产品没错）。
- **遗留问题与下一步**：
  1. **`Req-M3-2` 批量导入未实现**（`POST /api/tasks/batch-import`，错误码 `TASK.BATCH_PARTIAL_FAIL` 已登记）。
     倾向**复用** `docs/data-interfaces.md` 的导入管线（预检 + 确认、幂等键），不在 M3 另开一套解析语义 ——
     与 `docs/module-M2-base-data.md` Q5 同口径，待导入管线评审批次一起定（见 `docs/module-M3-task.md` §12 Q1）。
  2. **`assign` / `start` / `complete` / `fail` 已实现但没有调用点**：它们是状态机的一部分、
     `operateTask` 也能跑，但按 §4.2 的设计**不给 HTTP 入口**，等 M4（apply）与 M7（执行器）接上。
  3. **任务详情的「最近操作」在 seed 任务上是空的**：seed 直接写表、不产生审计（有意）。
     真实操作过的任务能看到记录 —— 这不是缺陷，但演示时容易被误读成「功能没做」。
  4. **工作台的任务面板仍复用 `map/overview`**：`TaskProgress` 的进度与 M3 的 `progress` 同源，
     待 `/api/monitor/overview` 落地后切换（`ISS-021` 同批）。
  5. **本批仍未提交**：工作区含六批未提交改动，日志与 `docs/issues.md` 已同步，可提交。
     拟提交信息依次为 `refactor(ipc): 抽出分页与校验工具，并把文档规则固化为断言` →
     `feat(base-data): 落地 M2 读取路径与基础数据页` → `fix(map): 共点图层互不遮挡` →
     `feat(base-data): 落地 M2 写路径与路由方法/路径参数` →
     `feat(base-data): 落地禁行规则与任务模板，并把 OBJECT_TYPES 扩项做成断言` →
     `feat(task): 落地 M3 任务状态机与任务管理页`。

### 2026-09-26 — 用脚本复核批次 E 的 E2E 结论：35 项断言全绿，库内证据与日志逐条对上（无源码改动）✅（已并入 `a22ae16`）

- **范围与目标**：上一条日志与「验证基线」里写着一条 **「禁行规则 / 任务模板在真实 Electron 形态下实测」**。
  本次复核的唯一目的就是**兑现它** —— 把它从「一次人工走查的记忆」变成**可重跑的脚本 + 可复核的库内证据**；
  记录若兑现不了就必须改记录，**不能留假账**。用户指令为「继续」。
- **变更清单**：**无源码改动、无文档事实改动**。仓库外新增一次性 E2E 脚本 `/tmp/udmshot/batchE-e2e.mjs`
  （35 项断言，截图落 `/Users/sunsetflower/.codex/visualizations/2026/09/26/batch-e/`，**不入库**）；
  本文件「验证基线」补强一行、`困难与问题记录` 追加一行、本条目。
- **关键设计决策**：无新增（沿用 D-45 / D-46）。
- **验证与测试结果（2026-09-26 实测）**：
  - ✅ 环境：`vite` 5173 + `electron desktop/dist/main.js --remote-debugging-port=9222`
    （非打包形态 → 加载 dev server，故 `renderer/src` 改动无需重新构建）；
    `npm run db:reset` 后启动，主进程 `migrations applied: none`（`0001` + `0003` 已在复位时应用）。
    复核前先 `build:shared` + `build:desktop`，避免用旧产物验证（`ISS-058` 那条纪律）。
  - ✅ **35 项断言 / 0 失败 / 控制台 0 错误**，逐条兑现日志里的结论：
    - 建边规则（目标下拉里选 `E_N01_N05`）→ 列表「目标编码」列显示**派生**编码、时间窗「不限时段」、适用车辆「全部车辆」；
    - 「目标类型」由「路网节点」切到「有向边」→ 目标下拉候选**立刻换组**（`N01 · 园区节点 1` → `E_N01_N02`）；
    - 时间窗 `endAt < startAt` → 字段级报错「结束时间必须晚于开始时间」且**弹层不关**；`Esc` 关闭后行未丢；
    - 删除 → 二次确认层（文案含「物理删除」）→ 行消失；
    - 模板新增：优先级默认 `normal`（「普通」）、起终点类型默认「不限」；编辑态「编码」只读；改名 + 改优先级后**回读一致**；
    - `monitor`：两页的新增 / 编辑 / 删除入口计数**全为 0**，页脚提示为「当前角色只能查询」。
  - ✅ **库内证据（复核后直接查库，不经界面）**：
    - `audit_logs` 6 条 —— `login` ×2、规则 `create` / `delete`、模板 `create` / `update`；
      **删除那条的 `before` 是完整快照**（含派生 `targetCode: "E_N01_N05"`），`after` 为空：物理删除确实只留痕、不留行；
    - `event_log` 4 条 `map.updated` —— 2 条 `{"reason":"login"}` + `restriction.created` + `restriction.deleted`；
      **模板的 create / update 一条事件也没发**（与「模板与地图无关」的设计一致）；
    - 走查结束时 `restrictions` 0 行、`task_templates` 3 行（seed 2 + 走查 1）。
  - ✅ **枚举 ↔ DDL 漂移护栏复验（红 → 绿可复现）**：`mv` 走 `0003_object_types.sql` 后
    `npx vitest run desktop/src/db/db.test.ts` 报 `CHECK constraint failed: object_type IN ('site',…)`
    （1 failed / 6 passed）；放回后 7 passed。
  - ✅ 走查后 `npm run db:reset` 复位开发库（`migrations applied: 1, 3`；seed 12 节点 / 34 边 / 3 站点 /
    3 车辆 / 2 模板 / 3 账号 / 9 设置 / 1 任务 / 1 路线 / 1 告警）并重启 Electron；
    `git status --porcelain` 仍为 **73** 处 —— 本次没有改任何文件（除本文件的记录）。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 1 行 ——
  **E2E 脚本的「初始态断言」只在复位后的库上成立**：第二次运行时库里还留着上一轮建的模板，`模板页有 2 行 seed 数据`
  当场报红（**数据是脏的，产品是对的**）。教训：脚本自带初始态断言时，**跑之前必须复位库**，否则断言比较的是上一轮的残留。
  首轮还有两处选择器写错（弹层提交按钮是 `type="button"` 不是 `submit`；只读提示类名是 `.udm-base__note`）——
  都是**脚本的错**，报红后按实际 DOM 改正，没有去改产品「迁就脚本」。
- **遗留问题与下一步**：
  1. 五批改动仍未提交（**73 处**）；日志与 `docs/issues.md` 均已同步，可提交。
     拟提交信息沿用上一条日志里的 5 条（按批次）。
  2. **M3 任务状态机**（`docs/api.md` §3.3）仍是「模板创建任务」走查（`Req-M2-5`）与工作台指标的前置。
  3. 本次**未新增 ISS**：复核未发现新的产品问题。


### 2026-09-26 — 落地 M5 路径规划：内核放共享层 + 三条只读接口 + 调度中心页，并修复认证接口的方法契约偏差（D-49 / D-50，ISS-063/064/065/066）✅（已并入 `a22ae16`）

- **范围与目标**：把 `design.md` §4.6 的路径规划从契约变成可用的功能 —— **A\*（默认）与 Dijkstra 对比、
  途经点、禁行规避、结果可解释**，主进程与浏览器 Mock 行为逐字段一致，**只读、不落库、不发事件**。
  对应 `Req-M5-1 / 2 / 3 / 4`；`Req-M5-5`（旧路线不删除）属调度侧，随 M4 一起。
  用户指令为「继续」——在前几批之后**自行定案并继续推进**，不再等待评审。
- **变更清单**（按层）：
  - **共享内核（新增，唯一作者）**：`shared/src/route-search.ts`（图模型 + `MinHeap` + A\*/Dijkstra 共用框架、
    via 分段拼接去重、`slow_edge` / `detour` 警告）· `route-graph.ts`（`buildRouteGraph`：停用 / 车种 /
    半开时间窗**三层排除** + `ROUTE_DEFAULT_SPEED_MPS`；通行速度 = `min(边限速 ?? 车种默认, 车种默认)`）·
    `route-rules.ts`（`validateRouteInput` + `ROUTE_MAX_VIA_NODES`）；`types.ts` 增 `RoutePlan` /
    `RoutePlanResponse` / `RouteCompareItem` / `RouteCompareResponse` / `RouteDetail`；`errors.ts` 增
    `ROUTE.NOT_FOUND`；三个 `*.test.ts`（19 + 11 + 9 例）。
  - **主进程**：新增 `desktop/src/db/repositories/route.repo.ts`（`findRouteById` / `insertRoute` /
    `listGraphNodes` · `listGraphEdges` **读全量图** / `listRestrictionRules`）与
    `desktop/src/domain/route/route.service.ts`（`planRoute` / `compareRoutes` / `getRoute`：缺省算法读
    `settings.route.defaultAlgorithm`；**节点存在性先于构图判**；五种 `reason` → 四个 code；`compare` 不一致时写审计）；
    `desktop/src/ipc/api.ts` 追加 3 条路由（`/api/routes/plan` · `/compare` · `GET /:id`，权限 `route:plan`，**不发事件**）；
    **`ISS-066` 修复**：`/api/auth/login` 与 `/api/auth/logout` 显式 `method: 'POST'`，新增 `api.auth.test.ts`。
  - **渲染层**：新增 `renderer/src/route/`（`model.ts` 途经点解析 / 载荷构造 / 展示口径 + `RoutePlanner.tsx` +
    `style/route.css` + `model.test.ts`）与 `renderer/src/api/mock-route.ts`（Mock 侧同一套内核，`FAILURE_CODE`
    与主进程逐项相同）；`api/mock.ts` 的认证分支**移到权限判定之前**并**删掉 `GET` 分支**、加 `routes` 分支；
    `api/mock-data.ts` 加 `MockRouteStore`/`buildMockRouteStore`（`edgeIds` 由节点对反查，不手拼）；
    `pages/DispatchPage.tsx`（+ 读 / 错误两个测试）；`app/App.tsx` 的 `/dispatch` 换真实页、`app/modules.ts`
    移除 `dispatch` 条目、`pages/index.ts` 导出、`domain/labels.ts` 加 `ROUTE_ALGORITHM_LABEL`。
  - **文档**：新增 **`docs/module-M5-route.md`**（12 节，含「文档边界」）；`docs/api.md`（§3.5 加「已实现范围」+
    三条落地口径、§2.1 加 `ROUTE.NOT_FOUND`、§3.1.1 加「方法不是可选项」警示、§3.5.x 补三条字段说明、§0 SSOT 表加 3 行）；
    `docs/architecture.md`（§8.1 / §8.3 / §9：M5 标为已实现、占位页 7→4）；`README.md`（状态 + 文档入口 + 目录结构）；
    `docs/issues.md`（新增并关闭 ISS-063～066）；本文件。
- **关键设计决策**：新增 **D-49**（路径搜索内核放 `shared/` 而非 `desktop/src/algorithms/`：算法纯函数、无 IO，
  主进程与浏览器 Mock 要用**同一份**，两侧只各自提供「从自己的存储读出图」；判断标准是「这段代码有没有 IO」）与
  **D-50**（`slow_edge` 仅在 `maxSpeedMps > minSpeedMps` 时产生 —— 永远出现的提示等于没有提示）。
- **验证与测试结果（2026-09-26 实测）**：
  - ✅ `npm test` **68 套件 / 756 用例全通过**（本批 +9 文件 / +111 例）；`npm run typecheck` 三 workspace exit 0；
    `npm run build` 三端通过（renderer `index.html` 1.94 kB / gzip 1.20 kB、CSS 63.30 kB / gzip 10.71 kB、
    JS 550.58 kB / gzip 174.92 kB）。
  - ✅ **`ERROR_CODES` 126 条唯一**（36 运行时 + 90 导入域）；`docs/api.md` §2.1 / §2.2 行数 36 / 90，**0 处未登记**。
  - ✅ **IPC 路由 40 条**（本批 +3）；文档自检 16 份 Markdown / 303 表格块 / 115 围栏 / 64 链接全通过；
    `docs/issues.md` 索引·锚点·明细 **66 / 66 / 66**。
  - ✅ **M5 在真实 Electron 形态下实测**（CDP + 真实 IPC + SQLite）：`plan n01→n12` = 100 m / 66.667 s /
    6 节点 / 5 边 / `aStar`；无人机 20 s；via `N05` → `[n01,n05,n06,n07,n11,n12]`；`compare` `consistent=true`；
    `GET seed-route-demo` = 100 m / `costDetail {}`；`ROUTE.NOT_FOUND` / `NODE.NOT_FOUND` /
    `VALIDATION.FAILED{fields:{vehicleType}}` / 封 `n02` → `GRAPH.BLOCKED`；绕行 `n01→n03` = 80 m + 警告，删规则后 40 m；
    `GET /api/auth/login` → `API.ROUTE_NOT_FOUND`（契约是 `POST`）。
  - ✅ **界面**：摘要五项 + 节点链（编码）+「无需提醒」；对比表两行 + 一致结论；坏途经点报「认不出这些节点：N99」；
    `monitor` 侧栏无入口 + 权限提示 + 按钮 disabled + 直连 `AUTH.FORBIDDEN`；**控制台错误 0**。
  - ✅ **浏览器 Mock 一致性**：同一批输入逐字段相同（**含 `detail`**），控制台 0 错误。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 4 行（ISS-063～066）——
  最值得记的是 **`ISS-066`**：契约写 `POST`，实现按缺省的 `GET` 注册，**界面登录一直正常**（界面调用点也不传方法，
  两边互相吻合），只有**照文档调用**才 404；说明「路径 + 权限 + 领域服务」都对，**方法**却从未进入断言范围。
  修法是「两条路由显式写 `method`」+「Mock 删掉 `GET` 分支」+「新增反向断言：不得同时存在 GET 形态」。
- **遗留问题与下一步**：
  1. 七批改动仍未提交（D-40 → D-50）；日志与 `docs/issues.md` 均已同步，可提交（本批拟提交信息见「仓库状态」）。
  2. **M4 调度引擎**是 M5 的消费方（apply 才把路线写进 `routes` 表）；已有 `docs/module-M4-dispatch.md` 可逐节照做，
     `route.repo.ts` 可直接复用。
  3. M5 遗留：`Req-M5-5`（旧路线 superseded 不删除）随 M4；轨迹回放（`Req-M6-6`）仍需执行器产生 `vehicle.changed`。
  4. 唯一「等人」项仍是 `ISS-017` / `ISS-018`（D-11 / D-15…D-20 / D-28…D-31 / D-35 与 `data-interfaces.md` Q1-Q16 待评审）；
     **M4 / M5 不受其阻塞**。

| 2026-09-26 | 半开区间相交谓词 `a < d && c < b` 把 `from === to` 的**空区间**判成与别人冲突 | 公式对非空区间成立，空区间要单独排除 —— 前提没写进代码。当前调用方（`t3 = t2 + executeTimeS > t2`）不会产生空区间，所以**只在写用例时才暴露** | **已解决**：谓词前置 `aFrom < aTo && bFrom < bTo`，并补一条「零长度区间不与他人冲突」的用例把语义钉住 · 出处：`shared/src/dispatch-evaluate.ts`（ISS-067） |
| 2026-09-26 | 本批一次 `npm test` 报 `3 failed \| 70 passed`（`Tests 2 failed \| 796 passed`），而前后复跑都是 `73 passed / 805 passed` | 失败当次的环境耗时是平时的约 40 倍（`environment 419s`、`tests 332s`，正常约 `10s` / `58s`）→ 机器被占满；**未留下失败当次的完整输出**，因此无法区分是超时阈值、真实计时依赖还是资源争用 | **待办（ISS-068）**：下一步在负载下复跑并保留 `--reporter=verbose` 完整输出，再决定加超时 / 去共享状态 / 明确「门禁须空载运行」 · 出处：本批 `npm test` 输出 |
| 2026-09-27 | 调度中心「全选 → 预览 → 应用派发」提示「车辆状态不允许该操作」，库里一条计划都没落；而只派一单时完全正常 | 内核**允许一辆车在一批里出现多条计划**（后一个任务落在前一个占用区间之外即可），而落库层把「预留」写成了 `idle → reserved` 的**单向跃迁**：处理第二条计划时条件更新的 `rowCount` 为 0，被当成「车被别的批次抢走」，单事务整体回滚。提示与事实无关 —— 车没有问题，问题是同一辆车在同一批里出现了两次 | **已解决（`ISS-069`）**：`reservedInBatch` 把「本批次已由我们预留」与「被别人抢走」分开（每辆车一批只预留一次）；再加一道守卫 —— 同车两次占用**时间重叠**时抛 `DISPATCH.PLAN_EXPIRED` 要求重新预览（存档可能被改动或来自旧版实现）。Mock 侧同判据对齐，两侧各加回归用例并**反向验证**过会转红。见 D-53 |
| 2026-09-27 | 同一辆车上有两条生效计划时，对其中一条「回收并重算」后车辆变成 `idle`，而它身上还挂着另一条未完成的计划 | 回收循环的判据只有「这条计划属于这个任务」，没有问过「这辆车还有没有别的生效计划」—— 该写法建立在「一车一批一单」这个**内核从来不保证**的假设上（正是 `ISS-069` 已否掉的那个） | **已解决（`ISS-070`）**：新增 `hasOtherActivePlanForVehicle`，回收语义改为「释放**这一单**的占用」，无其它生效计划时才回 `idle`；Mock 侧对齐。这类数据形态最危险的地方是**每个字段单看都合法**，事后查不出是哪一步错的，因此值得一条独立护栏 |
| 2026-09-27 | 调度日志里一行「重算 · 派 0/1 · 拒 0」，而同一时刻屏幕上写着「指派 1/1」，第一反应是「这单去哪了」 | 日志行的 `summary` 被统一拼成「派 x/y · 拒 n」，而重算的动作是**回收 + 产出一份待确认的新预览**（有意不自动应用），它的 `summary` 恒为 0 派 / 0 拒 —— 数字没算错，错的是**用同一个模板讲了两件不同的事** | **已解决（`ISS-071`）**：`logRowOf` 对 `recompute` 单独给一句话（「回收 N 条计划 · 新建议待确认」），其余动作保留原模板；用例同时断言两者，避免修一行把别的路径改坏 |
| 2026-09-27 | Mock 走查脚本打印「创建成功 `T20260101-0001:pending`」，切到调度中心却是「待派任务（0）」、页面一片空 | `page.evaluate` 里的动态 `import('/src/api/index.ts')` 与页面自身加载的模块**不是同一个实例**（Vite dev 给页面用的是带 query 的 URL），于是写进了第二份 Mock 内存库；改走真实 UI 后另有第二个坑：Mock 是内存库，`page.goto` 会连登录态一起重置 | **已排除（不是产品缺陷，`ISS-072`）**：改产品去迁就测试只会引入一个为测试而存在的旁路。解法是让走查**走真实 UI**（点「新建任务」→ 填表 → 提交），页面间移动只用页内导航。两条纪律写进脚本头部注释；重写后 Mock 与 Electron 的走查结论逐项一致 |


### 2026-09-26 — 落地 M4 调度内核：贪心 + 匈牙利 + 六步评估，并把内核从 `desktop/` 移回 `shared/`（D-51，ISS-067/068）✅（已并入 `a22ae16`）

- **范围与目标**：把 `design.md` §4.4 的调度决策从契约变成**可测试的纯函数** ——
  单车 × 单任务的固定顺序约束评估（六步短路）、代价函数、两种策略（贪心 / 匈牙利整体指派）、
  确定性输出。对应 `Req-M4-1 / 2 / 3 / 7` 的**算法侧**；`Req-M4-4 / 5 / 6`（手动指派 / 重算 / 留痕）
  属服务层，本批未开工。用户指令为「继续」——在前几批之后**自行定案并继续推进**，不再等待评审。
  按模块文档 §15 的 DoD，本批交付 **Step 1 + Step 2**（Step 3-5 未开工，文档已如实标注）。
- **变更清单**：
  - **内核（新增，纯函数、无 IO）**：`shared/src/dispatch-types.ts`（`DispatchSnapshot` /
    `DispatchTaskView` / `DispatchVehicleView` / `OccupiedSlot` / `StrategyOutcome` + 算法常量）·
    `dispatch-evaluate.ts`（半开区间相交 + 就近取点 + 六步评估 + 代价函数 + 按车种构图与**路线结果缓存**）·
    `dispatch-strategies.ts`（`compareTasks` 全序排序 + 贪心 + 匈牙利 `solveAssignment` + `n > m` 预拒绝）·
    `dispatch.ts`（`runDispatch` / `runDispatchAll` / `SUPPORTED_DISPATCH_STRATEGIES`，未实现策略**显式报错**）；
    5 个测试文件 / **49 例**。
  - `shared/src/index.ts` 追加四个再导出。
  - **落笔位置的修正（D-51）**：内核先写在 `desktop/src/algorithms/dispatch/`（照模块文档 §3），
    写完全部用例后对照 D-49 意识到它与 M5 处境相同（Mock 必须复用），**在没有任何调用方时移回 `shared/`**，
    并删除 `desktop/src/algorithms/` —— 此时移动的成本是几次改名，等 Mock 落地再移要动 700 行 + 5 个测试文件。
  - **文档**：`docs/module-M4-dispatch.md`（§3 目录树改为 `shared/src/dispatch-*.ts` 并写明理由、
    §4 快照形状的两处差异、§6 空区间语义、§7.3 常量清单、§14.1/§15 的落地进度）；
    `docs/issues.md`（新增 ISS-067 已解决、ISS-068 待办）；`README.md` 与 `docs/architecture.md`；
    本文件（阶段 / 代码现状地图 / 仓库状态 / 验证基线 / D-51 / 困难与问题记录 / 本条目）。
- **关键设计决策**：新增 **D-51**（M4 内核放 `shared/src/dispatch-*.ts` —— 与 M5 同一条：
  「这段代码有没有 IO」决定归属，没有 IO 且两端都要用 → `shared/`；同时把模块文档 §3/§4 一起回写）。
  未新增错误码（本批没有抛错点，「先给取值定名」会让枚举走在调用点之前，与 D-45 的理由相反）。
- **验证与测试结果（2026-09-26 实测）**：
  - ✅ `npm test` **73 套件 / 805 用例全通过**（本批 +5 套件 / +49 例）；`typecheck` 三 workspace exit 0；
    `build` 三端通过（renderer 体积未变 —— 内核在主进程侧，不进渲染层包）。
  - ✅ `ERROR_CODES` 126 条（未变）· `docs/issues.md` 68 / 68 / 68 · 文档自检 16 份 / 305 表格 / 116 围栏 / 64 链接。
  - ✅ 覆盖：六类拒绝原因、早到等待计代价、窗口晚点的「轻微只罚分 / 超过容忍才拒绝」分界、
    同一辆车连排两单（首尾相接合法、重叠冲突）、`n > m` 预拒绝、匈牙利整体代价不劣于贪心、
    矩阵「不可行」用有限大数不破坏求解、两个策略的**确定性**（同快照两次逐字段相同）。
  - ⚠️ 本批**未跑** Electron 走查 / `db:*` / `mock-parity`：无接口、无页面、无迁移，端到端行为不变。
- **遇到的困难与解决方案**：见「困难与问题记录」追加 2 行 ——
  **`ISS-067`**：半开区间的相交公式对**空区间**不成立（`from === to` 落在对方内部被判为冲突），
  当前调用方不会产生空区间，所以只在写用例时才暴露 —— 属于「公式对、前提没写进代码」；
  **`ISS-068`**：一次 `npm test` 在机器被占满时偶发 `3 failed`，复跑全绿，**未定位**（已留待办，
  因为「门禁绿」这条结论的可信度依赖它）。
- **遗留问题与下一步**：
  1. 八批改动仍未提交（D-40 → D-51）；日志与 `docs/issues.md` 均已同步，可提交。
  2. **M4 Step 3**：`desktop/src/domain/dispatch/`（`snapshot.ts` 组装快照 + `explain.ts` 出 U11 文案 +
     `dispatch.service.ts` 的 `preview / apply / manualAssign / recompute`）+ `dispatch-plan.repo.ts` /
     `dispatch-log.repo.ts` + 错误码（`DISPATCH.REQUEST_NOT_FOUND` / `ALREADY_APPLIED` / `PLAN_EXPIRED` / `NO_CANDIDATE`）。
     `route.repo.ts` 与 M5 内核可直接复用。
  3. **M4 Step 4-5**：IPC 4-6 条路由 + 契约测试；调度中心页接入（策略选择 / 预览对比 / 应用 / 日志）。
  4. 唯一「等人」项仍是 `ISS-017` / `ISS-018`；**M4 不受其阻塞**。

### 2026-09-27 — 落地 M4 调度服务、六条接口与调度中心页；走查实测修掉两处同车多单缺陷（D-52 / D-53，ISS-069/070/071/072）✅（已并入 `a22ae16`）

- **本次范围与目标**：把 M4 从「只有内核」推到**端到端可用**，对齐
  `docs/module-M4-dispatch.md` §15 的 Step 3-5 —— 领域服务 + 两个 Repository + 六条 IPC 路由 +
  调度中心页；需求依据 `design.md` §4.4 / §5 与 `Req-M4-1..7`。本批结束时 M4 的
  Step 1-5 全部落地（该文档 §15 已逐项打勾）。
- **变更清单**（不含文档回写；文档见「本批文档」段）：
  - **新增 `desktop/src/domain/dispatch/dispatch.service.ts`**（`listStrategies` / `preview` / `apply` /
    `manualAssign` / `recompute` / `listDispatchLogs`）+ `snapshot.ts`（读库组装 `DispatchSnapshot`）+
    `explain.ts`（人读文案唯一作者）。**apply 不重跑算法** —— 落的是预览当场存下的
    `dispatch_logs.output_snapshot`，只有路线会重推；并发安全靠条件 UPDATE，不靠「快照没变」。
  - **新增 `desktop/src/db/repositories/dispatch-plan.repo.ts`**（`insertPlan` · 三处乐观锁
    `assignTaskIfPending` / `reserveVehicleIfIdle` / `releaseVehicleIfBusy` · `listAppliedPlans` ·
    `listActiveOccupiedSlots` · `latestOccupiedTo` · `setPlansStatus` · **`hasOtherActivePlanForVehicle`**）
    与 **`dispatch-log.repo.ts`**（`insertLog` · `hasApplied` · `findPreviewOutput` · `listLogs`）。
  - **`desktop/src/ipc/api.ts` 新增六条路由**（路由 40 → 46）：`strategies` · `preview` · `apply` ·
    `manual-assign` · `recompute` · `logs`；三条写路由**显式 `method: 'POST'`**；新增
    `emitDispatchEffects` 只在写路径发事件（apply / manual-assign / recompute 各发
    `task.changed` + `vehicle.changed` + `map.updated`，preview 只写日志、世界无变化故不发）。
  - **`shared/src/constants.ts` 新增三张词表**（策略名 / 拒绝原因 / 日志动作，D-52）。
  - **新增 `renderer/src/dispatch/`**：`model.ts`（纯函数：策略选项 / 推荐结论 / 派发明细行 /
    拒绝原因行 / 确认清单 / 日志行 / 四个请求体构造函数）· `DispatchConsole.tsx`（两栏：左候选池 +
    策略 + 手动指派 + 重算，右推荐条 + 策略对比表 + 派发明细 + 拒绝原因，底部跨栏日志）·
    `ConfirmDispatchDialog.tsx`（二次确认，逐条列「任务 → 车辆」+ 预计完成时刻，**并单独列出被拒的**）·
    `DispatchLogPanel.tsx`（服务端筛选 + 分页，写操作后按 `revision` 刷新）· `style/dispatch.css`。
  - **新增 `renderer/src/api/mock-dispatch.ts`**：浏览器形态**复用 `shared` 同一份内核**、只各管存储；
    文件头明写三处有意差异（`explain` 返回空数组、不写审计、不产出 fingerprint）。
  - **`pages/DispatchPage.tsx` 改为两区块**：上「调度台」（会改数据）、下「路径规划（试算）」（只读），
    并写明「任务实际使用的路线要等『应用派发』才写进 `routes` 表」。
  - 测试：`dispatch.service.test.ts`（26 例）· `api.dispatch.test.ts`（9 例）·
    `renderer/src/dispatch/model.test.ts`（13 例）· `mock-dispatch.test.ts`（6 例）·
    `db.test.ts` 增 `dispatch_logs` CHECK 探针 1 例。
- **关键设计决策**：新增 **D-52**（调度三张词表的唯一作者放 `shared/src/constants.ts`——三个跨进程使用方，
  任一处各写一份中文，分叉只在切换形态时显形）与 **D-53**（「预留」不是可重入动作、「回收」只释放这一单的占用；
  同车一批多单是合法形态，跨批次仍保守拒接）。两条都源于本轮**实测**而非推演。
- **验证与测试结果（2026-09-27 实测）**：
  - ✅ `npm test` **77 套件 / 860 用例全通过**；`typecheck` 三 workspace exit 0；
    `build` 三端通过（renderer `index.html` 1.94 kB + CSS 66.14 kB / gzip 11.13 kB +
    JS 595.78 kB / gzip 187.57 kB）。
  - ✅ **Electron 端到端**（真实 ipc + 真实 SQLite，走登录表单）：造 3 条 `pending` 任务 →
    全选 → 「全部（对比）」→ 预览（两行对比 + 推荐语）→ 逐策略看明细 → 应用二次确认 → 确认 →
    「已派发 1 单（匈牙利）」；落库核对 任务 `assigned` / 车辆 `reserved` / 日志 2 条 / 审计 1 条；
    同 `requestId` 再应用得 `DISPATCH.ALREADY_APPLIED`、伪造 id 得 `DISPATCH.REQUEST_NOT_FOUND`；
    手动指派超载被拒 / 轻货成功；重算三步可见；日志筛选与分页正确。**控制台错误 0 条**（截图 9 张）。
  - ✅ **浏览器 Mock 形态**：同一套走查逐项结论相同，**控制台错误 0 条**（截图 5 张）。
  - ✅ **反向验证**：把 `reservedInBatch` 短路改回旧行为后，四条新用例立刻转红，恢复即全绿。
  - ✅ `docs/issues.md` 三处计数对齐 72 / 72 / 72（`tests/docs.test.ts` 8 例通过）；
    文档自检 16 份 / 307 表格 / 116 围栏 / 64 链接全通过。
  - ⚠️ 本批**未跑** `db:*` 与迁移复测：无新迁移、无 DDL 变化（走查前执行过 `db:reset`，seed 幂等）。
- **本批文档**：`docs/api.md` §3.4（新增「已实现范围」段 + `apply` 的同车多单与回收语义）；
  `docs/module-M4-dispatch.md`（§14 落地进度改为 Step 1-5 全绿、§14.2 增 S9-S11、新增 §14.2.1 方法护栏、
  §15 打勾并新增 §15.1 落地位置表）；`docs/issues.md`（新增 ISS-069/070/071 已解决、ISS-072 已排除，
  §0 计数与索引同步）；本文件（阶段 / 代码现状地图 / 仓库状态 / 验证基线 / D-52 / D-53 / 困难与问题记录 / 本条目）。
- **遇到的困难与解决方案**：见「困难与问题记录」本轮追加的 4 行 ——
  `ISS-069`（apply 整批回滚且报一句与事实无关的错）、`ISS-070`（回收把仍有占用的车辆置 `idle`）、
  `ISS-071`（重算日志套派发模板，读起来像任务丢了）、`ISS-072`（走查脚本的工具用法坑，已排除）。
  **前两条的共同形状值得记下**：落地层把「一车一批一单」当成不变量，而**内核从来不保证**它 ——
  内核保证的是**区间不重叠**。同一处误解产生了一对后果相反的缺陷：一个**能派却拒绝**，
  一个**不能派却放行**；两者都不会让任何单测变红，只在「同一辆车在一批里出现两条计划」这种数据形态下显形，
  是端到端走查把它们拽出来的。
- **遗留问题与下一步**：
  1. **本批仍未提交**（九批：D-40 → D-53）；日志与 `docs/issues.md` 已同步，**现在可提交**。
     拟提交信息：`feat(dispatch): 落地 M4 调度服务、六条接口与调度中心页`。
  2. **M7 执行器与监控**是下一个自然的模块：它是让 `reserved → busy`、车辆动起来（`vehicle.changed`）
     与轨迹落库的唯一来源；M4 的接口契约不需要改（`apply` 只到 `reserved` 就是为此留的边界）。
  3. 之后：M8 告警闭环 · M9 审计页 · M10 设置写接口 · M3 批量导入与四类文件导入管线 · 打包（无打包脚本）。
  4. 唯一「等人」项仍是 `ISS-017` / `ISS-018`；**M4 已不受其阻塞**。

### 2026-09-28 — M1 / M7 / M8 / M9 / M10 落地批次：用户维护、监控与模拟执行器、告警闭环、审计、设置（⏳ 追记）

> **这是补记**。这批改动（以及 2026-09-25/26 的地图与设计系统批次）由**使用者本人**于 2026-09-28
> 以 `a22ae16`（`all build`，207 文件）合成一笔提交，**当时没有按纪律先写本日志**。
> 现按代码与测试的现状补记，并如实记录这处偏差（见「仓库状态」的同一说明）。
> 之所以不省略它：**下一次改动要能查到「这五个模块是什么时候、以什么口径落地的」**，
> 缺了这条记录，`git log` 里那笔「all build」就等于没有说明。

- **范围与目标**：把首期剩下五个模块的契约变成可用功能 —— **M1** 用户维护、**M7** 监控读模型 + 本地模拟执行器、
  **M8** 告警五态闭环、**M9** 审计查询与 CSV 导出、**M10** 设置写接口与 schema 驱动表单。
  完成后首期十个模块（M1-M10）的页面与接口全部落地。
- **变更清单**（按模块）：
  - **M1 用户**：`desktop/src/domain/user/user.service.ts`（+ 113 行用例）——
    四条路由（列表 / 新增 / 更新 / 重置密码）；**两条「别把自己锁在门外」的护栏在服务端**：
    不能停用/降级**最后一个启用的管理员**、不能停用**当前登录的账号**。
    字段归属随调用点走（禁用时报在 `status`、改角色时报在 `role`），前端因此能把红框标在正确的控件上。
    页面 `renderer/src/pages/UsersPage.tsx`。
  - **M7 监控与执行**：`desktop/src/domain/monitor/monitor.service.ts`（三条读路由；
    两条列表**复用** `listTasks` / `listVehicles` 后补字段，不复制 SQL）、
    `desktop/src/domain/execution/executor.ts`（**本地模拟执行器**，D-10）+ `execution.repo.ts` /
    `monitor.repo.ts`（轨迹采样与遥测）、`GET /api/map/tracks/:vehicleId`（轨迹回放）与
    `renderer/src/map/panels/TrackPanel.tsx`。执行器的对外入口刻意只有
    `startTask` / `takeover` / `tick` 三个：**`tick()` 是纯推进、不自己读时间**（于是可被逐帧断言），
    `startTimer()` 只负责调度；`adoptRunningTasks()` 把上次进程退出时仍在跑的任务接回内存续跑 ——
    少了它，界面上一条「执行中」的任务会永远停在原地。
    **事务边界**：状态迁移复用 `operateTask`（自带事务与审计），遥测与轨迹写在**另一个**事务里
    —— `tx()` 不支持嵌套 `BEGIN`，合并会直接抛错。
  - **M8 告警**：`shared/src/alert-state.ts`（**状态机唯一作者**：迁移表 + `alertActionsOf` + `ALERT_NEXT_STEPS`）、
    `desktop/src/domain/alert/alert.service.ts`、页面 `renderer/src/pages/AlertsPage.tsx`。
    服务端据此校验、前端据此渲染按钮 —— **界面上能点的，服务端一定放行**。
    `resolve` 的字段名是 `resolution` 且必填（处置结论是这条告警唯一有价值的知识）。
  - **M9 审计**：`desktop/src/domain/audit/audit.service.ts`、`renderer/src/pages/AuditPage.tsx`。
    导出把「文件名 + 正文」放进 `data` —— **本地 IPC 形态没有响应头**可放 `Content-Disposition`，
    而两种适配器必须共用同一个信封；`content` 带 UTF-8 BOM、正文按 RFC 4180 转义。
  - **M10 设置**：`shared/src/settings-rules.ts`（`validateSettingValue`，主进程与 Mock 共用）、
    `desktop/src/domain/settings/settings.service.ts`、`renderer/src/pages/SettingsPage.tsx`。
    PATCH **只改 `updates` 里提到的键**、**整批校验后才写**；前端只提交与已保存值不同的键。
  - **渲染层共用地基**：`renderer/src/ops/model.ts` + `ops/style/ops.css`（四页共用的纯函数与样式）、
    `app/App.tsx` 九条路由全部指向真实页面（`PlaceholderPage` 与 `PLANNED_MODULES` 保留但**当前无路由使用**）。
  - **文档**：`docs/api.md` §3.1 / §3.6.2 / §3.7 / §3.8 / §3.9 / §3.10 补「已实现范围」与实现要点；
    `README.md` 状态与下一步改写；`docs/issues.md` 关闭 `ISS-010` / `ISS-012` / `ISS-021`。
- **关键设计决策**：**本批未新增 D 编号** —— 五个模块都是在既有决策（D-08 权限双轨、D-10 执行器、
  D-32 事件过滤、D-33 错误码唯一处、D-34 事实单一来源、D-48 展示口径）的框架内落地，
  没有出现需要新决策的分叉。唯一值得记的是 M7 的两条**实现口径**（`tick()` 不读时间、
  遥测不与状态迁移共事务），已写在 `executor.ts` 文件头与 `docs/api.md` §3.7.3。
- **验证与测试结果（补记时为 2026-09-28 复跑）**：见「验证基线（2026-09-28 实测，第二批）」。
  这批自己的实测记录（2026-09-28 提交时）已丢失，**不做臆造**；能确认的是：
  全量 `npm test` 覆盖这五个模块（`user.service.test.ts` / `executor.test.ts` / `alert.service.test.ts` /
  `settings.service.test.ts` / `api.ops.test.ts` / `mock-parity.test.ts` 的 M1/M7/M8/M9/M10 段）。
- **遇到的困难与解决方案**：无新增（补记）。
- **遗留问题与下一步**：四类数据文件的导入管线（M3 批量导入与其同批）· M2 详情接口 ·
  地图的订单端点图层（`ISS-011`）· 工作台是否改用 `/api/monitor/overview`（当前刻意保持单快照）。

### 2026-09-28 — 车辆接入 / 调度对比与接力 / 告警停滞与批量认领 / 复杂校园地图与边权（D-54 / D-55 / D-56，ISS-076…ISS-082）✅（已并入 `fef52a6`）

- **范围与目标**：使用者的五条指令，逐条落地 ——
  ① **添加车辆接口，可以加入新的车辆**；② **调度中心对不同的任务做算法对比，并给出数据（哪条路更快、快多少）**；
  ③ **任务对不同车辆派发的最好结果，含接力**（A 给 1 车、B 给 2 车、2 车跑完马上接 D）；
  ④ **告警中心给出更好的告警与异常处理**；⑤ **地图从 `data` 读更复杂的数据，并改变每条边的长度权重使调度更复杂**。
  与 `design.md` 的对应：Req-M2-2/3（车辆维护）· Req-M4-1/2/3（派发与策略对比）· Req-M8-1/2/3（告警处置）· Req-M6-1/2（地图数据）。
- **变更清单**（按用户指令分组）：
  - **① 车辆接入**：`shared/src/base-rules.ts` 的 `VehicleCreate` 新增 `currentNodeId: string | null`，
    `x`/`y` 改为 `number | null`（`null` = 跟随所在节点，与站点同口径）；`desktop/src/db/repositories/vehicle.repo.ts`
    写入 `current_node_id`；`desktop/src/domain/base/vehicle.service.ts` 新增 `resolveVehicleXY()`
    （**坐标优先 → 节点 → (0,0)**，创建时两者至少要有一个，缺则 `x`/`y` 一起报必填）；
    `renderer/src/base/form.ts` 车辆表单新增「所在节点」（`kind: 'node'`）。**新车立即进入调度候选池**（用例覆盖）。
  - **② 算法对比给出数字**：`renderer/src/dispatch/model.ts` 新增
    `durationText` / `outcomeMetricsOf` / `differenceLinesOf` / `vehiclePlanGroupsOf`（全部纯函数，D-48）；
    `OutcomeRow` 扩为四列（执行里程 / 行驶耗时 / 全部完成 / 用车）；`DispatchConsole.tsx` 加列、加差异行与口径说明。
    **口径**：里程**只累加执行段**（空驶段没有路线摘要，混进去会让「谁少跑路」变成另一回事）；
    行驶耗时 = 空驶 + 执行；完成时刻取 `max(occupiedTo)`。见 `docs/api.md` §3.4.2。
  - **③ 接力**：同一屏新增**按车辆分组**的清单（组内按开始时刻、组间按第一单时刻），
    `CAR-01 接力 2 单` 后紧接着列出两单的时刻、里程与代价 —— 平铺的「任务 → 车辆」表读不出接力。
    `mock-parity.test.ts` 断言「贪心里至少一台车带两条计划，且两条占用区间**不重叠**」。
  - **④ 告警**：`renderer/src/ops/model.ts` 新增 `alertAgeOf`（**停滞时长随状态换措辞**：未认领 / 未开始处理 / 未解决，
    已终结显示 `—`；`nowMs` 由调用方注入以便测试）与 `ackTargetsOf` / `batchAckNotice`；
    页面加「停滞」列（严重且未终结的行加强调色）与**批量认领本页待确认**——
    **不新增接口**，逐条打既有 `POST /api/alerts/{id}/acknowledge`（状态机、权限与审计因此完全复用），
    成功与失败条数分开报；详情里的关联对象改为可跳转链接。
  - **⑤ 复杂地图与边权**：新增 `data/campus/`（4 个样本文件 + 自写的 `campus_congestion.csv` + `README.md`）、
    `shared/src/campus-map.ts`（原生 5 文件 → 内部的**唯一**翻译层，纯函数无 IO）、
    `shared/src/seed-data.ts`（`buildSeedDataset()`：路网 / 站点 / 车辆 / 演示数据的**唯一**推导处）、
    `desktop/src/db/campus-map-source.ts`（Node 侧取数）、`desktop/migrations/0005_edge_weight.sql`（`edges.weight`）、
    `desktop/src/db/seed.ts` 改为「取数 → 推导 → 落库」（**文件里没有业务数字**）；
    `shared/src/route-search.ts` 的耗时改为 `长度 × 权重 ÷ 有效限速`；
    画布上 `weight > 1` 的边画成橙色点线（`is-slow`）并在详情里写「拥堵（通行变慢）」。
  - **走查中发现并修掉的真实缺陷**：`ISS-076`（站点锚点取错端点）· `ISS-077` / `ISS-078`（演示数据时间戳冻结）·
    `ISS-079`（车辆表单候选下拉为空）· `ISS-080`（**边的视觉标志类从未落到 `<path>`**）· `ISS-081`（用例夹具绑定旧 seed 形状）。
  - **测试**：新增 `renderer/src/map/edges/NetEdge.test.tsx`（5 条，含从 CSS 反向提取 `path` 选择器的护栏）·
    `renderer/src/ops/model.test.ts`（6 条）· `renderer/src/pages/AlertsBatch.test.tsx`（2 条）·
    `renderer/src/task/execution.test.ts` · `mock-parity.test.ts` 的调度对比 3 条 +
    「渲染层不消费 `explain`」1 条；并把 `BaseDataPage` / `TasksPage` / `DispatchPage` / `dashboard`
    等 14 个套件的夹具迁到新地图数据。
  - **文档**：`docs/api.md` §3.2.2（车辆的三种「停在哪」与优先级）· §3.2.4（`weight` 的完整口径表）·
    §3.4.2（对比怎么读）· §3.8.1（停滞与批量认领都不是新接口）· §3.9（导出信封）；
    `docs/database.md` §2.2（`weight` 的最终形态）+ §6（迁移登记 `0005`）+ §4（seed 规则整段重写）；
    `docs/data-interfaces.md` §4.1.0（仓库内副本 `data/campus/` 与自编拥堵层）；
    `docs/issues.md`（新增并关闭 `ISS-076`…`ISS-082`，§0 计数与索引同步）；`README.md`；本文件。
  - **写回后复跑修掉的一处文档缺陷**：`docs/api.md` §3.2.2 原写 `BASE.NODE_NOT_FOUND`，与唯一登记处
    （`NODE.NOT_FOUND`）不符 —— `errors.catalog.test.ts` 复跑时当场变红。**改文档、不加码**（D-33），
    并记入「困难与问题记录」。这是本批唯一在**写回之后**才发现的问题。
- **关键设计决策**：新增 **D-54**（`edges.weight` 是**耗时**系数，`>= 1` 是 A* 可采纳性约束而非取值风格）·
  **D-55**（seed 与 Mock 共用一份推导，D-27 的升级）· **D-56**（演示数据的时间戳必须相对「现在」派生）。
- **验证与测试结果（2026-09-28 实测）**：详见「验证基线（2026-09-28 实测，第二批）」。
  要点：`npm test` **88 套件 / 991 用例**全通过；`typecheck` 三端 exit 0；`build` 三端通过；
  `db:reset` 落 `30/90/13/2/5/2/3/9/7/1/1` 且复跑幂等；Electron 走查（清新库）实测
  **对比表两行带数字 + 差异行「少跑 450 m / 少行驶 8 分 27 秒 / 早 2 分 20 秒」+ `CAR-01` 接力 2 单**、
  告警停滞列与批量认领可用、新建车辆真落库且立即进入候选池、地图 7 条慢边为橙色点线，**控制台错误 0 条**。
  **这次「走查 → 写文档 → 再复跑」的顺序本身也修掉了一个缺陷**：`errors.catalog.test.ts` 在写回之后
  变红（`docs/api.md` 写了 `BASE.NODE_NOT_FOUND`，登记处叫 `NODE.NOT_FOUND`，见 `ISS-082`）。
  教训：**文档也是被测代码** —— 复跑要放在写回之后，而不是之前。
- **遇到的困难与解决方案**：见「困难与问题记录」本轮 6 行。其中两条最值得记：
  **(a)** 「边的视觉标志类」——`toFlow.ts` 的类名落在 `<g>` 而 CSS 选择的是 `<path>`，
  于是**三条规则从未生效过**，而页面、控制台与单测全绿（单测断的是模型里的 `className`）；
  修法不只是改类名，而是把「类名落在哪个元素」判据收进边组件，并加一条**从 CSS 反向提取**的护栏。
  **(b)** 「演示数据的时间戳」——一个常量让浏览器形态 100% 报业务拒绝（`ISS-077`），
  而它**只在跨月时显形**；同一个常量还让告警的停滞时长显示成 9 个月（`ISS-078`）。
  两条的共同教训：**静默失效的东西不会自己暴露，只有端到端读真实 DOM / 逐字段比两边的输出才能抓到。**
- **遗留问题与下一步**：
  1. **本批已随 `a22ae16` 提交**（使用者本人提交；该笔一并覆盖了 2026-09-25/26/27 的多批改动）。日志与 `docs/issues.md` 已同步。
     拟提交信息：`feat(map): 接入车辆节点、算法对比与接力视图、告警停滞列，并换用带权重的校园路网`。
  2. **`data/campus/` 必须纳入版本控制**（它是源数据，`.gitignore` 的 `*.db` 规则不覆盖它）——
     否则干净检出上 `db:seed` 会失败或落不出路网（D-55 的代价）。
  3. 四类数据文件的导入管线仍未开工：目前 `data/campus/` 是**构建期源数据**，
     与 `docs/data-interfaces.md` 规划的**用户上传导入**是两件事（后者待评审，见 `ISS-013` / `ISS-014`）。
  4. 地图仍缺**订单端点图层**（`ISS-011`，`map/overview?include=orders`）。
  5. 告警可再加「按停滞时长排序」；调度对比表可加「按车辆分组」的第二种视图（当前是两块并列）。

### 2026-10-03 — 告警中心「看未来」：任务冲突 / 超时预检 + 任务分配派发区块；调度加路线列与派发后上地图（D-57，ISS-083…ISS-086）✅（已并入 `fef52a6`）

> 同日后半段的**术语改名批次**（「代价」→「加权综合分」）见本条日志末尾的「补充」小节，那一批**已随 `2f33ac4` 提交**。

- **范围与目标**：使用者提出四项诉求 —— ① 调度中心要对**已有车辆**的任务分配与路线分配做算法比较；
  ② 告警中心要**列举出所有可能的任务冲突与任务超时**；③ 给出**任务分配派发的区块**；
  ④ 任务派发后**实时在地图上显示**。对照 `design.md` 的 M4（调度）与 M8（告警）两条需求线。
- **变更清单（新增 / 修改）**：
  - **`shared/src/plan-risk.ts`（新文件，本批的核心）**：`scanPlanRisks(tasks, plans, vehicles, {nowMs, toleranceS?, minBatteryPercent?})`
    → `PlanRiskItem[]`（7 类：`VEHICLE_OVERLAP` / `VEHICLE_UNAVAILABLE` / `BATTERY_RISK` /
    `PLAN_WITHOUT_ROUTE` / `LATE_FINISH` / `WINDOW_EXPIRED` / `UNASSIGNED_TASK`）·
    `planInputsOf(sources)`（**唯一业务规则**：`dispatch_plans` 优先，否则按 `routes.task_id` 回退）·
    `buildPlanRiskReport(items, scannedAt, {tasks, plans})`（三个视图 + `counts`）· `PLAN_RISK_LABELS`（中文名唯一来源）。
    **纯函数、无 IO、不读时钟**（`nowMs` 由调用方注入）。
  - `shared/src/types.ts`：`PLAN_RISK_KINDS` / `PlanRiskKind` / `PlanRiskItem` / `PlanAssignment` / `PlanRiskReport`。
  - `desktop/src/domain/alert/risk.service.ts`（新）：`alertRisks(db, now = nowIso())` —— 一条 LEFT JOIN
    查询取齐（`prv` = 计划路线、`fr` = 回退路线），**只取数、不判断**。
  - `desktop/src/ipc/api.ts`：注册 `GET /api/alerts/risks`（`alert:read`），**放在 `/api/alerts/:id` 之前**。
  - `renderer/src/api/mock-ops.ts` + `mock.ts`：Mock 同口径实现（`MonitoringDeps` 新增 `plans` / `routeStore`）。
  - `renderer/src/ops/RiskPanels.tsx`（新）：两个区块「任务冲突与超时预检」「任务分配派发」；
    `ops/model.ts` 新增 `riskRowOf` / `RISK_LEVEL_TONE`（存**色调名**而非类名）/ `riskSummaryOf` /
    `assignmentGroupsOf`（**只分组不排序**，顺序由服务端定死）；`ops/style/ops.css` 追加 `.udm-risk*`。
  - `renderer/src/pages/AlertsPage.tsx`：`/api/alerts/risks` 独立取数（`riskRevision` 计数器），
    刷新按钮同时刷新列表与预检；两个区块插在「告警列表 + 详情」**之前**（首屏先看「要处理什么」）。
  - **调度**：`dispatch/model.ts` 的 `PlanRow` 新增 `route` / `routeSegments` / `routeDistanceM`
    （`routeTextOf` → `2 段 · 300 m` / `无路线`）；`DispatchConsole.tsx` 派发明细表新增**路线（载货段）**列，
    应用成功后的提示条给出**「在地图上查看这 N 台车」**（写全局 selection + `navigate('/map')`）。
  - **测试**：`shared/src/plan-risk.test.ts`（19）· `desktop/src/domain/alert/risk.service.test.ts`（8）·
    `renderer/src/pages/AlertsRisk.test.tsx`（3）· `renderer/src/dispatch/DispatchConsole.test.tsx`（4）·
    `renderer/src/dispatch/model.test.ts`（+2 路线列）· `renderer/src/api/mock-parity.test.ts`（+2 风险预检逐字段比对）·
    `renderer/src/ops/model.test.ts`（+2 CSS 护栏）。
  - **文档**：`docs/api.md` 新增 §3.8.3（契约、7 类判据表、三个视图、两级查法），原 §3.8.3 状态操作顺延为 §3.8.4；
    `docs/issues.md` 新增 `ISS-083`（待办）与 `ISS-084` / `ISS-085` / `ISS-086`（已解决），§0 计数与索引同步；
    本文件（快照 / 验证基线 / D-57 / 困难与问题记录 / 本条日志）。
- **关键设计决策**：新增 **D-57**（风险 ≠ 告警；判据唯一作者在 `shared`；三个视图同一次读取）。
- **验证与测试结果（2026-10-03 实测）**：详见「验证基线（2026-10-03 实测）」。要点：
  `npm test` **92 套件 / 1041 用例**全通过；`typecheck` 三端 exit 0；`build` 三端通过；
  `db:reset` 幂等；Electron 真实 `ipc` 走查 —— 对比表两行带数字 + 差异行「少跑 450 m / 少行驶 8 分 27 秒 /
  早 2 分 20 秒」、派发明细每行带路线、应用后「在地图上查看这 4 台车」跳转后地图显示 6 条配送路线且
  选中 `CAR-01`、告警中心刷新后出现 2 条「必须处理」的 `已超时` / `未派发`（`ISS-084` 的那一类）、
  派发区块显示「4 台车 · 5 单已生效」且 `CAR-01` 标「接力 2 单」，控制台错误 0 条。
- **遇到的困难与解决方案**：见「困难与问题记录」本轮 3 行。最值得记的是**两条只有在真实渲染下才暴露**的问题：
  (a) `ISS-084` 是**写用例时抓到**的 —— `pending` 任务过期不报，因为超时循环复用了「占用车辆」的状态集；
  (b) `ISS-086` 是**走查时抓到**的 —— 建议动作列被 `nowrap` 顶出卡片，`scrollWidth 1183 > clientWidth 1146`，
  而 DOM、单测、控制台全绿（jsdom 不做布局，量不出宽度）。
  两条的共同教训与上一批一致：**静默失效的东西不会自己暴露**。
  另有一条**环境坑**值得记：CDP 连上的那个 `9223` 端口上是**几天前启动的旧 Electron 进程**，
  它跑的是旧 `dist/main.js`（没有 `alerts/risks` 这条路由），于是 `/api/alerts/risks` 被
  `/api/alerts/:id` 命中并返回「告警不存在」—— 看起来像新接口写错了。**重启进程后一切正常**；
  这正是既有纪律「改完主进程 / preload 必须重启 Electron 再验证」的又一次印证。
- **补充（同日，同批未提交）：把界面上的「代价」改称「加权综合分」**
  - 起因：使用者提出「代价」这个词容易被读成运费 / 价格，而它其实是加权秒数。
  - 改法：新增 `renderer/src/domain/labels.ts` 的 **`COST_METRIC_LABEL = '加权综合分'`（唯一作者，
    两个使用者：调度台与任务详情弹层）**；调度台两处列头（并加 `title` 说明「越低越好、由五项加权得出」）、
    按车辆分组行、推荐文案、调度日志小结、任务详情弹层都改为引用它；策略描述与 `explain.ts` 的策略小结
    （会写进调度日志、界面能读到）同步改口。**算法侧 `cost` / `costOf` / `DISPATCH_COST_WEIGHTS` /
    「代价函数」等标识符与文档术语一律不变** —— 改的只是给人看的字；`docs/module-M4-dispatch.md` §7.3
    加了一行「算法叫代价、界面叫加权综合分」的对照，避免后来者以为实现与文档不一致。
  - 实测（Electron 真实 `ipc`）：对比表列头与派发明细列头均为「加权综合分」（共 4 张表的列头逐项读出）、
    两处 `title` 生效、策略描述显示「挑当前加权综合分最小的车辆 / 求加权综合分总和最小的指派」、
    日志小结显示「派 5/6 · 拒 1 · 加权综合分 1712.4」；**全文再无「总代价 / · 代价」**。
    另做了一次**「只点预览不点应用」**的对照（日志前后只有一条 `preview`），确认改文案没有碰到派发链路。
  - 顺带发现并登记 **`ISS-087`（待办）**：时间戳有两个格式化作者 —— 告警页按本地时区渲染
    （`ops/model.ts` 的 `shortTime`），调度 / 审计等页把 UTC 串直接印出来（`domain/format.ts` 的
    `formatDateTime` 只是删掉 `Z`），**实测相差 8 小时**。库里的值是对的，错在渲染；
    **本轮不修**（会波及一批断言的字符串与多处页面，需先定「全系统本地时间还是 UTC」的口径）。
- **遗留问题与下一步**：
  1. **本批（「代价」→「加权综合分」）已随 `2f33ac4` 提交**（使用者本人提交）。日志与 `docs/issues.md`
     已同步。**已随 `2f33ac4` 提交**；拟提交信息（当时）：`refactor(dispatch): 界面术语「代价」统一改为「加权综合分」`。
     **上一批（风险预检 / 派发区块 / 路线列 / 派发后上地图）已由使用者并入 `fef52a6`**，
     即本条日志与 `ISS-084`…`ISS-086` 的代码与文档都已进版本库。
  2. **`ISS-083`（Mock 读接口不校验会话）与 `ISS-087`（时间戳 UTC / 本地两套口径）未修**，
     两者都应单独成批：前者要给 Mock 补一张「已知路径 → 是否 public」表，
     后者要先定「全系统用本地时间还是显式 UTC」再动（会波及多个页面与断言）。`ISS-083` 细节：浏览器形态下读接口匿名可读，与主进程口径相反；
     修它要给 Mock 补一张「已知路径 → 是否 public」表，属独立一批（本批只在 `mock-parity` 里
     把断言范围限定为「有会话时一致」，并把原因写在用例注释里）。
  3. 地图仍缺**订单端点图层**（`ISS-011`）与**轨迹回放**的界面入口（接口已有，ISS-012 已关闭）。
  4. 风险清单的排序目前固定为「级别 → 类型 → 任务编码」；「按停滞时长排序」与「按车辆聚合视图」可作后续增强。

### 2026-10-03 — 订单派发主链路打通 + 新增车辆中心：调度内建建单、派发即开跑、本批次预检同屏（D-58 / D-59，ISS-088…ISS-092）✅（已并入 `2f33ac4`）

- **范围与目标**：使用者提出两组诉求 ——
  ① **流程**：「调度中心创建一个新订单 → 调度中心调度一个车来派发这个订单 → 新订单提交告警中心
  提出可能出现的冲突问题」；② **前端**：「订单应用后，车可以在前端地图中跑出来（实时仿真地行动就行）」，
  并「额外设计一个车辆中心」；③ 前置要求：「把这些需求整理到改动文档后再进行修改」。
  按 `design.md` 的 M4（调度）/ M2（基础数据）/ M7（监控与执行）/ M8（告警）四条需求线拆成六项，
  **先写方案文档再动代码**（`docs/module-M4b-order-flow.md` 先于实现成文，本批按它落地）。
- **变更清单（新增 / 修改）**：
  - **文档（第 0 步，先于代码）**：新建 `docs/module-M4b-order-flow.md`（六项方案、口径裁决、
    文件级改动清单、测试与 DoD、明确不做清单、登记位置表、风险；§10 为本批实现回写）；
    `design.md` 新增 `Req-M2-8`（车辆中心）· `Req-M4-8/9/10`（建单 / 自动开跑 / 预检）· `Req-M7-6`，
    §7.1 页面清单加「车辆中心 `/fleet`」；`README.md` 文档入口加一行；`docs/api.md` §0 的模块文档指派行
    加入 module-M4b；本文件新增 **D-58 / D-59** 与「困难与问题记录」；`docs/issues.md` 新增 5 条
    （`ISS-088` 待评审 + `ISS-089`…`ISS-092` 已解决）。
  - **调度中心（`renderer/src/dispatch/`）**：新增 `NewOrderDialog.tsx`（**复用** M3 的 `TASK_FORM` +
    `EntityFormDialog` + `buildTaskPayload`，只做三件事：套字段、固定 `submit: true`、把新任务交回调用方
    —— 不新写第二份任务表单，D-34）· `applyFlow.ts` + `applyFlow.test.ts`（把「apply 结果 + 逐单 start 结果」
    汇总成一段可展示的结论：`applied` / `started` / `failed[]` / `notStarted` / `headline` / `details` / `tone`）；
    `DispatchConsole.tsx`：左栏加「新建订单」入口（`task:write`）、应用按钮旁加「派发后立即开跑」复选框
    （默认值 = 会话是否有 `execution:start`，没有则整块隐藏并说明去哪儿手动开跑）、apply 成功后**顺序**逐单
    `POST /api/execution/tasks/{id}/start`、右栏加「派发 + 逐单开跑」回执块与「本批次预检」块
    （用 `filterRiskReport` 过滤出本批任务相关的条目，并链到告警中心看全量）；
    **精简**：手动指派 / 回收重算 / 调度日志收进默认折叠的 `<details>`（折叠 ≠ 删除，接口与权限判定不变）。
  - `renderer/src/pages/DispatchPage.tsx`：页头与文案重写（说清 apply 与 start 是两个权限点、开关在哪），
    路径规划收进折叠区「高级操作：路径规划（试算，不落库）」。
  - **告警预检复用（`renderer/src/ops/`）**：从 `RiskPanels.tsx` 抽出 `RiskTable.tsx`（两个页面共用同一张表，
    否则同一批风险会在两个页面上长成两件事）；`ops/model.ts` 加 `filterRiskReport`（**只过滤与重新计数，
    不复制判定**）。`RiskPanels.tsx` 对外行为不变。
  - **车辆中心（新增 `renderer/src/fleet/` + `pages/FleetPage.tsx`）**：`model.ts`（分桶恒七桶 / 需关注
    不含「停用」/ 电量两档阈值复用调度内核常量 / 行组装 / 轨迹投影含 y 轴翻转）· `useFleetList.ts`
    （`/api/monitor/vehicles` + 事件分层：带坐标的 `vehicle.changed` 只覆盖坐标、其余节流 500 ms 重拉；
    **不挂轮询兜底**）· `FleetTable` · `VehicleDrawer`（实时位置 / 当前任务 / 轨迹折线 + 采样点表）· style；
    导航与路由挂到 `monitor` 组（`monitor:read`），「改车」跳基础数据页（D-59）。
  - **测试**：新增 `dispatch/applyFlow.test.ts`（5）· `dispatch/NewOrderDialog.test.tsx`（3）·
    `dispatch/DispatchNewOrder.test.tsx`（2）· `dispatch/DispatchAutoStart.test.tsx`（1）·
    `fleet/model.test.ts`（10）· `pages/FleetPage.test.tsx`（6）；改 `dispatch/DispatchConsole.test.tsx`
    （+1 折叠区）· `pages/DispatchPage.test.tsx`（改为先展开折叠区）· `ops/model.test.ts`（+3 过滤口径）。
- **关键设计决策**：新增 **D-58**（「派发后立即开跑」在**渲染层**把 apply 与逐单 start 组合成带开关的流程，
  服务端契约与 D-11 的权限分离都不动，代价是显式接受「已派发未开跑」的中间态并**把它展示出来**）与
  **D-59**（车辆中心是**运行态读模型**，不复制车辆 CRUD、不新增权限点，`base:write` 才显示跳转入口）。
- **验证与测试结果（2026-10-03 实测）**：详见「验证基线（2026-10-03 实测·第五批）」。
  要点：`typecheck` 三端 exit 0；`build` 三端通过；`db:reset` 幂等；`npm test` 98 套件 / 1072 用例
  （空载 98 套件 / 1072 用例全绿；同日的两次负载复跑出现过 `ISS-068` 的偶发超时）；
  Electron 真实 `ipc` 走查按 DoD 四条逐条走通 ——
  建单 `T20261003-0001` → 候选池 6→7 且自动勾选 → 预览 → 应用（开关默认开）→
  「已派发 5 单（贪心），5 单已开始执行」→ 地图上 5 台车连续三次采样都在动；关掉开关再派 →
  「已派发 2 单（贪心），尚未启动执行」；新建「时间窗已过」的订单 → 调度中心与告警中心**同时**列出
  2 条 `必须处理`（`已超时` + `未派发`，同一次 `scanPlanRisks`）；车辆中心 5 台 / 分桶「空闲 2 · 执行中 3」，
  `AGV-01` 抽屉读到实时位置、当前任务与 80 个采样点；控制台错误 0 条。
- **遇到的困难与解决方案**：
  1. **mock 内存库把同一文件里的用例互相污染**：`apply` 会把候选池搬空，于是同文件后续用例
     「找不到候选」——失败长得像功能坏了。按既有约定（`TasksPage.test.tsx` / `TasksPage.write.test.tsx`
     分家）拆成三个文件；这条判据写进了 `docs/module-M4b-order-flow.md` §8.1 的注。
  2. **`npm test` 的失败数随机器负载剧烈变化**：Electron 正在运行（执行器每秒推遥测）时跑全量，
     21 条 jsdom 用例超时；杀掉 Electron 后同一份代码只剩 3 条超时，且这 3 条单独复跑全绿。
     这正是 `ISS-068`（并行负载下偶发超时）的现场证据 —— 本轮把成因进一步指向**负载 / 5 s 超时窗口**
     （而不是某一条用例），但**未修**：修它要么加大超时窗口、要么降并行度，两者都该单独成批并先测影响。
  3. **三条走查 / 写用例时当场发现并修掉的问题**（`ISS-090`…`ISS-092`）：抽屉坐标没走 `formatNumber`
     （`73.59999999999991`）、新建订单后仍挂着上一批的「在地图上查看 N 台车」、`DispatchPage.test.tsx`
     仍在断言已被信息架构调整移除的徽标。三条都不报错、不影响接口，只在真实渲染或被用例挡住时显形 ——
     与 `ISS-084`…`ISS-086` 同一族。
- **遗留问题与下一步**：
  1. **本批与「术语改名」批均已随 `2f33ac4` 提交**（使用者本人提交），两批的文档与日志均已同步，
     **已随 `2f33ac4` 提交**；拟提交信息（当时）：`feat(dispatch): 调度中心内建建单与派发即开跑，新增车辆中心`。
  2. `ISS-088`（D-58 的口径裁决）状态仍为**待评审**：需要使用者确认「渲染层组合 apply 与 start」
     这一取舍；若要改成服务端原子动作，应连同 D-11 一起评审。
  3. `ISS-083`（Mock 读接口不校验会话）与 `ISS-087`（时间戳 UTC / 本地两套口径）**未修**，各自单独成批。
  4. 逐单 `start` 是 N 次串行请求（演示规模可接受）；任务量放大后应先做批量开跑接口并回写 `docs/api.md`。
  5. 地图仍缺**订单端点图层**（`ISS-011`）；车辆中心的轨迹回放目前是折线 + 采样点表，
     完整回放（时间轴 + 游标）仍在地图页。

### 2026-10-03 — 待派任务池扩容 + 对比屏新增「差异对照 / 派单差异」：让算法差异第一屏可见（第六批）✅（已并入 `2f33ac4`）

- **范围与目标**：使用者原话 ——「多创建几个预留的待派任务，并为了更多体现算法之间的差异做出改动」。
  拆成两项：① 把 seed 的待派演示任务**扩容**，并按「放大哪一种算法差异」来设计每一条；
  ② 把调度中心的**差异呈现**做厚，让「差多少」不再只靠一句差异文案。
  仍按项目纪律**先写改动文档再动代码**（新建 `docs/seed-dispatch-diversity.md`，先于实现成文）。
- **为什么只动数据与展示层**：算法契约（贪心「重排序 + 逐个挑最小代价 + 允许接力」、匈牙利
  「整批最小化 + 一车一单」）、成本权重、时间窗容忍、`DISPATCH_MAX_*` 全部不变（D-12）；
  **不新增接口、不新增领域事件**，因此 `docs/api.md` §3 / §4 无需改动，也没有新的 `D-xx`。
- **变更清单（新增 / 修改）**：
  - **文档（第 0 步，先于代码）**：新建 `docs/seed-dispatch-diversity.md`（两项改动的设计意图、
    每条新任务想放大哪种差异、两条实现约束、文件清单与验收；抬头写「文档边界」）；
    `README.md` 文档入口加一行；`docs/database.md` §4 的「演示待派发 ×6」改为不固化条数并指向该文档；
    `docs/issues.md` 新增 **`ISS-093`（待办）**：贪心的拒绝原因取「首个失败车辆」，多车池下会报出
    与真实原因无关的那一条；本文件的项目快照、验证基线、代码现状地图、工作日志与「困难与问题记录」。
  - **种子数据**：`shared/src/constants.ts` 的 `SEED_IDS.pendingTasks` 追加 6 个 id；
    `shared/src/seed-data.ts` 的 `SEED_PENDING` 追加 6 条任务并补「每条放大哪种差异」的注释。
    新任务一律**追加在尾部**：`code` 由下标派生（`T-DEMO-<index+2>`），既有 `T-DEMO-0002`…`T-DEMO-0007`
    的编码因此保持不变，引用旧编码的用例与文档不受影响。
  - **展示层**：`renderer/src/dispatch/model.ts` 新增两个纯函数 ——
    `metricComparisonOf`（逐指标对照：推荐策略为基准列，其余列给带符号差值与更优 / 更差标记，
    含「单车平均里程 / 平均耗时」以抵消「派得少就天然省」）与 `assignmentDiffsOf`
    （同一单派给了不同车，某一方没派即 `null`）；抽 `fleetTextOf` 让两处共用同一种用车文案。
    `renderer/src/dispatch/DispatchConsole.tsx` 在「策略对比」区块内渲染这两块（原对比表与差异文案不动），
    `style/dispatch.css` 补少量样式（差值颜色只区分更优 / 更差，不用警示色 —— 「更差」往往只是活干得多）。
  - **测试**：`dispatch/model.test.ts` 新增 4 条（单策略返回 null、基准列与差值方向、单车平均抵消规模差、
    派单差异只列不一致行）；`DispatchConsole.test.tsx` 改 1 条（区块内现在有多张表，取第一张）并新增 2 条
    （差异对照的指标行与差值徽标、派单差异的「未派发」格）；`AlertsRisk.test.tsx` 的待派编码与条数
    改为**从任务列表接口读**，不再硬编码 6 条。
- **关键设计决策**：无新增 `D-xx`（本轮是既有 M4 口径下的数据与呈现调整；两条实现约束写在
  `docs/seed-dispatch-diversity.md` §3 与 `seed-data.ts` 的注释里）。
- **验证与测试结果**（空载实测，详见「验证基线」第六批）：
  - `npm test` **98 套件 / 1078 用例全通过**；`npm run typecheck` 三 workspace exit 0；
    `npm run build` 三端通过；`npm run db:reset` 幂等（`tasks:13` = 1 条演示执行 + 12 条待派）。
  - 调度对比实测（真实 SQLite + 主进程内核）：贪心 `9/12` vs 匈牙利 `4/12`，差异文案
    「少跑 1210 m、少行驶 17 分 16 秒、早 2 分 20 秒完成」，派生差异 9 行不一致 ——
    其中唯一的重货 `T-DEMO-0008` 是「贪心未派发、匈牙利 `CAR-02`」。
- **遇到的困难与解决方案**：
  1. **第一版用了「未来时间窗」来做预留任务，被一致性护栏当场拦下**：窗口起点晚于 seed 时刻后，
     「等待时间」随「数据基准时刻 − 预览时刻」变化，而 Mock 与主进程的这两个时刻必然不同，
     差异于是**从时间字段泄漏进 `waitTimeS` / 加权综合分**，`mock-parity.test.ts` 的逐字段一致断言变红。
     解决办法是**放弃时间窗错开**，改用任务端点设计来制造可接力的空档（详见「困难与问题记录」）。
  2. **短途件踩到有向边与占道规则**：第一版的「短途」选了 `ST04 → ST09`（`N12 → N13`），
     实测执行段不是 150 m 而是绕行 450 m —— 因为 `campus.obstacles.rou.xml` 把 `E_N12_N13` 封了、
     反向的 `E_N12_N13_R` 畅通。改选 `ST04 → ST02`（`N12 → N11`）后落入空档，接力成功。
     这条已写进 `seed-data.ts` 注释，避免后来者重蹈。
  3. **扩池不是「加几行」而是「让贪心真的能接上」**：最初 6→12 的版本里贪心只派出 6 单（其余因
     占用区间相交被拒），对比反而更难看。最终按「重货 / 中重件 / 无人机小件 / 短途件」四类逐条设计，
     贪心升到 9 单，差异才真正拉开。
- **遗留问题与下一步**：
  1. **第六批（本批）与第四批（术语改名）、第五批（订单派发主链路 + 车辆中心）均已随 `2f33ac4` 提交**
     三批的文档与日志均已同步，**已随 `2f33ac4` 提交**。
     拟提交信息：`feat(dispatch): 扩容待派任务并在对比屏给出逐指标 / 逐任务的算法差异`。
  2. 匈牙利在「任务数 ≫ 车辆数」时**必然**拒掉 `n − m` 单（一车一单是它的定义），
     演示里因此出现「拒 8」；这是口径而不是缺陷，但若要在界面上更公平地呈现，
     可考虑补充「每单平均」以外的第三个口径（例如「完成这批任务需要几批派发」）—— 未做，留作下一步。
  3. **`ISS-093`（待办）是本批新登记的**：扩容后拒绝原因表几行都报「AGV-01 不可用」，
     而真实原因是占用区间冲突 —— 它不影响派发结果，只影响可诊断性；建议单独成批（要先定口径）。
  4. `ISS-083`（Mock 读接口不校验会话）、`ISS-087`（时间戳 UTC / 本地两套口径）、`ISS-068`
     （并行负载下偶发超时）仍**未修**，各自单独成批。

### 2026-10-03 — 待派任务再扩容（12→18）+ 加权综合分与拒绝原因口径修正（D-60 / D-61，ISS-093 已解决 / ISS-094 新增）✅（已并入 `2f33ac4`）

- **范围与目标**：使用者原话 ——「多设计几个预留的待派任务以进行仿真演示，并修复加权综合分的计算」。
  拆成两项：① 待派演示任务 **12 → 18**，按「放大容量瓶颈与算法差异」补 6 条（3 个只有大车能接的
  重货 / 中重件 + 2 个远距离无人机小件 + 1 个相邻短途件）；② 修正界面「加权综合分」
  （`summary.totalCost`）**只累加已派发计划**的口径缺陷 —— 它会让「拒得多」的一方看着更优。
- **变更清单（新增 / 修改）**：
  - **数据**：`shared/src/constants.ts` 的 `SEED_IDS.pendingTasks` 追加 `seed-task-p13`…`seed-task-p18`；
    `shared/src/seed-data.ts` 的 `SEED_PENDING` 追加 6 条，**一律追加在尾部**（`code` 由下标派生，
    既有 `T-DEMO-0002`…`T-DEMO-0013` 编码不变，引用旧编码的用例与文档不受影响），并补
    「每条想放大哪种差异」与实测结论注释。
  - **算法内核（`shared/src/`，纯函数无 IO）**：`dispatch-types.ts` 新增
    `DISPATCH_UNSERVED_PENALTY_S = 3600`；`dispatch-evaluate.ts` 新增
    `compositeScoreOf(plans, rejectedCount)`（批次加权综合分的唯一算法）；`dispatch-strategies.ts`
    新增并导出 `mostInformativeReject` + `REJECT_STEP_ORDER`，贪心改为**收集全部失败后取最优原因**，
    匈牙利步骤 1 同步（`row.filter(...).map((cell) => cell.reject)`）。
  - **汇总点接入（共 7 处调用）**：`shared/src/dispatch-strategies.ts`（贪心 / 匈牙利）、
    `desktop/src/domain/dispatch/dispatch.service.ts`（apply / manual-assign）、
    `renderer/src/api/mock-dispatch.ts`（3 处）—— 全部改调 `compositeScoreOf`，不各自写 `reduce`。
  - **展示层**：`renderer/src/dispatch/DispatchConsole.tsx` 在「差异对照」表下新增一行公式说明
    （`加权综合分 = Σ 已派发计划的加权代价 + 未派发单数 × 3600（未派发惩罚）`，常量从 `shared` 导入，
    不硬编码数字），读者不必翻文档。
  - **测试**：`shared/src/dispatch-evaluate.test.ts` +3（`compositeScoreOf` 的算术、惩罚上界、
    多派一单永远更优）；`shared/src/dispatch-greedy.test.ts` 改 1（`totalCost` 期望含惩罚）+ 新增 2
    （拒绝原因两个方向的反例）；`desktop/src/domain/dispatch/dispatch.service.test.ts` +1
    （按**真实 seed** 穷举 `max(plan.cost)` 断言小于惩罚）；`renderer/src/dispatch/DispatchConsole.test.tsx`
    的「差异对照」用例 +2 条断言（表下公式含「未派发惩罚」与该常量值）。
  - **文档**：`docs/seed-dispatch-diversity.md` 升 v1.1（新增 §0 三轮索引 · §3.1 第二轮扩容 ·
    §7 加权综合分修正 · §8 拒绝原因修正）；`docs/module-M4-dispatch.md` §5「拒绝原因怎么挑」·
    §7.1 c 步 · **新增 §7.4 批次加权综合分**；`docs/api.md` §3.4.2 对比表加「加权综合分」行；
    `docs/architecture.md` 拒绝顺序段落；`docs/database.md` §4 去数值化；
    `docs/issues.md`（`ISS-093` → 已解决、新增 `ISS-094`、§0 计数与 §2 已解决表）；本文件。
- **关键设计决策**：新增 **D-60**（批次加权综合分必须包含未派发惩罚）与 **D-61**
  （拒绝原因按「离能跑还差多少」排序，不按步骤号取第一条）。
- **验证与测试结果**（空载实测，详见「验证基线·第七批」）：
  - `npm test` **98 套件 / 1084 用例全通过**；`npm run typecheck` 三 workspace exit 0；
    `npm run build` 三端通过；`npx vitest run tests/docs.test.ts` 8 条通过；
    `npm run db:reset` → `tasks:19`（1 条演示执行 + **18 条待派**）。
  - **两策略实测**（真实 SQLite + 主进程内核，数字与「验证基线·第七批」同一次复测）：
    贪心**派 9 / 拒 9**、已派发代价 3146、加权综合分 **35546**、执行里程 3760 m；
    匈牙利**派 4 / 拒 14**、已派发代价 1256、加权综合分 **51656**。
    旧口径下匈牙利 1256 < 贪心 3146，会推荐「少干 5 单活」的一方；
    新口径下贪心少 16110 分，与「多派 5 单」一致。
  - **拒绝原因**：贪心拒绝的 9 条全部指向真实瓶颈（占用区间冲突），不再出现
    「十几行都是 AGV-01 不可用」的形态。
- **遇到的困难与解决方案**：
  1. **等待派上限是分页契约给的，不是算法给的**：扩到 19 条待派时 `api.task.test.ts` 与
     `TasksPage*.test.tsx` 变红 —— 任务列表默认一页 20 条，1 条演示执行 + 19 条待派 = 20，
     再多一条就把演示执行任务挤到第 2 页，而用例断言它首屏可见。最终把待派上限锁在 **18**，
     并把成因登记为 `ISS-094`（Mock 新建记录的时间戳与演示数据同基准，刚建的任务排列表末尾）。
  2. **未派发惩罚取值要大于「任何单条计划代价」**：第一版取 2700 加权秒，按本路网
     「空驶 + 执行」上限 1673 s 叠加晚点 / 续航最坏项后约 2773 s，仍可能被单条贵计划反超，
     于是取 3600（约 1.3–1.4 倍余量），并加一条按真实 seed 穷举 `max(plan.cost)` 的断言。
  3. **拒绝原因的排序方向两个方向都有反例**：第一版按六步**步骤号**排序，恰好把
     `VEHICLE_NOT_AVAILABLE` 排在 `LOAD_EXCEEDED` 之前，把要修的反例原样复现；反向反例是
     「唯一大车被预留时，优先报 `LOAD_EXCEEDED` 会说成『没有车装得下 900 kg』」。
     判据改为「离能跑还差多少」，两个方向各写一条用例（见「困难与问题记录」）。
- **遗留问题与下一步**：
  1. **第四 ~ 第七批（本批）已随 `2f33ac4` 提交**（使用者本人一次性提交），四批的文档与日志均已同步。
     拟提交信息（当时）：`feat(dispatch): 扩容待派任务并修正加权综合分与拒绝原因口径`。
  2. **`ISS-094`（待办）**：Mock 的新建记录时间戳与演示数据同基准，刚建的任务排列表末尾；
     它锁死了「待派 ≤ 18」这个演示上限，要放开得先修适配层的记录时间戳口径。
  3. 匈牙利「任务数 ≫ 车辆数必然拒 `n − m` 单」是口径而非缺陷（一车一单是它的定义）；
     若要更公平地呈现，可考虑补第三个口径（如「完成这批任务需要几批派发」）—— 未做。
  4. `ISS-083`（Mock 读接口不校验会话）、`ISS-087`（时间戳 UTC / 本地两套口径）、
     `ISS-068`（并行负载下偶发超时）仍**未修**，各自单独成批。
  5. 本轮**未**重跑 `dev:electron` 真实 Electron 走查（改动集中在内核与种子数据，界面只多了一句
     公式说明）；下次提交前建议补一次目视核对。

### 2026-10-03 — 真实 Electron 走查：确认加权综合分口径修复，并修掉「拒绝原因只有一种说法」（ISS-095）✅（已并入 `2f33ac4`）

- **范围与目标**：补做第七批欠下的**真实 Electron 目视核对**（该批改动集中在内核与种子数据，
  界面上只多了一句公式说明，故当时未跑）。目标有三：① 确认第七批的加权综合分 / 差异对照 /
  公式行在真实 `ipc` + SQLite 形态下与实测数值一致；② 顺手核对「拒绝原因」表；
  ③ 按项目纪律把走查当次发现的问题**先记录后修**。
- **走查方法（可复现）**：`npm run db:reset`（干净库：1 条演示执行 + 18 条待派）→
  `npm run dev:electron` → `admin/admin123` 登录 → 调度中心 → 全选 18 条 → 「全部（对比）」→ 预览派发。
- **变更清单（新增 / 修改）**：
  - **`shared/src/dispatch-evaluate.ts`**：两处时间窗拒绝的 `detail` 各加 `kind`（`'late'` / `'occupied'`）；
    新增并导出 `isLateWindowConflict(detail)` —— 两种情形的**唯一判据**（含 `kind` 之前的旧快照回退：
    没有 `kind` 时仍按「有没有 `lateS`」判）。
  - **`desktop/src/domain/dispatch/explain.ts`** 与 **`renderer/src/dispatch/model.ts`**：
    `TIMEWINDOW_CONFLICT` 分支改为调 `isLateWindowConflict`，不再各自用 `lateS` 反推。
  - **测试**：`renderer/src/dispatch/model.test.ts` +1（晚点 / 被占用两种情形 + 旧快照回退，
    并断言「被占用」那句里**不出现「晚点」**）；`shared/src/dispatch-evaluate.test.ts` 两条拒绝用例
    各加一条 `kind` 断言。
  - **文档**：`docs/module-M4-dispatch.md` §5（步骤 5 表格补 `detail.kind`、排序段后补两种情形的分口径说明）；
    `docs/issues.md`（新增 **`ISS-095`** 已解决 + §0 计数 94→95 / P3 36→37 / 已解决 72→73 + §2 追加一行）；
    本文件（快照 ⑨ 段、第八批验证基线、困难与问题记录一条、本条日志）。
- **关键设计决策**：无新 `D-xx`。修法遵循既有的 **D-34 / D-55 原则（判据只能有一个作者）**：
  不再给渲染层补一个 `if`（那会留下两份判据），而是让**产出方**把「哪一种时间窗冲突」写进 `detail.kind`。
- **验证与测试结果**：
  - `npm test` **98 套件 / 1085 用例全通过**；`npm run typecheck` 三 workspace exit 0；
    `npm run build` 三端通过；`npx vitest run tests/docs.test.ts` 8 条通过。
  - **真实 Electron 读数**（与第七批逐项一致）：推荐语「推荐『贪心』：指派 9/18，加权综合分 35546.0，
    比『匈牙利』多派 5 单」；贪心 `9/18 · 拒 9 · 3760 m · 52 分 26 秒 · 35546.0`、
    匈牙利 `4/18 · 拒 14 · 1950 m · 20 分 56 秒 · 51656.0`；差异对照「加权综合分 +16110.0」；
    公式行「= Σ 已派发计划的加权代价 + 未派发单数 × 3600（未派发惩罚）」。
  - **修复前后对比（同一次走查的两次预览）**：修复前 9 行「具体情况」全是
    「预计晚点 0s，超出容忍 0s」；修复后 9 行各不相同 ——
    `T-DEMO-0005 AGV-02 在 04:41:22 ~ 04:46:22 已被占用`、`T-DEMO-0008 CAR-02 在 04:39:02 ~ 04:42:22 已被占用`、
    `T-DEMO-0010 CAR-01 在 04:39:02 ~ 04:42:22 已被占用`、`T-DEMO-0014 CAR-02 在 04:37:22 ~ 04:41:26 已被占用` 等。
- **遇到的困难与解决方案**：
  1. **这条缺陷单测与文档都看不见，只有人读那 9 行才会发现**：`TIMEWINDOW_CONFLICT` 的两种情形
     在类型上就是同一个 `reason`，两条路径各自的断言都通过（主进程那条还写对了）。
     它属于 `ISS-084`…`ISS-086`、`ISS-090`…`ISS-092` 那一族：**不报错、不影响接口，只在真实渲染时显形**。
  2. **走查期间把用户的 dev 会话弄断过一次**：`concurrently -k` 在 Electron 进程被单独 kill 后
     连坐关掉了 Vite，于是界面停在旧库快照上（已 `db:reset`，但运行中的进程仍握旧文件句柄）。
     教训：**改完库或改完主进程代码，要整套重启 `npm run dev:electron`，而不是只重启 Electron**；
     判断「界面读的是不是新库」看窗口里的待派条数（应为 18）比看日志更快。
- **遗留问题与下一步**：
  1. **第四批（术语改名）~ 第八批（本批）均已随 `2f33ac4` 提交**（使用者本人一次性提交，纪律偏差见「项目快照 · 仓库状态」），
     各批文档与日志已同步。拟提交信息（当时）：
     `feat(dispatch): 扩容待派任务、修正加权综合分口径并改进拒绝原因展示`。
  2. **`ISS-094`（待办）仍是唯一的演示规模约束**：Mock 的新建记录时间戳与演示数据同基准，
     它锁死了「待派 ≤ 18」，要放开得先修适配层的记录时间戳口径。
  3. 走查只覆盖了调度中心；`ISS-083`（Mock 读接口不校验会话）、`ISS-087`（时间戳 UTC / 本地两套口径）、
     `ISS-068`（并行负载下偶发超时）仍**未修**，各自单独成批。
  4. 告警中心的「任务冲突 / 超时预检」本批**未**目视核对（第七批的预检结论仍以那一节的日期为准）。

### 2026-10-03 — 风险预检按「是否依赖已生效派发」分两节呈现（第九批，ISS-096）✅（已并入 `2f33ac4`）

- **范围与目标**：用户提问「为什么我在任务中心派发任务之前，告警中心就给出冲突处理了」。
  解释清根因后，用户给出处置口径：**「保留，但分节」** —— 不删、不去重，改为按风险是否依赖
  「已生效的派发」分成两节，让「没派发也会出现的缺口」与「派发才可能造成的冲突」在视觉上分开。
- **根因（为什么没派发也报冲突）**：`GET /api/alerts/risks` 的七类风险里只有五类由已生效派发算出
  （同车抢占 / 车辆不可用 / 电量不够 / 缺路线 / 预计迟到）；`WINDOW_EXPIRED`（时间窗已过）与
  `UNASSIGNED_TASK`（还没排上车）**与有没有派发无关**，且对同一条 `pending` 任务可同时成立 ——
  旧版把它们平铺在一张表、共用标题「任务冲突与超时预检」，于是「共 12 条」里只有 9 条不同任务。
- **变更清单（新增 / 修改）**：
  - **`shared/src/plan-risk.ts`**（分类判据的唯一作者）：抽 `riskCountsOf(items)`；
    新增 `PLAN_RISK_SECTIONS` / `PlanRiskSection` / `PLAN_RISK_SECTION_OF`（五类→`dispatch`、
    两类→`backlog`）/ `PLAN_RISK_SECTION_TEXT`（节标题 + 一句话 hint）/ `PlanRiskSectionView` /
    `planRiskSectionsOf(items)` —— **空节不返回、组内保持扫描顺序、不重排**。
  - **`renderer/src/ops/RiskPanels.tsx`**：区块标题 `任务冲突与超时预检` → **`任务风险预检`**
    （`aria-label` 与 `<h3>` 同步）；导语改为解释两节；按 `planRiskSectionsOf` 分组渲染
    （节标题 + `riskSummaryOf(view.counts)` + hint + `RiskTable`）；结尾行「还有 N 条待派任务没有安排车辆」
    移入 backlog 节内，文案改「其中 N 条完全没有安排车辆」。
  - **`renderer/src/ops/style/ops.css`**：新增 `.udm-risk__section` / `__section-head` / `__section-title`
    / `__section-count` / `__section-hint`（左侧竖线建立层次）。
  - **测试**：`shared/src/plan-risk.test.ts` +5；`renderer/src/pages/AlertsRisk.test.tsx` +1（`ISS-096` 回归）
    并改 2 处 `aria-label`、1 处「还有 N 条」→「其中 N 条」；`RiskTable.tsx` / `OpsPages.test.tsx` 注释里的旧区块名同步。
  - **文档**：`docs/api.md` §3.8.3（排序段前插入「分两节呈现」表与「为什么必须分 / 为什么不去重 / 空节不显示」）；
    `docs/issues.md`（新增 **`ISS-096`** 已解决 + 索引行 + §2 一行；§0 计数 95→96 / P3 37→38 / 已解决 73→74，
    口径 `5+53+38 = 96 = 74+11+6+0+3+2`）；本文件（快照 ⑩ 段、第九批验证基线、困难与问题记录一条、本条日志）。
- **关键设计决策**：无新 `D-xx`（属既有 **D-34**「每个事实只有一个作者」的又一次应用）：
  「哪一节」必须由产出方定，**不能画在渲染层** —— 在组件里写 `if (kind === …)` 就等于把分类判据的
  第二个作者放进 UI，日后内核加一类风险，界面会静默漏掉它。
- **验证与测试结果**：
  - `npm test` **98 套件 / 1091 用例全通过**；`npm run typecheck` 三 workspace exit 0；
    `npm run build` 三端通过（renderer JS 722.21 kB / gzip 224.43 kB、CSS 79.56 kB / gzip 12.94 kB）；
    `npx vitest run tests/docs.test.ts` 8 条通过。
  - **真实 Electron 走查**：登录 → 调度中心 → 全选 9 条 → 全部（对比）→ 预览（贪心 6/9 · 12866.0 · 3080 m；
    匈牙利 4/9 · 19136.0 · 2100 m；差异 +6270.0；3 行拒绝原因各说各的）→ 点「应用这 6 条派发」→
    确认框 → 确认 → 「已派发 6 单（贪心），6 单已开始执行」→ 告警中心。
  - **分节读数**：告警中心「任务风险预检」显示「共 3 条 · 需留意 3」，**只渲染节 2「待派与超时缺口」**
    （3 行全为「未派发」）；**节 1「派发冲突与执行风险」按设计不渲染**（该批计划无冲突，
    同屏「本批次预检」也写「没有发现冲突或超时」）—— 正好实测了「空节不显示」。
- **遇到的困难与解决方案**：见「困难与问题记录」本批一行（核心：**这是单测与文档都看不见的问题，
  只有人读那 12 行才会发现**；因此分类判据必须单点，且要有一条「只待派时不得出现派发节」的回归断言）。
- **遗留问题与下一步**：
  1. **第四 ~ 第九批（本批）已随 `2f33ac4` 提交**（使用者本人提交），文档与日志已同步。
     拟提交信息（当时）：`feat(alerts): 风险预检按是否依赖派发分两节呈现`。
  2. 节 1 在真实库里**尚未出现过非空形态**（演示数据是「先派发、无冲突」的干净计划）：
     想在界面上也看一眼，需要构造一次真实的双派 / 迟到计划（例如手动指派制造同车区间重叠）。
  3. `ISS-094`（待派 ≤ 18 的时间戳口径）、`ISS-083`、`ISS-087`、`ISS-068` 仍未修，各自单独成批。

### 2026-10-04 — 四步主链路端到端实测：确认「新建订单 → 派发 → 告警提示 → 地图动起来」成立，并查出节 1 的演示可达性问题（第十批，ISS-097）⏳（未提交）

- **范围与目标**：用户要求确认一条具体流程是否完成 ——
  「调度中心新建一个订单 → 调度中心对新订单进行派发 → 告警中心对新订单的冲突进行提示 → 完成后地图上会有车节点运动」。
  目标不是读代码下结论，而是**在真实 `ipc` + SQLite 上把四步走一遍**，逐步留下可复核的读数。
- **方法（可复现）**：`npm run db:reset`（干净库：1 条演示执行 + 18 条待派）→ `npm run dev:electron` →
  `admin/admin123` 登录 → 调度中心逐单新建 / 预览 / 应用 → 告警中心 → 地图。
- **四步各自的实测结论**：
  1. **新建订单 ✅**：`新建订单` 弹层复用任务表单（D-58），填标题 / 载重 / 起终点后
     toast「已新建订单『T20261004-0001 · 流程验证订单』并提交到待派队列」；待派 `18 → 19`，
     新单**自动勾选**、策略默认「贪心」——「建完就能直接派」不需要手动去找它。
  2. **派发 ✅**：`预览派发` 给出「本次只跑了『贪心』：指派 1/1」（450 m / 加权综合分 260.0 / CAR-01），
     `应用这 1 条派发` → 确认框（列明生效与不派发两类）→「已派发 1 单（贪心），1 单已开始执行」。
     `派发后立即开跑` 默认勾选，因此 apply 之后逐单调了 `execution/tasks/:id/start`。
  3. **告警中心提示 ✅（但见下方可达性）**：它是**读模型**（`/api/alerts/risks`，每次刷新/轮询按当前库重算），
     不是「某张订单的消息」。派发后新单进入「任务分配派发」区块（`CAR-01 · 单趟 · … 执行中`）。
     要让「**冲突**」真的出现，必须存在一条真实的冲突条件 —— 本批用短时间窗造出了它（见下）。
  4. **地图车节点运动 ✅**：CAR-01 坐标 `300,384 → 450,300` 逐帧推进、`vehicle_tracks` 21 → 129 行、
     相隔 6 s 的两张截图 diff 出 238 个强差异像素（车辆标记位移）、任务端点进度 `0% → 100%`。
     `execution.progress` / `vehicle.changed` 走的是「只写 `positionsRef`、定向 `updateNode`」那条路径（D-23）。
- **关键发现（`ISS-097`，待办）**：按「新建 → 派发」的常规操作走，**节 1 永远是空的**。
  逐类核对后确认五类里只有 `LATE_FINISH` 能由常规操作触发：
  | 风险类 | 为什么造不出来 |
  | --- | --- |
  | `VEHICLE_OVERLAP`（同车区间重叠） | 派发前校验会拒绝重叠计划；库里能出现重叠的旧计划，但那些任务已 `finished`，扫描跳过 |
  | `VEHICLE_UNAVAILABLE`（车不可用） | 管理接口白名单只有 `idle` / `disabled`（`desktop/src/domain/base/vehicle.service.ts`），且 `disabled` 对 `reserved` / `busy` 会被 `VEHICLE.STATE_CONFLICT` 拒；`offline` / `fault` / `charging` 归执行器，而执行器从不设置这些状态 |
  | `BATTERY_RISK`（电量不够） | 电量只随行驶缓慢下降（每单约 1–2%），且低电车辆在派发阶段就被拒，不会被派出 |
  | `PLAN_WITHOUT_ROUTE`（计划缺路线） | `apply` 一定会写 `routes`，不存在「有计划没路线」 |
  | `LATE_FINISH`（预计迟到） | ✅ 可达，但窗口很窄：需落在「计划完成晚于时间窗末端、且晚点 ≤ 容忍 300 s」的带内，超了会被直接拒绝而不是记为风险 |
- **把节 1 演示出来的配方（本批实测有效）**：新建一张**时间窗只有几分钟**的单（起终点选一条较长的路，
  例如 `ST12 → ST07`）→ 直接 `预览派发` → `应用派发`。界面读数：
  「任务风险预检：共 9 条 · 必须处理 2 · 需留意 7」，节 1「派发冲突与执行风险：共 1 条 · 需留意 1」——
  `T20261004-0005 预计完成时间比时间窗末端晚 135 秒`（车辆 CAR-01）；
  节 2「待派与超时缺口：共 8 条 · 必须处理 2 · 需留意 6」——`T20261004-0004 / 0005` 为 `已超时`。
  **同一张单在节 1（预计超时）与节 2（已超时）各出现一次**，正是第九批「保留两条、不去重」要表达的口径。
- **变更清单（本批无产品代码改动）**：
  - **`AGENTS.md`**：快照 ⑪ 段、第十批验证基线、困难与问题记录一行、本条日志。
    另**顺带校正了历史标记**：本批执行时发现使用者已把第四 ~ 第九批提交为 `2f33ac4`（`use1`），
    于是把「项目快照 · 仓库状态」的提交序列与「积压/未提交」段落、以及 **16 条日志标题上的
    `⏳（未提交）` 标记**逐一改为实际归属（`66fa7d2`/`121af4d`/`a22ae16`/`fef52a6`/`2f33ac4`，
    归属按各批特征文件在 `git log --diff-filter=A` 里的落点确定）。**这属于「不写第二份真相」的维护动作：
    提交信息可以丢，日志里的状态不能一直停在旧的。**
  - **`docs/issues.md`**：新增 `ISS-097`（待办，展示可达性）+ §0 计数（96→97 / 待办 11→12）+ §2 表。
  - 实验期间用 `desktop/dist` 的领域服务（`createTask` / `preview` / `apply` / `alertRisks`）在库里
    造了一张迟到验证单 —— 这只是**造数据**，不进代码库。
- **关键设计决策**：无新 `D-xx`。本批结论进一步支持第九批的分节设计：
  正因为节 1 平时是空的，把它与「必然有内容的」节 2 混在一张表里，才会读出「我什么都没派它却在报冲突」。
- **验证与测试结果**：本批未改产品代码，但因改动落到文档，三端验证照跑：`npm run typecheck` 三 workspace exit 0、
  `npm run build` 三端通过、`npx vitest run tests/docs.test.ts` 8 条通过。
  `npm test` 全量跑**再现 `ISS-068` 的负载超时**（5 文件 / 13 用例，失败信息全是 `Test timed out in 5000ms`，
  失败集合每次不同），**把失败文件单独复跑全部通过** —— 判定与明细见「验证基线 · 第十批」。
- **遇到的困难与解决方案**：
  1. **走查中途 Mac 锁屏**（Computer Use 报 `The Mac is locked`）：那一轮正好卡在「去告警中心看两节」之前。
     解锁后补做了这一步 —— 也正因为补做，才发现节 1 需要专门造数据才看得见。
  2. **`no-persistence` 的坑**：用 `nohup … &` 起的 `dev:electron` 会被回收（进程消失、窗口空白），
     必须用持久会话跑（PTY），否则会误判成「Electron 起不来」。
- **遗留问题与下一步**：
  1. **第四 ~ 第九批已由使用者以 `2f33ac4`（`use1`）提交**（提交纪律的偏差已记入「项目快照 · 仓库状态」）；
     **本批（第十批）未提交** —— 本批只有 `AGENTS.md` 与 `docs/issues.md` 两处文档改动。
     拟提交信息：`docs: 端到端实测四步主链路并登记节 1 演示可达性（ISS-097）`。
  2. **`ISS-097` 待修**：三种方向可选 —— ① 演示脚本层面只用「短时间窗」配方（零代码）；
     ② 让执行器在电量低于阈值时真的置 `charging`（让 `BATTERY_RISK` 可达）；
     ③ 给基础数据页加「置为离线 / 故障」入口（让 `VEHICLE_UNAVAILABLE` 可达）。
     修之前建议先定「演示数据该不该包含一条常驻冲突」，否则改完又会回到「一打开就有两条冲突」的第九批问题。
  3. 实验残留：库里留了 5 张验证单（`T20261004-0001`…`0005`），其中 `0004 / 0005` 处于 `assigned`、
     占着 CAR-01 与 DRN-01。要恢复干净演示态执行 `npm run db:reset`（需整套重启 `dev:electron`）。

### 2026-10-04 — 给车辆加「人工报障」：让告警中心「派发冲突」这一节在演示里可见（第十一批，ISS-097，D-62）⏳（未提交）

- **范围与目标**：收口第十批登记的 `ISS-097`（展示可达性）。目标不是「多一个按钮」，而是让用户点名的四步流程里
  **第三步**（「告警中心对新订单的冲突进行提示」）在界面上真的看得见 —— 走**可手动触发**而不是「演示数据自带冲突」
  （后者会回到 `ISS-096`：一打开就报冲突，使用者会说「我什么都没做」）。
- **变更清单**：
  - `shared/src/base-rules.ts`：新增 `MANAGED_VEHICLE_STATUSES`（`idle` / `disabled` / `fault`）与
    `vehicleStatusConflictOf(from, to)`（`disableOccupied` / `faultRunning`）。**规则下沉到共享层**，
    主进程与 Mock 调同一个函数（D-34）—— 这是本次唯一新增的契约面。
  - `desktop/src/domain/base/vehicle.service.ts`：白名单改读共享常量；两类冲突统一由共享判定产出，
    `VEHICLE.STATE_CONFLICT` 的 **message 保持目录原话**，原因放 `detail.reason` / `detail.hint`；
    审计动作新增 `fault`（与 `disable` 分开：「坏了要修」≠「退役不用」）。
  - `desktop/src/domain/base/context.ts`：`BASE_ACTIONS.fault`。
  - `renderer/src/api/mock-base-write.ts`：删掉本地第二份白名单，改调共享规则（**消除了一个重复作者**）。
  - `renderer/src/base/form.ts`：`faultActionOf`（`idle`/`reserved` → 「标记故障」；`fault` → 「恢复可用」；
    `busy`/`disabled`/`charging`/`offline` → 不出按钮）。
  - `renderer/src/pages/BaseDataPage.tsx`：车辆行加第二颗行内按钮（与「停用 / 启用」并列，走同一个接口）。
  - **测试**：`shared/src/base-rules.test.ts`（白名单 + 冲突判定）、`desktop/src/domain/base/base.service.test.ts`
    （报障 / 恢复 / 幂等 / `busy` 被拒 / 审计动作）、`desktop/src/domain/alert/risk.service.test.ts`
    （**端到端演示路径**：派发一单 → 报障 → 再扫描，节 1 出现「车辆不可用」）、`renderer/src/base/form.test.ts`、
    `renderer/src/pages/BaseDataPage.write.test.tsx`、`renderer/src/api/mock-parity.test.ts`
    （执行中报障两边同码 + 报障/恢复成功路径两边一致）。
  - **文档**：`docs/api.md` §3.2 / §3.2.2（取值、两类冲突的 `detail.reason` 表）、
    `docs/module-M2-base-data.md` §2.1 / §6.1 / §7.1、`design.md` §4.2 车辆状态迁移表、`docs/issues.md`（ISS-097 关闭）。
- **关键设计决策**：新增 **D-62**（见「设计决策记录」）。
- **验证与测试结果**（2026-10-04）：
  - ✅ `npm run typecheck`：shared / desktop / renderer 三 workspace exit 0。
  - ✅ 定向用例：`shared/src/base-rules.test.ts` + `desktop/src/domain/base/base.service.test.ts` + `renderer/src/base/form.test.ts`
    **118 passed**；`renderer/src/api/mock-parity.test.ts` + `BaseDataPage.write.test.tsx` **58 passed**；
    `desktop/src/domain/alert/risk.service.test.ts` **9 passed**（含新增的端到端演示路径）。
  - ✅ `npx vitest run tests/docs.test.ts` 8 条通过（文档结构自检：表格块 / 围栏 / ISS 引用闭环）。
  - ✅ `npm run build`：三端通过。`npm test` 全量的 `ISS-068` 偶发超时未复测（本批定向执行，未触碰并行度）。
- **遇到的困难与解决方案**：见「困难与问题记录」2026-10-04 的第二行（message 一致性护栏）。
- **遗留问题与下一步**：
  1. **未提交**。拟提交信息：`feat(base): 车辆增加人工报障入口，让告警中心的派发冲突可见（ISS-097 / D-62）`。
  2. `ISS-097` 关闭后，节 1 五类里可达的仍是**三类**（`LATE_FINISH` 短时间窗、`BATTERY_RISK` 编辑电量、
     `VEHICLE_UNAVAILABLE` 人工报障）；`VEHICLE_OVERLAP` / `PLAN_WITHOUT_ROUTE` 仍**有意不可达**
     （前者被派发前校验挡住 —— 挡住才是对的；后者要求 `apply` 漏建路线 —— 那是缺陷不是场景）。
  3. 仍未修：`ISS-094`、`ISS-083`、`ISS-087`、`ISS-068`、`ISS-016`（`charging`/`offline` 与 `fault` 的**自动**进入仍归 M7）。
  4. 实验/演示残留：`npm run db:reset` 可恢复干净演示态（需整套重启 `dev:electron`）。
