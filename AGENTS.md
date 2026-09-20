# AGENTS 工作记录与提交纪律

> 本文件是项目根规则文件与**协作工作日志**：任何构建/编码阶段的 git 提交，都必须先在本文件留下完整记录再提交。本文件同时记录项目状态、设计决策、困难与遗留问题。

## 项目快照

- **项目**：无人物流调度管理软件（`/Users/sunsetflower/myJobs/js/831`）。
- **阶段**：**P1 地基进行中（渲染层尚未接通）**。文档（设计 / 接口 / M4 开发详档 / 数据库 / 构建计划 / 订单接入设计）已成稿；代码已落地 `shared/`（枚举 · 类型 · 错误目录 · 常量，错误码 34 条）与 `desktop/`（`node:sqlite` 连接 · 迁移 · seed · IPC Router · 会话 · 审计 · 事件总线 · 7 条接口：health / auth.login / auth.logout / auth.session / settings / settings.schema / users）；`renderer/` 仅有 Vite 配置、`index.html` 与 `src/vite-env.d.ts`，**缺 `src/main.tsx` 及业务页面、适配器、store、路由**，故 Vite 能启动但拿不到入口模块，`npm run build` 在 renderer 阶段失败。
- **形态**：本地优先桌面应用 —— Electron 主进程（SQLite + 领域服务 + 算法）+ React 渲染层 + 三层服务适配器（IPC / 本地 HTTP / Mock）。
- **技术栈（`node_modules` 实测版本）**：Electron 44.3.0 · React / React-DOM 18.3.1 · react-router-dom 6.30.6 · **Vite 6.4.3（renderer 独立安装）+ Vite 5.4.21（根，Vitest 侧）** · TypeScript 5.9.3 · **Node 内置 `node:sqlite`（见 D-14，非 better-sqlite3）** · zustand 5.0.15 · Vitest 2.1.9 · bcryptjs 2.4.3 · @testing-library/react 16.3.3 · jsdom 25.0.1 · concurrently 9.2.4 · wait-on 8.0.5；运行时 Node v25.8.2 / npm 11.11.1。
- **仓库状态**：已完成 `git init`，当前基线提交为 `29143cc`（`first commit`）；工作区有两处未提交改动 —— 本文件修改 + 未跟踪的 `docs/order-data-map-design.md`；`package-lock.json` 已纳入版本控制。开发库 `desktop/.data/app.db` 已由本次 `db:migrate` 创建（此前不存在，且被 `.gitignore` 的 `.data/` / `*.db` 排除）。
- **验证基线（2026-09-14 复测，20:16-20:18）**：
  - ✅ `npm run db:migrate`：应用迁移 `0001`，seed 写入 nodes 12 · edges 34 · sites 3 · vehicles 3 · templates 2 · users 3 · settings 9，生成 `desktop/.data/app.db`。
  - ✅ `npm run db:seed`：幂等复跑，各表新增均为 0。
  - ✅ `npm run typecheck`：shared / desktop / renderer 三个 workspace 各自 exit 0。
  - ✅ `npm run dev --workspace renderer`：Vite 6.4.3 在 107ms 内就绪并响应 `http://localhost:5173/`。
  - ❌ `npm test`：5 个套件全部在收集前失败，`tests/setup.ts` 无法解析 `@testing-library/jest-dom/vitest`（未安装、未在 package.json 声明，lock 中亦无条目）；当前 0 测试真正执行。
  - ❌ `npm run build`：`build:shared` / `build:desktop` 通过；`build:renderer` 失败 —— `[vite:build-html] Failed to resolve /src/main.tsx from renderer/index.html`。
  - ⚠️ dev server 对 `/src/main.tsx` 返回 SPA 兜底的 `index.html`（200 + `text/html`）而非 JS 模块，与上一条同因：入口文件缺失。
  - ✅ 数据模型实测：`0001_init.sql` 建 17 张业务表 + `schema_version`，18 条索引，与 `docs/database.md` §2 / §3 一致。
- **文档**：
  - [`design.md`](./design.md)：设计文档（架构 / 模块目标 / 要求规范 / 数据模型 / 状态机 / 算法）。
  - [`docs/api.md`](./docs/api.md)：接口文档（全量契约 / 错误码 / 事件）。
  - [`docs/module-M4-dispatch.md`](./docs/module-M4-dispatch.md)：模块开发文档（调度引擎 M4，面向开发）。
  - [`docs/module-M6-map.md`](./docs/module-M6-map.md)：模块开发文档（地图渲染 M6，React Flow 方案；含选型实测数据、数据映射、Handle 策略、性能护栏、测试与打包口径，**方案待评审**）。
  - [`docs/database.md`](./docs/database.md)：SQLite 建表 DDL / 索引 / seed / 迁移规则。
  - [`docs/build-plan.md`](./docs/build-plan.md)：P1-P6 构建计划与阶段验收门。
  - [`docs/order-data-map-design.md`](./docs/order-data-map-design.md)：订单数据接入与地图生成设计（CSV 导入 / 地区目录 / 订单数据文档 / 地图联动，**设计态，尚无实现**）。
  - [`docs/architecture.md`](./docs/architecture.md)：架构图集（23 张 Mermaid，可直接导出 PPT / Word / PDF / 图片；含实现状态标记与导出命令）。
  - [`docs/data-interfaces.md`](./docs/data-interfaces.md)：数据文件接口规范（订单 CSV / 仿真地图 / 车辆参数 / 算法配置的导入契约 + 统一导入管线，**草案，调研中**）。
  - [`docs/requirement-raw.md`](./docs/requirement-raw.md)：原始需求存档。
  - [`README.md`](./README.md)：项目说明。

## 代码现状地图（进入开发前先看这里）

| 位置 | 已有内容 | 缺口 |
| --- | --- | --- |
| `shared/src/` | `enums.ts`（角色/状态/优先级/错误原因/20 个权限点 + `ROLE_PERMISSIONS` 映射）、`types.ts`（信封、分页、DTO、调度预览类型）、`errors.ts`（`ERROR_CODES` 34 条 + `DomainError`/`ok`/`fail`/`fromError`）、`constants.ts`（`APP_NAME`、分页默认、`DISPATCH_COST_WEIGHTS`、`MIN_BATTERY_PERCENT`、`SEED_ACCOUNTS`/`SEED_IDS`、`SETTINGS_SCHEMA` 9 项） | 业务实体类型（task/site/vehicle/route 完整模型）、`DispatchSnapshot` 等算法类型、M2 之后模块的 DTO |
| `desktop/src/db/` | `index.ts`（`DatabaseSync` 连接、WAL/外键/busy_timeout、`run`/`get`/`all`/`tx`、`defaultDbPath`）、`migrate.ts`（按序单事务 + `schema_version` 幂等）、`seed.ts`（4×3 网格路网 12 节点 / 34 边、3 站点、3 车辆、2 模板、3 账号、9 设置）、`repositories/`（users / settings / audit） | M2/M3/M4/M5/M6 各模块 Repository；seed 仅覆盖演示最小集 |
| `desktop/src/ipc/` | `router.ts`（注册表 + 鉴权/权限前置校验 + `traceId` + 统一信封兜底）、`api.ts`（7 条路由，其中 `/api/health`、`/api/auth/login` 为 public） | 其余 M2-M10 接口；分页/参数校验工具仍内联在 `api.ts` |
| `desktop/src/services/` | `auth.ts`（登录 / 锁定策略）、`password.ts`（bcryptjs）、`session.ts`（内存会话）、`audit.ts`（审计写入）、`event-bus.ts`（`webContents` 推送领域事件） | 领域服务层（任务/调度/路线/告警/监控）整体未开工 |
| `desktop/src/cli/db.ts` | `migrate` / `seed` / `reset`（reset 删 `-wal`/`-shm` 后重建） | — |
| `desktop/preload.cjs` | `window.dispatchApi.invoke/on`（`udm:invoke` / `udm:event`，contextIsolation 开启） | — |
| `renderer/` | `index.html`（引用不存在的 `/src/main.tsx`）、`vite.config.ts`（`base: './'`、端口 `VITE_PORT`、严格端口）、`src/vite-env.d.ts` | **`src/main.tsx` 及全部业务代码**：适配器（mock/ipc/http）、store、路由、页面、地图图层 |
| `tests/setup.ts` | 全局 setup（当前唯一内容是一行 `@testing-library/jest-dom/vitest`） | 该依赖缺失导致全部套件失败；无跨包集成/E2E 测试 |

> 测试现状：现有 5 个测试文件（`shared/src/enums.test.ts`、`shared/src/errors.test.ts`、`desktop/src/db/db.test.ts`、`desktop/src/ipc/router.test.ts`、`desktop/src/services/auth.test.ts`）内容已写好，只因 setup 依赖缺失而全部无法收集；`renderer/` 目前 0 个测试文件。

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
4. 在本文件「工作日志」**追加一条完整记录**，必须包含：
   - 日期与标题；
   - 本次范围与目标（对应阶段/模块/需求条目）；
   - 变更清单（新增/修改文件、关键改动）；
   - 关键设计决策（记编号并同步到「设计决策记录」，如新增则编新号）；
   - 验证与测试结果（命令 + 结果，若未跑要写明原因）；
   - 遇到的困难与解决方案（若有，同步「困难与问题记录」）；
   - 遗留问题与下一步。
5. 确认 `docs` 与实现一致（接口、枚举、状态机若变化必须回写文档）。
6. 只有完成上述步骤后才允许执行 `git commit`；commit message 使用 `类型(模块): 摘要`，如 `feat(dispatch): apply 派发生效流程`。

### 禁止项

- 禁止在未记录到本文件的情况下直接提交代码。
- 禁止为了「先跑通」绕过状态机校验、审计留痕或文档同步。
- 禁止引入与设计冲突的新枚举/新状态而不更新 `design.md` 与 `docs/api.md`。
- 禁止把密钥、真实设备地址等敏感信息写入任何文档或代码。

## 设计决策记录

| 编号 | 决策 | 理由 / 备注 |
| --- | --- | --- |
| D-01 | 技术栈定为 Electron + React + SQLite 的本地优先桌面应用，三层适配器统一契约 | 匹配需求文档 2.2；渲染层可独立 Mock 运行 |
| D-02 | 任务状态在原始 7 态上显式增加 `paused`（running 的暂停位不做隐式字段） | 保证状态机迁移可显式校验、UI/日志清晰 |
| D-03 | 算法层纯函数 + 输入快照（DispatchSnapshot），预览不落业务库 | 满足「算法输出不污染业务数据、先预览后生效」 |
| D-04 | 路线/计划版本化：apply 才写 `dispatch_plans` 与 `routes`，旧计划置 superseded 不删除 | 可对比、可复核、可回放 |
| D-05 | 坐标统一平面 `{x,y}` 米制，禁止内部混用经纬度 | 简化离线演示；二期再做真实地图转换层 |
| D-06 | SQLite 仅主进程访问，渲染层永不直连 | 数据一致性 + 权限边界 |
| D-07 | 删除策略：站点/车辆/节点/边一律软删（disabled），草稿任务可物理删除 | 保留审计与引用完整性 |
| D-08 | 权限校验双轨制：前端隐藏 + 主进程服务端强制 | 防绕过 |
| D-09 | 告警五类 + 去重窗口 + 状态机（new→acknowledged→processing→resolved→archived） | 满足来源/级别/时间/对象/状态基线 |
| D-10 | 执行流首期用「本地模拟执行器」，二期以真实协议替换执行器且不改上层契约 | 先闭环再真实设备 |
| D-11 | 权限点 `dispatch:read`（调度日志只读）与 `execution:start`（开始执行）在接口文档补充并生效 | 便于 dispatcher 自查调度记录并启动执行（待评审确认） |
| D-12 | M4 落地口径：代价权重 P4 用常量不进设置表；preview 输入规模限制 taskIds≤50、车辆≤30；apply 用「条件 UPDATE 当乐观锁」防并发双派 | 控制匈牙利复杂度与并发一致性；二期再迁移权重到系统设置 |
| D-13 | 工程形态采用根级 npm workspaces（`shared/ desktop/ renderer/`，与 design §2.4 一致）；适配器由 `VITE_API_ADAPTER=mock / ipc / http` 切换；迁移单事务 + `schema_version` 幂等，开发库固定 `desktop/.data/app.db` | 本地一键构建、类型零成本共享；渲染层不被原生依赖阻塞 |
| D-14 | 数据库实现采用 Node 内置 `node:sqlite` `DatabaseSync`，不引入 better-sqlite3 | 与当前 Node/Electron 运行时及零原生额外依赖目标一致；如更换驱动必须同步 `desktop/src/db/index.ts`、迁移/事务测试与构建文档 |
| D-15 | 订单接入引入独立「地区目录」（`regions` / `region_aliases` / `region_dataset_versions`），不复用业务 `sites` 承担外部地址别名；匹配优先级为「标准编码 → 规范化名称 → 别名 → 归一化唯一命中」，多候选/无候选一律进失败明细，禁止自动猜测 | 外部地址别名数量与语义远多于业务站点；匹配结果需可复核（保存 `inputValue`/`matchType`/`confidence`/`datasetVersion`）。见 `docs/order-data-map-design.md` §3 |
| D-16 | CSV 导入按 `contentSha256 + mappingVersion` 幂等，重复上传默认不重复建任务；导入分「预检预览（零副作用）+ 确认导入」两步，单行失败不回滚其它合法行，仅批次级系统错误整体回滚 | 满足「先预览后生效」与部分成功反馈；避免重复导入污染任务表。见 `docs/order-data-map-design.md` §2/§4.3 |
| D-17 | 四类数据文件（订单 CSV / 仿真地图 / 车辆参数 / 算法配置）共用一套导入契约：统一 JSON 信封 `schemaVersion+kind+meta+data`、统一 `ImportIssue` 错误模型、统一 `mode`（validateOnly/merge/replace/appendOnly）与幂等键 `contentSha256+schemaVersion+mappingVersion+targetScope` | 管线与错误模型完全一致，前端只需一套导入向导；避免四套各自为政的导入语义。见 `docs/data-interfaces.md` §2。**待评审** |
| D-18 | 文件内一律用业务 `code` 引用、不使用数据库 ID；引用必须能在同一文件内解析（`merge` 模式可放宽为库内解析） | ID 由系统生成，外部文件无法预知；用 code 才能让地图/车队文件自洽、可手写、可 diff。见 `docs/data-interfaces.md` §4.2 |
| D-19 | 车辆参数文件**只承载物理参数与服务能力**，禁止出现运行态字段（status/x/y/currentNodeId/battery/loadKg）；出现即报错阻断，不静默忽略 | 静默忽略会让使用者误以为配置生效；运行态由调度与执行器独占管理。见 `docs/data-interfaces.md` §5.1 |
| D-20 | 算法配置以「导入型配置集 + 版本化（active/superseded）」落地，不接管运行时 `settings` 热更新；与 `settings` 重叠项以 `settings` 优先并给 info 提示 | 兼顾 D-12（P4 权重走常量）与仿真可复现诉求；不静默覆盖用户显式设置过的项。见 `docs/data-interfaces.md` §6.4 |
| D-21 | M6 地图渲染改用 **React Flow（`@xyflow/react` v12，仅 renderer 依赖）** 替换原「自研 SVG/Canvas 平面图层」；`map/overview` 为画布唯一数据入口；地图只渲染路线不自行搜索路径；车辆位置以事件为权威、插值仅补帧且禁止外推；图层开关用 `hidden` 而非过滤元素 | React Flow 是节点/边图渲染器，与 D-05 的平面 `{x,y}` 米制路网模型天然匹配，且视口/命中/标签/箭头等均为其成熟能力，省去自研；**M6 尚未实现，属零迁移成本替换**。实测：Vite 6 构建通过、体积 +187 KB（gzip +61 KB）、产物无 Worker/WASM/动态 import、Electron `loadFile` 正常渲染、2000 节点+3910 边 20 Hz 刷新仍 60 fps。见 `docs/module-M6-map.md`。**待评审** |

## 困难与问题记录

| 日期 | 问题现象 | 原因分析 | 解决/状态 |
| --- | --- | --- | --- |
| 2026-09-07 | 原始需求文档落在误建目录 `/Users/sunsetflower/myJobs/js/831:n`（文件名带冒号） | 建目录时误输入 `:n` | 已迁移至本仓库 `docs/requirement-raw.md` 并删除误建目录 |
| 2026-09-07 | 使用 `apply_patch` 写入大段中文 Markdown 时偶发「空行无补丁前缀」报错 | 空行缺少 `+` 前缀，补丁原子回滚 | 已按行加前缀分段写入；后续大文件改动沿用分段写入法 |
| 2026-09-14 | `npm test` 的 5 个测试套件均在收集前失败 | `tests/setup.ts` 引用了 `@testing-library/jest-dom/vitest`，但依赖中未安装或未声明 | 当前测试基线记录为失败；补齐依赖后重跑全量测试，并评估是否将 setup 拆为 renderer 专用 |
| 2026-09-14 | renderer 没有 `src/main.tsx` | 只有 Vite 壳层文件，`index.html` 已指向不存在的入口 | P1 下一步补 React 入口、适配器与最小健康页，再验证 `npm run dev`、`npm run build` |
| 2026-09-14 | `design.md` §2.3 仍写作 `better-sqlite3`，与实现及 D-14 不一致 | 文档阶段选型未随 P1 实现更新 | 后续同步 `design.md`、`docs/database.md` 与 README，统一为 Node 内置 `node:sqlite` |
| 2026-09-14 | `docs/build-plan.md` §2 前置条件与 §7 风险表仍以 `better-sqlite3` + `@electron/rebuild` 为前提 | 同上，构建计划未随 D-14 更新 | 后续把两条改为「无原生编译依赖」，并把「ABI 不匹配」风险替换为 `node:sqlite` 相关风险（如 Node 版本下限、Electron 内置 Node 版本） |
| 2026-09-14 | `renderer/` 同时存在嵌套 `node_modules`（Vite 6.4.3），根 `node_modules` 为 Vite 5.4.21 | renderer 依赖未完全提升；两套 Vite 并存 | 属正常 workspaces 现象，但需注意：`renderer/vite.config.ts` 由 Vite 6 执行，根 `vitest.config.ts` 由 Vite 5 执行；排查构建/测试问题时要区分版本 |
| 2026-09-14 | `npm run build` 在 renderer 阶段失败，`npm run dev` 看似正常但拿不到入口 | `renderer/index.html` 引用 `/src/main.tsx`，该文件不存在；dev server 用 SPA 兜底返回 `index.html`，被误判为 200 成功 | 已记录为真实基线；P1 补齐 `src/main.tsx` 后重跑 `npm run build` 与浏览器冒烟 |
| 2026-09-14 | `npm run dev:electron` 端到端链路从未验证 | renderer 无入口，Electron 加载 `http://localhost:5173` 必然白屏 | 待 renderer 入口 + `ipc` 适配器就位后验证；验证前不得声称桌面端可用 |
| 2026-09-15 | 能耗估算缺乏量纲正确的模型：代码注释中出现 `kmToWh(总里程)`，把「里程」直接当「耗电」 | 设计阶段只有「按里程估算」一句，未定义单位与电池容量口径 | 已在 `docs/data-interfaces.md` §5.4 固定为「每公里耗电 Wh × 里程」并引入 `batteryCapacityWh`；缺容量时退化为百分比近似并给 warning。实现 M4 时需按此口径改写 |
| 2026-09-15 | 算法配置存在两处可改同一参数的隐患（`settings` 表 vs 导入型配置集） | D-12 决定权重走常量、D-20 引入配置集，二者边界未定义 | 已定为「重叠项以 `settings` 优先 + info 提示」（`docs/data-interfaces.md` §6.4）；**待评审** |
| 2026-09-15 | 导入进度无承载通道：现有事件总线仅有 `task.changed` 等业务事件，不适合承载批次进度 | 导入为长耗时操作，IPC 默认等待不足 | 记为待评审问题 Q6（倾向先轮询 `GET /api/imports/{id}`），未擅自新增事件名 |
| 2026-09-20 | Chrome 直接打开 `file://` 产物时 React Flow 不渲染，一度疑似打包缺陷 | Chromium 以 CORS 规则拦截 `file://` 下的 ES module 脚本；用最小复现（纯 `type="module"` 脚本 BLOCKED、同内容的传统 `<script src>` 正常）确认与 React Flow 无关 | **已排除**：真实 Electron 44 用 `loadFile()` 实测渲染正常（视口/节点/边/边路径 DOM 齐全）。验收请用 `dev:electron` 或 `vite preview`，不要用 Chrome 开 `file://`。兜底为单文件 IIFE 构建（实测在 `file://` 下可渲染）。见 `docs/module-M6-map.md` §11 |
| 2026-09-20 | jsdom 中 `render(<ReactFlow/>)` 直接抛 `ReferenceError: ResizeObserver is not defined` | React Flow 依赖 `ResizeObserver` 测量节点尺寸，jsdom 未实现该 API | 已给出最小 stub（`ResizeObserver` + `matchMedia`）并实测通过；但**必须先修复 `tests/setup.ts` 的既有依赖缺失**，否则新增用例同样无法收集。见 `docs/module-M6-map.md` §10.1 |
| 2026-09-20 | `@xyflow/react` 自带 `zustand@4.5.7`，与项目 `zustand@5.0.15` 并存两份 | React Flow 的 `dependencies` 固定 `zustand ^4.4.0`，npm 无法将其提升为根的单版本 | **属正常现象**，两者互不干扰（React Flow 只用自己那份）；排查版本问题需注意 `renderer/node_modules/@xyflow/react/node_modules/zustand`。已记入文档，与既有「两套 Vite」同类 |
| 2026-09-15 | 迁移编号可能冲突：`order-data-map-design.md` 建议 `0002_order_ingestion.sql`，`data-interfaces.md` 建议 `0002_data_import.sql` | 两份设计分别编号，均未落地 | **已解决**：统一为 `0002_data_import.sql`，`0002_order_ingestion.sql` 作废（见本文件 Q7 与两文档去重说明） |

## 工作日志

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
