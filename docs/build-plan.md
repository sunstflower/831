# 项目构建计划（P1-P6）

> 版本：v1.0 · 状态：待评审后开工
> 关联：`design.md` §2 / §9、`docs/api.md`、`docs/database.md`、`AGENTS.md`（提交纪律）
> 本文回答「怎么把设计变成能跑的项目」：仓库形态、脚本、骨架、迁移与 seed、分阶段任务与验收门、风险。

## 1. 目标与非目标

目标：

1. P1 结束时本地可一键启动：`npm install` → `npm run dev:electron` 打开桌面窗口，建库 + seed 成功。
2. 每个阶段有**可执行的验收命令与期望结果**，不靠肉眼判断。
3. 渲染层可在浏览器以 Mock 模式独立开发，不被原生依赖与主进程阻塞。

非目标（本期不做）：打包分发安装包（P6 收尾再做 `build`）、CI/CD、真实设备/云端。

## 2. 开工前置条件（Pre-flight）

| 项 | 要求 | 验证 |
| --- | --- | --- |
| 设计评审 | D-02 / D-11 / D-12 确认（任务 paused 态、权限点、M4 落地口径） | AGENTS「设计决策记录」勾选 |
| 仓库 | `831` 已 `git init`，首条提交包含全部文档 | `git log --oneline` 可见 |
| 环境 | Node ≥ 20（LTS）、npm ≥ 10；macOS 本地开发 | `node -v` / `npm -v` |
| 原生编译 | `better-sqlite3` 需匹配 Electron ABI（`@electron/rebuild`）；xcode CLT 可用 | `xcode-select -p` |
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

### 3.1 根脚本（计划）

```bash
npm run dev            # 仅渲染层：vite dev，VITE_API_ADAPTER=mock
npm run dev:electron   # 并发：vite dev + electron（等端口就绪后启动主进程）
npm run typecheck      # tsc --noEmit（全 workspace）
npm test               # vitest run（shared 单测 + desktop 单测 + renderer 组件测试）
npm run db:migrate     # 主进程 CLI：按序应用迁移
npm run db:seed        # 幂等 seed（演示数据）
npm run db:reset       # 删除库文件后 migrate + seed（仅开发）
npm run build          # typecheck + vite build + electron-builder（P6 启用）
```

### 3.2 适配器开关

渲染层通过环境变量选择实现，契约完全相同（`docs/api.md` §1.1）：

| 值 | 实现 | 场景 |
| --- | --- | --- |
| `mock` | 内存 + localStorage 种子数据 | 浏览器独立开发 / 演示（默认） |
| `ipc` | `window.dispatchApi.invoke/on` | Electron 生产形态（`dev:electron` 强制） |
| `http` | `fetch('/api/...')` + Bearer | 自动化契约测试（预留） |

## 4. 骨架内容（P1 交付）

### 4.1 shared

- `enums/`：design §3.2、api §1.5 的全部枚举（唯一来源）。
- `types/`：信封、分页、DTO、领域类型（含 `DispatchSnapshot` 等算法类型）。
- `errors/`：`DomainError` 构造器 + api §2 错误码常量。
- `constants/`：默认设置值（含 M4 代价权重）、演示种子常量。

### 4.2 desktop

- `main.ts`：创建窗口（`contextIsolation: true`、`nodeIntegration: false`），加载 dev URL / 打包文件。
- `preload.ts`：`contextBridge` 暴露最小面 `dispatchApi = { invoke, on }`，不暴露 Node。
- `ipc/router.ts`：路径 → 服务方法映射 + 会话鉴权中间件（未登录/无权限先行拦截）。
- `db/`：连接、迁移器、seed、Repository 基类（仅主进程）。
- `services/`：会话表（内存）、事件总线（`webContents.send`）、日志。

### 4.3 renderer

- Vite + React Router 页面骨架：登录、监控工作台、地图、任务、调度中心、基础数据、告警、审计、设置（route 清单见 design §7.1）。
- `api/`：`apiClient` + 三个适配器；页面只依赖 `apiClient`。
- `store/`：zustand 全局态（会话 / selection / 筛选）+ 事件订阅。

## 5. 数据库迁移与 seed

1. 迁移文件：`desktop/db/migrations/0001_init.sql`（DDL）；演示数据用代码侧 seed（见 `docs/database.md` §4），如需 SQL 种子则 `0002_seed.sql`。
2. 迁移器：读目录内 `NNNN_*.sql` 升序，事务内执行，成功后写 `schema_version`；重复运行跳过已应用版本。
3. seed：代码侧幂等写入（固定 `seed-*` id），密码 bcrypt 运行时生成，不落明文 SQL；细节见 `docs/database.md`。
4. 库文件位置：开发期 `desktop/.data/app.db`（gitignore）；生产放用户数据目录。

## 6. 阶段任务与验收门

| 阶段 | 任务 | 验收命令 | 期望 |
| --- | --- | --- | --- |
| P1 地基 | workspaces + shared + desktop/renderer 骨架 + 迁移/seed | `npm run dev:electron` | 窗口打开、`/api/health` 返回 `db:true`；库文件生成 |
| P2 认证与主数据 | M1 + M2（服务/UI/审计/权限） | `npm test` + 手工走查 | 三角色登录；站点/车辆/路网 CRUD；审计可查 |
| P3 任务与地图 | M3 状态机 + M6 静态图层联动 | `npm test` + 手工走查 | 任务创建/提交；地图与列表联动 |
| P4 算法内核 | M4（按 `module-M4-dispatch.md`）+ M5 + 模拟执行器 | `npm test` | U1-U11 / S1-S8 绿；preview→apply→start 主线通 |
| P5 监控告警 | M7 + M8 + 事件推送 | `npm test` + 手工走查 | 异常→告警→接管闭环 |
| P6 收尾 | M9 查询 + M10 设置 + 演示数据与手册 + 打包 | `npm run build` | 安装包可离线启动 |

每阶段结束按 `AGENTS.md` 纪律：先补工作日志与决策，再提交。

## 7. 关键技术风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `better-sqlite3` 与 Electron ABI 不匹配 | 主进程启动即崩 | P1 用 `@electron/rebuild`；浏览器 Mock 模式不受影响 |
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
