# 无人物流调度管理软件 · 架构图集

> 版本：v1.0（2026-09-14）
> 用途：可直接导出为 PPT / Word / PDF / 图片的 Mermaid 架构图集合。
> 关联：[`design.md`](../design.md) §2 · [`docs/api.md`](./api.md) · [`docs/database.md`](./database.md) · [`docs/build-plan.md`](./build-plan.md)

## 图例与阅读说明

每张图都用统一的实现状态标记，避免把「设计」误读成「已完成」：

| 标记 | 含义 |
| --- | --- |
| 【已实现】 | 已实现，且有代码/实测支撑 |
| 【设计中】 | 设计中，文档已定稿但尚无代码 |
| 【二期】 | 二期预留，首期明确不做 |

图中节点若带 `→ 缺口` 或 `TODO` 字样，表示该环节当前为空。

### 如何导出

| 目标格式 | 方法 |
| --- | --- |
| GitHub / GitLab / VS Code 预览 | 无需导出，浏览器原生渲染 Mermaid |
| Word / PPT | 用下方命令 1 导出「Markdown + PNG 图集」，图片自动替换进 md，再整体粘贴 |
| PDF（评审传阅） | 用下方命令 2 |
| 可再编辑的矢量图 | 用下方命令 3 导出 SVG |

以下命令均已实测通过：

```bash
# 1) 导出 Markdown + PNG 图集（本文件全部 23 张图一次性导出）
npx -y @mermaid-js/mermaid-cli \
  -i docs/architecture.md \
  -o docs/export/architecture.md \
  -e png -w 1500 -s 2 \
  -a docs/export/assets

# 2) 导出单文件 PDF
npx -y @mermaid-js/mermaid-cli -i docs/architecture.md -o docs/export/architecture.pdf -f

# 3) 导出 SVG 图集（矢量无损，适合放大投影或二次编辑）
npx -y @mermaid-js/mermaid-cli -i docs/architecture.md \
  -o docs/export/architecture-svg.md -e svg -a docs/export/svg
```

| 参数 | 作用 |
| --- | --- |
| `-i` 传 `.md` | 自动抽取文件中全部 Mermaid 图，无需逐张导出 |
| `-e png / svg / pdf` | 输出格式 |
| `-w 1500` | 画布宽度，图宽超过该值会整体缩放 |
| `-s 2` | 2 倍缩放，避免文字在高分屏或投影上发虚 |
| `-a <目录>` | 图片输出目录，不指定则与 md 同目录 |
| `-f` | 仅 PDF：缩放页面以适配图形 |

> 首次运行会下载 Puppeteer / Chromium，耗时较长，之后走缓存。若网络受限，可改用 VS Code 插件「Markdown Preview Mermaid Support」在预览中右键导出。

> macOS 本地导出中文显示正常（已验证）。若在 Linux / CI 上导出后中文变成方块，是容器缺 CJK 字体，安装 `fonts-noto-cjk` 即可。**不建议用 `-C` 覆盖 font-family**：字体度量在布局之后才生效，会导致文字溢出节点框。

> **建议优先导出 SVG**：架构图会随 P2-P6 频繁改版，SVG 缩放不糊、可二次编辑，且体积通常小于高分辨率 PNG。

---

## 1. 系统总体架构（分层 · 含实现状态）

图例：<span>蓝=唯一来源</span> · <span>绿=已实现</span> · <span>黄=纯函数算法层</span> · <span>紫=设计中</span>

```mermaid
---
config:
  flowchart:
    wrappingWidth: 520
---
flowchart TB
  SH["<b>shared · 类型唯一来源【已实现】</b><br/>枚举 · 类型 · 错误目录 · 常量<br/>无运行时依赖，渲染层与主进程共同引用"]
  UI["<b>展示层 · 渲染进程 renderer（设计中）</b><br/>React 页面 / 组件 · 地图画布 React Flow · 表格 / 表单 / 弹窗"]
  ST["<b>状态层（设计中）</b><br/>全局状态 会话 / 角色 / 筛选 / 主题 · 页面态 · 事件订阅缓存"]
  ADP["<b>服务适配器 · 同一契约三种实现（部分实现）</b><br/>IpcAdapter 生产形态 · HttpAdapter 预留【二期】 · MockAdapter 浏览器独立开发"]
  GW["<b>接入层【已实现】</b><br/>IPC Router 注册表 + 鉴权 + traceId · API Routes 7 条"]
  BIZ["<b>业务层（认证已实现，其余设计中）</b><br/>认证与会话 · 任务 / 车辆 / 站点 / 模板 · 调度编排 M4 · 路径服务 M5 · 告警 / 监控 / 执行 M7 M8"]
  ALG["<b>算法层 · 纯函数，禁止访问数据库（设计中）</b><br/>A* / Dijkstra · 贪心 / 匈牙利 / 遗传【二期】 · 代价函数 / 约束评估"]
  DATA["<b>数据层 · 主进程独占【已实现】</b><br/>SQLite node:sqlite · Repository 查询仓库 部分 · 迁移 / 种子 · 审计 / 事件日志"]

  SH -. 类型零成本共享 .-> UI
  SH -. 类型零成本共享 .-> GW
  UI --> ST --> ADP --> GW --> BIZ
  BIZ --> ALG
  BIZ --> DATA
  ALG -. 只读快照，不落库 .-> DATA

  style SH fill:#e3f2fd
  style GW fill:#e8f5e9
  style DATA fill:#e8f5e9
  style ALG fill:#fff8e1
```

**五条层间铁律**（`design.md` §2.1，评审与重构时按此判定违规）：

1. 渲染层永不直连数据库，只通过服务契约调用领域接口。
2. 业务层不写算法细节，只编排算法结果并落库留痕。
3. 算法层是纯函数：入参为领域快照，出参为 `Plan / Route / 评估报告`，不持有状态、不写库。
4. 数据层由主进程独占，仅经 Repository 暴露读写，禁止业务层拼裸 SQL。
5. 状态层只消费服务返回与事件推送，不自行修改业务状态。

---

## 2. 运行形态与进程模型

```mermaid
flowchart LR
  subgraph OS["操作系统"]
    direction TB
    subgraph MP["Electron 主进程 · Node 运行时"]
      M1["窗口与生命周期 【已实现】"]
      M2["SQLite 实例 【已实现】"]
      M3["领域服务 【部分实现】"]
      M4["算法执行 【设计中】"]
      M5["内存会话表 【已实现】"]
      M6["事件总线 EventBus 【已实现】"]
    end
    subgraph RP["Electron 渲染进程 · 浏览器运行时"]
      R1["React 18 应用 【设计中】"]
      R2["zustand store 【设计中】"]
      R3["地图画布 React Flow 【设计中】"]
    end
  end

  subgraph BR["浏览器 · 独立开发形态"]
    B1["同一份 React 代码 【设计中】"]
    B2["MockAdapter 内存 + localStorage 【设计中】"]
  end

  DB[("desktop/.data/app.db 【已实现】")]
  MIG["migrations/*.sql 【已实现】"]

  M2 --> DB
  MIG --> M2
  R1 -->|"window.dispatchApi.invoke 【已实现】"| M1
  M1 -->|"udm:invoke 【已实现】"| M3
  M3 --> M2
  M3 -->|"emit 【已实现】"| M6
  M6 -->|"udm:event 【已实现】"| R1
  B1 --> B2
  B2 -.同一契约.-> B1

  SEC["安全边界<br/>contextIsolation: true 【已实现】<br/>nodeIntegration: false 【已实现】<br/>sandbox: false 【注意】"]
  SEC -.- M1
```

要点：

- **渲染进程拿不到 Node 能力**：只暴露 `invoke` / `on` 两个方法，敏感能力全部留在主进程。
- **`sandbox: false` 是当前配置**（`desktop/src/main.ts`）；因为 preload 使用 CommonJS，尚未启用沙箱。若要收紧，需评估 `preload.cjs` 的兼容性。
- **浏览器形态不需要 Electron**：`MockAdapter` 让 UI 独立开发，不被原生依赖阻塞（D-13）。

---

## 3. 一次调用的完整链路（统一信封与鉴权）

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant UI as React 页面 【设计中】
  participant AD as 适配器 【设计中】
  participant PL as preload.cjs 【已实现】
  participant RT as IPC Router 【已实现】
  participant SS as SessionStore 【已实现】
  participant H as Route Handler 【已实现】
  participant RP as Repository 【部分实现】
  participant DB as SQLite 【已实现】
  participant AU as audit_logs 【已实现】
  participant EV as EventBus 【已实现】

  U->>UI: 点击操作
  UI->>AD: invoke(path, payload, token)
  AD->>PL: window.dispatchApi.invoke
  PL->>RT: ipcRenderer.invoke('udm:invoke')
  Note over RT: 生成 traceId = randomUUID 【已实现】

  RT->>RT: 查路由注册表
  alt 路径不存在
    RT-->>PL: API.ROUTE_NOT_FOUND
  else 命中路由
    alt route.public = false
      RT->>SS: get(token)
      alt 会话无效
        RT-->>PL: AUTH.REQUIRED
      else 会话有效
        SS-->>RT: SessionRecord
        RT->>RT: 校验权限点
        alt 无权限点
          RT-->>PL: AUTH.FORBIDDEN
        end
      end
    end
    RT->>H: handler(payload, ctx)
    H->>H: 参数校验
    H->>RP: 业务读写
    RP->>DB: SQL
    DB-->>RP: 结果
    H->>AU: writeAudit(before/after)
    H->>EV: emit(领域事件)
    EV->>DB: 落 event_log
    EV-->>PL: udm:event 推送
    H-->>RT: data
    RT-->>PL: ok(data) 即 code 0
  end
  PL-->>UI: ApiResult
  UI-->>U: 渲染结果
```

**统一信封**（`shared/src/types.ts`，成功与失败互斥）：

```mermaid
classDiagram
  class ApiSuccess {
    code 恒为 0
    message success
    data T
  }
  class ApiFailure {
    code 如 AUTH.FORBIDDEN
    message 人类可读
    source ErrorSource
    detail 结构化补充
    traceId 定位日志
  }
  class ErrorSource {
    <<enumeration>>
    validation
    auth
    business
    system
  }
  ApiFailure --> ErrorSource
  note for ApiSuccess "判定成功请用 code === 0，而非裸真值"
```

---

## 4. 认证、角色与会话

```mermaid
flowchart TB
  subgraph LOGIN["登录流程 【已实现】"]
    direction TB
    L1["POST /api/auth/login"] --> L2["requireString 校验用户名与密码"]
    L2 --> L3{"findByUsername"}
    L3 -->|不存在| F1["audit failure<br/>AUTH.LOGIN_FAILED"]
    L3 -->|存在| L4{"status equals active"}
    L4 -->|否| F2["audit failure<br/>AUTH.USER_DISABLED"]
    L4 -->|是| L5{"verifyPassword<br/>bcryptjs"}
    L5 -->|否| F3["audit failure<br/>AUTH.LOGIN_FAILED"]
    L5 -->|是| L6["sessions.create<br/>token = sess_ + 16 字节随机"]
    L6 --> L7["touchLastLogin 更新 last_login_at"]
    L7 --> L8["audit success"]
    L8 --> L9["emit map.updated"]
    L9 --> L10["返回 token 与 SessionUser 含 permissions"]
  end

  subgraph RBAC["角色与权限点 【已实现】"]
    direction TB
    R1["admin 系统管理员<br/>全量 20 个权限点"]
    R2["dispatcher 调度员<br/>16 个权限点"]
    R3["monitor 监控员<br/>6 个权限点"]
  end

  L10 --> RBAC
```

**权限点分配**（`shared/src/enums.ts` → `ROLE_PERMISSIONS`，共 20 个权限点）：

```mermaid
flowchart LR
  subgraph FULL["admin 独占 4 个"]
    X1["user:manage"]
    X2["base:write"]
    X3["settings:write"]
    X4["audit:read"]
  end
  subgraph COMMON["三角色共有 6 个"]
    C1["base:read"]
    C2["task:read"]
    C3["map:read"]
    C4["monitor:read"]
    C5["alert:read"]
    C6["alert:ack"]
  end
  subgraph DISP["dispatcher 额外 10 个"]
    D1["task:write"]
    D2["dispatch:read D-11 待评审"]
    D3["dispatch:preview"]
    D4["dispatch:apply"]
    D5["route:plan"]
    D6["execution:start D-11 待评审"]
    D7["execution:takeover"]
    D8["alert:resolve"]
    D9["alert:archive"]
    D10["settings:read"]
  end
```

> **双轨制（D-08）**：前端隐藏按钮只算体验优化，权限判定一律以主进程 `Router` 为准。鉴权在 handler 之前完成，handler 内不得再信任前端传入的角色或用户 ID。

### 会话模型

```mermaid
flowchart LR
  T["token<br/>sess_ 加 16 字节 hex 【已实现】"] --> M["Map 内存表 【已实现】"]
  M --> R["SessionRecord<br/>token / user / createdAt 【已实现】"]
  R --> U["SessionUser<br/>id / username / role / displayName / permissions 【已实现】"]

  W["【注意】 会话仅存内存"] -.主进程重启即失效.-> M
  W -.多窗口共享同一进程内会话.-> M
  W -.二期如需持久化.-> P["【二期】持久化会话"]
```

---

## 5. 任务状态机（`design.md` §4.3 为唯一来源）

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> pending : submit
  pending --> assigned : dispatch apply
  assigned --> running : start execute
  running --> paused : pause
  paused --> running : resume
  running --> finished : arrive and unload
  running --> failed : executor fault
  assigned --> failed : executor fault
  pending --> cancelled : cancel
  assigned --> cancelled : cancel
  running --> cancelled : cancel 强停
  paused --> cancelled : cancel
  failed --> pending : requeue
  finished --> [*]
  cancelled --> [*]
  note right of paused
    原始需求为 7 态
    paused 为 D-02 显式新增
    避免用隐式字段表达暂停
  end note
  note right of failed
    仅 failed 可回到 pending
    允许重新进入候选池
  end note
```

**迁移前置与副作用**：

| 从 | 到 | 触发 | 前置 / 副作用 |
| --- | --- | --- | --- |
| draft | pending | submit | 校验必填：起终点、载重、时间窗 |
| pending | assigned | dispatch apply / manual assign | 派发车辆，生成计划与路线 |
| assigned | running | start | 车辆到达起点或执行开始 |
| running | paused | pause | 仅运行中可暂停，写暂停原因 |
| paused | running | resume | 继续执行 |
| running / assigned | finished | complete | 到达终点并完成卸货 |
| assigned / running | failed | fail | 执行器或车辆异常 |
| pending / assigned / running / paused | cancelled | cancel | 必须传原因；已派发需先回收车辆（Req-M3-6） |
| failed | pending | requeue | 允许重新进入候选池 |
| draft / pending | 删除 | delete | 仅草稿可物理删除（D-07） |

> **硬性约束**：任何状态变化必须经服务层统一状态机函数判定，禁止直接 UPDATE 状态字段；非法迁移返回 `TASK.STATE_CONFLICT`，且 detail 需说明当前状态与期望状态。

### 关联状态机

```mermaid
stateDiagram-v2
  direction LR
  state "车辆状态机 · 7 态枚举【已实现】" as VS
  [*] --> VS
  state VS {
    [*] --> idle
    idle --> reserved : dispatch apply 已定义
    reserved --> busy : start 执行 已定义
    busy --> idle : recompute 回收 已定义
    reserved --> idle : recompute 回收 已定义
    idle --> disabled : 软删 D-07
  }
```

> 上图为**已定义迁移**的子集：`charging` / `offline` / `fault` 的进入与退出条件尚未在文档中成稿，故不在此臆测，待 M2 与 M7 落地时补齐完整迁移表。

> 车辆 7 态枚举与 CHECK 约束已落地，但**完整迁移表未定稿**：上文仅列出 `module-M4-dispatch.md` §10 与 `docs/api.md` §3.4 已明确定义的迁移（apply → `reserved`、start → `busy`、recompute → 回收至 `idle`）。`charging` / `offline` / `fault` 的进入退出按 M2 与 M7 落地时补写，避免此处先入为主。

---

## 6. 数据模型 · 17 张业务表【已实现】

> 完整 DDL 见 [`docs/database.md`](./database.md)；此处只表达**关系与分组**，字段级细节以 DDL 为准。

### 6.1 核心业务实体

```mermaid
erDiagram
  users {
    TEXT id PK
    TEXT username UK
    TEXT role "admin|dispatcher|monitor"
    TEXT status "active|disabled"
  }
  nodes {
    TEXT id PK
    TEXT code UK
    REAL x
    REAL y
    TEXT status "enabled|disabled"
  }
  edges {
    TEXT id PK
    TEXT from_node_id FK
    TEXT to_node_id FK
    REAL length_m
    REAL speed_limit_mps
  }
  sites {
    TEXT id PK
    TEXT code UK
    TEXT type "depot|dock|charging|gate|other"
    TEXT node_id FK
  }
  vehicles {
    TEXT id PK
    TEXT code UK
    TEXT type "agv|carrier|drone|other"
    TEXT status
    REAL capacity_kg
    REAL battery
    TEXT current_node_id FK
  }
  task_templates {
    TEXT id PK
    TEXT code UK
    TEXT priority
    REAL default_cargo_kg
  }
  tasks {
    TEXT id PK
    TEXT code UK
    TEXT template_id FK
    TEXT status
    TEXT from_site_id FK
    TEXT to_site_id FK
    TEXT assigned_vehicle_id FK
    REAL progress
  }
  routes {
    TEXT id PK
    TEXT task_id FK
    TEXT algorithm "aStar|dijkstra"
    TEXT node_ids
    TEXT edge_ids
    REAL distance_m
    REAL duration_s
  }
  dispatch_plans {
    TEXT id PK
    TEXT request_id
    TEXT task_id FK
    TEXT vehicle_id FK
    TEXT strategy
    TEXT status "applied|superseded|cancelled"
    TEXT occupied_from
    TEXT occupied_to
  }
  restrictions {
    TEXT id PK
    TEXT type "node|edge"
    TEXT target_id
    TEXT vehicle_type
  }

  nodes ||--o{ edges : "from_node_id"
  nodes ||--o{ edges : "to_node_id"
  nodes ||--o{ sites : "node_id 绑定"
  nodes ||--o{ vehicles : "current_node_id 当前所在"
  sites ||--o{ tasks : "from_site_id 起点"
  sites ||--o{ tasks : "to_site_id 终点"
  task_templates ||--o{ tasks : "template_id 套用模板"
  vehicles ||--o{ tasks : "assigned_vehicle_id 执行"
  vehicles ||--o{ dispatch_plans : "vehicle_id 派发"
  tasks ||--o{ dispatch_plans : "task_id 派发"
  tasks ||--o{ routes : "task_id 路线"
  dispatch_plans ||--o| routes : "route_id"
```

> 注意：`tasks.plan_id` **没有外键约束**（见 `0001_init.sql`），是刻意留给「当前生效计划」的指针；`dispatch_plans.route_id` 才是 FK。为避免误示为强约束，图中未画 `plan_id` 关系。

### 6.2 日志、审计与运行追踪（只增不改）

```mermaid
erDiagram
  dispatch_logs {
    TEXT id PK
    TEXT request_id "对应一次 preview 或 apply"
    TEXT action "preview|apply|recompute|manual_assign"
    TEXT strategy "greedy|hungarian|genetic|all"
    TEXT input_snapshot
    TEXT output_snapshot
    TEXT rejected
    INTEGER elapsed_ms
  }
  audit_logs {
    TEXT id PK
    TEXT ts
    TEXT actor_id
    TEXT module
    TEXT action
    TEXT object_type
    TEXT object_id
    TEXT before
    TEXT after
    TEXT result "success|failure"
    TEXT trace_id
  }
  event_log {
    INTEGER seq PK "AUTOINCREMENT"
    TEXT id UK
    TEXT type
    TEXT object_type
    TEXT object_id
    TEXT payload
  }
  vehicle_tracks {
    TEXT id PK
    TEXT vehicle_id FK
    TEXT ts
    REAL x
    REAL y
    REAL speed_mps
    TEXT task_id
  }
  alerts {
    TEXT id PK
    TEXT type
    TEXT level "info|warning|critical"
    TEXT object_type
    TEXT object_id
    TEXT status
    TEXT dedupe_key
  }
  settings {
    TEXT key PK
    TEXT value
    TEXT updated_by
  }
  schema_version {
    INTEGER version PK
    TEXT description
    TEXT applied_at
  }
  vehicles {
    TEXT id PK
  }

  vehicles ||--o{ vehicle_tracks : "vehicle_id 轨迹采样"
  note for event_log "seq 单调递增，渲染层据此去重"
  note for alerts "dedupe_key 与 created_at 组成去重窗口索引 idx_alerts_dedupe"
  note for audit_logs "before/after 记录状态迁移，非法迁移同样留痕"
```

> `object_type` / `object_id` 是跨表弱引用（可指向 task / vehicle / site / node / edge / user / system / alert / settings），因此**不建外键** —— 这是为了让审计与告警能记录「已删除对象」的痕迹，是 D-07 软删策略的配套设计。

### 6.3 表与索引规模（实测）

| 项 | 数量 | 说明 |
| --- | --- | --- |
| 业务表 | 17 | 另有 `schema_version` 用于迁移追踪 |
| 索引 | 18 | 覆盖任务状态与优先级、边起点、派发占用区间、告警去重、审计与轨迹时间序 |
| seed 数据 | 12 节点 · 34 边 · 3 站点 · 3 车辆 · 2 模板 · 3 账号 · 9 设置 | 4×3 网格路网，步长 20m，双向边 |

---

## 7. 调度引擎 M4（核心算法流程 【设计中】）

> 详细开发口径见 [`docs/module-M4-dispatch.md`](./module-M4-dispatch.md)。以下为架构视角的骨架图。

### 7.1 先预览、后生效（D-03）

```mermaid
flowchart TB
  START(["pending 任务进入候选池"]) --> P1["preview 请求<br/>校验 dispatch:preview"]
  P1 --> P2["① 实时取快照<br/>任务 / 车辆 / 路网 / 禁行 / 设置"]
  P2 --> P3["② buildSnapshot 组装 DispatchSnapshot<br/>构图调用 M5"]
  P3 --> P4["③ runDispatch(snapshot, strategy)<br/>纯函数，无副作用"]
  P4 --> P5["④ 产出 StrategyResult<br/>plans / rejected / summary / explain"]
  P5 --> P6["⑤ 写 dispatch_logs action=preview<br/>含 input 与 output 快照"]
  P6 --> P7["⑥ 返回 PreviewResult<br/>requestId + 多策略对比"]

  P7 --> DECIDE{"调度员查看对比"}
  DECIDE -->|放弃| DISC["不改任何业务数据"]
  DECIDE -->|确认 apply| A1["apply 请求<br/>校验 dispatch:apply"]
  A1 --> A2["重建快照并比对<br/>关键版本是否漂移"]
  A2 --> A3{"快照有效?"}
  A3 -->|失效| ERR["DISPATCH.PLAN_EXPIRED<br/>或 TASK.STATE_CONFLICT"]
  A3 -->|有效| A4["单事务写入"]
  A4 --> A5["任务 assigned<br/>车辆 reserved<br/>plans 与 routes 落库"]
  A5 --> A6["写 dispatch_logs 与 audit_logs"]
  A6 --> A7["广播领域事件"]

  style P4 fill:#e8f5e9
  style A4 fill:#fff3e0
  style DISC fill:#eceff1
```

**为什么必须分两步**：算法只输出快照结果，业务数据仅在用户确认后变更。`preview` 零副作用，`apply` 才产生持久化变更（D-03）。这条边界是「算法可以随便重跑、业务数据不会被污染」的前提。

### 7.2 单车 × 单任务约束评估（固定短路顺序）

```mermaid
flowchart TB
  IN(["候选对 task, vehicle"]) --> C1{"① 车辆状态<br/>status equals idle<br/>且非 disabled/offline/fault/charging"}
  C1 -->|否| R1["VEHICLE_NOT_AVAILABLE"]
  C1 -->|是| C2{"② 载重<br/>capacity_kg - load_kg<br/>大于等于 cargo_kg"}
  C2 -->|否| R2["LOAD_EXCEEDED"]
  C2 -->|是| C3{"③ 起点可达性<br/>构图后起点有出边"}
  C3 -->|否| R3["UNREACHABLE 不连通"]
  C3 -->|是| C4{"④ 求路线 M5<br/>按禁行约束构图"}
  C4 -->|无解 断开| R4a["UNREACHABLE"]
  C4 -->|无解 禁行| R4b["RESTRICTION_VIOLATED"]
  C4 -->|有解| C5{"⑤ 时间窗<br/>完成时刻不超窗<br/>且与占用区间不相交"}
  C5 -->|否| R5["TIMEWINDOW_CONFLICT"]
  C5 -->|是| C6{"⑥ 电量<br/>battery 减 预计耗电<br/>大于等于 minBattery"}
  C6 -->|否| R6["BATTERY_INSUFFICIENT"]
  C6 -->|是| OK(["通过 → 进入代价计算"])

  style OK fill:#e8f5e9
  style R1 fill:#ffebee
  style R2 fill:#ffebee
  style R3 fill:#ffebee
  style R4a fill:#ffebee
  style R4b fill:#ffebee
  style R5 fill:#ffebee
  style R6 fill:#ffebee
```

> **顺序即优先级**：命中即短路返回。同一任务多个候选都不满足时取第一个失败原因，并按车辆排序保证稳定 —— 这是「拒绝可解释」（Req-M4-2）的实现基础。`message` / `detail` 必须带车辆编码与具体数值。

### 7.3 占用区间模型（防重复派车）

```mermaid
flowchart LR
  N["now 服务端时钟<br/>同一请求内所有策略共用"] --> T1["t1 = max(now, vehicle.freeAt)<br/>deadhead 到达起点"]
  T1 --> T2["t2 = max(t1, task.timeWindowStart)<br/>早到则等待"]
  T2 --> T3["t3 = t2 + executeTimeS<br/>预计完成"]
  T3 --> OCC["occupied = 区间 t2 到 t3"]
  OCC --> RULE1["半开区间相交判定<br/>a,b 与 c,d 相交才算冲突"]
  OCC --> RULE2["preview 阶段<br/>策略各自在内存维护槽位"]
  OCC --> RULE3["apply 阶段<br/>落 dispatch_plans 的 occupied_from/to"]
  RULE3 --> DERIVE["车辆 freeAt<br/>由最大 occupied_to 推导"]
```

### 7.4 多策略对比与代码边界

```mermaid
flowchart TB
  subgraph SHARED["shared · 契约唯一来源"]
    S1["enums/dispatch.ts<br/>strategy / rejectReason 【设计中】"]
    S2["types/dispatch.ts<br/>DTO 与快照类型 【设计中】"]
  end

  subgraph DOMAIN["desktop/domain/dispatch 【设计中】"]
    D0["dispatch.service.ts<br/>编排：鉴权 → 快照 → 算法 → 事务 → 日志/审计/事件"]
    D1["snapshot.ts<br/>buildSnapshot 组装与构图"]
    D2["evaluate.ts<br/>约束评估 + 代价计算"]
    D3["occupancy.ts<br/>占用区间与相交检测"]
    D4["explain.ts<br/>人类可读解释"]
    D5["errors.ts<br/>M4 错误码"]
  end

  subgraph ALGO["desktop/algorithms/dispatch 【设计中】"]
    A0["index.ts<br/>runDispatch(snapshot, strategy)"]
    A1["greedy.ts<br/>贪心，默认"]
    A2["hungarian.ts<br/>匈牙利指派，不可行格为无穷"]
    A3["types.ts<br/>算法层内部输入输出"]
  end

  subgraph REPO["desktop/db/repositories 【设计中】"]
    RP["task / vehicle / graph / restriction<br/>dispatch-plan / route / dispatch-log"]
  end

  S1 --> DOMAIN
  S2 --> DOMAIN
  S2 --> ALGO
  D0 --> D1
  D0 --> A0
  D1 --> D2
  D2 --> D3
  D0 --> REPO
  A0 --> A1
  A0 --> A2
  A0 --> A3

  BAN["【边界】边界约束<br/>algorithms 禁止 import db 与 domain<br/>service 不写 SQL，只调 Repository"]
  BAN -.- ALGO
  BAN -.- D0
```

**代价函数**（`DISPATCH_COST_WEIGHTS` 已落地为常量，D-12）：

| 分量 | 权重 | 含义 |
| --- | --- | --- |
| deadhead | 1 | 空驶时间 |
| execute | 1 | 执行时间 |
| wait | 0.8 | 等待时间（早到） |
| late | 2 | 迟到惩罚 |
| chargeRisk | 1000 | 电量风险罚项，用于把高风险指派推到队列末尾 |

---

## 8. 模块全景与依赖顺序

### 8.1 十个首期模块

```mermaid
flowchart TB
  subgraph L0["地基"]
    M1["M1 登录与权限【部分实现】"]
    M2["M2 基础数据 【设计中】"]
  end

  subgraph L1["业务主线"]
    M3["M3 任务管理 【设计中】"]
    M4["M4 调度引擎 【设计中】"]
    M5["M5 路径规划 【设计中】"]
  end

  subgraph L2["呈现与运行"]
    M6["M6 地图可视化 【设计中】"]
    M7["M7 运行监控与执行 【设计中】"]
    M8["M8 告警 【设计中】"]
  end

  subgraph L3["支撑"]
    M9["M9 审计与日志【部分实现】"]
    M10["M10 系统设置【部分实现】"]
  end

  M11["二期 统计分析 【二期】"]
  M12["二期 真实设备协议 【二期】"]

  M1 --> M2
  M2 --> M3
  M2 --> M5
  M3 --> M4
  M5 --> M4
  M3 --> M6
  M5 --> M6
  M4 --> M7
  M7 --> M8
  M1 --> M9
  M1 --> M10
  M7 -.数据源.-> M11
  M7 -.执行器可替换.-> M12

  style M11 stroke-dasharray: 5 5
  style M12 stroke-dasharray: 5 5
```

> `M11` / `M12` 为二期预留。`M7` 首期用**本地模拟执行器**（定时步进 + 轨迹采样），二期以真实协议替换执行器但**不改上层契约**（D-10）。

### 8.2 地图渲染链路（M6 · React Flow 方案 【设计中】）

> 选型与实现细节见 [`module-M6-map.md`](./module-M6-map.md)。此图只表达**数据流与职责边界**。

```mermaid
flowchart TB
  OV["GET /api/map/overview 【设计中】<br/>nodes · edges · sites · vehicles · tasks · routes · alerts · eventSeq"]
  OV2["可选 include=orders,orderEndpoints<br/>订单起终点图层"]

  subgraph MAP["renderer/map/（全部【设计中】，React Flow）"]
    direction TB
    HOOK["useMapOverview<br/>拉取 + 事件刷新 + 轮询兜底"]
    TOFLOW["model/toFlow.ts · 纯函数<br/>overview + 图层可见性 + 选中态 → nodes/edges"]
    PROJ["model/projection.ts<br/>米制 {x,y} → 画布坐标（y 翻转 × 比例）"]
    CANVAS["stage/FlowCanvas.tsx<br/>ReactFlow + Background + Controls + MiniMap"]
    NT["nodes/ · 5 类节点<br/>net · site · vehicle · taskEndpoint · orderEndpoint"]
    ET["edges/ · 2 类边<br/>net 基础边 · route 高亮边"]
  end

  EV["事件 UDM:Event<br/>vehicle.changed · execution.progress<br/>task.changed · alert.* · map.updated"]
  SEL["全局 selection<br/>（对象类型 + ID）"]
  LIST["任务列表 / 详情 / 告警中心"]

  OV --> HOOK
  OV2 -.-> HOOK
  EV --> HOOK
  HOOK --> TOFLOW
  PROJ --> TOFLOW
  SEL --> TOFLOW
  TOFLOW --> CANVAS
  CANVAS --> NT
  CANVAS --> ET
  CANVAS -. 点击实体 .-> SEL
  SEL -. 高亮 + 定位 .-> LIST

  style OV fill:#fffde7
  style OV2 fill:#fffde7
  style EV fill:#e8f5e9
```

**三条边界**（违反即为架构违规）：

1. `overview` 是画布**唯一**数据入口；地图不读 CSV、不调多次接口拼装。
2. 地图只渲染 `routes`，**不自行搜索路径** —— 禁行规则与可达性判定只在 M5。
3. 车辆位置以事件为权威、插值仅补帧且**禁止外推**；所有选中/缩放/图层开关都是页面态。

**M6 实现缺口**（截至本文档更新日）：

| 缺口 | 说明 |
| --- | --- |
| `map/overview` 服务端未实现 | M6 接口在 `docs/api.md` §3.6 已成稿，主进程侧尚未落地 |
| renderer 无入口 | 连 `src/main.tsx` 都没有，整层未实现 |
| `EventBus` 未按会话权限过滤 | 与第 10 章同一问题，M6/M8 落地时一并补 |
| 组件测试 setup 阻塞 | `tests/setup.ts` 缺依赖导致 0 测试可收集，且 jsdom 还需 `ResizeObserver` stub |

### 8.3 已实现 vs 待实现（截至 2026-09-14 实测）

```mermaid
flowchart LR
  subgraph DONE["【已实现】已落地且有实测支撑"]
    D1["shared 枚举 8 类<br/>权限点 20 个"]
    D2["错误目录 34 条"]
    D3["SQLite 连接与事务"]
    D4["迁移 0001 幂等"]
    D5["seed 可重入"]
    D6["IPC Router 鉴权 + traceId"]
    D7["登录 / 登出 / 会话"]
    D8["审计写入"]
    D9["事件总线落库"]
    D10["health / settings / users 接口"]
  end

  subgraph TODO["【设计中】待实现"]
    T1["renderer 全部<br/>入口 / 适配器 / 页面 / 地图"]
    T2["M2 站点车辆路网 CRUD"]
    T3["M3 任务状态机"]
    T4["M4 调度引擎"]
    T5["M5 路径规划与图搜索"]
    T6["M6 地图图层"]
    T7["M7 执行器与监控"]
    T8["M8 告警闭环"]
    T9["M10 设置写接口"]
    T10["测试 setup 修复"]
  end

  DONE -.下一阶段.-> TODO
```

---

## 9. 构建路线图 P1-P6

```mermaid
flowchart LR
  P1["P1 地基 【已实现】 基本完成<br/>workspaces · shared · 迁移 · seed<br/>IPC 骨架"]
  P2["P2 认证与主数据 【设计中】<br/>M1 补全 · M2 全量"]
  P3["P3 任务与地图 【设计中】<br/>M3 状态机 · M6 静态图层"]
  P4["P4 算法内核 【设计中】<br/>M4 · M5 · 模拟执行器"]
  P5["P5 监控告警 【设计中】<br/>M7 · M8 · 事件推送"]
  P6["P6 收尾 【设计中】<br/>M9 查询 · M10 设置<br/>演示数据 · 打包"]

  P1 --> P2 --> P3 --> P4 --> P5 --> P6

  G1["验收门<br/>dev:electron 起窗<br/>health 返回 db true【部分实现】"]
  G2["验收门<br/>三角色登录<br/>主数据 CRUD"]
  G3["验收门<br/>任务创建提交<br/>地图列表联动"]
  G4["验收门<br/>U1-U11 / S1-S8 绿<br/>preview → apply → start 通"]
  G5["验收门<br/>异常 → 告警 → 接管闭环"]
  G6["验收门<br/>安装包离线启动"]

  P1 -.- G1
  P2 -.- G2
  P3 -.- G3
  P4 -.- G4
  P5 -.- G5
  P6 -.- G6

  BLOCK["【阻塞】当前阻塞<br/>tests/setup.ts 缺依赖<br/>5 个测试套件全部无法收集"]
  BLOCK -.必须先解.-> P2
```

> **P1 剩余缺口**：`renderer` 无 `src/main.tsx`，导致 `npm run build` 失败、`npm run dev:electron` 必然白屏；`tests/setup.ts` 缺 `@testing-library/jest-dom`，导致 `npm test` 跑 0 个测试。

---

## 10. 事件流与实时推送

```mermaid
flowchart LR
  SRC["业务动作<br/>任务状态变化 / 车辆移动 / 告警创建"] --> EMIT["EventBus.emit<br/>type, payload, object 可选"]
  EMIT --> LOG["INSERT event_log<br/>seq 自增，payload 存 JSON 【已实现】"]
  LOG --> SEQ["取得 eventSeq"]
  SEQ --> PUSH["遍历 targets<br/>webContents.send udm:event 【已实现】"]
  PUSH --> RENDER["渲染层 dispatchApi.on<br/>按事件名过滤 【设计中】"]
  RENDER --> DEDUP["按 eventSeq 去重与节流 【设计中】"]
  DEDUP --> UI["更新 store 与视图 【设计中】"]

  TIMER["定时兜底<br/>settings monitor.refreshIntervalMs 默认 1000ms"] -.断连或丢失时补齐.-> RENDER
```

**七类领域事件**（`docs/api.md` §4）：

| 事件 | 载荷要点 | 触发时机 |
| --- | --- | --- |
| `task.changed` | taskId, code, status, transition, vehicleId | 任务任何状态变化 |
| `vehicle.changed` | vehicleId, code, status, x, y, battery | 位置 / 状态 / 电量变化 |
| `alert.created` | alertId, type, level, objectType, objectId | 新告警（角标 + toast） |
| `alert.updated` | alertId, status | 告警状态变化 |
| `map.updated` | eventSeq | 通用刷新信号 |
| `execution.progress` | taskId, vehicleId, progress, x, y | 高频进度（节流 ≥ 250ms） |
| `settings.changed` | key, value | 设置变更广播 |

> **当前实现差距**：`EventBus` 已能落库并推送，但**尚未按会话权限过滤事件**（`docs/api.md` §4 要求「由主进程按会话权限过滤后推送」）。M6/M8 落地时需补该过滤，否则监控员可能收到超出其权限的事件。另：`EventBus` 目前没有「一个事件推给多个窗口时每窗口独立权限」的处理，多窗口场景需一并设计。

---

## 11. 部署与数据存储形态

```mermaid
flowchart TB
  subgraph DEV["开发形态"]
    DEV1["npm run dev<br/>仅 Vite，浏览器 + MockAdapter 【设计中】"]
    DEV2["npm run dev:electron<br/>Vite 加 Electron，真实 SQLite 【部分实现】"]
  end

  subgraph PROD["生产形态 · 打包后 【二期】"]
    PR1["Electron 主进程"]
    PR2["loadFile renderer/dist/index.html<br/>base 为相对路径 【已实现】"]
    PR3["用户数据目录 SQLite 【二期】"]
  end

  subgraph DBFILES["数据库文件"]
    F1["开发<br/>desktop/.data/app.db 【已实现】"]
    F2["环境变量覆盖<br/>UDM_DB_PATH 【已实现】"]
    F3["WAL 模式<br/>app.db-wal / app.db-shm 【已实现】"]
  end

  DEV2 --> F1
  F2 -.覆盖默认路径.-> F1
  F1 --> F3
  PR3 -.待定：打包后库位置需评估.-> F2
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `UDM_DB_PATH` | `desktop/.data/app.db` | 数据库路径，测试用 `:memory:` |
| `UDM_RENDERER_URL` | `http://localhost:5173` | 开发期加载的渲染层地址 |
| `VITE_PORT` | `5173` | 渲染层 dev 端口，严格占用 |
| `VITE_API_ADAPTER` | `mock` | `mock` / `ipc` / `http` |
| `VITE_API_BASE_URL` | `/api` | 仅 http 适配器使用 |

> **日志与隐私**：SQLite 已开启 WAL、外键与 `busy_timeout = 5000ms`。`audit_logs` 会记录操作者与 before/after，落地真实数据前需确认**不写入敏感信息**（提交纪律「禁止项」第 4 条）。

```mermaid
stateDiagram-v2
  state "告警状态（D-09）" as A {
    [*] --> new
    new --> acknowledged : ack
    acknowledged --> processing : 开始处理
    processing --> resolved : 解决
    resolved --> archived : 归档
    new --> archived : 直接归档
    acknowledged --> archived : 直接归档
    processing --> archived : 直接归档
    note right of archived
      已解决告警超期自动归档
      默认 90 天，参数 alert.autoArchiveDays
    end note
  }
```

```mermaid
stateDiagram-v2
  state "派发计划状态（D-04）" as P {
    [*] --> applied : apply 写入
    applied --> superseded : 新计划生效，旧计划置位
    applied --> cancelled : 取消
    note right of superseded
      旧计划不删除
      保留可对比、可复核、可回放
    end note
  }
```
