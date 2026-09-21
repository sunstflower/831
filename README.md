# 无人物流调度管理软件

面向园区 / 仓储 / 校园等中小规模场景的**无人车队调度管理桌面应用**：统一管理任务创建、车辆调度、路径规划、执行监控与异常处理，形成可观察、可回放、可审计的业务闭环。

> **文档边界**：本文件只负责「项目说明与**文档索引**」。其余事实按 [`docs/api.md`](./docs/api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**。

## 状态

> 本节是**实测快照（2026-09-21）**；最新一次验证命令与结果以 [`AGENTS.md`](./AGENTS.md) 的「验证基线」为准。

- 当前：**P1 地基已通 + M6 地图已实现**（`shared/` · `desktop/` · `renderer/` 三端可跑）。
  - `shared/`：枚举 · 类型 · 错误目录（**唯一登记处**，见 D-33）· 常量。
  - `desktop/`：`node:sqlite` 连接 · 迁移 · seed · IPC Router（鉴权/权限/`traceId`）· 会话 · 审计 · 事件总线 · 主数据与地图快照接口。
  - `renderer/`：入口 + 三层适配器（`mock` / `ipc` / `http`）· 登录/工作台/地图页 · **React Flow 地图**（路网 + 站点 + 车辆 + 任务起终点 + 路线高亮 + 图层开关 + 迷你图）。
- 具体接口清单、错误码条数、seed 规模、测试用例数等**数值**不在本节复述，按 [`docs/api.md`](./docs/api.md) §0 到负责文档查。
- 命令：`npm run dev`（浏览器 Mock）· `npm run dev:electron`（Electron 真实链路）· `npm test` · `npm run build` · `npm run db:migrate` / `db:seed` / `db:reset`。
- 下一步：订单/地图/车辆/算法四类文件的导入管线（[`docs/data-interfaces.md`](./docs/data-interfaces.md)）· M4 调度引擎 · M7 执行与监控。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [`design.md`](./design.md) | 设计文档：架构分层、运行形态、全局规范、10 个首期模块的目标/要求规范/接口概览、数据模型、状态机、算法、里程碑 |
| [`docs/api.md`](./docs/api.md) | 接口文档：全量接口契约、错误码、事件订阅、种子数据 |
| [`docs/module-M4-dispatch.md`](./docs/module-M4-dispatch.md) | 模块开发文档：调度引擎 M4（文件划分、类型/方法签名、策略与事务、测试与验收） |
| [`docs/database.md`](./docs/database.md) | 数据库设计：业务表 DDL（**表数与索引数在本文件**）、索引、种子规则、常用查询、迁移编号与演进规则 |
| [`docs/architecture.md`](./docs/architecture.md) | 架构图集：Mermaid 架构图集，可导出 PPT / Word / PDF（**图内数字以来源文档为准**） |
| [`docs/build-plan.md`](./docs/build-plan.md) | 构建计划：仓库形态与脚本、P1-P6 任务与验收门、风险与开工清单 |
| [`docs/data-interfaces.md`](./docs/data-interfaces.md) | 数据文件接口规范：订单 CSV / 仿真地图 / 车辆参数 / 算法配置的导入契约与统一导入管线（草案） |
| [`docs/order-data-map-design.md`](./docs/order-data-map-design.md) | 订单数据接入与地图生成设计（设计态） |
| [`docs/module-M6-map.md`](./docs/module-M6-map.md) | 模块开发文档：地图渲染 M6（React Flow 方案：选型实测、数据映射、性能护栏、测试清单） |
| [`docs/issues.md`](./docs/issues.md) | **项目问题汇总**：全项目唯一的问题/风险/待决清单（P1-P3 定级 + 状态跟踪） |
| [`AGENTS.md`](./AGENTS.md) | 项目工作日志与提交纪律（构建阶段每次提交前必须记录） |
| [`docs/requirement-raw.md`](./docs/requirement-raw.md) | 原始需求存档 |

## 功能概览（首期）

- 登录与权限：三角色（管理员 / 调度员 / 监控员）会话与按钮/接口级权限。
- 任务管理：创建、批量导入、暂停/恢复/取消/重派/重排，全状态机显式校验。
- 调度引擎：候选筛选、代价评估、贪心 / 匈牙利多策略预览对比、手动指派、冲突检测与重算。
- 路径规划：A*（默认）与 Dijkstra 基线对比，禁行规避，结果可解释。
- 地图与监控：任务/车辆/站点/路线/告警同图联动，执行推进、轨迹回放、手动接管。
- 告警：五类告警「生成 → 确认 → 处理 → 归档」闭环留痕。
- 审计与日志、系统设置：全局参数重启生效。

明确不在首期范围：真实设备协议、云端同步、多租户、复杂权限矩阵、大规模分布式优化、统计模块（二期预留）。

## 技术方案（计划）

Electron（主进程独占 SQLite + 领域服务 + 纯函数算法）+ React 18 / Vite 渲染层 + 三层统一服务适配器（IPC / 本地 HTTP / Mock）。类型与枚举集中在 `shared/` 单一来源，详见 `design.md` §2。

## 本地运行

```bash
npm install          # 安装依赖
npm run dev          # 渲染层（浏览器 + MockAdapter 可独立开发）
npm run dev:electron # 启动 Electron 桌面端（真实 SQLite + IPC）
npm test             # 单元 / 契约测试
npm run build        # 三端类型检查 + 构建
npm run db:migrate   # 应用迁移（内置 node:sqlite）
npm run db:seed      # 幂等写入演示数据
npm run db:reset     # 删库重建并重新 seed（仅开发）
```

> 命令均已落地可跑；脚本全量清单见 `package.json` 与 `docs/build-plan.md` §3。
> `dev` / `dev:electron` 会自动先构建 `shared`（`dev:electron` 另构建 `desktop`），
> 因此**干净检出无需手动 `npm run build`**；如需只构建产物，用 `npm run build`。

## 目录结构

> **本节是目录形态的唯一来源**；`design.md` §2.4 只标注设计意图与实现状态，与本节冲突时以本节为准。

```text
831/
├── package.json  package-lock.json  tsconfig.base.json  vitest.config.ts
├── .env.example            # 适配器与端口开关（默认不设置，见 D-22）
├── README.md  AGENTS.md  design.md
├── docs/                   # 其余文档（清单见上面「文档入口」）
├── shared/src/             # 类型 / 枚举 / 错误 / 常量（唯一来源，扁平文件）
├── desktop/                # Electron 主进程
│   ├── src/                # db / services / ipc / cli / main.ts
│   ├── migrations/         # SQL 迁移（0001_init.sql）
│   ├── preload.cjs         # contextBridge 最小面
│   └── .data/app.db        # 开发库（gitignore）
├── renderer/src/           # React 渲染层：api / store / app / pages / components / map / styles
└── tests/setup.ts          # 测试全局 setup（用例与被测代码同目录）
```
