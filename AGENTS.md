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
  - [`docs/database.md`](./docs/database.md)：SQLite 建表 DDL / 索引 / seed / 迁移规则。
  - [`docs/build-plan.md`](./docs/build-plan.md)：P1-P6 构建计划与阶段验收门。
  - [`docs/order-data-map-design.md`](./docs/order-data-map-design.md)：订单数据接入与地图生成设计（CSV 导入 / 地区目录 / 订单数据文档 / 地图联动，**设计态，尚无实现**）。
  - [`docs/architecture.md`](./docs/architecture.md)：架构图集（22 张 Mermaid，可直接导出 PPT / Word / PDF / 图片；含实现状态标记与导出命令）。
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
