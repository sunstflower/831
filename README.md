# 无人物流调度管理软件

面向园区 / 仓储 / 校园等中小规模场景的**无人车队调度管理桌面应用**：统一管理任务创建、车辆调度、路径规划、执行监控与异常处理，形成可观察、可回放、可审计的业务闭环。

> **文档边界**：本文件只负责「项目说明与**文档索引**」。其余事实按 [`docs/api.md`](./docs/api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**。

## 状态

> 本节是**实测快照（2026-09-28）**；最新一次验证命令与结果以 [`AGENTS.md`](./AGENTS.md) 的「验证基线」为准。

- 当前：**十个首期模块的业务链路全部落地**（P1 地基 + M1-M10 页面与接口；M11/M12 属二期）。
  最近的增量是 **M1 / M7 / M8 / M9 / M10**：用户维护页、监控读模型 + 模拟执行器（车辆真的会动、
  轨迹真的会记）、告警五态闭环（认领 / 解决 / 归档，按钮与服务端共用一份迁移表）、审计查询与 CSV 导出、
  设置页（按 `SETTINGS_SCHEMA` 动态渲染 + 只提交改过的键），以及地图上的**轨迹回放**
  （折线 + 游标，实时位置与历史轨迹分开显示）。此前的 M2 基础数据（含写路径）、M3 任务管理（批量导入除外）、
  M4 调度全链路（贪心 / 匈牙利 / 对比）、M5 路径规划（A* 与 Dijkstra 对比 + 途经点 + 禁行规避）、
  M6 地图（React Flow，含共点图层避让规则 D-42）保持可用。（`shared/` · `desktop/` · `renderer/` 三端可跑）。
  - `shared/`：枚举 · 类型 · 错误目录（**唯一登记处**，见 D-33）· 常量 · **M5 路径搜索内核**（`route-search` / `route-graph` / `route-rules`：A*/Dijkstra 共用框架、构图与途经点规则，是主进程与 Mock 的同一份纯函数，D-49）· **M4 调度内核**（`dispatch-types` / `dispatch-evaluate` / `dispatch-strategies` / `dispatch`：六步约束评估、代价函数、贪心与匈牙利，同样是无 IO 的纯函数，D-51）· **调度三张词表**（策略名 / 拒绝原因 / 日志动作，唯一作者，D-52）。
  - `desktop/`：`node:sqlite` 连接 · 迁移（含 `0003_object_types` 与 `0004_task_pause_reason`）· seed · IPC Router（鉴权/权限/`traceId`，**支持方法 + `:name` 路径参数**，D-43）· 会话 · 审计 · 事件总线 · 地图快照接口 · **M2 基础数据读写接口**（站点 / 车辆 / 路网节点 / 有向边 / 禁行规则 / 任务模板：列表含分页与筛选，写路径含创建 / 更新 / 启停 /（仅规则）物理删除，经领域服务 + 事务 + 审计）· **M3 任务接口**（列表 / 详情 / 创建 / 编辑 / 状态操作 / 删除草稿：状态机执行器 + 车辆回收 + 计划作废，事务 + 审计 + `task.changed` 事件）· **M5 路径接口**（规划 / 对比 / 按 id 查路线：只读计算，不发事件）· **M7 监控与执行接口**（`/api/monitor/{overview,tasks,vehicles}` 读模型 + `/api/execution/tasks/{id}/{start,takeover}`，执行器 `domain/execution/executor.ts` 在启动时恢复未完成任务并常驻定时推进）· **M6 轨迹读接口**（`/api/map/tracks/{vehicleId}`）· **M8 告警接口**（列表 / 详情 / 三个状态操作，去重窗口 + 处置建议）· **M9 审计接口**（查询 + CSV 导出，导出走信封的「文件名 + 正文」，见 `docs/api.md` §3.9）· **M10 设置接口**（PATCH 只改提到的键、整批校验后才写）· **M1 用户接口**（创建 / 更新 / 启停 / 重置密码 / 改本人密码，两条「别把自己锁在门外」的护栏在服务端）。
  - `renderer/`：入口 + 三层适配器（`mock` / `ipc` / `http`）· **设计系统**（`styles/theme.css` 令牌 + `styles/ui.css` 共用基元）· **信息架构**（`app/modules.ts`）· 现代化外壳（分组导航 + 顶栏 + 用户菜单）· 登录页 / **监控工作台** / **基础数据页（M2：六个页签 + 防抖搜索 + 状态 / 类型筛选 + 分页表格 + 新增 / 编辑弹层 + 启停 + 删除二次确认，按 `base:write` 开关）** / 地图页 / **任务管理页（M3：筛选 + 分页 + 新建 / 编辑弹层 + 状态操作与二次确认 + 只读详情，按 `task:write` 开关）** / **调度中心页（上：M4 调度台 —— 候选池 / 策略选择 / 预览对比 / 派发明细与拒绝原因 / 二次确认应用 / 手动指派 / 回收重算 / 跨栏日志面板；下：M5 路径规划面板 + 算法对比，常驻标注「规划只预览、不落库」）** · **告警中心页（M8：四个筛选 + 列表 / 详情两栏 + 按状态派生的处置按钮 + 建议下一步）** / **审计日志页（M9：模块 / 动作筛选 + 分页表格 + 仅 admin 可见的 CSV 导出）** / **系统设置页（M10：schema 驱动表单 + 差异提交 + 字段级报错）** / **用户管理页（M1：账号增改停启 + 重置换密码 + 改本人密码，两条护栏在界面上可见）** · **React Flow 地图**（路网 + 站点 + 车辆 + 任务起终点 + 路线高亮 + 图层开关 + 迷你图 + **轨迹回放面板**；**共点图层各领不重叠锚点**，由 `map/model/layout.test.ts` 的不变量守住）。
- 说明：**当前没有任何路由指向「未实现模块说明页」**（九个模块的页面都已落地）；`PlaceholderPage` 与 `app/modules.ts` 的 `PLANNED_MODULES`（现为空表）保留给下一个模块。
- 具体接口清单、错误码条数、seed 规模、测试用例数等**数值**不在本节复述，按 [`docs/api.md`](./docs/api.md) §0 到负责文档查。
- 命令：`npm run dev`（浏览器 Mock）· `npm run dev:electron`（Electron 真实链路）· `npm test` · `npm run build` · `npm run db:migrate` / `db:seed` / `db:reset`。
- 下一步：**四类数据文件的导入管线**（订单 CSV / 仿真地图 / 车辆参数 / 算法配置，契约草案见 [`docs/data-interfaces.md`](./docs/data-interfaces.md)，其决策 D-15…D-20 / D-28…D-31 仍待评审）· M3 的批量导入（与该管线同批落地）· M2 的详情接口 · 地图的订单端点图层（`map/overview?include=`，见 `docs/issues.md` ISS-011）· 工作台是否改用 `/api/monitor/overview`（当前刻意保持单快照，理由见 `renderer/src/pages/DashboardPage.tsx` 文件头）。
- 已知边界（不是缺陷，是刻意留的）：执行器是**本地模拟**（D-10，二期换真实协议且不改上层契约）；真实设备协议、统计分析属二期（M11 / M12）。

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [`design.md`](./design.md) | 设计文档：架构分层、运行形态、全局规范、10 个首期模块的目标/要求规范/接口概览、数据模型、状态机、算法、里程碑 |
| [`docs/api.md`](./docs/api.md) | 接口文档：全量接口契约、错误码、事件订阅、种子数据 |
| [`docs/module-M2-base-data.md`](./docs/module-M2-base-data.md) | 模块开发文档：基础数据 M2（文件划分、校验顺序、软删与引用完整性、审计动作命名、测试清单与 DoD） |
| [`docs/module-M3-task.md`](./docs/module-M3-task.md) | 模块开发文档：任务管理 M3（状态机口径与触发者、校验顺序、事务与副作用边界、审计动作命名、错误映射、渲染层口径、测试清单与 DoD） |
| [`docs/module-M4-dispatch.md`](./docs/module-M4-dispatch.md) | 模块开发文档：调度引擎 M4（文件划分、类型/方法签名、策略与事务、测试与验收） |
| [`docs/module-M5-route.md`](./docs/module-M5-route.md) | 模块开发文档：路径规划 M5（算法内核归属与不变量、构图口径、失败原因映射、途经点语义、渲染层口径与 DoD） |
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
├── shared/src/             # 类型 / 枚举 / 错误 / 常量（含调度三张词表） / 边编码 / M2 字段规则 / M3 状态机与任务规则 / M5 路径内核 / M4 调度内核（唯一来源，扁平文件）
├── desktop/                # Electron 主进程
│   ├── src/                # db / domain（领域服务）/ services / ipc / cli / main.ts
│   ├── migrations/         # SQL 迁移（0001_init + 0003 + 0004，编号与条数以 docs/database.md §6 为准）
│   ├── preload.cjs         # contextBridge 最小面
│   └── .data/app.db        # 开发库（gitignore）
├── renderer/
│   ├── index.html          #   首屏声明：内联图标 + 深色 meta（D-37，仅此一处）
│   └── src/                # React 渲染层
│       ├── api/            #   三层适配器（mock / ipc / http）、再导出类型、分页 / 写入 hook 与 Mock 写路径
│       ├── app/            #   路由、会话守卫、modules.ts（信息架构）、index-html.test.ts（首屏护栏）
│       ├── components/     #   外壳、品牌标识、用户菜单、内联图标集（含各自的 .test.tsx）
│       ├── pages/          #   登录 / 工作台 / 基础数据（M2） / 任务管理（M3） / 调度中心（M4+M5） / 告警（M8） / 审计（M9） / 设置（M10） / 用户（M1） / 占位页（当前无路由使用）
│       ├── domain/         #   跨模块共用：labels（枚举 → 文案）/ form / table / format / paging / tone
│       ├── ops/            #   M1/M8/M9/M10 四页的共用纯函数与样式（`ops/model.ts` + `ops/style/ops.css`）
│       ├── dashboard/      #   监控工作台：model / panels / style
│       ├── base/           #   基础数据 M2：model（列与页签）/ form（写表单与载荷）/ useBaseDataList / EntityFormDialog
│       ├── task/           #   任务管理 M3：model / form / actions / 弹层 / style
│       ├── route/          #   路径规划 M5：model（途经点解析与展示口径）/ RoutePlanner / style
│       ├── map/            #   地图：model（含 toFlow 图层偏移 / layout 不变量）/ nodes / edges / hooks / stage / panels / style
│       └── styles/         #   theme.css（令牌）· ui.css（共用基元）· layout.css（外壳）
└── tests/                  # 仓库级测试：setup.ts（全局 setup）+ docs.test.ts（文档不变量）
```
