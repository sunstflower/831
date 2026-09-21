# 无人物流调度管理软件

面向园区 / 仓储 / 校园等中小规模场景的**无人车队调度管理桌面应用**：统一管理任务创建、车辆调度、路径规划、执行监控与异常处理，形成可观察、可回放、可审计的业务闭环。

## 状态

- 当前：**P1 地基已通 + M6 地图已实现**（`shared/` · `desktop/` · `renderer/` 三端可跑）。
  - `shared/`：枚举 · 类型 · **错误目录 `ERROR_CODES` 123 条**（34 运行时 + 89 导入域，**唯一登记处**，见 D-33）· 常量。
  - `desktop/`：`node:sqlite` 连接 · 迁移 · seed · IPC Router（鉴权/权限/`traceId`）· 会话 · 审计 · 事件总线 · 8 条接口（health / auth.login / auth.logout / auth.session / settings / settings.schema / users / **map.overview**）。
  - `renderer/`：入口 + 三层适配器（`mock` / `ipc` / `http`）· 登录/工作台/地图页 · **React Flow 地图**（路网 34 边 + 站点 + 车辆 + 任务起终点 + 路线高亮 + 图层开关 + 迷你图）。
- 命令：`npm run dev`（浏览器 Mock）· `npm run dev:electron`（Electron 真实链路）· `npm test`（110 个用例）· `npm run build` · `npm run db:migrate` / `db:seed` / `db:reset`。
- 下一步：订单/地图/车辆/算法四类文件的导入管线（`docs/data-interfaces.md`）· M4 调度引擎 · M7 执行与监控。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [`design.md`](./design.md) | 设计文档：架构分层、运行形态、全局规范、10 个首期模块的目标/要求规范/接口概览、数据模型、状态机、算法、里程碑 |
| [`docs/api.md`](./docs/api.md) | 接口文档：全量接口契约、错误码、事件订阅、种子数据 |
| [`docs/module-M4-dispatch.md`](./docs/module-M4-dispatch.md) | 模块开发文档：调度引擎 M4（文件划分、类型/方法签名、策略与事务、测试与验收） |
| [`docs/database.md`](./docs/database.md) | 数据库设计：16 张业务表 DDL（+`schema_version`，共 17 张表）、索引、种子规则、常用查询、迁移演进规则 |
| [`docs/architecture.md`](./docs/architecture.md) | 架构图集：23 张 Mermaid 架构图，可导出 PPT / Word / PDF |
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

## 本地运行（脚手架就绪后生效）

```bash
npm install          # 安装依赖
npm run dev          # 渲染层（浏览器 + MockAdapter 可独立开发）
npm run dev:electron # 启动 Electron 桌面端（真实 SQLite + IPC）
npm test             # 单元/契约测试
```

> 以上命令为规划占位，脚手架（P1）落地后以实际脚本为准并回写此处。

## 目录结构

```text
831/
├── design.md  docs/  AGENTS.md  README.md   # 文档与规则
├── shared/    # 类型 / 枚举 / 错误（唯一来源）
├── desktop/   # Electron 主进程：db / domain / algorithms / ipc
├── renderer/  # React 渲染层：pages / components / api / store / map
└── tests/     # 端到端冒烟
```
