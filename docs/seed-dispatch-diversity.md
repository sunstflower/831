# 模块开发文档：待派任务扩容与算法差异可视化（M4c）

> 版本：v1.1 · 面向开发 · 状态：**已按此实现（2026-10-03），本文件随实现回写**
> 关联文档：[`design.md`](../design.md) §4.4 · [`docs/module-M4-dispatch.md`](./module-M4-dispatch.md) · [`docs/module-M4b-order-flow.md`](./module-M4b-order-flow.md) · [`docs/database.md`](./database.md) §4
> **文档边界**：本文件只负责「这几轮改动的**设计意图与实现口径**」—— 为什么扩任务、每条任务想放大哪种差异、对比屏新增哪两块、加权综合分与拒绝原因的口径修正，以及验收方式。
> 其余事实按 [`docs/api.md`](./api.md) §0「文档事实单一来源」引用：**任务清单与数值的唯一作者是 [`shared/src/seed-data.ts`](../shared/src/seed-data.ts)**，本文件不复述。

## 0. 本文覆盖的三轮改动

| 轮次 | 日期 | 内容 | 入口 |
| --- | --- | --- | --- |
| 第一轮 | 2026-10-03 | 待派 6 → 12；对比屏加「差异对照 / 派单差异」 | §1 · §3 前段 · §4 |
| 第二轮 | 2026-10-03 | 待派 12 → 18（容量瓶颈 + 仿真丰富度） | §3 后段 |
| 第三轮 | 2026-10-03 | **修正加权综合分的算法**（补未派发项）与**拒绝原因的口径** | §7 · §8 |

## 1. 第一轮要解决什么

使用者原话：

> 「多创建几个预留的待派任务，并为了更多体现算法之间的差异做出改动」。

拆成两项：

| # | 诉求 | 落点 |
| --- | --- | --- |
| 1 | 待派任务更多、更能压出差异 | `shared/src/constants.ts` 的 `SEED_IDS.pendingTasks` + `shared/src/seed-data.ts` 的 `SEED_PENDING` |
| 2 | 对比屏把「差多少」讲得更直白 | `renderer/src/dispatch/model.ts` 新增两个**纯读模型**函数 + `DispatchConsole` 的「策略对比」区块 |

## 2. 不改什么（先划边界，避免顺手改契约）

- **不放宽任何算法契约**：贪心的「重排序 + 逐个挑最小代价 + 允许接力」与匈牙利的「整批最小化 + 一车一单」都不动；
  成本权重（`DISPATCH_COST_WEIGHTS`）、时间窗容忍、电量阈值、`DISPATCH_MAX_TASKS` 全部不变（D-12）。
- **不新增接口、不新增领域事件**：本轮没有任何 IPC 路由或 `EVENT_PERMISSIONS` 变化，因此 `docs/api.md` §3 与 §4 无需改动。
- **第一 / 二轮不动决策编号**：没有新的架构级取舍，属既有 M4 口径下的数据与呈现调整。
- **第三轮是例外**：`加权综合分` 与 `拒绝原因` 都改了**算法口径**，因此新增了决策编号（见 §7 / §8 与 [`AGENTS.md`](../AGENTS.md) 的设计决策表）。

## 3. 待派任务：扩容的设计意图（数值见 seed-data.ts）

任务清单本身是 seed 数据，**唯一作者是 `shared/src/seed-data.ts`**（D-34）。这里只写「每条任务想放大哪种差异」，
便于后来者判断「这条任务能不能删」：

- **原有 6 条保持不变**（编码 `T-DEMO-0002`…`T-DEMO-0007` 稳定：新任务**追加在尾部**，索引靠后，既有编码不受影响）。
  它们覆盖「两车种可选的中距件」「无人机专属小件」「紧窗急件」「回库件」四类基础形态。
- **重货件**：载重**只有 1200 kg 车型能承接**。它让「唯一的车该留给谁」成为两策略的分水岭 ——
  小批量下匈牙利会把整批最优留给它，贪心则可能先把这台车用在优先级更高的普通件上。
- **中重件（只有 800 kg 以上车型能承接）**：与重货件共同制造「大车不够分」，
  匈牙利必须放弃某些单，而贪心能靠接力排下。
- **紧窗无人机器件**：时间窗最短、载重落在无人机能力内，逼出「按优先级抢车」与
  「整体最优」在**接力顺序**上的不同。
- **短途小件（起终点相邻）**：执行段短，能塞进某台车已排班次之间的空档，
  于是贪心的接力不再是偶然 —— 它把一台车填得更满，匈牙利则一车只接一单。

两条实现约束（都是实测踩出来的，写在这里避免后来者重蹈）：

1. **短途件的方向要选对**。样本路网是**有向边**，`E_N12_N13` 被占道规则封路、反向的
   `E_N12_N13_R` 畅通 —— 同一对站点换个方向，执行段就从 150 m 变成绕行 450 m，「短途」不再短。
2. **不要给任务加「未来时间窗」**。窗口起点一旦晚于 seed 时刻，等待时间就随
   「数据基准时刻 − 预览时刻」变化，而 Mock 与主进程的这两个时刻必然不同（[`renderer/src/api/mock-data.ts`](../renderer/src/api/mock-data.ts) 已写明
   「两种形态的差异只有时间字段」）—— 差异会**泄漏进 `waitTimeS` / 加权综合分**，
   `mock-parity.test.ts` 的逐字段一致断言随即变红。

扩容后：**任务数远多于可用车辆数**（演示执行任务占住一台车），从而
① 接力成为常态，`differenceLinesOf` 的「多派 N 单」不再是个位数里的 1；
② 里程 / 耗时 / 完成时刻的差值随任务数放大；
③ 匈牙利**必然**拒掉一批任务，两策略的「拒绝清单」因此不再重合，
   「派单差异」表里能直接看到「同一单派给了不同车」与「某一方未派发」。

> **第二轮追加的实测（2026-10-03，真实 seed + 内核，18 条待派一起跑）**：
> 贪心 9 单 / 匈牙利 4 单。**两边的重货都被拒**（`CAR-02` 被别的已派班次占住，
> 而 1100 / 1000 kg 只有它装得下）—— 于是「重货该留给谁」只在**小批量**选择下才是分水岭；
> 整池一起跑时，重货的作用变成了「让车队容量瓶颈在拒绝原因与预检里看得见」。
> 这也是为什么第二轮的注释不再写「贪心会接力跑完两个重货」（那是**未经验证的猜测**）。

## 3.1 第二轮扩容（12 → 18）：为「仿真演示」加的是什么

使用者原话：

> 「多设计几个预留的待派任务以进行仿真演示，并修复加权综合分的计算」。

第二轮追加 6 条（新任务一律**追加在尾部**，既有 `T-DEMO-0002`…`T-DEMO-0013` 编码不变）：

| 类别 | 作用 |
| --- | --- |
| 两个重货（1100 / 1000 kg，只有 CAR-02 能接） | 把「大车只有一台」变成可看见的瓶颈：拒绝清单里会出现「占用区间冲突」，预检里有对应的未派发缺口 |
| 一个中重件（700 kg，只有两台配送车能接） | 与重货叠加，制造「大车不够分」 |
| 两个远距离小件（40 / 45 kg） | 无人机与地面车都够载重，跑的是长对角线 —— 演示里能看到轨迹横穿校园 |
| 一个相邻短途件（300 kg） | 执行段只有一条边，能塞进某台车已排班次的空档（贪心多派的样本） |

**为什么停在这里（18 条）**：`DEFAULT_PAGE_SIZE = 20`，`1 条演示 + 18 条待派 = 19 ≤ 20`，
所以演示任务仍出现在任务列表首屏 —— 再多一条就会把它挤到第二页
（`TasksPage.test.tsx` 与 `api.task.test.ts` 都靠首屏可见，且浏览器 Mock 的新建记录时间戳
排在演示数据之后，见 `ISS-094`）。这条上限是**产品侧的可见性约束**，不是随口取的数量。

## 4. 对比屏：新增两块「差异」呈现

现有 `differenceLinesOf` 只给一句「另一个策略更优的地方」，回答不了「每个指标各差多少」。
本轮在「策略对比」区块内追加两块**只读**呈现（不改任何既有函数签名）：

### 4.1 差异对照（逐指标）

新函数 `metricComparisonOf(outcomes, recommendedStrategy)`（`renderer/src/dispatch/model.ts`）：

- 把两个策略的**同一指标**排成一行，推荐策略列在前、作为基准列；
- 基准列只显示值；其它列显示值 + **相对基准的带符号差值**，并按该指标的优劣方向标 `更优 / 更差`；
- 除「指派 / 拒绝 / 里程 / 耗时 / 完成时刻 / 加权综合分」外，新增 **单车平均里程 / 单车平均耗时** ——
  两策略派单数不同时，合计值天然偏向「派得少」的一方，平均值是抵消这个偏差的口径。
- 差异方向：指派数越高越好；拒绝数、里程、耗时、完成时刻、加权综合分越低越好；用车数不判优劣。

### 4.2 派单差异（同一单派给了不同车）

新函数 `assignmentDiffsOf(outcomes, taskCodes)`：

- 逐任务比对两个策略给出的车辆，**只列不一致的行**；
- 某策略没派这一单时显示「未派发」——它正是「匈牙利拒掉的那几单」的可读形态；
- 两边派给同一台车的任务不出现在表里（那些不是差异）。

两块都是**纯函数 + 只读渲染**：不触碰 `preview` / `apply` 契约，`mock-parity.test.ts` 的逐字段一致断言不受影响。

## 5. 受影响文件

| 文件 | 改动 |
| --- | --- |
| `shared/src/constants.ts` | `SEED_IDS.pendingTasks` 追加新任务 id，注释更新 |
| `shared/src/seed-data.ts` | `SEED_PENDING` 追加新任务（唯一作者，含数值与「实测结论」注释） |
| `shared/src/dispatch-types.ts` | 新增 `DISPATCH_UNSERVED_PENALTY_S`（未派发惩罚，第三轮） |
| `shared/src/dispatch-evaluate.ts` | 新增 `compositeScoreOf`（批次加权综合分，第三轮） |
| `shared/src/dispatch-strategies.ts` | 两个策略改调 `compositeScoreOf`；新增 `mostInformativeReject` 与原因信息量排序（第三轮） |
| `desktop/src/domain/dispatch/dispatch.service.ts` | apply / manual-assign 的 `totalCost` 改走 `compositeScoreOf` |
| `renderer/src/api/mock-dispatch.ts` | 同上（Mock 必须与主进程逐字段一致） |
| `renderer/src/dispatch/model.ts` | 第一轮：`metricComparisonOf` / `assignmentDiffsOf` |
| `renderer/src/dispatch/DispatchConsole.tsx` | 「策略对比」区块渲染差异对照 / 派单差异；表下给出加权综合分的公式（第三轮） |
| `renderer/src/dispatch/style/dispatch.css` | 差异对照的少量样式 |
| `shared/src/dispatch-evaluate.test.ts` · `shared/src/dispatch-greedy.test.ts` · `desktop/src/domain/dispatch/dispatch.service.test.ts` | 第三轮的口径用例与数据护栏 |
| `renderer/src/pages/AlertsRisk.test.tsx` | 待派任务条数/编码由接口读，不再硬编码 |
| `docs/module-M4-dispatch.md` §5/§7.1/§7.3/§7.4 · `docs/api.md` §3.4.2 · `docs/architecture.md` · `docs/database.md` §4 | 第三轮的口径回写 |

## 6. 验收

1. `npm run db:reset` 后 `tasks` 行数 = 1 条演示执行 + `SEED_IDS.pendingTasks.length` 条待派（数值以 seed-data.ts 为准）。
2. 调度中心勾选全部待派任务 → 「全部（对比）」→ 预览，应看到：
   - 「指派 / 任务」两策略明显不同（贪心靠接力多派，匈牙利一车一单）；
   - 「差异对照」每个指标都有带符号的差值，且方向标记与数值一致；
   - 「派单差异」列出被派给不同车辆的任务，以及某一方「未派发」的单；
   - 「加权综合分」一行**推荐策略的分数更低**（未派发项已计入）—— 这是第三轮的验收重点：
     若只加已派发计划，派得多的那一方反而分数更高（实测 3146 vs 1256），推荐会与指派数打架。
3. 拒绝原因**不再清一色**报某个固定车辆。整池一起跑时应当都指向真实瓶颈
   （占用区间冲突，或重货/超载相关的固有原因），而不是所有行都说「AGV-01 不可用」。
4. `npm test` / `npm run typecheck` / `npm run build` 全绿；文档不变量用例（`tests/docs.test.ts`）通过。

## 7. 第三轮 A：加权综合分的口径修正

**缺陷**：`StrategySummary.totalCost` 只把**已派发**计划的 `cost` 相加，被拒任务记 0 →
「派得越少分数越低」。18 条待派的实测里，匈牙利派 4 单得到 1256 分、贪心派 9 单得到 3146 分，
旧口径会推荐**少干 5 单活**的那一方。

**修正**：新增 `DISPATCH_UNSERVED_PENALTY_S`（`shared/src/dispatch-types.ts`）与
`compositeScoreOf`（`shared/src/dispatch-evaluate.ts`，唯一算法作者）：

```
加权综合分 = Σ(已派发计划的 cost) + 未派发单数 × DISPATCH_UNSERVED_PENALTY_S
```

- 惩罚取值必须**大于任何单条计划的代价**，否则「故意拒掉贵单」会变成更优解；
  本演示路网单条计划代价的实测上界是「最长空驶+执行 1673.3 s + 晚点容忍惩罚 + 续航风险」≈ 2773，
  常量取 3600（见常量注释）。
- 两条护栏：`shared/src/dispatch-evaluate.test.ts` 用常数上界验算；
  `desktop/src/domain/dispatch/dispatch.service.test.ts` 用**真实 seed 数据穷举**所有可行计划，
  断言惩罚大于其中最大的 `cost`（地图变大 / 惩罚调小时它先红）。
- 界面在「差异对照」表下直接写出公式（不再让读者去猜「加权综合分」含不含被拒的单）。
- 推荐逻辑不变：仍然「先比指派数、再比加权综合分」；同指派数时未派发项相消，比较退化成「谁更省」。

## 8. 第三轮 B：拒绝原因的口径修正（`ISS-093`）

**缺陷**：`runGreedy` / `runHungarian` 在没有任何可行车辆时，取**遍历到的第一个**失败原因。
`snapshot.vehicles` 按编码排序、`AGV-01` 恒 `busy` 且恒在首位，于是十几条**占用区间冲突**
全被报成同一句「AGV-01 当前不可用」—— 使用者照着这句话去查 AGV-01，永远查不出原因。

**修正**：`mostInformativeReject`（`shared/src/dispatch-strategies.ts`）按「**离能跑还差多少**」
排序取一条，顺序为
`TIMEWINDOW_CONFLICT > BATTERY_INSUFFICIENT > VEHICLE_NOT_AVAILABLE > LOAD_EXCEEDED > RESTRICTION_VIOLATED > UNREACHABLE`。
两个方向的反例都必须成立，并各有一条用例钉住：

- 车辆池里既有 busy 的车、也有「排班冲突」的车 → 报 `TIMEWINDOW_CONFLICT`（不是「某车不可用」）；
- 900 kg 任务在 `CAR-02` 被预留、其余车装不下 → 报 `VEHICLE_NOT_AVAILABLE`
  （报 `LOAD_EXCEEDED` 等于说「没有车装得下 900 kg」，而事实是有的、只是它现在不可用）。

口径细节见 [`docs/module-M4-dispatch.md`](./module-M4-dispatch.md) §5 末。
