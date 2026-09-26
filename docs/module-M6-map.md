# 模块开发文档：地图渲染（M6）· React Flow 方案

> 版本：v1.2 · 面向开发 · 状态：**已实现（待评审项见 §12）**
> 关联：`design.md` §2.3 / §2.4 / §4.6 · `docs/api.md` §3.6 / §4 · `docs/data-interfaces.md` §10（F2 仿真地图）
> 定位：把 M6 的地图渲染从「自研 SVG/Canvas 平面图层」替换为 **React Flow（`@xyflow/react` v12）**，
> 并给出渲染层文件划分、数据映射、动画/性能/测试口径。任何实现偏差必须先回写本文档与 `AGENTS.md`。
> **文档边界**：本文件只负责「M6 地图渲染的模块内实现口径」。其余事实按 [`docs/api.md`](./api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**。

## 1. 目标与边界

### 1.1 为什么换

`design.md` §2.3 原选型为「自研 SVG/Canvas 平面图层」，理由只有一条：**离线稳定、不依赖真实地图服务**。
该理由至今成立，但自研方案要自己实现的部分并不少，而这些恰好是 React Flow 的成熟能力：

| 自研必须手写的部分 | React Flow 现成能力 |
| --- | --- |
| 缩放/平移/滚轮与触摸手势、缩放边界 | 内置视口（`panOnScroll` / `zoomOnPinch` / `minZoom` / `maxZoom`） |
| 节点命中测试、悬停、选中、点选空白取消 | 内置的选择与 `onNodeClick` / `onPaneClick` |
| 上千元素的重绘与「只渲染视口内元素」优化 | `onlyRenderVisibleElements` |
| 画布坐标系 ↔ 屏幕坐标系的换算与事件反查 | 内置 `viewport`、`useReactFlow().screenToFlowPosition` |
| 小地图、控件、背景网格 | `MiniMap` / `Controls` / `Background` 组件 |
| 标签、箭头、虚线动画、边标签渲染 | `MarkerType` / `animated` / `EdgeLabelRenderer` |

关键前提（**历史**）：提出本方案时 M6 尚未实现（`renderer/` 连 `src/main.tsx` 都没有），
因此是一次**零迁移成本的选型替换**，不存在需要重写的既有画布代码。

> **现状（2026-09-21）**：M6 已按本方案落地 —— `renderer/src/map/`（`MapView` / `toFlow` / 节点与边组件 /
> `useVehicleMotion`）已实现，并有 8 个测试套件覆盖；`npm run build` 与 `npm test` 均通过。
> 本方案剩余未决项见 §12（Q-1 React Flow 署名策略须在对外分发前确认）。

### 1.2 必须说清楚的边界：React Flow 不是地图库

React Flow 是**节点-连线图（node/edge graph）渲染器**，不是地理地图库。它没有地理投影、没有经纬度、
没有底图瓦片、没有路网吸附。它提供的是：任意二维坐标系里的节点与边、视口变换、交互与事件。

这在本项目**恰好是匹配的**，因为：

- `design.md` §3.2 已规定坐标统一为平面 `{x, y}` 米制（D-05），**禁止内部混用经纬度**；
- 路网本身建模为「节点 + 有向边」（`nodes` / `edges` 两张表）；
- 任务起终点、车辆位置、路线（`nodeIds` 序列）都能自然表达为图元素。

因此本方案不引入任何真实地图语义。二期若要做经纬度，按 `design.md` §3.2 的既定说法，
在 `shared/src/types.ts` 增加**显式转换层**，把经纬度投影为平面坐标后再交给 React Flow —— 上层渲染代码不需要改。

### 1.3 由此确定的三条硬约束

1. **零在线依赖**：不得引入瓦片服务、地理编码、字体 CDN、在线图标库；渲染必须能离线启动（实测结论见 §11）。
2. **渲染层不得越界**：地图只做「渲染 + 交互 + 页面态」，不自己算路径、不自己改业务状态（`design.md` §2.1 层间规则）。
3. **坐标只有一个来源**：`map/overview` 返回的 `{x, y}` 是唯一权威坐标；渲染层的像素换算是**展示变换**，
   禁止把它写回业务数据。

## 2. 选型与实测依据

### 2.1 选型结论

| 项 | 结论 |
| --- | --- |
| 包名 | `@xyflow/react`（React Flow v12 的正式包名，v10/v11 时代的 `reactflow` 已废弃，不要装错） |
| 版本 | `12.11.6`（实测时的 `latest`） |
| 许可 | MIT |
| 对等依赖 | `react >= 17` / `react-dom >= 17`，与现有 React 18.3.1 兼容 |
| 安装位置 | `renderer/package.json` 的 `dependencies`（**只在 renderer**，shared / desktop 不得依赖） |
| 样式 | `import '@xyflow/react/dist/style.css'`（或在 `main.tsx` 统一引入） |
| 内部依赖 | `zustand ^4.4.0`、`classcat`、`@xyflow/system` |

> **注意（实测）**：`@xyflow/react` 自带 `zustand@4.5.7`，会装进 `renderer/node_modules/@xyflow/react/node_modules/zustand`，
> 与项目使用的 `zustand@5.0.15` **并存两份**。两者互不干扰（React Flow 只用自己那份），但会让
> `node_modules` 再多一层嵌套，排查版本问题时别混淆 —— 这与本项目已有的「两套 Vite（6.4.3 / 5.4.21）」是同类现象。

### 2.2 实测数据（2026-09-20）

以下均为**本次实测**，不是估算。环境：Electron 44.3.0 + React 18.3.1 + Vite 6.4.3，macOS。

| 验证项 | 方法 | 结果 |
| --- | --- | --- |
| 依赖树可解析 | `npm i @xyflow/react@12.11.6 react@18.3.1 react-dom@18.3.1` | ✅ 26 个包，无 peer 冲突 |
| Vite 6 构建（renderer 形态） | `vite build`，含 `ReactFlow` + `Background` + `Controls` + `MiniMap` + 自定义节点 | ✅ 186 模块，431ms |
| 产物体积 | 同上 | 330.62 kB（gzip 106.66 kB）+ CSS 15.87 kB（gzip 2.67 kB） |
| **体积增量** | 与「仅 React + react-dom」基线 143.65 kB（gzip 46.08 kB）对比 | **+186.97 kB（gzip +60.58 kB）** |
| 运行时离线 | 扫描产物 JS 中的 `new Worker` / `WebAssembly` / `eval(` / 动态 `import(` / `http(s)://` | ✅ 全部为 0；仅出现 `reactflow.dev`（版权署名链接的字符串常量），**无运行时网络请求** |
| Electron 端真实渲染 | Electron 44 `loadFile()` 加载产物，`executeJavaScript` 读真实 DOM | ✅ 视口 1 个、节点 1 个、边 1 条、`<path d="M29.2 26.5L…">` 正常、节点包围盒 233×90 |
| 车辆沿路线移动 | 折线 `n1→n2→n3` 按进度插值，定时更新节点 `position` | ✅ 3 次采样车辆屏幕坐标依次为 (229,119) → (508,319) → (337,148)，确实在沿折线移动 |
| 性能 · 演示量级 | 1200 节点 / 2330 边，车辆节点 20 Hz 刷新，采样 3s 帧间隔 | ✅ 中位 8.3 ms、p95 9.0 ms、max 9.4 ms（≈120 fps 未掉帧） |
| 性能 · 设计上限量级 | 2000 节点 / 3910 边，同样 20 Hz 刷新 | ✅ 中位 8.3 ms、p95 16.7 ms、max 17.4 ms（仍达 60 fps） |
| jsdom 组件测试（Vitest 2.1.9 + Vite 6.4.3） | `render(<ReactFlow …/>)`，断言渲染出节点文本 | ✅ 1 passed（需 §10 的 stub） |
| jsdom 组件测试（Vitest 2.1.9 + Vite 5.4.21，即**本仓库根**配置） | 同上 | ✅ 1 passed（Vite 5 / 6 双版本均可） |

### 2.3 实测暴露的四个关键事实

这四条会直接改变实现写法，先把结论放前面：

1. **默认不会自动选「最近的 handle」**。实测：A、B 两节点水平相邻，若自定义节点里按上/右/下顺序声明 handle
   且边上不写 `sourceHandle` / `targetHandle`，边会**取声明顺序里第一个**（Top），画出 `M 20,-4L 320,-4`
   （贴节点顶边），而不是期望的「右→左」水平连线。
   → 路网连线必须**显式指定 handle id**，或者干脆用「居中单 handle」方案（见 §5.2）。
2. **同源同目标的边会完全重叠，且按数组顺序绘制，后者在上**。实测：基础边 `base` 与高亮边 `route`
   （同 `source`/`target`）路径 `d` 完全相同，样式各取各的（stroke `#bdbdbd` / `#1e88e5`）。
   → 路线高亮为**独立边**并**排在基础边之后**，不能指望自动错线。
3. **`hidden: true` 对节点与边都有效**，元素不进入 DOM（实测隐藏 1 节点 + 1 边，DOM 中均未出现）。
   → 图层开关用 `hidden`，不要用「过滤掉元素」——后者会导致每次开关重建数组、丢失选中态。
4. **Electron 的 `file://` 可正常加载 ES module，Chrome 直接开 `file://` 不行**。
   实测：Electron 44 用 `loadFile()` 加载含 `<script type="module">` 的页面，React Flow 正常渲染；
   而同一份产物用 Chrome headless 打开 `file://` 则被拦（用最小复现验证：纯 `type="module"` 脚本
   BLOCKED、同样内容的传统 `<script src>` 正常）。**这不是 React Flow 的问题，是 Chromium 对 `file://`
   模块脚本的 CORS 限制**。本项目生产形态是 Electron `loadFile`，因此不受影响；细节与兜底见 §11。

## 3. 代码结构规划

`design.md` §2.4 已把 `map/` 列入 renderer 目录。本方案把它展开（**全部新增，无既有代码需改动**）：

```text
renderer/src/map/
├── MapView.tsx                # 页面级容器：ReactFlowProvider + 画布 + 面板
├── stage/
│   ├── FlowCanvas.tsx         # <ReactFlow> 装配：props、事件、Background/Controls/MiniMap
│   ├── nodeTypes.ts           # 模块级常量（禁止内联对象，见 §9 注意事项）
│   └── edgeTypes.ts           # 同上
├── nodes/
│   ├── NetNode.tsx            # 路网节点（小圆点）
│   ├── SiteNode.tsx           # 站点（按 type 变色/换图标：depot/dock/charging/gate）
│   ├── VehicleNode.tsx        # 车辆（含状态色环、电量角标、朝向）
│   ├── TaskEndpointNode.tsx   # 任务起终点（from/to 两种样式）
│   └── OrderEndpointNode.tsx  # 订单起终点（含匹配置信度、未定位态）
├── edges/
│   ├── NetEdge.tsx            # 基础路网边（含禁行虚线与限速标注）
│   └── RouteEdge.tsx          # 路线高亮边（含距离/耗时标签、箭头）
├── model/
│   ├── projection.ts          # 米制坐标 → 画布坐标（含 y 轴翻转、PIXELS_PER_METER）
│   ├── ids.ts                 # 跨图层 id 命名空间（net:/site:/veh:/task:/route:/order:）
│   ├── toFlow.ts              # MapOverview → { nodes, edges }（纯函数，本模块核心）
│   └── layers.ts              # 图层定义、可见性、渲染顺序
├── hooks/
│   ├── useMapOverview.ts      # 拉取 + 事件驱动刷新 + 轮询兜底
│   ├── useLayerVisibility.ts  # 页面态图层开关
│   ├── useVehicleMotion.ts    # 车辆位置补帧（rAF 插值）
│   └── useSelectionSync.ts    # 与全局 selection 双向联动
└── style/
    └── map.css                # 节点/边主题变量（不引第三方图标字体）
```

边界约束：

1. `map/` 只依赖 `shared` 与 `renderer/src/api/` 适配器；**禁止** import `desktop/**` 或 Node/Electron 能力。
2. `model/toFlow.ts` 必须是**纯函数**：入参为 `MapOverview` + 图层可见性 + 选中态，出参为 React Flow 的
   `{ nodes, edges }`；不读全局状态、不发请求。这样它可以被单测覆盖（§10）。
3. 组件不自己 `fetch`：数据只从 `useMapOverview` 进来，保持「一个页面一个数据入口」。

### 3.1 现状（2026-09-25）与样式归属

上表是**规划视图**，实现后有两处变化，按事实如实登记（避免后来者照规划找文件）：

1. **节点/边类型注册表合并**：`stage/nodeTypes.ts` 与 `stage/edgeTypes.ts` 未单独成文件，
   改为 `nodes/index.ts` 与 `edges/index.ts` 各自导出**模块级常量** `nodeTypes` / `edgeTypes`
   （约束不变：**禁止**写成内联对象，见 §9 第 1 条）。
2. **`map/` 下实际多了这些文件**：`model/` 另含 `structural`（结构签名，D-23）、`motion`、
   `focus`（聚焦压暗）、`metrics`（画布指标）、`detail`（详情卡内容）、`palette`（真色值，供 MiniMap）、
   `edgeIndex`（边长索引）、`visualization`；`hooks/` 另含 `useMapShortcuts`、`useZoomLevel`；
   另有 `panels/`（`MetricsBar` / `LayerPanel` / `DetailPanel`）。

**样式归属（D-36）**：`style/map.css` 现在**只保留画布专有样式**（布局、指标条与画布提示这两处浮层、
图层面板、详情卡、节点与边、选中/压暗效果、React Flow 内置组件的主题接入）。
原先放在这里的**通用基元已抽到 `renderer/src/styles/ui.css`**：
`.udm-panel` / `.udm-kv` / `.tone-*` / `.udm-chip` / `.udm-btn--ghost` / `.udm-icon-btn`，
以及 `.udm-swatch` 的**基类与 6 个图层色变体**全量。
判定规则是「**被 2 处以上使用 → 归设计系统**」，因为它们同时服务地图与工作台/外壳。
色值本身仍只在 `theme.css` 定义一次，并由 `palette.test.ts` 断言 CSS 变量与 `model/palette.ts`
的字面量逐条一致 —— 因此 swatch 搬了文件，颜色来源没变。

> 改样式时的落点选择：**只服务画布 → 本文件的 `map.css`；被两处以上使用 → `styles/ui.css`；
> 只是换个色值 → `styles/theme.css`（改完让 `palette.test.ts` 告诉你哪里过期了）。**

## 4. 数据映射（唯一入口：`model/toFlow.ts`）

### 4.1 输入

唯一数据来源是 `docs/api.md` §3.6 的 `GET /api/map/overview`：
`nodes` / `edges` / `sites` / `vehicles` / `tasks` / `routes` / `alerts` / `eventSeq`，
以及订单领域按 `?include=orders,orderEndpoints` 追加的订单端点（`docs/order-data-map-design.md` §5）。

**禁止**地图直接读 CSV 或自己拼多次请求 —— 这既是 Req-M6-5 的要求，也是保证快照一致性的前提
（否则路网与车辆可能来自不同时刻，出现「车在已禁用的边上」这类鬼影）。

### 4.2 坐标变换（`projection.ts`）

```ts
// design.md §3.2：业务坐标 { x, y } 单位米，x 向右、y 向上（数学坐标系）
// React Flow / DOM：y 向下。因此必须翻转 y，并乘一个展示比例。
const PIXELS_PER_METER = 3; // 可配置常量，不改业务数据

export function toFlowXY(p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x * PIXELS_PER_METER, y: -p.y * PIXELS_PER_METER };
}
```

要点：

- **只做线性变换，不做投影**。二期接经纬度时在此文件增加显式投影函数，上层组件不动。
- `PIXELS_PER_METER = 3` 的依据：seed 路网为 4×3 网格、间距 20 m（`desktop/src/db/seed.ts`），
  3 px/m 时相邻节点相距 60 px，足以容纳 24–28 px 的节点标记且不互相压盖；60 m × 40 m 的路网
  约 180 × 120 px，配合 `fitView` 会放大到合适视野。
- 该比例**不进设置表、不进接口**：它是渲染层的展示常量，改动不影响任何落库数据。
- 反向换算（点击坐标 → 业务坐标）只在需要时提供 `fromFlowXY`，且**只用于提示**，不写回业务。

### 4.3 节点映射

| 图层 | 数据源 | 节点 id | 类型 | 位置 | 关键 data |
| --- | --- | --- | --- | --- | --- |
| 路网节点 | `overview.nodes` | `net:<id>` | `net` | `toFlowXY(node)` | `code`、`status` |
| 站点 | `overview.sites` | `site:<id>` | `site` | `toFlowXY(site)`（无 x/y 时用绑定节点坐标） | `code`、`type`、`status` |
| 车辆 | `overview.vehicles` | `veh:<id>` | `vehicle` | `toFlowXY(vehicle)` | `code`、`status`、`battery`、`taskId` |
| 任务起终点 | `overview.tasks` | `task:<id>:from` / `:to` | `taskEndpoint` | 由 `fromSiteId` / `toSiteId` 解析到站点坐标 | `code`、`role` |
| 订单起终点 | `overview.orderEndpoints` | `order:<orderId>:from` / `:to` | `orderEndpoint` | 同上；**未匹配则不上图** | `confidence`、`matchType`、`pathStatus` |
| 告警 | `overview.alerts` | 不新建节点 | — | 角标挂在 `objectType`/`objectId` 对应节点上 | `level`、`type` |

三条硬性规则：

1. **id 必须带命名空间前缀**。业务 id 可能撞车（站点 id 与路网节点 id 都是 UUID 形态），
   React Flow 要求全局唯一 id，故统一用 `net:` / `site:` / `veh:` / `task:` / `route:` / `order:` 前缀。
2. **坐标缺失不伪造**。订单未匹配到地区时，按 `docs/order-data-map-design.md` §5 **不上图**，
   只进「未定位订单」列表；这与该文档「不伪造坐标」的要求一致。
3. **告警不生成独立节点**，而是作为角标叠加到目标实体节点上，避免同一位置堆叠多个元素。

### 4.4 边映射

| 图层 | 数据源 | 边 id | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| 基础路网 | `overview.edges` | `net:<id>` | `net` | `disabled` 边用虚线 + 灰色；有 `speedLimitMps` 时在边上标注 |
| 路线高亮 | `overview.routes[].nodeIds` | `route:<routeId>:<seq>` | `route` | 相邻节点两两成边；`active` 加动画，`superseded` 用暗色细线 |
| 车辆位置 | `overview.vehicles` | 不用边 | — | 车辆是节点，不画「车→节点」的辅助边 |

**路线分段的三个实现要点**（均已实测）：

1. 每段是一个独立边，`source`/`target` 为该段两端节点；`seq` 保证 id 唯一。
2. **高亮边必须排在基础边之后**（数组顺序即绘制顺序，实测确认后者在上）。
   由于同源同目标的边路径完全重合，靠样式区分，不指望自动错线。
3. 若路线段的 `source`/`target` 在 `overview.nodes` 中不存在（数据不一致），**跳过该段并记一条开发期警告**，
   不要让 React Flow 抛错导致整张图白屏。

### 4.5 图层与渲染顺序

`layers.ts` 固定图层与顺序（自下而上）：

```text
1  background      背景网格（Background 组件）
2  netEdges        基础路网边
3  routeEdges      路线高亮边（+ 轨迹回放线）
4  netNodes        路网节点
5  sites           站点
6  taskEndpoints   任务起终点
7  orderEndpoints  订单起终点
8  vehicles        车辆（最上层，必须始终可见）
9  overlays        告警角标 / 悬浮卡片 / EdgeLabelRenderer 内容
```

图层开关只切 `hidden`（实测有效），**不移除元素**：这样关闭再打开时选中态、视口、动画进度都不丢。
`vehicles` 与 `overlays` 建议不允许关闭（或至少保证「全部关闭」时给出空态提示）。

## 5. 节点与边类型系统

### 5.1 自定义类型注册

```ts
// stage/nodeTypes.ts —— 模块级常量，只创建一次
import { NetNode } from '../nodes/NetNode';
import { SiteNode } from '../nodes/SiteNode';
import { VehicleNode } from '../nodes/VehicleNode';
import { TaskEndpointNode } from '../nodes/TaskEndpointNode';
import { OrderEndpointNode } from '../nodes/OrderEndpointNode';

export const nodeTypes = {
  net: NetNode,
  site: SiteNode,
  vehicle: VehicleNode,
  taskEndpoint: TaskEndpointNode,
  orderEndpoint: OrderEndpointNode
} as const;
```

对应地 `edgeTypes = { net: NetEdge, route: RouteEdge }`。

### 5.2 Handle 策略（本方案最容易踩坑的地方）

实测已确认「不会自动选最近的 handle」，因此**二选一**，不要混用：

- **方案 A（推荐）：单 handle 居中。** 每个节点只放一个 `source` 与一个 `target`，
  用 `style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0 }}` 压到节点中心。
  实测边路径从节点中心出发（`M 5,9L 205,101` 这类），连线视觉上贴合路网几何，且**不需要为每条边算 handle**。
  路网节点、车辆、站点全部适用。
- **方案 B：四向 handle + 显式绑定。** 节点声明 `s-t/s-r/s-b/s-l` 与 `t-t/t-r/t-b/t-l`，
  每条边显式写 `sourceHandle` / `targetHandle`。实测显式绑定生效（水平相邻节点走「右→左」），
  但要求 `toFlow.ts` 根据两端相对位置计算方向 —— **只有在必须画「正交折线」时才值得这么做**。

首期统一用方案 A；`NetEdge` 用 `type: 'straight'` 而非 `default`(bezier)，
因为路网边的几何语义是直线段，贝塞尔曲线会让「路网看起来是弯的」。

### 5.3 节点视觉约束

- 尺寸固定（路网节点 24×24、站点 28×28、车辆 28×28）并**写进 `style.width/height`**，
  避免 React Flow 为了测量尺寸产生的额外渲染；固定尺寸也让 `onlyRenderVisibleElements` 的判定更准。
- 不引入图标字体或在线 SVG：图标一律内联 SVG 或 CSS 形状，满足 §1.3 的零在线依赖。
- 选中态用 CSS 类，不用改 `data`（改 `data` 会触发节点重渲染）。
- 告警角标在 `VehicleNode`/`SiteNode` 内部按 `data.alerts` 渲染，不额外加 DOM 层。

## 6. 视口与交互

`FlowCanvas.tsx` 的装配参数（对应 Req-M6-4）：

| 需求 | 实现 |
| --- | --- |
| 缩放 | `minZoom={0.1}` `maxZoom={4}`（默认值是 0.5–2，对本项目偏窄，需显式放宽） |
| 平移 | `panOnDrag`（左键拖拽）默认开启；`panOnScroll` 可选（滚轮平移、Ctrl 滚轮缩放） |
| 复位视角 | `useReactFlow().fitView({ padding: 0.2, duration: 300 })` |
| 缩放到某实体 | `useReactFlow().setCenter(x, y, { zoom, duration })`，用于列表联动定位 |
| 图例 | 画布角落的固定定位面板（纯 DOM，不用 React Flow 组件） |
| 空态 | 无数据时渲染可读文案而非空白画布（`design.md` §7.2 第 6 条） |

交互与全局状态的关系（Req-M6-2）：

1. 地图点击实体 → 写全局 `selection`（对象类型 + ID）。
2. 列表点击 → `selection` 变化 → 地图高亮并把视口移到该实体。
3. 点击空白（`onPaneClick`）→ 清空 `selection`。
4. 高亮与选中态**不落库**（`design.md` §4.6 已明确「图层开关、缩放、选中态均为页面态」）。

`useSelectionSync.ts` 只做「selection → 高亮属性」的映射；**禁止**在渲染期 `setState`，
联动定位要用 `useEffect` 包住，否则会触发 React Flow 的重复渲染循环。

## 7. 路线高亮与车辆动画

### 7.1 路线高亮

1. `routes[].nodeIds` → 相邻节点对 → `route:<id>:<seq>` 边，`animated: true` 表示执行中。
2. 高亮边 `style.strokeWidth` 大于基础边（如 5 vs 2），并加 `markerEnd` 箭头表示行进方向。
3. 距离/耗时标签用 `EdgeLabelRenderer` 渲染 —— 实测可用：自定义边组件内输出
   `<EdgeLabelRenderer><div style={{ position:'absolute', transform:'translate(-50%,-50%) translate(Xpx,Ypx)' }}/></EdgeLabelRenderer>`，
   标签会出现在 `.react-flow__edgelabel-renderer` 容器中（实测读到了 `120 m` 文本）。
4. 计划版本对比（D-04）用**两条不同颜色的路线边**表达，`superseded` 用暗色细线，不删除。

### 7.2 车辆位置：以事件为准，插值为辅

原则：**权威位置来自 `execution.progress` / `vehicle.changed` 事件的 `x`/`y`，插值只用来补帧平滑**。

```text
事件到达 (vehicleId, x, y, ts)
  → 更新 motion 表：{ from: 当前位置, to: 新坐标, t0: 现在, dur: 预计到达时间 }
  → rAF 循环按 t 在 from→to 之间线性插值（或沿路线折线插值）
  → 只更新该车辆的节点 position（定向更新，不重建整个 nodes 数组）
  → 超过 2 个节流窗口（≥500ms）没有新事件 → 冻结当前位置，不无限外推
```

约束：

- **禁止外推**（不能用上一次速度预测位置）：模拟执行器可能暂停、失败或接管，
  外推会让车「自己开到不存在的位置」，与 `design.md` §3.3「算法输出态不得污染业务数据」的精神冲突。
- 轨迹回放（Req-M6-6）走 `GET /api/map/tracks/{vehicleId}`：把采样点画成一条只读的 `route` 类边 +
  一个跟随时间轴的车辆节点；回放时**冻结实时刷新**，避免两个数据源打架。

## 8. 实时刷新与事件接入

沿用 `docs/api.md` §4 的既有约定，不新增事件：

| 事件 | 地图侧动作 |
| --- | --- |
| `vehicle.changed` | 定向更新该车辆节点 position/status/battery |
| `execution.progress` | 同上（高频，节流合并） |
| `task.changed` | 更新任务起终点节点与相关路线边（`assigned`/`running` 时出现/高亮） |
| `alert.created` / `alert.updated` | 更新对应实体节点的告警角标 |
| `map.updated` | **拉取一次 `/api/map/overview`**（路网/站点/批量变化的兜底信号） |
| `settings.changed` | 若 `monitor.refreshIntervalMs` 变化，重建轮询定时器 |

去重与节流（与 `docs/api.md` §4「监听须知」一致）：

1. 按 `eventSeq` 去重：丢弃 `seq <= lastSeq` 的事件（重连后可能收到重复推送）。
2. 高频事件（`execution.progress` / `vehicle.changed`）按 **≥250 ms** 节流合并，同一车辆只保留最后一个。
3. 定时兜底轮询 `settings monitor.refreshIntervalMs`（默认 1000 ms）：断连或丢事件时补齐。
4. 页面不可见（`document.hidden`）时暂停轮询与 rAF，回到前台立即补一次全量拉取。

## 9. 性能预算与护栏

实测（§2.2）已经证明 React Flow 在本项目量级上**不是瓶颈**：2000 节点 + 3910 边、20 Hz 刷新下
中位帧 8.3 ms。但这依赖下面几条写法，**违反任一条都会显著掉帧**：

1. **`nodeTypes` / `edgeTypes` 必须是模块级常量或用 `useMemo` 包住**。
   写成内联对象（`nodeTypes={{ vehicle: VehicleNode }}`）会让 React Flow 每次渲染都认为类型变了，
   从而**卸载再重挂载所有节点** —— 这是 React Flow 最常见的性能事故。
2. **`nodes` / `edges` 数组只在数据真变了才换新引用**；静态图层（路网节点/边）与动态图层（车辆/路线）
   分开维护，避免「一辆车移动」导致上千条静态边重渲染。
3. **车辆位置用定向更新**（`useReactFlow().updateNode(id, …)`），不要 `map` 出全新的 `nodes` 数组。
4. 开启 `onlyRenderVisibleElements`；节点尺寸固定（§5.3），提高视口裁剪命中率。
5. `nodesDraggable={false}` `nodesConnectable={false}` `elementsSelectable` 保留 ——
   地图是只读视图，可拖拽/可连线既无业务意义，又会引入多余的手势与命中测试开销。
6. 节点内部保持轻量：不要为每个节点挂 `IntersectionObserver`、`ResizeObserver` 或大块 SVG。

**规模护栏**：`design.md` §8 的非功能指标是「节点 ≤ 2000、边 ≤ 6000」。实测覆盖到 2000 节点 / 3910 边。
若导入的仿真地图超过该量级（`docs/data-interfaces.md` §9.3 已有大文件约束），按以下顺序降级：

1. 超出阈值时默认只渲染「当前视口 + 关联路线 + 车辆」的边，其余边折叠为聚合提示；
2. 提供「精简模式」（隐藏路网节点，只留站点/车辆/路线）；
3. `docs/data-interfaces.md` §4.4 的图结构校验应在**导入侧**就拦截超大图，而不是让渲染层兜底。

## 10. 测试方案

### 10.1 jsdom 必须补的 stub（实测踩过）

`render(<ReactFlow/>)` 在 jsdom 中会直接抛 `ReferenceError: ResizeObserver is not defined`
—— React Flow 内部依赖 `ResizeObserver` 测量节点尺寸。最小 stub（实测通过）：

```ts
// tests/setup.ts（renderer 部分）
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

// 若引入 MiniMap/Controls 或主题检测，还需 matchMedia
(globalThis as any).matchMedia = (globalThis as any).matchMedia ?? ((q: string) => ({
  matches: false, media: q, onchange: null,
  addListener() {}, removeListener() {},
  addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false
}));
```

> ⚠️ **依赖既有阻塞项**：本仓库 `tests/setup.ts` 目前因缺少 `@testing-library/jest-dom` 导致
> **5 个既有测试套件全部无法收集**（见 `AGENTS.md` 验证基线）。M6 的渲染层测试必须以「先修好 setup」
> 为前提，否则新增用例同样跑不起来。建议把 setup 拆成 renderer 专用文件，`ResizeObserver` 等
> DOM stub 只对 `renderer/**` 生效（`vitest.config.ts` 已有 `environmentMatchGlobs` 的机制可借鉴）。

### 10.2 测试清单（建议）

| 编号 | 用例 | 层次 |
| --- | --- | --- |
| M6-U1 | `toFlowXY` 的 y 轴翻转与比例缩放（含负坐标） | 纯函数单测 |
| M6-U2 | id 命名空间：路网节点/站点/车辆 id 前缀正确且全局唯一 | 纯函数单测 |
| M6-U3 | 路线分段：`nodeIds` 4 个 → 3 条边，`seq` 递增、顺序在基础边之后 | 纯函数单测 |
| M6-U4 | 坐标缺失/引用不存在节点时跳过而不抛错 | 纯函数单测 |
| M6-U5 | 图层开关只切 `hidden`，元素数量不变 | 纯函数单测 |
| M6-U6 | `eventSeq` 去重：乱序/重复事件被丢弃 | hook 单测 |
| M6-U7 | 车辆插值：t=0/0.5/1 的坐标落在折线对应位置；超时后不外推 | hook 单测 |
| M6-C1 | `<MapView/>` 挂载后渲染出预期数量的节点与边（jsdom + stub） | 组件测试 |
| M6-C2 | 点击车辆节点调用 `selection` 更新；点空白清空 | 组件测试 |
| M6-C3 | 空 `overview` 时渲染空态文案，不白屏 | 组件测试 |
| M6-S1 | Electron 冒烟：`loadFile` 后 `.react-flow__node` 数量与 overview 一致 | 端到端 |

## 11. 打包与离线（含 `file://` 实测结论）

1. **离线能力**：产物无 Worker / WASM / 动态 import / 运行时网络请求（§2.2 实测），
   满足 `design.md` §8「Electron 包可离线启动」。
2. **Electron 生产形态没问题**：`desktop/src/main.ts` 用 `window.loadFile(resolve(..., 'renderer', 'dist', 'index.html'))`，
   实测 Electron 44 下 `type="module"` 脚本正常执行、React Flow 正常渲染。
3. **不要用 Chrome 直接开 `file://` 验收**：实测 Chromium 会以 CORS 规则拦截 `file://` 下的模块脚本
   （最小复现：模块脚本 BLOCKED、同样内容的传统脚本正常）。这是**浏览器行为，不是打包缺陷**，
   验收请用 `npm run dev:electron` 或 `vite preview`（HTTP）。
4. **兜底方案**：若未来 Electron/Chromium 收紧该行为，把 renderer 构建改为单文件 IIFE
   （`rollupOptions.output.format = 'iife'` + `inlineDynamicImports: true`）即可，实测该形态在 `file://`
   下可正常渲染。注意：`base: './'`（`renderer/vite.config.ts` 已配置）是前提，不要改成绝对路径。
5. **署名合规**：React Flow 为 MIT，允许隐藏右下角署名（`proOptions={{ hideAttribution: true }}`），
   但官方请求隐藏时给予支持（订阅 React Flow Pro）。**这是产品/合规选择，列入待评审**（§12 Q-3）。

## 11.5 实现期实测新增结论（2026-09-20 落地时发现）

以下四条都是**写完代码后在真实 Electron 里量出来的**，与前述章节的「选型期实测」互补。
其中前三条若不修正，功能会「看起来没问题、实际不生效」，属于最危险的一类缺陷。

### 11.5.1 `MiniMap` 只为「有尺寸」的节点画方块

`@xyflow/react` 的 `NodeComponentWrapperInner` 有这一句：

```js
if (!node || node.hidden || !nodeHasDimensions(node)) return null;
// nodeHasDimensions = (measured?.width ?? width ?? initialWidth) !== undefined && 高度同理
```

实测（Electron 44 + React Flow 12.11.6）：画布渲染完成后，用户节点的 `measured` **仍未落位**，
于是缩略图**一个方块都不画**，只剩一个空框 + 遮罩，且**不报任何错**；
`window.resize`、`zoomIn`、`fitView` 都无法恢复（排除时序问题）。

- 对策：在 `model/toFlow.ts` 给每类节点补 `initialWidth` / `initialHeight`
  （`NODE_SIZE`，与 `style/map.css` 对应），补上后实测 `minimap-node` 从 0 → 20（全量）。
- 必须用 `initial*` 而**不是** `width`/`height`：后者会与真实测量值竞争；
  实测 `initial*` 在测量完成后会被 `measured` 自然覆盖，不影响布局。
- 回归护栏：`model/toFlow.test.ts` 的「节点声明尺寸（MiniMap 依赖）」一组用例。

### 11.5.2 `BaseEdge` 的 `className` 落在 `<path>` 自身，不是外层 `<g>`

React Flow 的 `BaseEdge` 实现是：

```js
jsx("path", { ...props, d: path, className: cc(['react-flow__edge-path', props.className]) })
```

即我们传入的 `className` 会**拼到那个 `<path>` 上**，并不存在包一层的 `<g class="udm-edge-net">`。
因此按「祖先 + 后代」写的选择器 `.udm-edge-net path` / `.udm-edge-route.is-active path`
**全部匹配不到**，边会静默落回 React Flow 默认样式（灰 1px），
表现为「路线高亮完全看不出来，但也不报错」。

- 对策：选择器写成 `.react-flow__edge-path.udm-edge-net` 这种「同元素多类」形式（`style/map.css` 已改）。
- 实测取值：修正前 `stroke: rgb(177,177,183)` / `1px`；修正后路线 `rgb(56,189,248)` / `4px`、路网 `rgb(71,85,105)` / `1.5px`。

### 11.5.3 节点选中态的类名是 `selected`，不是 `is-selected`

React Flow 给选中节点容器加的是 `selected`（实测 DOM：
`class="react-flow__node react-flow__node-site selected"`）。
旧样式里的 `.react-flow__node.is-selected` 是**死选择器**，实测 `boxShadow === 'none'`，
即那圈选中光晕从未生效过。已改为 `.react-flow__node.selected`。

### 11.5.4 `Controls` / `MiniMap` 默认是浅色主题

两者沿用 React Flow 自带的浅色样式，在深色画布上表现为**一块白方块**（截图确认）。
React Flow 不提供深色变量，需自行覆盖（`style/map.css` 已补），
`MiniMap` 另需显式传 `bgColor` / `maskColor` 与 `nodeColor`（按图层配色）。

### 11.5.5 适配器默认值必须按「有没有 preload 桥」判定

打包后的 Electron 用 `loadFile` 加载渲染层产物，构建时通常不带 `.env`，
于是 `VITE_API_ADAPTER` 为 `undefined`。若默认落到 `mock`，桌面端会**静默显示假数据**
（不读 SQLite、不报错）——属于最难排查的一类问题。
`renderer/src/api/index.ts` 已改为：有 `window.dispatchApi` → `ipc`，否则 `mock`；
并用 `api/index.test.ts` 锁死该行为。

## 12. 风险与待评审

| 编号 | 事项 | 建议 | 状态 |
| --- | --- | --- | --- |
| Q-1 | 是否隐藏 React Flow 署名 | 内部工具可隐藏；对外分发前需确认 | **待评审** |
| Q-2 | `PIXELS_PER_METER` 固定为 3 是否够用 | 首期固定；若导入地图跨度差异大，再考虑按 bounds 自适应 | **待评审** |
| Q-3 | Handle 策略最终取方案 A 还是 B | 首期 A；若评审要求「正交折线路网」，改 B 并补方向计算 | **待评审** |
| Q-4 | 超过 2000 节点时的降级顺序（§9） | 先在导入侧拦截，渲染侧只做精简模式 | **待评审** |
| Q-5 | `NODE_SIZE`（`toFlow.ts`）与 CSS 尺寸重复声明 | 首期接受；若 CSS 频繁调整，可改为从 CSS 变量读取或集中到一处常量 | **待评审** |
| Q-6 | 是否需要「车辆运行态推进器」（模拟执行器） | 现无组件持续产生 `vehicle.changed`，车辆静止；M7 执行器落地时一并解决 | **待评审** |

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| `nodeTypes` 被写成内联对象 | 每次渲染重挂载全部节点，帧率崩塌 | 模块级常量（§9 第 1 条）+ 代码评审检查项 |
| 渲染层越界算路径 | 与 M5 路径服务口径分叉，禁行规则失效 | 地图只画 `overview.routes`，不自行搜索路径（§1.3） |
| 车辆位置外推 | 车显示在不存在的位置，与真实状态不符 | 禁止外推（§7.2），超时冻结 |
| 图层开关用「过滤元素」实现 | 每次开关重建数组、丢失选中与视口 | 统一用 `hidden`（§4.5） |
| 地图与列表各自维护选中态 | 双向联动不一致 | 唯一 `selection`（§6），地图只读不写业务态 |
| 引入在线图标/字体/瓦片 | 破坏离线启动要求 | §1.3 零在线依赖；图标内联 |

## 13. 开发顺序与完成标准（DoD）

开发顺序（P3 阶段，与 `docs/build-plan.md` §6 的「P3 任务与地图」对齐）：

1. `renderer/package.json` 加 `@xyflow/react`，`main.tsx` 引入 `style.css`，起一个静态空白画布（验证依赖与打包）。
2. `model/projection.ts` + `model/ids.ts` + `model/toFlow.ts`（先写单测 M6-U1…U5，这部分不依赖 DOM）。
3. `stage/FlowCanvas.tsx` + 五个节点类型 + 两个边类型，用 **seed 路网**渲染静态图层（Req-M6-1）。
4. `hooks/useLayerVisibility.ts` + 图例 + `Controls`/`MiniMap`（Req-M6-4）。
5. `hooks/useSelectionSync.ts`，打通列表/地图/详情三方联动（Req-M6-2）。
6. `hooks/useMapOverview.ts` + 事件去重/节流/轮询兜底（Req-M6-3）。
7. `hooks/useVehicleMotion.ts` 车辆补帧动画。
8. 轨迹回放（Req-M6-6）与订单端点图层（`docs/order-data-map-design.md` §5）。

完成标准（DoD，逐条可验证）：

- [ ] `npm run build --workspace renderer` 通过，产物含 React Flow 且体积增量与 §2.2 同量级（±20%）。
- [ ] `npm run typecheck` 三个 workspace 全绿。
- [ ] M6-U1…U7 / M6-C1…C3 全绿（前提：先修复 `tests/setup.ts` 的既有阻塞项）。
- [ ] `npm run dev:electron` 打开窗口后地图渲染 seed 路网（12 节点 / 34 边 / 3 站点 / 3 车辆），
      截图或 DOM 计数与 `db:seed` 数据一致。
- [ ] 列表点选任务 → 地图高亮其路线与起终点；点空白清空。
- [ ] 关闭再打开「路网」图层后，选中态与视口不丢失。
- [ ] 断网状态下启动，地图仍正常渲染（离线验证）。
- [ ] 车辆执行推进时位置可见移动，且无外推（暂停后位置停住）。
- [ ] 提交前按 `AGENTS.md` 纪律先补工作日志与决策记录（D-21）。
