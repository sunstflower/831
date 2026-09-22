# 项目构建计划（P1-P6）

> 版本：v1.1 · 状态：P1 已交付（脚本均已落地可跑）；其余阶段待评审后开工
> 关联：`design.md` §2 / §9、`docs/api.md`、`docs/database.md`、`AGENTS.md`（提交纪律）
> 本文回答「怎么把设计变成能跑的项目」：仓库形态、脚本、骨架、迁移与 seed、分阶段任务与验收门、风险。
> **文档边界**：本文件只负责「工程脚本、仓库形态、分阶段验收门」。其余事实按 [`docs/api.md`](./api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**。

## 1. 目标与非目标

目标：

1. P1 结束时本地可一键启动：`npm install` → `npm run dev:electron` 打开桌面窗口，建库 + seed 成功。
2. 每个阶段有**可执行的验收命令与期望结果**，不靠肉眼判断。
3. 渲染层可在浏览器以 Mock 模式独立开发，不被原生依赖与主进程阻塞。

非目标（本期不做）：打包分发安装包（P6 收尾再做 `build`）、CI/CD、真实设备/云端。

## 2. 开工前置条件（Pre-flight）

| 项 | 要求 | 验证 |
| --- | --- | --- |
| 设计评审 | D-02 / D-11 / D-12 确认（任务 paused 态、权限点、M4 落地口径） | AGENTS「设计决策记录」勾选（评审状态统一见 `docs/issues.md` ISS-017） |
| 仓库 | `831` 已 `git init`，文档与代码均有提交 | `git log --oneline` 可见 |
| 环境 | **Node ≥ 22.5**（`node:sqlite` 自 v22.5.0 起内置，见 D-14）、npm ≥ 10；macOS 本地开发 | `node -v` / `npm -v` |
| 原生编译 | **无**（采用 Node 内置 `node:sqlite`，见 AGENTS D-14，不需要 `@electron/rebuild` / xcode CLT） | `node -v` ≥ 22（`node:sqlite` 内置） |
| 端口 | 渲染层 dev 默认 `5173`，可通过 `VITE_PORT` 覆盖 | 无占用 |

> 版本策略：本文只给**下限**；P1 首次 `npm install` 后以 `package-lock.json` 锁定精确版本，并回写本表。

## 3. 仓库形态与脚本

采用 **npm workspaces 单体仓库**（一个根 `package.json` + 三个 workspace），理由：本地构建简单、类型共享零成本、无需跨包发布。

```text
renderer/   # React + Vite（UI / 页面态 / mock 适配器）
desktop/    # Electron 主进程 + preload + db + domain + algorithms
shared/     # 类型 / 枚举 / 错误目录 / 常量（无运行时依赖）
```

> 与 `design.md` §2.4 完全一致：这三个目录就是 npm workspaces 的三个成员（根 `package.json` 的 `workspaces` 字段配置）。

### 3.1 根脚本（**已落地**，全量清单以 `package.json` 为准）

```bash
npm run dev            # 仅渲染层：先 build shared，再 vite dev（未设 VITE_API_ADAPTER，按桥判定 → 浏览器下为 mock）
npm run dev:electron   # 先 build shared + desktop，再并发 vite dev + electron（等端口就绪后启动主进程）
npm run typecheck      # tsc --noEmit（全 workspace）
npm test               # vitest run（shared 单测 + desktop 单测 + renderer 组件测试）
npm run db:migrate     # 主进程 CLI：按序应用迁移
npm run db:seed        # 幂等 seed（演示数据）
npm run db:reset       # 删除库文件后 migrate + seed（仅开发）
npm run build          # shared/desktop（tsc）+ renderer（vite build）；打包 installer 待 P6
```

> 上表为**用途说明**，不保证与 `package.json` 逐条同步；新增/改名脚本请以 `package.json` 为准并更新本节。
>
> **注意**：`shared` 的产物 `dist/` 不进版本控制，而 `renderer` / `desktop` 在**运行时**从 `@udm/shared` 导入
> （非仅类型），因此**所有启动类脚本都必须先 `build:shared`**（`dev:electron` 还需 `build:desktop`，
> 因为它执行 `electron dist/main.js`）。遗漏时表现为「Vite 打印 ready 但页面白屏、`Failed to resolve entry`」，
> 而非明确的报错 —— 见 `docs/issues.md` ISS-034。

### 3.2 适配器开关

渲染层通过环境变量选择实现，契约完全相同（`docs/api.md` §1.1）：

| 值 | 实现 | 场景 |
| --- | --- | --- |
| `mock` | **纯内存**（`mock-data.ts` 从 `SEED_IDS` 同规则派生，无 `localStorage`） | 浏览器独立开发 / 演示 |
| `ipc` | `window.dispatchApi.invoke/on` | Electron 生产形态 |
| `http` | `fetch('/api/...')` + Bearer | 自动化契约测试（预留） |

**未显式配置 `VITE_API_ADAPTER` 时的默认值**（D-22）：按「有没有 preload 桥」判定 ——
有桥（在 Electron 里）→ `ipc`，无桥（纯浏览器）→ `mock`。**不是**一律默认 `mock`：
打包后的 Electron 用 `loadFile` 加载产物，构建时通常不带 `.env`，
若默认落 `mock` 会让桌面端**静默显示假数据**（不读 SQLite、不报错）。
该行为由 `renderer/src/api/index.test.ts` 锁死，配置项全表见 `docs/architecture.md` §11。

## 4. 骨架内容（P1 交付）

### 4.1 shared

- `src/enums.ts`：design §3.2、api §1.5 的全部枚举（唯一来源）。
- `src/types.ts`：信封、分页、DTO、领域类型（含 `DispatchSnapshot` 等算法类型）。
- `src/errors.ts`：`DomainError` 构造器 + api §2 错误码常量。
- `src/constants.ts`：默认设置值（含 M4 代价权重）、演示种子常量。

> 早期规划写作 `enums/ types/ errors/ constants/` **四个子目录**；实测为 **`src/` 下的四个扁平文件**（`shared/src/*.ts`）。

### 4.2 desktop

以下**全部位于 `desktop/src/` 下**（早期规划漏写 `src/`）：

- `main.ts`：创建窗口（`contextIsolation: true`、`nodeIntegration: false`），加载 dev URL / 打包文件。
- `../preload.cjs`：`contextBridge` 暴露最小面 `dispatchApi = { invoke, on }`，不暴露 Node。
- `ipc/router.ts`：路径 → 服务方法映射 + 会话鉴权中间件（未登录/无权限先行拦截）。
- `ipc/api.ts`：已注册路由表。
- `db/`：连接、迁移器、seed、Repository（仅主进程）。
- `services/`：会话表（内存）、事件总线（`webContents.send`）、审计、密码。
- `cli/db.ts`：`migrate` / `seed` / `reset` 命令。

### 4.3 renderer

- Vite + React Router 页面骨架：登录、监控工作台、地图、任务、调度中心、基础数据、告警、审计、设置（route 清单见 design §7.1）。
- `api/`：`apiClient` + 三个适配器；页面只依赖 `apiClient`（`renderer/src/api/index.ts` 导出，**不在 `shared/` 里**）。
- `store/`：zustand 全局态（会话 / selection / 筛选）+ 事件订阅。
- `map/`：React Flow（`@xyflow/react` v12，renderer 依赖）地图图层；结构、数据映射与性能护栏见 [`module-M6-map.md`](./module-M6-map.md)。**M6 已按 D-21 落地并通过构建与测试**（实测见该文档 §1.1 与 §11.5）；D-21 的评审归属见 `docs/issues.md` ISS-017。

## 5. 数据库迁移与 seed

1. 迁移文件：`desktop/migrations/0001_init.sql`（DDL，**实际路径**，非 `desktop/db/migrations/`）。
   演示数据一律走代码侧 seed（见 `docs/database.md` §4），**不再引入 SQL 种子文件**。
   下一个迁移是 **`0002_data_import.sql`**（四类导入数据文件，编号与命名见 `docs/database.md` §6 与 `docs/data-interfaces.md` §10；早期草案里的 `0002_seed.sql`／`0002_order_ingestion.sql` 均已作废）。
2. 迁移器：读目录内 `NNNN_*.sql` 升序，事务内执行，成功后写 `schema_version`；重复运行跳过已应用版本。
3. seed：代码侧幂等写入（固定 `seed-*` id），密码 bcrypt 运行时生成，不落明文 SQL；细节见 `docs/database.md`。
4. 库文件位置：开发期 `desktop/.data/app.db`（gitignore）；生产放用户数据目录。

## 6. 阶段任务与验收门

| 阶段 | 任务 | 验收命令 | 期望 |
| --- | --- | --- | --- |
| P1 地基 | workspaces + shared + desktop/renderer 骨架 + 迁移/seed | `npm run dev:electron` | 窗口打开、`/api/health` 返回 `db:true`；库文件生成 |
| P2 认证与主数据 | M1 + M2（服务/UI/审计/权限；M2 口径见 [`module-M2-base-data.md`](./module-M2-base-data.md)） | `npm test` + 手工走查 | 三角色登录；站点/车辆/路网 CRUD；审计可查 |
| P3 任务与地图 | M3 状态机 + M6 静态图层联动 | `npm test` + 手工走查 | 任务创建/提交；地图与列表联动 |
| P4 算法内核 | M4（按 `module-M4-dispatch.md`）+ M5 + 模拟执行器 | `npm test` | U1-U11 / S1-S8 绿；preview→apply→start 主线通 |
| P5 监控告警 | M7 + M8 + 事件推送 | `npm test` + 手工走查 | 异常→告警→接管闭环 |
| P6 收尾 | M9 查询 + M10 设置 + 演示数据与手册 + 打包 | `npm run build` | 安装包可离线启动 |

每阶段结束按 `AGENTS.md` 纪律：先补工作日志与决策，再提交。

## 7. 关键技术风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `node:sqlite` 版本下限 / Electron 内置 Node 版本差异 | 主进程启动即崩 | 实测 Electron 44.3.0 内置 Node 24.20.0、开发机 Node 25.8.2 均可用；`engines.node` 已收紧为 `>=22.5`（`node:sqlite` 自 Node v22.5.0 起可用，v22.13.0 起免 `--experimental-sqlite` 标志） |
| `node:sqlite` 在 vite-node 下无法解析（`builtinModules` 无裸名 `sqlite`） | 单元测试收集失败 | 已用 `createRequire` 惰性加载（`desktop/src/db/sqlite.ts`），并附还原条件注释 |
| 主进程与渲染层时序（dev server 未就绪） | 白屏/加载失败 | `wait-on` 等 `5173` 就绪再启 Electron；主进程失败重试一次 |
| 契约漂移（实现与 api.md 不一致） | 前后端联调返工 | shared 类型唯一来源 + 契约测试（api §1.1 信封逐字段） |
| 迁移不可重入 | 二次启动失败 | 事务 + `schema_version` + seed 幂等；`db:reset` 兜底 |
| 演示时间紧 | 功能做不完 | 严格按 P2→P4 主链路优先，统计/云能力不纳入 |

## 8. 开工清单（Checklist）

- [ ] D-02 / D-11 / D-12 评审通过
- [ ] `git init` 并提交全部文档
- [ ] 建立根 `package.json` + workspaces + `.gitignore`（`node_modules`、`.data`、`dist`）
- [ ] `shared` 枚举/类型/错误常量落地并通过 `typecheck`
- [ ] 迁移器 + `0001_init.sql` 跑通（`db:migrate`）
- [ ] seed 幂等（连续两次 `db:seed` 结果一致）
- [ ] `dev:electron` 一键启动（窗口 + health 检查）
- [ ] 首次提交前按 `AGENTS.md` 记录工作日志
