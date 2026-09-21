# AGENTS 工作记录与提交纪律

> 本文件是项目根规则文件与**协作工作日志**：任何构建/编码阶段的 git 提交，都必须先在本文件留下完整记录再提交。本文件同时记录项目状态、设计决策、困难与遗留问题。
>
> **文档边界**：本文件只负责「提交纪律、**设计决策编号（D-xx）**、历史问题原始记录、工作日志、项目快照」。
> 其余事实按 [`docs/api.md`](./docs/api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**；
> 文档索引见 [`README.md`](./README.md) 的「文档入口」表。
> 「项目快照 / 验证基线」属 §0 的**带日期实测快照**例外：写明实测日期，下次复测整段更新。

## 项目快照

- **项目**：无人物流调度管理软件（`/Users/sunsetflower/myJobs/js/831`）。
- **阶段**：**P1 地基已通 + M6 地图已实现（三层链路端到端可跑）**。代码已落地三端：
  - `shared/`：枚举 · 类型（含 `MapOverview` 系列快照契约）· **错误目录 `ERROR_CODES` 124 条**（34 运行时 + 90 导入域；**唯一登记处**，见 D-33）· 常量（含 `SEED_IDS` 演示任务/路线/告警）。
  - `desktop/`：`node:sqlite` 连接（`createRequire` 惰性加载，见下）· 迁移 · seed（含演示执行数据）· IPC Router · 会话 · 审计 · **事件总线（按会话权限过滤，D-32）** · **8 条接口**：health / auth.login / auth.logout / auth.session / settings / settings.schema / users / **map.overview**；新增 `repositories/map.repo.ts`（快照读取层）。
  - `renderer/`：**已补齐入口与全部业务代码** —— `src/main.tsx`（HashRouter，Electron `file://` 必需）、三层适配器（mock / ipc / http）、zustand store（session / selection）、路由与页面（登录 / 工作台 / 地图 / 其余 7 个占位页）、**React Flow 地图**（`map/` 下 model / nodes / edges / hooks / stage / style 全套）。
  - `npm run build` 与 `npm test` 均已通过（详见「验证基线」）。
- **形态**：本地优先桌面应用 —— Electron 主进程（SQLite + 领域服务 + 算法）+ React 渲染层 + 三层服务适配器（IPC / 本地 HTTP / Mock）。
- **技术栈（`node_modules` 实测版本）**：Electron 44.3.0 · React / React-DOM 18.3.1 · **`@xyflow/react` 12.11.6（仅 renderer；见 D-21）** · react-router-dom 6.30.6 · **Vite 6.4.3（renderer 独立安装）+ Vite 5.4.21（根，Vitest 侧）** · TypeScript 5.9.3 · **Node 内置 `node:sqlite`（见 D-14，非 better-sqlite3）** · zustand 5.0.15（`@xyflow/react` 另带嵌套 zustand 4.5.7，两者并存、互不影响）· Vitest 2.1.9 · bcryptjs 2.4.3 · @testing-library/react 16.3.3 · **@testing-library/jest-dom 6.10.0** · jsdom 25.0.1 · concurrently 9.2.4 · wait-on 8.0.5；运行时 Node v25.8.2 / npm 11.11.1。
- **仓库状态**：已完成 `git init`，当前基线提交为 `ab9a762`（`fix(desktop): 事件总线按会话权限过滤…`；历史 `29143cc` → `7dcc211` → `66fa7d2` → `3e33de7` → `121af4d` → `ab9a762`）；工作区有多份未提交改动（13 份文档 + `.env.example` + `shared/src/errors.ts` + `package.json`）；`package-lock.json` 已纳入版本控制。开发库 `desktop/.data/app.db` 被 `.gitignore` 的 `.data/` / `*.db` 排除。**未提交改动清单见 `docs/issues.md` ISS-029。**
- **验证基线（2026-09-21 复测；P1 收口会话建立，「文档统一」会话复跑门禁，三端结论未变）**：
  - ✅ `npm test`：**18 个套件 / 110 个用例全通过**（本轮新增 `errors.catalog.test.ts` 5 条、`event-bus.test.ts` 8 条、`mock-parity.test.ts` 3 条）。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 全部 exit 0。
  - ✅ `npm run build`：三端全通；renderer 产物 `index.html` 0.42 kB + CSS 24.45 kB（gzip 4.51 kB）+ JS 394.11 kB（gzip 128.75 kB）。
  - ✅ 错误码闭环：`ERROR_CODES` **124 条唯一**；`docs/api.md` 与 `docs/data-interfaces.md` 中出现的 code **0 处未登记**（由 `errors.catalog.test.ts` 持续断言）。
  - ✅ 权限过滤行为（单测覆盖）：未登录窗口收到 0 条登记过权限的事件；monitor 只收到 `alert.created`；dispatcher 收到 task/vehicle/alert；`map.updated` 仍放行；`event_log` 照写不误。
  - ✅ **`npm run dev` / `npm run dev:electron` 干净检出可启动**（2026-09-21 修 ISS-034）：两个脚本已前置
    `build:shared`（`dev:electron` 另加 `build:desktop`），不再要求 `dist/` 预先存在。实测：删掉 `shared/dist`
    与 `desktop/dist` 后 `npm run dev` 的 `AppLayout.tsx` 返回 200 且含 `hasPermission`、预转换错误 0 条；
    `dev:electron` 无障碍树实测窗口标题/URL/`12 节点 / 34 边 / 3 站点 / 3 车辆`/图层面板 7 项，非白屏。
  - ✅ 全新数据库引导：删除 `desktop/.data/` 后 `db:migrate` 应用 `0001` 并 seed 成功，`db:seed` 复跑幂等。

- **历史基线（2026-09-20 实测，渲染层与 M6 落地会话）** —— 保留供对照，勿当作最新结果：
  - ✅ `npm test`（当时）：15 个套件 / 94 个用例全通过。
  - ✅ `npm run db:migrate` / `db:seed`：迁移幂等；seed 写入 nodes 12 · edges 34 · sites 3 · vehicles 3 · templates 2 · users 3 · settings 9 · tasks 1 · routes 1 · alerts 1（演示执行数据）。
  - ✅ `npm run dev:electron`：Electron 主进程成功启动、打开 `desktop/.data/app.db`、迁移 `none`、seed 幂等（各表新增 0）。
  - ✅ **Electron 端到端（真实 `ipc` 适配器 + 真实 SQLite）**：登录 → 地图页渲染出 **20 节点 / 39 边（34 路网 + 5 路线高亮）/ 3 站点 / 3 车辆 / 2 任务端点 / 5 条路线标签 / 20 个迷你图方块**，与 seed 完全一致；无控制台错误。
  - ✅ **生产形态 `file://`**：无 `.env` 时**自动选中 `ipc` 适配器**（靠 preload 桥判定，D-22），渲染结果与 dev 一致。
  - ✅ **浏览器 Mock 形态**：渲染结果与 ipc 形态**逐项相同**（20/39/5/20），证明三层适配器行为一致。
  - ✅ **交互实测**：点选车辆 → 选中态与图例正确；点空白清空；图层开关关掉「路网节点」→ 节点 20→8、边 39→0，恢复后回到 20/39 且**选中态不丢**。
  - ✅ **CSS 修复前后对比（真实 Electron 取值）**：路线高亮边 `stroke` 由 `rgb(177,177,183)`/`1px` 修正为 `rgb(56,189,248)`/`4px`；路网边修正为 `rgb(71,85,105)`/`1.5px`；节点选中 `box-shadow` 由 `none` 修正为 `rgba(56,189,248,0.55) 0 0 0 3px`；迷你图背景由默认浅色修正为 `rgb(30,41,59)`。
  - ✅ `docs/architecture.md` 23 张 Mermaid 全部渲染成功（`npx -y @mermaid-js/mermaid-cli`，exit 0）。

- **文档**：清单见 [`README.md`](./README.md) 的「文档入口」表 —— 该表是**文档索引的唯一权威来源**（本文件与 `design.md` §10.2 不再维护副本，副本正是历史漂移成因，见 `docs/issues.md` ISS-032）。
  - 与开发最相关的三份：[`design.md`](./design.md)（需求条目 `Req-*` / 状态机 / 数据模型字段语义）、[`docs/api.md`](./docs/api.md)（接口契约 / 错误码 / 事件，其 **§0** 是「每个事实由哪份文档负责」的总表）、[`docs/issues.md`](./docs/issues.md)（问题清单，**每次提交前必须同步**）。
  - 本文件负责：项目快照、代码现状地图、提交纪律、**设计决策编号（D-xx）**、历史问题原始记录与工作日志。

## 代码现状地图（进入开发前先看这里）

| 位置 | 已有内容 | 缺口 |
| --- | --- | --- |
| `shared/src/` | `enums.ts`（角色/状态/优先级/错误原因/20 个权限点 + `ROLE_PERMISSIONS`）、`types.ts`（信封、分页、DTO、调度预览类型、**`MapOverview` 快照契约 8 个接口**）、`errors.ts`（**124 条**：34 运行时 + 90 导入域；**唯一登记处**，D-33。含 `DomainError`/`ok`/`fail`/`fromError`）、`errors.catalog.test.ts`（命名/severity/文档闭环断言）、`constants.ts`（`APP_NAME`、分页默认、`DISPATCH_COST_WEIGHTS`、`MIN_BATTERY_PERCENT`、`SEED_ACCOUNTS`/`SEED_IDS`（含演示任务/路线/告警 id）、`SETTINGS_SCHEMA` 9 项） | 业务实体完整模型（task/site/vehicle 的 CRUD DTO）、`DispatchSnapshot` 等算法类型、M2 之后模块的 DTO |
| `desktop/src/db/` | `index.ts`（`DatabaseSync` 连接、WAL/外键/busy_timeout、`run`/`get`/`all`/`tx`、`defaultDbPath`）、**`sqlite.ts`（`createRequire` 惰性加载 `node:sqlite`，规避 vite-node 解析缺陷）**、`migrate.ts`（按序单事务 + `schema_version` 幂等）、`seed.ts`（4×3 路网 12 节点/34 边、3 站点、3 车辆、2 模板、3 账号、9 设置、**1 演示任务 + 1 路线 + 1 告警，并把 AGV-01 置忙**）、`repositories/`（users / settings / audit / **map**） | M2/M3/M4/M5/M7/M8 各模块 Repository；seed 的 `restrictions`/`vehicle_tracks` 仍为空 |
| `desktop/src/ipc/` | `router.ts`（注册表 + 鉴权/权限前置 + `traceId` + 统一信封兜底）、`api.ts`（**8 条路由**，`/api/health`、`/api/auth/login` 为 public） | 其余 M2-M10 接口；分页/参数校验工具仍内联在 `api.ts` |
| `desktop/src/services/` | `auth.ts`（登录/锁定策略）、`password.ts`（bcryptjs）、`session.ts`（内存会话）、`audit.ts`（审计写入）、`event-bus.ts`（**按会话权限过滤后**推送领域事件，D-32；含 `EVENT_PERMISSIONS`）、`event-bus.test.ts` | 领域服务层（任务/调度/路线/告警/监控）整体未开工；**无持续产生 `vehicle.changed` 的执行器**（故车辆静止） |
| `desktop/src/cli/db.ts` | `migrate` / `seed` / `reset`（reset 删 `-wal`/`-shm` 后重建） | — |
| `desktop/preload.cjs` | `window.dispatchApi.invoke/on`（`udm:invoke` / `udm:event`，contextIsolation 开启） | — |
| `renderer/src/` | **全套已落地**：`main.tsx`（HashRouter，Electron `file://` 必需）、`api/`（client 契约 + `ipc`/`http`/`mock` 三层适配器 + `types.ts` 再导出 shared + `mock-data.ts` 与 seed 同源 + **`mock-parity.test.ts` 锁死三层错误码一致**）、`store/`（session / selection）、`app/`（路由 + `RequireSession`）、`components/AppLayout`、`pages/`（登录 / 工作台 / 占位页）、`map/`（model 6 + nodes 5 + edges 2 + hooks 4 + stage + style）、`test/dom-stubs.ts` | 任务/调度/告警等业务页仍为占位；地图缺轨迹回放、订单端点图层；无跨包 E2E 测试 |
| `tests/setup.ts` | 全局 setup（一行 `@testing-library/jest-dom/vitest`，依赖已补齐） | ✅ 已解锁：18 套件 / 110 用例全通过；jsdom 所需的 `ResizeObserver`/`matchMedia` stub 放在 `renderer/src/test/dom-stubs.ts` 里按需引入，**不进全局 setup**（否则 node 环境的 desktop 用例会被污染） |

> 测试现状：**18 个测试文件 / 110 用例全通过** —— `shared/`（enums、errors、**errors.catalog**）+ `desktop/`（db、auth、router、map.repo、**services/event-bus**）+ `renderer/`（api/index、api/mock-data、**api/mock-parity**、map/model 的 ids/projection/structural/motion/toFlow、map/MapView.tsx、map/hooks/useVehicleMotion）。

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
| 2026-09-20 | `@xyflow/react` 自带 `zustand@4.5.7`，与项目 `zustand@5.0.15` 并存两份 | React Flow 的 `dependencies` 固定 `zustand ^4.4.0`，npm 无法将其提升为根的单版本 | **属正常现象**，两者互不干扰（React Flow 只用自己那份）；排查版本问题需注意 `renderer/node_modules/@xyflow/react/node_modules/zustand`。已记入文档，与既有「两套 Vite」同类 |
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
  2. **本次改动尚未提交**：工作区含 13 份文档 + `.env.example` + `shared/src/errors.ts`（1 行）。
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

### 2026-09-20 — 地图渲染选型改为 React Flow + 新增 M6 模块方案文档 ⏳（未提交）

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

### 2026-09-20 — 修复测试阻塞 + 实现渲染层与 React Flow 地图（P1 地基打通 · M6 落地）⏳（未提交）

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
