# 无人物流调度管理软件

面向园区 / 仓储 / 校园等中小规模场景的**无人车队调度管理桌面应用**：统一管理任务创建、车辆调度、路径规划、执行监控与异常处理，形成可观察、可回放、可审计的业务闭环。

## 状态

- 当前：**P0 文档阶段**（设计定稿，未写业务代码，仓库尚未 git init）。
- 下一步：评审设计 → P1 脚手架。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [`design.md`](./design.md) | 设计文档：架构分层、运行形态、全局规范、10 个首期模块的目标/要求规范/接口概览、数据模型、状态机、算法、里程碑 |
| [`docs/api.md`](./docs/api.md) | 接口文档：全量接口契约、错误码、事件订阅、种子数据 |
| [`docs/module-M4-dispatch.md`](./docs/module-M4-dispatch.md) | 模块开发文档：调度引擎 M4（文件划分、类型/方法签名、策略与事务、测试与验收） |
| [`docs/database.md`](./docs/database.md) | 数据库设计：17 张表 DDL、索引、种子规则、常用查询、迁移演进规则 |
| [`docs/build-plan.md`](./docs/build-plan.md) | 构建计划：仓库形态与脚本、P1-P6 任务与验收门、风险与开工清单 |
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
