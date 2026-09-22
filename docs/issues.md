# 项目问题汇总（Issue Register）

> 版本：v1.0（2026-09-21 建立）· 状态：**持续更新**，每次提交前同步。
> 定位：**全项目唯一的「问题/风险/待决」清单**。跨 `design.md` / `docs/*.md` / `AGENTS.md` 汇总，并按「严重度 + 状态」排序，供评审与开发排期使用。
> **文档边界**：本文件只负责「问题 / 风险 / 待决的汇总、定级与状态跟踪」。其余事实按 [`docs/api.md`](./api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**。
>
> **与其它文档的分工**（避免出现第二个清单）：

| 文档 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| **本文件** | **问题的汇总、去重、定级、跟踪**；每条给「现象/影响/建议动作/出处」 | 不定义设计方案（按「出处」跳转） |
| `AGENTS.md`「困难与问题记录」 | **历史发生过的**问题与解决过程的原始记录（只追加不篡改） | 不做定级与跨文档汇总 |
| `docs/data-interfaces.md` §12 | 导入契约内部的**开放问题**（Q1-Q16） | 不覆盖其它领域的问题 |
| `docs/module-M6-map.md` §12 | 地图模块内部的**开放问题**（Q-1…Q-6） | 同上 |
| `docs/module-M2-base-data.md` §11 | 基础数据模块内部的**待决项**（Q1-Q6） | 同上 |
| `docs/build-plan.md` §7 | **构建阶段**的技术风险与缓解 | 不含功能与契约问题 |
| `AGENTS.md`「设计决策记录」 | 已作出的**决策**（编号与**状态以该表的「状态」列为准**） | 不记录未决问题（见 ISS-007 / ISS-017） |

**维护规则**（三选一，每条问题必须处于其中一种状态）：

1. **新增**：发现即入表，编号顺延（`ISS-0xx`），必须写「现象 + 影响 + 建议动作 + 出处」四段。
2. **状态流转**：`待办` → 处理中 → `已解决`（保留条目，标注解决日期与提交号）。
3. **不删条目**：即使已解决或被驳回，也保留原文并把状态改掉——已排除的问题（如 ISS-028）对后来者最有价值。

---

## 0. 总览

当前共 **38** 条（截至 2026-09-22：**已解决 18 条**）。

| 严重度 | 条数 | 含义 |
| --- | ---: | --- |
| `P1` | 5 | 阻断开工或涉及安全/契约根因，**必须先定** |
| `P2` | 24 | 影响正确性或可信度，应在对应模块开工前解决 |
| `P3` | 9 | 整洁性 / 体验 / 已知取舍，可延后 |

| 状态 | 条数 |
| --- | ---: |
| `已解决` | 18 |
| `待办` | 9 |
| `待评审` | 6 |
| `计划内` | 1 |
| `已接受` | 3 |
| `已排除` | 1 |

### 0.1 建议的处理顺序（P1 与阻断项）

> **2026-09-22 更新**：原第 1 位（`ISS-001` 两套错误码）与原第 4 位（`ISS-009` 事件总线越权）**已解决**，
> 见 §2「已解决问题」。剩下的 P1 全部是**评审类**（等人的决策，不是等写的代码）。
> **第 3 行原为 `ISS-029`（工作区未提交改动），已于 2026-09-22 关闭**：本轮文档批次提交为 `84fa028` 后工作区干净，见 §2；
> 其位置由 `docs/module-M2-base-data.md` §11 接替 —— M2 的待决项与 ISS-017/ISS-018 **可在同一次评审中一并清空**。

| 顺序 | 编号 | 标题 | 为什么先做 |
| ---: | --- | --- | --- |
| 1 | `ISS-017` | 决策待评审：D-11 / D-15…D-20 / D-28…D-31 / **D-35**（状态列已补齐） | D-17/D-28…D-31/D-35 决定导入模块的表结构与错误码 |
| 2 | `ISS-018` | `docs/data-interfaces.md` §12 的 Q1-Q16 待评审 | 与上一条**合并评审**，避免同一件事评两次 |
| 3 | `docs/module-M2-base-data.md` §11 | M2 的 6 个待决项（Q1 `OBJECT_TYPES` 缺 `restriction` / `task_template` 等） | **P2 阶段开工前须先定 Q1**（影响审计写入）；与上两条合并评审可一次清空 |

> **剩余根因**：`ISS-017`/`ISS-018` 是同一件事的两面（决策 + 待确认问题），都源于「文档先行」阶段的开放项。
> 错误码口径（`ISS-001`）已在 2026-09-21 收口为**唯一登记处**，导入模块开工不再受其阻塞。

### 0.2 全部问题索引

| 编号 | 严重度 | 类型 | 标题 | 状态 | 领域 |
| --- | --- | --- | --- | --- | --- |
| [`ISS-001`](#iss001) | `P1` | 契约冲突 | 错误码两套并存，且两份文档各自声称「唯一来源」 | `已解决（2026-09-21）` | 契约 / 文档 |
| [`ISS-002`](#iss002) | `P3` | 文档一致性 | `API.ROUTE_NOT_FOUND` 已实现但未登记进 `api.md` §2 | `已解决（2026-09-21）` | 文档 |
| [`ISS-003`](#iss003) | `P2` | 文档一致性 | `docs/architecture.md` §8.3 标题与内容停留在「截至 2026-09-14」 | `已解决（2026-09-21）` | 文档 |
| [`ISS-004`](#iss004) | `P2` | 文档一致性 | `docs/architecture.md` 仍标注「【阻塞】tests/setup.ts 缺依赖」 | `已解决（2026-09-21）` | 文档 |
| [`ISS-005`](#iss005) | `P2` | 文档一致性 | `docs/build-plan.md` §4 仍写「M6 尚未实现」 | `已解决（2026-09-21）` | 文档 |
| [`ISS-006`](#iss006) | `P2` | 文档一致性 | `docs/module-M6-map.md` 头部与 §1.1 仍称「尚未实现 / 方案待评审」 | `已解决（2026-09-21）` | 文档 |
| [`ISS-007`](#iss007) | `P2` | 流程纪律 | 设计决策表的「待评审」标注与工作日志口径不一致 | `已解决（2026-09-21）` | 流程 / 文档 |
| [`ISS-008`](#iss008) | `P2` | 环境 / 工具 | `package.json` 的 `engines.node >= 20.11` 与 `node:sqlite` 下限不符 | `已解决（2026-09-21）` | 工程化 |
| [`ISS-009`](#iss009) | `P1` | 安全 | `EventBus` 未按会话权限过滤，领域事件广播给全部窗口 | `已解决（2026-09-21）` | 后端 / 安全 |
| [`ISS-010`](#iss010) | `P2` | 实现缺口 | M2-M10 业务模块整体未开工（7 个占位页） | `计划内` | 实现 |
| [`ISS-011`](#iss011) | `P2` | 实现缺口 | `GET /api/map/overview?include=orders,orderEndpoints` 未实现 | `待办` | 实现 |
| [`ISS-012`](#iss012) | `P2` | 实现缺口 | `GET /api/map/tracks/{vehicleId}` 轨迹回放未实现 | `待办` | 实现 |
| [`ISS-013`](#iss013) | `P2` | 实现缺口 | 订单摄入迁移 `0002_data_import.sql` 未落地 | `待办` | 实现 |
| [`ISS-014`](#iss014) | `P2` | 实现缺口 | 导入 / 导出接口全部未实现 | `待办` | 实现 |
| [`ISS-015`](#iss015) | `P3` | 实现缺口 | 分页 / 参数校验工具内联在 `ipc/api.ts` | `待办` | 实现 / 整洁性 |
| [`ISS-016`](#iss016) | `P2` | 文档缺口 | 车辆状态机完整迁移表未成稿（`charging` / `offline` / `fault`） | `待办` | 文档 / 设计 |
| [`ISS-017`](#iss017) | `P1` | 待评审 | 12 项决策待评审（D-11 / D-15…D-20 / D-28…D-31 / D-35） | `待评审` | 流程 |
| [`ISS-018`](#iss018) | `P1` | 待评审 | `docs/data-interfaces.md` §12 的 Q1-Q16 待评审 | `待评审` | 流程 |
| [`ISS-019`](#iss019) | `P2` | 待评审 | `docs/module-M6-map.md` §12 的 Q-1…Q-6 待评审 | `待评审` | 流程 |
| [`ISS-020`](#iss020) | `P2` | 待评审 | F4 算法配置章（`data-interfaces.md` §6）未按真实样本核对 | `待评审` | 文档 / 设计 |
| [`ISS-021`](#iss021) | `P2` | 待评审 | 车辆运行态推进缺失：地图上车辆静止不动 | `待评审` | 实现 / 设计 |
| [`ISS-022`](#iss022) | `P2` | 数据风险 | 地区目录的别名 / 歧义匹配在样本上无实例，仍属未验证 | `待办` | 数据 / 设计 |
| [`ISS-023`](#iss023) | `P3` | 数据风险 | 车辆参数 51.2% 的数值字段为 `[D]` 级工程假设 | `已接受` | 数据 |
| [`ISS-024`](#iss024) | `P2` | 迁移风险 | `sites` 边绑定迁移会触及既有 seed 与已通过的 M6 | `待办` | 数据模型 |
| [`ISS-025`](#iss025) | `P3` | 设计待定 | 订单时间无日期，跨日策略未定 | `待办` | 设计 |
| [`ISS-026`](#iss026) | `P3` | 环境 / 工具 | 依赖树里存在两套 Vite 与两份 zustand | `已接受` | 工程化 |
| [`ISS-027`](#iss027) | `P3` | 环境 / 工具 | `apply_patch` 写入大段中文 Markdown 时易触发补丁失败 | `已接受` | 工具 |
| [`ISS-028`](#iss028) | `P3` | 环境 / 工具 | 用 Chrome 打开 `file://` 产物会误判为打包缺陷 | `已排除` | 工具 / 用法 |
| [`ISS-029`](#iss029) | `P2` | 流程纪律 | 工作区存在大量未提交改动，基线距今较远 | `已解决（2026-09-22）` | 流程 |
| [`ISS-030`](#iss030) | `P2` | 契约一致性 | mock 适配器自造错误码 `AUTH.INVALID_CREDENTIALS` | `已解决（2026-09-21）` | 前端 / 契约 |
| [`ISS-031`](#iss031) | `P3` | 文档格式 | 两处 Markdown 表格被单元格内的裸竖线截断 | `已解决（2026-09-21）` | 文档 |
| [`ISS-032`](#iss032) | `P2` | 文档一致性 | 跨文档事实不一致（18 处），且文档索引存在三份副本 | `已解决（2026-09-21）` | 文档 |
| [`ISS-033`](#iss033) | `P2` | 文档一致性 | 主修正未传播：地图包文件数 / 错误码条数 / 用例编号仍留旧值 | `已解决（2026-09-21）` | 文档 |
| [`ISS-034`](#iss034) | `P1` | 可运行性 | `npm run dev` / `dev:electron` 在干净检出上因未构建 `shared` 而无法启动 | `已解决（2026-09-21）` | 工程化 |
| [`ISS-035`](#iss035) | `P2` | 契约一致性 | `edges` 无业务 `code` 列，与「文件内一律用 code 引用」的导入契约冲突 | `待评审` | 数据模型 / 契约 |
| [`ISS-036`](#iss036) | `P2` | 契约一致性 | `PATCH /api/vehicles/{id}/status` 文档取值 `enabled` 不在车辆状态枚举中 | `已解决（2026-09-22）` | 契约 / 文档 |
| [`ISS-037`](#iss037) | `P2` | 文档缺口 | M2 缺模块开发文档（M4 / M6 已有，P2 阶段开工无实现口径） | `已解决（2026-09-22）` | 文档 |
| [`ISS-038`](#iss038) | `P3` | 文档格式 | `docs/issues.md` 的 37 条索引锚点全部失效（无对应 `id`） | `已解决（2026-09-22）` | 文档 |

---

## 1. 问题明细

### 1.1 P1 · 阻断 / 优先（5 条）

<a id="iss001"></a>

#### ISS-001 · 错误码两套并存，且两份文档各自声称「唯一来源」

| 项 | 值 |
| --- | --- |
| 严重度 | `P1`（阻断 / 优先） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 契约冲突 |
| 领域 | 契约 / 文档 |

**现象**：`docs/api.md` §2「错误码目录」登记 34 条（与 `shared/src/errors.ts` **完全一致**，含实现）；
`docs/data-interfaces.md` §8「错误码汇总」登记 97 条，并写明「本表是**唯一登记处**」。
两处**零重叠**——同一概念两套命名。

| 概念 | `api.md` §2 / 实现 | `data-interfaces.md` §8 |
| --- | --- | --- |
| 路网为空 | `GRAPH.EMPTY` | `MAP.EMPTY_GRAPH` |
| 路网不连通 | `GRAPH.DISCONNECTED` | `MAP.GRAPH_DISCONNECTED` |
| 无可行路径 | `ROUTE.NOT_FOUND_PATH` | `ROUTE.NOT_FOUND_PATH` |
| 节点/边不存在 | `NODE.NOT_FOUND` / `EDGE.NOT_FOUND` | `MAP.EDGE_NODE_NOT_FOUND` |

**影响**：导入模块（`0002_data_import`）一开工就必须先决定「按哪套命名发错误码」。
前端已按 `api.md` 命名准备好文案映射，若导入改用 §8 命名，会出现两套文案 key；
反过来若沿用 `api.md`，则 §8 的 97 条要整体改名。**这是当前最需要先定的一件事。**

**建议动作**：二选一，不并存。
(a) 以 `shared/src/errors.ts`（= `api.md` §2）为唯一真源，把 `data-interfaces.md` §8 的
97 条**按现有命名体系重命名**并合并入 `ERROR_CODES`（`MAP.*` → `GRAPH.*`/`NODE.*`/`EDGE.*`，保留 `ORDER.*`/`VEHICLE.*` 前缀）；
(b) 反过来以 §8 为准，则必须改 `shared/src/errors.ts` 与全部既有测试。
**倾向 (a)**：实现已有、测试已锁、`api.md` 是既有对外契约，改动面最小。

**出处**：`docs/api.md` §2 · `docs/data-interfaces.md` §8 · `shared/src/errors.ts`

**解决（2026-09-21）**：选定 **(a) 以 `shared/src/errors.ts` 为全项目唯一登记处**，废弃 `data-interfaces.md` §8 的独立目录。

- 采用业界口径（Google AIP-193 `ErrorInfo` 的 `domain` + `reason`）定为「**域.原因**」两段式（D-33）；
  「同一概念只允许一个 code」比「同一文件族一套前缀」更重要（AIP-193：同一个 `(reason, domain)` 对**必须**用于同一个错误，且**不得**用于不同错误）。
- 冲突按「谁更通用谁胜出」消解，不按「哪份文档更新」：
  `MAP.EMPTY_GRAPH`→`GRAPH.EMPTY`、`MAP.GRAPH_DISCONNECTED`→`GRAPH.DISCONNECTED`、`MAP.ISOLATED_NODE`→`GRAPH.ISOLATED_NODE`、
  `ORDER.ROUTE_NOT_FOUND`→`ROUTE.NOT_FOUND_PATH`（**与 `api.md` 既有码合并**）、`MAP.EDGE_NODE_NOT_FOUND`→`NODE.NOT_FOUND`、`MAP.SITE_EDGE_NOT_FOUND`→`EDGE.NOT_FOUND`。
- `errors.ts` 从 34 条 → **123 条**（新增 89 条导入域，含 `severity` 字段）；`api.md` §2 重写为 2.1 运行时 / 2.2 导入域 / 2.3 拒绝原因；
  `data-interfaces.md` §8 重写为注册表的**按章视图**并移除「唯一登记处」声明。
- 新增 `shared/src/errors.catalog.test.ts`（5 条断言）与 `renderer/src/api/mock-parity.test.ts`（3 条断言），把「唯一登记处」变成**可执行约束**。
- 附带修掉一处真实缺陷：mock 适配器自造 `AUTH.INVALID_CREDENTIALS`（不在目录中），见下方 ISS-030。

<a id="iss009"></a>

#### ISS-009 · `EventBus` 未按会话权限过滤，领域事件广播给全部窗口

| 项 | 值 |
| --- | --- |
| 严重度 | `P1`（阻断 / 优先） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 安全 |
| 领域 | 后端 / 安全 |

**现象**：`desktop/src/services/event-bus.ts` 的 `emit()` 对 `this.targets`（所有已 attach 的
`webContents`）**无条件群发** `udm:event`，不判断接收方会话的角色与权限点。

**影响**：与 D-08「权限校验双轨制」冲突——接口层做了服务端强制校验，
但事件通道绕过了它。只要有第二个窗口/会话连接，就能收到它无权查看的对象事件
（如 `alert.*` 给 monitor、`task.*` 给无 `task:read` 的角色）。
单窗口演示形态下不可见，接多角色后是真实的越权面。

**建议动作**：`EventBus` 持有「target → session」映射（`attach()` 时绑定会话），
`emit()` 前按事件类型所需权限点过滤。`docs/architecture.md` 已记为缺口（「M6/M8 落地时补」），
建议提前到 M8 之前，因为它属于安全边界而非功能特性。
**出处**：`desktop/src/services/event-bus.ts` · `docs/architecture.md` 第 10 章与 §8.2 缺口表

**解决（2026-09-21）**：`EventBus` 改为**按会话权限过滤**后再推送（deny-by-default）。

- 新增 `EVENT_PERMISSIONS`：事件类型 → 所需权限点（`task.changed`→`task:read`、`vehicle.changed`/`execution.progress`→`monitor:read`、
  `alert.created`/`alert.updated`→`alert:read`、`settings.changed`→`settings:read`）。未登记的类型（如刷新信号 `map.updated`）视为公开。
- `attach(target, token?)` 绑定会话；新增 `bindSession(target, token)` 供登录/登出升降权；
  未登录窗口**收不到**任何登记过权限的事件。
- `main.ts` 的 `udm:invoke` 在 `/api/auth/login` 成功与 `/api/auth/logout` 后同步窗口身份。
- `EventBus` 构造器第二参数改为**必填** `sessions` —— 省略它会让所有事件被静默丢弃，让编译期就报错好过运行时排查。
- **事件日志照写不误**（服务端真相不受过滤影响），只过滤**推送**。
- 新增 `desktop/src/services/event-bus.test.ts`（8 条用例：未登录 / monitor / dispatcher / 登出降权 / 公开事件 / 落库 / 销毁 / 权限映射完备性）。

<a id="iss017"></a>

#### ISS-017 · 12 项决策待评审（D-11 / D-15…D-20 / D-28…D-31 / D-35）

| 项 | 值 |
| --- | --- |
| 严重度 | `P1`（阻断 / 优先） |
| 状态 | `待评审` |
| 类型 | 待评审 |
| 领域 | 流程 |

**现象**：决策表已按 ISS-007 补上独立「状态」列（不再写在备注列的自由文本里），
当前标为 `待评审` 的共 **12 项**：D-11（新增权限点）、D-15~D-20（订单接入 / 四类导入契约）、
D-28~D-31（样本驱动的字段契约与单位口径）、D-35（`edges.code` 业务键，2026-09-22 新增，见 ISS-035）。D-21…D-27 已在实现中落地并被测试锁死，状态为 `已定`。

**影响**：D-17/D-28…D-31 直接决定导入模块的表结构与错误码，**不评审就无法动工 ISS-013**。
D-11 影响权限点集合（`shared/src/enums.ts` 已含 `dispatch:read`/`execution:start`，实现已按新权限点写好）。

**建议动作**：优先评审 **D-17 / D-28…D-31 / D-35**（导入契约与 `edges` 引用键，阻断 ISS-013/ISS-014），其次 D-11（与实现现状对齐即可）。
评审后把决策表的「状态」列改为 `已定`，并把结论回写 `design.md` / `docs/api.md` / `docs/database.md`
（回写时按 `docs/api.md` §0 的单一来源指派，只在负责文档里写数值）。
**出处**：`AGENTS.md` 设计决策记录 · 工作日志

<a id="iss018"></a>

#### ISS-018 · `docs/data-interfaces.md` §12 的 Q1-Q16 待评审

| 项 | 值 |
| --- | --- |
| 严重度 | `P1`（阻断 / 优先） |
| 状态 | `待评审` |
| 类型 | 待评审 |
| 领域 | 流程 |

**现象**：Q1-Q9 为 v0.2 遗留（其中 Q7 已定），Q10-Q16 为 2026-09-21 样本核对新提出：
Q10 多文件地图包 · Q11 站点边绑定 · Q12 优先级映射 · Q13 时间口径 · Q14 溯源落库 ·
Q15 规则求值位置 · Q16 F4 待核对。

**影响**：与 ISS-017 同源——Q10-Q15 与 D-28…D-31 是一体两面（决策 + 待确认问题），
建议**合并评审**，避免同一件事在两处各评一次、结论不一致。
其中 **Q16**（F4 算法配置未按样本核对）单独跟踪，见 ISS-020。
**建议动作**：与 ISS-017 合并为一次评审会议；通过后新增 D 编号并回写四份文档。
**出处**：`docs/data-interfaces.md` §12

---

<a id="iss034"></a>

#### ISS-034 · `npm run dev` / `dev:electron` 在干净检出上因未构建 `shared` 而无法启动

| 项 | 值 |
| --- | --- |
| 严重度 | `P1`（阻断 / 优先） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 可运行性 |
| 领域 | 工程化 |

**现象**：在**干净检出**（`node_modules` 已装、但 `shared/dist` 与 `desktop/dist` 不存在）上执行
`npm run dev` 或 `npm run dev:electron`，Vite 能启动并打印 ready，但页面**拿不到入口模块**；
浏览器控制台/终端报：

```text
[vite] Pre-transform error: Failed to resolve entry for package "@udm/shared".
The package may have incorrect main/module/exports specified in its package.json.
```

Electron 侧同样起不来：`npm run start --workspace desktop` 执行 `electron dist/main.js`，
而 `desktop/dist` 不存在。

**影响**：**这是新使用者/新机器的第一步**（README「本地运行」第一条就是 `npm run dev`），
失败即劝退；且失败形态具误导性 —— Vite 显示 `ready in 113 ms`、`/` 返回 200
（SPA 兜底），看起来「启动了」，实际白屏。排查者容易误判为 React Flow 或渲染层问题。

**原因**：workspaces 的**源码**依赖被当成了**已构建产物**依赖。
`shared/package.json` 的 `main`/`exports` 指向 `./dist/index.js`，而 `dist/` 被 `.gitignore` 排除；
`renderer` 与 `desktop` 在**运行时**（非仅类型）从 `@udm/shared` 导入：

| 位置 | 运行时导入（非 `import type`） |
| --- | --- |
| `renderer/src/components/AppLayout.tsx` | `hasPermission` |
| `renderer/src/api/mock.ts` | `ERROR_CODES` |
| `renderer/src/api/mock-data.ts` | `SEED_IDS` |
| `desktop/src/main.ts` · `ipc/*` · `services/*` · `db/seed.ts` 等 | `APP_NAME` / `SETTINGS_SCHEMA` / `DomainError` / `SEED_ACCOUNTS` … |

`test` / `typecheck` / `db:*` 四个脚本都**已经**带 `npm run build:shared`，
唯独 `dev` 与 `dev:electron` 没有 —— 不是设计选择，是漏加。

**建议动作**：给 `dev` / `dev:electron` 补上与其它脚本一致的预构建步骤。

**解决（2026-09-21）**：`package.json` 两处脚本前置构建，**改动仅 2 行**：

- `dev`：`npm run build:shared && npm run dev --workspace renderer`
- `dev:electron`：`npm run build:shared && npm run build:desktop && concurrently …`
  （桌面端还要 `desktop/dist/main.js`，同样不能假定已存在）

未选用的替代方案：给 `shared` 加 `dev` 走源码（需改 `exports` 指向 `src`，会让 Electron 主进程加载 `.ts`）；
或在 `prepare` 钩子里构建（`npm install` 之后自动跑，但会拖慢安装且对「只跑 renderer」的人不必要）。
当前方案与既有 `test`/`typecheck`/`db:*` 的写法完全一致，成本最低、认知负担最小。

**验证**：删除 `shared/dist` 与 `desktop/dist` 后复跑两条命令，均一次通过 —— 见
`AGENTS.md` 2026-09-21「修复干净检出无法启动」工作日志条目的实测记录。

**出处**：`package.json` · `shared/package.json`（`main`/`exports` 指向 `dist`） · `README.md`「本地运行」

---

### 1.2 P2 · 重要（本节 18 条；全量 24 条 —— 另 6 条为 ISS-029 / ISS-030 / ISS-032 / ISS-033 / ISS-036 / ISS-037，见 §1.3）

<a id="iss003"></a>

#### ISS-003 · `docs/architecture.md` §8.3 标题与内容停留在「截至 2026-09-14」

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：§8.3 标题为「已实现 vs 待实现（截至 2026-09-14 实测）」，图中
`T1["renderer 全部<br/>入口 / 适配器 / 页面 / 地图"]` 仍列为【设计中】待实现，
而 `renderer/` 已全套落地、M6 已实现（§8.2 已标记【已实现】）。

**影响**：同一份文档内 §8.2 与 §8.3 自相矛盾；读者按 §8.3 会以为渲染层不存在。

**建议动作**：把 T1 移入【已实现】，标题日期改为最近一次实测日期；
并把「renderer 全部」拆成已实现（入口/适配器/store/路由/地图）与未实现（6 个业务页）两部分。
**出处**：`docs/architecture.md` §8.2 / §8.3

**解决（2026-09-21）**：§8.3 标题改为「截至 2026-09-21 实测」；`D1/D2/D9/D10` 更新为实测值，
原 `T1「renderer 全部」` 移入【已实现】并细化为 `D11 renderer 全套` / `D12 M6 地图` / `D13 测试基线`；
`T6「M6 地图」` 与 `T10「测试 setup 修复」` 从待实现中移除。

<a id="iss004"></a>

#### ISS-004 · `docs/architecture.md` 仍标注「【阻塞】tests/setup.ts 缺依赖」

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：§8.3 图中节点 `BLOCK["【阻塞】当前阻塞<br/>tests/setup.ts 缺依赖<br/>5 个测试套件全部无法收集"]`，
图下正文写「**P1 剩余缺口**：`renderer` 无 `src/main.tsx`…`tests/setup.ts` 缺 `@testing-library/jest-dom`，
导致 `npm test` 跑 0 个测试」。

**影响**：该阻塞**已于 2026-09-20 解除**（依赖补齐 + `createRequire` 惰性加载，现 15 套件 / 94 用例全绿）。
保留「阻塞」状态会让读者误判项目不可构建。

**建议动作**：删掉 `BLOCK` 节点与「P1 剩余缺口」段，改为「P1 已解除」的历史注记。
**出处**：`docs/architecture.md` §8.3 · `AGENTS.md` 困难与问题记录（2026-09-20 两条）

**解决（2026-09-21）**：删除 `BLOCK` 节点与「P1 剩余缺口」段，改为「历史注记（2026-09-20 已解除）」，
并补上真实的剩余缺口（7 个业务页仍是 `PlaceholderPage`，指向 ISS-010）。

<a id="iss005"></a>

#### ISS-005 · `docs/build-plan.md` §4 仍写「M6 尚未实现」

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：§4 渲染层骨架最后一条写「**注意**：M6 尚未实现，属零迁移成本选型（D-21，待评审）」。

**影响**：M6 已于 2026-09-20 实现并端到端验证；该行会让读者以为地图要重做。

**建议动作**：改为「M6 已按 React Flow 落地（D-21 已生效，实测见 `module-M6-map.md` §11.5）」，
并保留 D-21 的评审状态说明（评审归属见 ISS-018）。
**出处**：`docs/build-plan.md` §4

**解决（2026-09-21）**：改为「**M6 已按 D-21 落地并通过构建与测试**」，
D-21 的评审状态改由决策表的「状态」列统一表达（见 ISS-007）。

<a id="iss006"></a>

#### ISS-006 · `docs/module-M6-map.md` 头部与 §1.1 仍称「尚未实现 / 方案待评审」

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：文件头「状态：**方案待评审**」；§1.1 写「关键前提：**M6 尚未实现**（`renderer/` 目前连 `src/main.tsx` 都没有）」。

**影响**：与实际不符（入口已补齐、`map/` 全套实现、8 个测试套件覆盖）。
该文档同时是 M6 的实现依据，状态标签失真会影响后续开发者判断。

**建议动作**：状态改为「**已实现（待评审项见 §12）**」，§1.1 的「尚未实现」改为
「实现时为零迁移成本替换（已按此执行）」的历史说明。§12 的 Q-1…Q-6 保留（见 ISS-020）。
**出处**：`docs/module-M6-map.md` 头部 / §1.1

**解决（2026-09-21）**：文件头状态改为「**已实现（待评审项见 §12）**」；
§1.1 的「M6 尚未实现」改为**历史前提**说明，并补注现状（`renderer/src/map/` 已实现、8 个测试套件覆盖、`npm run build` 与 `npm test` 均通过）。

<a id="iss007"></a>

#### ISS-007 · 设计决策表的「待评审」标注与工作日志口径不一致

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 流程纪律 |
| 领域 | 流程 / 文档 |

**现象**：`AGENTS.md` 设计决策表中只有 **D-11 / D-17 / D-21** 三行带「待评审」字样，
但工作日志里写「D-22…D-27 均**待评审**」「D-15…D-27 全部待评审」「D-28…D-31 与 Q10-Q16 待评审」——
即 D-15/D-16/D-18/D-19/D-20/D-22…D-31 在**表中无标注**、在**日志中被声明为待评审**。

**影响**：「哪些决策已定、哪些还悬着」无法从表里一眼看出；评审时容易漏项。
D-28…D-31 是本轮新增，同样未标注。

**建议动作**：给决策表加独立「状态」列（`已定` / `待评审`），逐行补齐；
工作日志保留原文（只追加不篡改原则），但今后引用评审状态一律以表为准。
**出处**：`AGENTS.md` 设计决策记录 · 工作日志 2026-09-20 / 2026-09-21

**解决（2026-09-21）**：设计决策表新增独立「**状态**」列（`已定` / `待评审`），31 条逐行补齐 ——
D-11、D-15…D-20、D-28…D-31 标 `待评审`，其余 `已定`。今后**评审状态一律以该列为准**，工作日志保留原文（只追加不篡改）。

<a id="iss008"></a>

#### ISS-008 · `package.json` 的 `engines.node >= 20.11` 与 `node:sqlite` 下限不符

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 环境 / 工具 |
| 领域 | 工程化 |

**现象**：根 `package.json` 声明 `engines: { node: ">=20.11" }`，但 `node:sqlite` 是 **Node 22+** 内置模块。
`docs/build-plan.md` §7 已经指出「实际需 ≥ 22」，但 `engines` 字段本身没同步。

**影响**：在 Node 20/21 上 `npm install` 不会报错，运行到 `db:migrate` 才崩，
且报错是模块解析失败（`Cannot find module 'node:sqlite'`），排查成本高。

**建议动作**：`engines.node` 改为 `>=22`（或 `>=22.5`，以 `node:sqlite` 稳定版本为准），
并同步 `build-plan.md` §2 前置条件。实测开发机 Node v25.8.2、Electron 44.3.0 内置 Node 24.20.0 均可用。
**出处**：`package.json` · `docs/build-plan.md` §7

**解决（2026-09-21）**：`engines.node` 由 `>=20.11` 收紧为 **`>=22.5`**。
依据（已核实）：`node:sqlite` 的 `DatabaseSync` **Added in v22.5.0**（Node 官方 v22 文档）；v22.13.0 起**免 `--experimental-sqlite` 标志**（Node 提交 `doc,lib,src,test: unflag sqlite module`，2024-11-19 合入，随 v22.13.0 LTS 发布）。
`build-plan.md` §2 前置条件同步为「Node ≥ 22.5」，§7 风险表同步。

<a id="iss010"></a>

#### ISS-010 · M2-M10 业务模块整体未开工（7 个占位页）

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `计划内` |
| 类型 | 实现缺口 |
| 领域 | 实现 |

**现象**：`renderer/src/app/App.tsx` 中 7 个路由指向 `PlaceholderPage`：
任务管理（M3）、调度中心（M4/M5）、基础数据（M2）、告警中心（M8）、审计日志（M9）、
系统设置（M10）、用户管理（M1）。主进程侧仅有 8 条接口，无任务/调度/路线/告警领域服务。

**影响**：属**计划内**缺口（P2-P6 任务），非缺陷。此处登记以确保「缺口可见」，
避免把工作台与地图的可用误当成系统可用。

**建议动作**：按 `docs/build-plan.md` §6 的 P2 → P6 顺序推进；
每完成一个模块，在本表把对应条目标记「已解决」并注明提交。
**出处**：`renderer/src/app/App.tsx` · `docs/build-plan.md` §6

<a id="iss011"></a>

#### ISS-011 · `GET /api/map/overview?include=orders,orderEndpoints` 未实现

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 实现缺口 |
| 领域 | 实现 |

**现象**：`MapSnapshotOrderEndpoint` 类型与 `MapOverview.orderEndpoints?` 字段已就位
（`shared/src/types.ts`），但 `map.repo.ts` 未读取订单，`api.ts` 未解析 `include` 参数。

**影响**：订单起终点无法上图。依赖订单摄入（ISS-013）先落地。

**建议动作**：随 `0002_data_import` 一并实现；落地前保持「未匹配地区的订单不上图、不伪造坐标」的既有约定。
**出处**：`shared/src/types.ts` · `docs/architecture.md` §8.2 缺口表

<a id="iss012"></a>

#### ISS-012 · `GET /api/map/tracks/{vehicleId}` 轨迹回放未实现

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 实现缺口 |
| 领域 | 实现 |

**现象**：`docs/api.md` §3.6.2 定义了轨迹接口（标注【设计中，未实现】），
主进程无对应路由，渲染层无回放图层。

**影响**：无法回看车辆历史轨迹；`event_log` 已在记录事件，数据基础具备。

**建议动作**：M7（执行器）落地后实现，或先做只读回放（从 `event_log` 聚合位置序列）。
**出处**：`docs/api.md` §3.6.2

<a id="iss013"></a>

#### ISS-013 · 订单摄入迁移 `0002_data_import.sql` 未落地

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 实现缺口 |
| 领域 | 实现 |

**现象**：`docs/data-interfaces.md` §10 已给出新增/变更列建议（含 `orders` 6 列、
`road_types` / `obstacles` / `vehicle_type_params` / `vehicle_param_provenance` 四张新表、
`sites` 边绑定 7 列），迁移文件尚未创建；`desktop/migrations/` 只有 `0001_init.sql`。

**影响**：导入管线、订单图层、泊位约束（M7）均依赖该迁移。

**建议动作**：先解 ISS-001（错误码口径）与 ISS-018（D-28…D-31 评审）再动工，
否则迁移中的表/列命名可能要返工。实现时注意 §10 的提示：
**不要在同一迁移里把 `sites.node_id` 强制改为非空边绑定**（会打断 M6 与 seed）。
**出处**：`docs/data-interfaces.md` §10 · `desktop/migrations/`

<a id="iss014"></a>

#### ISS-014 · 导入 / 导出接口全部未实现

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 实现缺口 |
| 领域 | 实现 |

**现象**：`docs/data-interfaces.md` §7 定义了 6 个导入接口与 4 个导出接口（含 `?format=csv-bundle`），
主进程一条都没有。

**影响**：四类数据文件目前只能手工进库；「先预览后生效」（D-03/D-16）尚无落点。

**建议动作**：随 `0002_data_import` 实施；注意多文件输入的幂等键要覆盖**全部**输入文件（D-28）。
**出处**：`docs/data-interfaces.md` §7

<a id="iss016"></a>

#### ISS-016 · 车辆状态机完整迁移表未成稿（`charging` / `offline` / `fault`）

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 文档缺口 |
| 领域 | 文档 / 设计 |

**现象**：车辆 7 态枚举与 CHECK 约束已落地（`0001_init.sql`），
但 `charging` / `offline` / `fault` 的进入/退出条件**在任何文档中都未定义**。
`docs/architecture.md` 因此只画已定义的迁移并明确标注缺口，未臆测补全。

**影响**：M2（车辆管理）与 M7（执行与监控）实现时无依据，容易出现「同一状态两处定义不同条件」。

**建议动作**：在 M2/M7 落地时补写迁移表，回写 `design.md` §4.3 与 `docs/architecture.md` 状态机图。
**出处**：`docs/architecture.md` 车辆状态机一节 · `desktop/migrations/0001_init.sql`

<a id="iss019"></a>

#### ISS-019 · `docs/module-M6-map.md` §12 的 Q-1…Q-6 待评审

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待评审` |
| 类型 | 待评审 |
| 领域 | 流程 |

**现象**：Q-1 是否隐藏 React Flow 署名 · Q-2 `PIXELS_PER_METER` 固定为 3 · Q-3 Handle 方案 A/B ·
Q-4 超 2000 节点的降级顺序 · Q-5 `NODE_SIZE` 与 CSS 尺寸重复声明 · Q-6 是否需要车辆运行态推进器。

**影响**：Q-1 是**产品/合规**问题（对外分发前必须确认署名策略）；Q-6 与 ISS-021 是同一件事。
其余为可接受的已知取舍，首期已按倾向实现，评审主要是确认。

**建议动作**：Q-1 必须在对外分发前定；Q-6 随 M7 解决；Q-2/Q-3/Q-5 可一次性确认。
**出处**：`docs/module-M6-map.md` §12

<a id="iss020"></a>

#### ISS-020 · F4 算法配置章（`data-interfaces.md` §6）未按真实样本核对

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待评审` |
| 类型 | 待评审 |
| 领域 | 文档 / 设计 |

**现象**：v0.3 样本核对**只覆盖 F1/F2/F3**（用户明确限定只读 `1_仿真地图`/`2_订单数据集`/`3_车辆参数`）。
`4_调度约束/dispatch_constraints.yaml` 未纳入，故 §6 的字段契约仍为 v0.2 的推演版本。

**影响**：F2 章刚因「无样本推演」被整章重写（30+ 处字段不符），§6 存在**同类风险**；
且 §6 与 §5 的单位/时间口径尚未对齐（如 `minBatteryPercent` vs `socMinPct`）。

**建议动作**：下一轮把 `4_调度约束/` 纳入，按 §5 同等标准做逐字段核对，并统一单位口径。
已知 §6 有 1 处与实现可能重复：`costWeights` 键名须与 `DISPATCH_COST_WEIGHTS` 一致（需复核）。
**出处**：`docs/data-interfaces.md` §6 · §12 Q16 · 样本目录 `4_调度约束/`

<a id="iss021"></a>

#### ISS-021 · 车辆运行态推进缺失：地图上车辆静止不动

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待评审` |
| 类型 | 待评审 |
| 领域 | 实现 / 设计 |

**现象**：无任何组件持续产生 `vehicle.changed`，故车辆位置恒定。
渲染层补帧逻辑（`useVehicleMotion`）已实现并有单测，只是没有数据源。

**影响**：演示时「车辆不动」，容易被误判为地图功能缺陷（实际是执行器未开工）。
**明确不做**：不得为了「看起来会动」在前端伪造位置（既已在文档中约定）。

**建议动作**：随 M7（模拟执行器）解决；在此之前，UI 需对「位置未更新」给出可读提示而非静默静止。
**出处**：`AGENTS.md` 困难与问题记录 2026-09-20 · `docs/module-M6-map.md` Q-6

<a id="iss022"></a>

#### ISS-022 · 地区目录的别名 / 歧义匹配在样本上无实例，仍属未验证

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 数据风险 |
| 领域 | 数据 / 设计 |

**现象**：`D-15` 定义了「标准编码 → 规范化名称 → 别名 → 归一化唯一命中」四级匹配，
但样本订单的 `pickup_id`/`dropoff_id` **直接就是站点编码**（`DEPOT`/`ST01…ST12`），
恒在第一级命中（`confidence = 1.0`、`matchType = "code"`）。**别名与歧义场景零实例。**

**影响**：`ORDER.REGION_NOT_FOUND` / `ORDER.REGION_AMBIGUOUS` / `ORDER.SITE_DISABLED` 三条错误码
与「候选选择器」交互均无真实数据可验证，属纸面设计。真实订单接入时可能整条链路失效。

**建议动作**：后续引入真实订单时，**特意补一批含别名/同名/多候选的样本**，
否则该设计无法在验收中被证明可用。已在 `docs/data-interfaces.md` 去重表中登记该待办。
**出处**：`docs/data-interfaces.md` §3.9 · `docs/order-data-map-design.md` §3

<a id="iss024"></a>

#### ISS-024 · `sites` 边绑定迁移会触及既有 seed 与已通过的 M6

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待办` |
| 类型 | 迁移风险 |
| 领域 | 数据模型 |

**现象**：样本 13/13 站点绑定在**边**上（`edge_id` + 车道 + 泊位区间 + 容量），
既有 `sites` 只有 `node_id`。D-30 定为「新增边绑定列 + `node_id` 改为可空」的双写过渡。

**影响**：`MapSnapshotSite.nodeId` 类型是 `string | null`（**已兼容**），但
seed 的 3 个站点、`map.repo.ts` 的查询、M6 渲染与 8 个测试套件都依赖当前形状。

**建议动作**：按 `docs/data-interfaces.md` §10 的提示执行——**先加可空列、保留 `node_id` 有值也可用**，
由导入器同时写 `edge_id`；**不要在同一迁移里强制二选一**。迁移后必须重跑全量测试。
**出处**：`docs/data-interfaces.md` §4.7 / §10 · `shared/src/types.ts`

<a id="iss035"></a>

#### ISS-035 · `edges` 无业务 `code` 列，与「文件内一律用 code 引用」的导入契约冲突

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `待评审` |
| 类型 | 契约一致性 |
| 领域 | 数据模型 / 契约 |

**现象**：`docs/data-interfaces.md` §4.2（D-18）规定导入文件内**一律用 `code` 引用、不用数据库 ID**，
F2 有四处指向 `edges[].code`：`sites.onEdgeCode`、`obstacles.affectsEdgeCodes[]`、
`codeOfReverse`、`restrictions` 的边目标；样本 `campus_edges.csv` 的 `edge_id` 列也映射为 `edges[].code`。
但 `nodes`/`sites`/`vehicles`/`task_templates`/`tasks` **都有 `code` 列，唯独 `edges` 没有**。

**影响**：契约要求一个**无处落库的键**。后果有三：
① `merge` 模式「库内解析文件里的 code」无从实现 —— 只能靠 `(from_node_id,to_node_id)` 反推，
无法与文件里的 `code` 互相校验；② 反向边 `_R` 约定无法持久化，重导时无法判断是否已存在；
③ M2 的边 CRUD 若按 §3.2.4 提供 `code` 查询会直接失败。

**建议动作**：按 **D-35** 在 `0002_data_import.sql` 给 `edges` 加 `code TEXT NOT NULL UNIQUE`
并按 `E_<fromCode>_<toCode>` 回填既有行；`/api/edges` 暴露 `code` 并支持按 `code` 查询。
属 ISS-017 评审批次（D-35），**评审通过后随 `0002` 落地**，不在本轮改代码。
**出处**：`docs/data-interfaces.md` §4.2/§4.3/§10 · `desktop/migrations/0001_init.sql` · `docs/module-M2-base-data.md` §8

---

### 1.3 P3 · 一般（9 条，另含 6 条已解决的 P2：ISS-029 / ISS-030 / ISS-032 / ISS-033 / ISS-036 / ISS-037）
<a id="iss029"></a>

#### ISS-029 · 工作区存在大量未提交改动，基线距今较远

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-22）` |
| 类型 | 流程纪律 |
| 领域 | 流程 |

**现象**：登记时基线为 `66fa7d2`，工作区有大量未提交改动（`renderer/src/` 全套、
`desktop/src/db/sqlite.ts`、`repositories/map.repo.ts`、`shared/` 多项、多份文档）。

**影响**：改动越大，「回退到已知良好状态」越难。

**解决（2026-09-22）**：按提交纪律分四批清空工作区 —— 代码三批 `3e33de7` / `121af4d` / `ab9a762`，
文档两批 `076714e`（文档统一）/ **`84fa028`（M2 模块文档）**。提交前均先补齐 `AGENTS.md` 工作日志并跑全量门禁
（`npm test` 18 套件 / 110 用例 · `typecheck` 3 workspace · `build` 三端）。
提交后基线推进到 `84fa028`，**工作区 0 处未提交改动**。
**注意**：`shared/src/errors.ts` 必须与 `docs/api.md` §2 同批提交，否则会出现「文档有 code、登记处没有」——本轮已同批。
**出处**：`git status` · `AGENTS.md` 提交纪律

<a id="iss038"></a>

#### ISS-038 · `docs/issues.md` 的索引锚点全部失效

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已解决（2026-09-22）` |
| 类型 | 文档格式 |
| 领域 | 文档 |

**现象**：§0.2「全部问题索引」的每行都链到 `#iss0xx`（如 `#iss037`），
但文件里**没有任何 `<a id="iss037">` 或同名标题**——明细标题是 `#### ISS-037 · 标题`，
按 Markdown 渲染出的锚点是 `iss-037-标题…`。实测：37 条链接**在渲染后 0 条可跳转**。

**影响**：本文件的设计前提是「评审前只看 §0.1、开发中按索引跳转」。
链接全失效后，§0.2 的可用性退化为「一张需要手工搜索的表格」，
而条目数越多、越依赖跳转时，损失越明显（当前 38 条）。
这是**静默失效**：Markdown 里看不出问题，只有渲染后才暴露，因此历次结构自检（列数/围栏/编号）都没抓到。

**建议动作**：给每条明细标题前补显式锚点；把「锚点可解析」加入结构自检脚本。

**解决（2026-09-22）**：在每条 `#### ISS-0xx ·` 标题前插入 `<a id="iss0xx"></a>`（38 条），
锚点与索引一一对应（`dangling=0` / `unused=0`）。此前登记编号（ISS-037）时顺带发现，属同类「静默失效」问题。
**出处**：`docs/issues.md` §0.2 与 §1 明细


<a id="iss036"></a>

#### ISS-036 · `PATCH /api/vehicles/{id}/status` 文档取值 `enabled` 不在车辆状态枚举中

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-22）` |
| 类型 | 契约一致性 |
| 领域 | 契约 / 文档 |

**现象**：`docs/api.md` §3.2.2 原写作 `{ "status": "disabled" / "enabled" }`，
但 `shared/src/enums.ts` 的 `VEHICLE_STATUSES` 与 `0001_init.sql` 的 `vehicles.status` CHECK
**都没有 `enabled`**（`enabled` 是 `sites`/`nodes`/`edges` 的取值）。同段落还写「更新基础属性」，
而实现该端点时必须**禁止**改 `status`（否则绕过状态机）。

**影响**：M2 实现「车辆启停」时若照抄文档，提交 `{status:"enabled"}` 会被 CHECK 约束拒绝
（或写库失败后返回 `SYS.INTERNAL`），而前端已把它当合法取值做了映射 —— 典型的「文档即契约」失配。
本项目此前已有同类事故（ISS-030：mock 自造 `AUTH.INVALID_CREDENTIALS`）。

**建议动作**：把取值改为枚举成员 `disabled` / `idle`，并写明「车辆域没有 `enabled`」、`PUT` 不含 `status`。

**解决（2026-09-22）**：`docs/api.md` §3.2.2 改为
`{ "status": "disabled" }`（软删）/ `{ "status": "idle" }`（启用），
显式声明「车辆域没有 `enabled`（与 `sites` 不同）」、占用中停用 → `VEHICLE.STATE_CONFLICT`、
`PUT /api/vehicles/{id}` **不含 `status`**；`online`（心跳标志）不由本接口维护。
迁移表与「M2 只拥有 `idle`/`disabled` 两个迁移」的口径写入 `docs/module-M2-base-data.md` §6.1。

<a id="iss037"></a>

#### ISS-037 · M2 缺模块开发文档（M4 / M6 已有）

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-22）` |
| 类型 | 文档缺口 |
| 领域 | 文档 |

**现象**：`docs/` 下只有 `module-M4-dispatch.md`（调度引擎）与 `module-M6-map.md`（地图渲染）两份模块开发文档，
而 `docs/build-plan.md` §6 的 **P2 阶段第一项就是「M1 + M2」**。M2 有 6 组主数据、7 条 `Req-M2-*`、
一条软删规则（D-07）与一套审计要求，全部散落在 `design.md` §4.2 / `docs/api.md` §3.2 / `docs/database.md` §2，
开工前需自行拼装。

**影响**：直接后果是**口径不统一** —— 例如车辆 `status` 的可写范围（ISS-036）、
节点引用的判定范围（`BASE.NODE_IN_USE` 算不算 `vehicles.current_node_id`）、
审计该用哪个 `objectType`（`OBJECT_TYPES` 里没有 `restriction` / `task_template`），
这些都没有单一出处，实现者只能各自决定。

**建议动作**：按 `module-M4-dispatch.md` 的格式补一份 M2 模块开发文档。

**解决（2026-09-22）**：新增 `docs/module-M2-base-data.md`（文件划分、服务契约与事务边界、
13 级校验顺序、拒绝新增冗余错误码的理由、软删与 `BASE.NODE_IN_USE` 判定、审计动作命名、
错误映射表、B1-B16 测试清单与 6 步 DoD）；并借该文档暴露 ISS-036 与 §11 的 6 个待决项。
**出处**：`docs/module-M2-base-data.md` · `docs/build-plan.md` §6

<a id="iss032"></a>

#### ISS-032 · 跨文档事实不一致（18 处），且文档索引存在三份副本

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：对全部 13 份 Markdown 做交叉核对（逐条与 `shared/` · `desktop/` · `renderer/` 源码及运行库比对），
发现 **18 处**「同一事实在不同文档中写法不同」—— **前 12 处是数值，后 6 处是源码路径**（两者都是「多处各写一份」）：

| # | 事实 | 错误写法 | 实为 | 出处 |
| --- | --- | --- | --- | --- |
| A | 登录返回的 `permissions` | 示例列了 8 项 | admin 实为 **20 项**（`permissionsOf('admin')`） | `docs/api.md` §3.1.1 |
| B | 迁移目录 | `desktop/db/migrations/` | `desktop/migrations/` | `docs/database.md` §0 · `docs/build-plan.md` §4 |
| C | 第二个迁移文件名 | `0002_seed.sql`（§4 正文） | `0002_data_import.sql`（Q7 已定，另三处一致） | `docs/build-plan.md` §4 |
| D | seed 路网规模 | 「10-16 节点、2 站点 + 1 充电桩」 | **12 节点 / 34 边 / 3 站点（2 depot + 1 charging）** | `docs/api.md` §5 |
| E | 「一键推进 / 一键重置演示数据」 | 写作既有能力 | **未实现**（代码中无此入口） | `docs/api.md` §5 |
| F | MockAdapter 存储 | 「内存 + localStorage」 | **纯内存**（`mock.ts` 无 `localStorage`） | `docs/build-plan.md` §3.2 · `docs/architecture.md` §1 |
| G | 适配器默认值 | 「默认 mock」 | 按 **preload 桥**判定（有桥→`ipc`，无桥→`mock`，D-22） | `docs/build-plan.md` §3.2 · `docs/architecture.md` §11 · `.env.example` |
| H | `design.md` 表清单 | 未标注 `schema_version` 与 16 张业务表口径 | 16 张业务表 + `schema_version` | `design.md` §6.2 |
| I | `README` 本地运行 | 「脚手架就绪后生效」「以上命令为规划占位」 | 已落地可跑 | `README.md` |
| J | 事件表 | 未标注所需权限点 | D-32 起按 `EVENT_PERMISSIONS` 过滤 | `docs/api.md` §4 |
| K | 种子账号默认密码 | 「见 AGENTS.md 种子说明」 | AGENTS.md **无此节**，实为 `shared/src/constants.ts` 的 `SEED_ACCOUNTS` | `design.md` §3.7 |
| L | 文档索引 | **三份副本**（`README.md` 表 · `design.md` §10.2 · `AGENTS.md` 列表），互相之间已出现描述差异 | 应有一份权威索引 | 三处 |
| M | 源码路径（主进程） | `desktop/db/seed.ts` | `desktop/src/db/seed.ts` | `docs/database.md` §4 |
| N | 源码路径（分层目录） | `desktop/domain` / `algorithms` / `db`（缺 `src/`） | `desktop/src/domain` / `algorithms` / `db` | `docs/module-M4-dispatch.md` §3 · `docs/architecture.md` §7.4 |
| O | 源码路径（shared 形态） | `shared/{types,enums,errors,constants}/` 四个子目录 | `shared/src/*.ts` **扁平文件** | `design.md` §2.4 · `docs/build-plan.md` §4.1 |
| P | 源码路径（renderer） | `renderer/{map,pages,api,store}/…` | `renderer/src/…` | `design.md` §2.4 · `docs/architecture.md` §7.4/§8.2 |
| Q | `shared/apiClient` | 写作 `shared/` 里的模块 | 实为 `renderer/src/api/index.ts` 导出（适配器在 renderer 侧） | `docs/api.md` §0 · `docs/build-plan.md` §4.3 |
| R | `shared/i18n/dispatch.ts` | 写作既定位置 | **从未存在**（文案当前内联在 `renderer/src/pages/`） | `docs/module-M4-dispatch.md` §8 |

**影响**：A/D/E/F/G 会直接误导开发者（把示例当契约、把未实现当既有能力、按错误默认值写代码）；
**M~R 更隐蔽**：路径写错不会让任何结论失效，但会让「按文档找文件」直接失败 ——
且**按数值清单核对的方法系统性地发现不了它们**（本轮是靠脚本逐个检查反引号路径是否存在才挖出来的）。
L 使「新增文档」要在三处同步，漏一处就产生新的漂移 —— 这正是本轮要根治的模式。

**解决（2026-09-21）**：

1. 上述 18 处逐条按实现/既定决策改正（详见本次 `AGENTS.md` 工作日志）。其中 M~R 六处路径已改为实测形态。
2. 新增 **文档事实单一来源表**（`docs/api.md` §0），明确「每个事实由哪份文档负责」，
   其余文档只能引用、不得复述数值 —— 从机制上避免再次漂移。
3. 文档索引收敛为**一份权威**（`README.md` 的「文档入口」），`design.md` §10.2 与 `AGENTS.md` 改为指针。

**出处**：全部 13 份 Markdown 的交叉核对 · `shared/src/constants.ts` · `desktop/migrations/` · `renderer/src/api/mock.ts`

---

<a id="iss031"></a>

#### ISS-031 · 两处 Markdown 表格被单元格内的裸 `|` 截断

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档格式 |
| 领域 | 文档 |

**现象**：`docs/api.md` §3.1 / §3.2 的两张接口表里，`PATCH .../status` 行的 JSON 示例写了裸竖线
（`` `{ "status": "disabled" | "enabled" }` ``），被 Markdown 解析为列分隔符，使该行列数比表头多出 1 列；
`docs/module-M4-dispatch.md` §6 的事件表同样有两行含裸 `|`（`` `'assigned'|'pending'` ``）。

**影响**：GitHub / VSCode 预览下这几行会**多出幽灵列**，表格右边界错位。不影响内容正确性，属渲染层瑕疵。

**建议动作**：把单元格内的 `|` 转义为 `\|`，或改用 `/`、`或` 等写法。属整洁性债务，不紧急。

**解决（2026-09-21）**：随 ISS-032 的文档统一一并修掉 —— 单元格内的裸 `|` 改写为 `/` + 「（二选一）」说明。
修后全量 13 份 Markdown 的**表格块列数逐块一致（0 处不一致）**，见本次 `AGENTS.md` 工作日志的验证记录。
**注意**：这与 P1 收口无关（ISS-001 已核对过 `shared/src/errors.ts` 与两份文档，这两处缺陷在变更前就已存在）。

**出处**：`docs/api.md` §3.1/§3.2 · `docs/module-M4-dispatch.md` §6

---

<a id="iss030"></a>

#### ISS-030 · mock 适配器自造错误码 `AUTH.INVALID_CREDENTIALS`

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 契约一致性 |
| 领域 | 前端 / 契约 |

**现象**：`renderer/src/api/mock.ts` 登录失败时返回 `AUTH.INVALID_CREDENTIALS` —— 该 code **不在** `ERROR_CODES` 中
（主进程返回的是 `AUTH.LOGIN_FAILED`）。同一份代码在浏览器与 Electron 下返回**不同的错误码**。

**影响**：违反了 `api.md` §1.1「三层适配器行为必须一致」。页面当前只读 `message` 所以看不出异常，
但一旦前端按 `code` 做文案映射或埋点，**切到 Electron 后静默失配** —— 与 D-27 记录的 mock 事故同一类。

**原因**：mock 的 `failure(code, message)` 助手接收任意字符串，没有把 code 约束到目录类型上。

**建议动作**：mock 一律从目录取 `source` 与兜底文案，助手签名收窄为 `ErrorCode`。

**解决（2026-09-21）**：删除自造的 `failure()`，改为 `fromCatalog(code: ErrorCode, detail?)`，
内部从 `ERROR_CODES` 取 `message`/`source`。新增 `renderer/src/api/mock-parity.test.ts`（3 条断言）
锁死「登录失败必须返回 `AUTH.LOGIN_FAILED` 且 source/文案与目录一致」「未实现路由返回已登记的 `API.ROUTE_NOT_FOUND`」。
本次审计（错误码闭环扫描）发现，属 ISS-001 的附带产出。

**出处**：`renderer/src/api/mock.ts` · `docs/api.md` §1.1 · `shared/src/errors.ts`

---

<a id="iss002"></a>

#### ISS-002 · `API.ROUTE_NOT_FOUND` 已实现但未登记进 `api.md` §2

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：`shared/src/errors.ts` 有 `API.ROUTE_NOT_FOUND`（未知路由，`router.ts` 兜底使用，
`router.test.ts` 有断言），但 `docs/api.md` §2 的目录里没有它。

**影响**：接口文档的「错误码目录」不完整；前端按目录做穷举映射时会漏掉 404 兜底分支。

**建议动作**：补登一行 `API.ROUTE_NOT_FOUND`（source `validation`，HTTP 404）。
**出处**：`shared/src/errors.ts` · `desktop/src/ipc/router.ts` · `desktop/src/ipc/router.test.ts`

**解决（2026-09-21）**：`api.md` §2 重写为**从 `shared/src/errors.ts` 派生的完整表**（34 条运行时 + 89 条导入域），
`API.ROUTE_NOT_FOUND` 已随之一并登记（source `validation`，HTTP 404）。
另新增 `errors.catalog.test.ts` 断言「文档里出现但未登记的 code 会让 `npm test` 失败」，此类漏登不会再发生。

<a id="iss015"></a>

#### ISS-015 · 分页 / 参数校验工具内联在 `ipc/api.ts`

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `待办` |
| 类型 | 实现缺口 |
| 领域 | 实现 / 整洁性 |

**现象**：`AGENTS.md` 代码现状地图记为「分页/参数校验工具仍内联在 `api.ts`」。

**影响**：接口数量增长后重复代码扩散，校验口径容易分叉。

**建议动作**：接口数超过 ~12 条前抽成 `ipc/validators.ts` + `ipc/paging.ts`。
属整洁性债务，不紧急。
**出处**：`AGENTS.md` 代码现状地图

<a id="iss023"></a>

#### ISS-023 · 车辆参数 51.2% 的数值字段为 `[D]` 级工程假设

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已接受` |
| 类型 | 数据风险 |
| 领域 | 数据 |

**现象**：`3_车辆参数/vehicle_params.yaml` 的 **129** 个数值字段中，A 0 / B 43 / C 20 / **D 66（51.2%）**。
`[D]` 定义是「本文工程假设（非实测，无外部来源）」。

> **口径更正（2026-09-21）**：本条原写作「218 个字段 / B 62 / C 24 / D 132（60.6%）」——
> 该组数字来自样本 `5_数据校验/数据可信级别.csv`，而它覆盖的是 **两份**配置文件
> （`vehicle_params.yaml` 129 + `dispatch_constraints.yaml` 89）。**车辆文件的正确口径是 129 / D 66（51.2%）**。
> 影响面：`docs/data-interfaces.md` §5.9（表与汇总提示）、§13.3、§11 V15、§7 的 F-5、
> §10 的 `vehicle_param_provenance`、Q14，以及 `AGENTS.md` 的 D-31 与工作日志。均已按新口径区分两列。

**影响**：仿真结果的可信度上限由这批假设决定。**这不是缺陷**——样本已对每个字段标注级别并给出
`references`，属「诚实的不确定性」。风险在于使用者忽略级别、把假设当实测引用。

**建议动作**：已定为「级别随参数落库 + UI 展示徽标 + 可筛选（D-31）」，不阻断导入。
报告/汇报中引用车辆参数时须注明级别构成。
**出处**：`docs/data-interfaces.md` §5.9 · §13.3

<a id="iss025"></a>

#### ISS-025 · 订单时间无日期，跨日策略未定

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `待办` |
| 类型 | 设计待定 |
| 领域 | 设计 |

**现象**：订单时间为「当日 0 点起秒数」，无日期无时区。首期规定不跨日、
`tw_end_s > 86400` 报 `ORDER.TIMEWINDOW_CROSS_DAY`（error）。

**影响**：真实订单中「夜间下单、次日晨间送达」很常见（样本时间窗上界正好压在 21:00 = 75600 s）。
当前口径会把这类订单当作错误拦截。

**建议动作**：首期按契约执行（服务日由批次参数 `serviceDate` 决定）；
引入真实订单时若出现跨日样本，需扩展为「服务日 + 偏移」模型。已在 §3.3 与 Q13 登记。
**出处**：`docs/data-interfaces.md` §3.3 · §12 Q13

<a id="iss026"></a>

#### ISS-026 · 依赖树里存在两套 Vite 与两份 zustand

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已接受` |
| 类型 | 环境 / 工具 |
| 领域 | 工程化 |

**现象**：`renderer/node_modules` 有 Vite 6.4.3，根 `node_modules` 是 Vite 5.4.21（Vitest 侧）；
`@xyflow/react` 自带 `zustand@4.5.7`，与项目 `zustand@5.0.15` 并存。

**影响**：均为 npm workspaces 与上游固定依赖导致的**正常现象**，互不干扰。
风险在排查时误判版本：`renderer/vite.config.ts` 由 Vite 6 执行，根 `vitest.config.ts` 由 Vite 5 执行。

**建议动作**：无需处理；排查构建/测试问题时先确认「构建用 Vite 6、测试用 Vite 5」。
**出处**：`AGENTS.md` 困难与问题记录（两条）

<a id="iss027"></a>

#### ISS-027 · `apply_patch` 写入大段中文 Markdown 时易触发补丁失败

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已接受` |
| 类型 | 环境 / 工具 |
| 领域 | 工具 |

**现象**：空行缺少 `+` 前缀会导致「空行无补丁前缀」错误并**原子回滚**整份补丁。

**影响**：大段中文文档改动反复失败，浪费轮次。

**建议动作**：沿用既有做法——**大文件改动改用 `python3` 脚本写入**（本项目已多次验证有效），
仅小改动用 `apply_patch`。避免使用 `rm -f`（沙箱拒绝），改用 `node -e "require('fs').rmSync(...)"`。
**出处**：`AGENTS.md` 困难与问题记录 2026-09-07

<a id="iss028"></a>

#### ISS-028 · 用 Chrome 打开 `file://` 产物会误判为打包缺陷

| 项 | 值 |
| --- | --- |
| 严重度 | `P3`（一般） |
| 状态 | `已排除` |
| 类型 | 环境 / 工具 |
| 领域 | 工具 / 用法 |

**现象**：Chromium 以 CORS 规则拦截 `file://` 下的 ES module 脚本，
用 Chrome 直接打开 `renderer/dist/index.html` 会白屏，一度疑似 React Flow 打包问题。

**影响**：已用最小复现确认与 React Flow 无关；真实 Electron 44 用 `loadFile()` 渲染正常。
风险在于**验收方式错误**导致误判。

**建议动作**：验收统一用 `npm run dev:electron` 或 `vite preview`，**不要**用 Chrome 开 `file://`。
兜底方案为单文件 IIFE 构建（实测 `file://` 下可渲染）。
**出处**：`AGENTS.md` 困难与问题记录 2026-09-20 · `docs/module-M6-map.md` §11

---

<a id="iss033"></a>

#### ISS-033 · 主修正未传播：地图包文件数 / 错误码条数 / 用例编号仍留旧值

| 项 | 值 |
| --- | --- |
| 严重度 | `P2`（重要） |
| 状态 | `已解决（2026-09-21）` |
| 类型 | 文档一致性 |
| 领域 | 文档 |

**现象**：按真实样本把地图包从「4 个文件」改判为「5 个文件」（新增 `campus.add.xml`）后，
**定义处改了、引用处没跟上**：

| 位置 | 旧值（未随主修正更新） | 正确值 |
| --- | --- | --- |
| `docs/data-interfaces.md` §0 四类文件表 | F2 实测形态「4 个文件」 | 5 个（3 CSV + 1 XML + 1 GeoJSON） |
| 同文件 §2.7 场景包 | 「地图 4 个文件 → 场景 6 份」 | 地图 5 个 → 场景 **7 份**（含 `scenarioId` 哈希范围） |
| 同文件 §4.1 标题 | 「四个文件的捆绑包」 | 五个文件（正文已是五个） |
| 同文件 §7.2 `sourceBundle` | `{ nodes, edges, stations, geojson }` | 增 `addXml` 键，且缺 `addXml` 会给 `MAP.OBSTACLES_UNAVAILABLE` |
| 同文件 §9 组件表 / F-4 / Q10 | 「四个文件」「3 CSV + 1 GeoJSON」 | 同步为五个文件 |

同时，新增错误码 `MAP.OBSTACLES_UNAVAILABLE` 后 `ERROR_CODES` 已为 **124 条**，
但 `AGENTS.md` 项目快照 / 验证基线 / 代码现状地图、`docs/api.md` §0、`docs/architecture.md` §8.3 图仍写 **123 条（导入域 89）**。

另有 §11.3 的**编号重复**：为 `campus.add.xml` 插入一条用例时占用了已存在的 `M17`，
表内出现两条 `M17`，其后用例未顺延。

**影响**：按「4 个文件」实现的导入向导会**漏掉障碍物来源**，且用户按文档上传时无法理解
`MAP.OBSTACLES_UNAVAILABLE` 从何而来；错误码条数错 1 会让「条目数与登记处一致」这类自检失去意义；
用例编号重复会让「M17 失败」无法定位到唯一用例。

**原因**：修正是**点状**的 —— 只改了定义处（§4.1 正文表格），没有沿「派生引用」再扫一遍。
与 ISS-032 / D-34 同源，但这次漂移发生在**同一文档内部**（此前 18 处是跨文档），
说明「唯一作者」原则还要配一条「改完旧值必须 `rg` 回扫」。

**解决（2026-09-21）**：5 处「文件数」全部改为 5 / 7；
`docs/api.md` §2 增补「**条数不在此处固化**」并成为条数的唯一出处（其余文档改为引用 §2）；
`AGENTS.md` 快照 / 验证基线 / 代码地图与 `docs/architecture.md` 图同步为 124（34 运行时 + 90 导入域）；
§11.3 的重复 `M17` 改为 `M18…M21` 顺延；历史工作日志里的旧值按既有惯例加删除线保留（不改写历史）。

**出处**：`docs/data-interfaces.md` §0/§2.7/§4.1/§7.2/§9/§11.3 · `docs/api.md` §0/§2 · `docs/architecture.md` §8.3 · `AGENTS.md`

---

## 2. 已解决问题（保留备查）

> 按维护规则第 3 条，已解决的问题**不删除**。本表从 `AGENTS.md`「困难与问题记录」汇总，保留「现象 → 根因 → 解法」，因为它对后来者最有价值。

| 日期 | 问题 | 根因 | 解法 | 出处 |
| --- | --- | --- | --- | --- |
| 2026-09-07 | 原始需求文档落在误建目录（文件名带冒号） | 建目录时误输入 `:n` | 迁移至 `docs/requirement-raw.md` 并删除误建目录 | AGENTS.md |
| 2026-09-14 | `npm test` 的 5 个套件全部无法收集 | `tests/setup.ts` 缺 `@testing-library/jest-dom`；**另有第二个原因**（见下条） | 补齐依赖 `@testing-library/jest-dom@^6.6.3` | AGENTS.md |
| 2026-09-20 | 修完 setup 依赖后测试**仍全失败**：`Failed to load url sqlite` | vite-node 的内置模块白名单是打包时固化的且会剥掉 `node:` 前缀，而 Node 25 的 `node:sqlite` **只有带前缀**形式 | 新增 `desktop/src/db/sqlite.ts`，用 `createRequire` 惰性加载（`require` 不参与 Vite 静态解析） | AGENTS.md / `desktop/src/db/sqlite.ts` |
| 2026-09-20 | renderer 无 `src/main.tsx`：`npm run build` 失败、`dev:electron` 必然白屏 | 只有 Vite 壳层文件，`index.html` 指向不存在的入口 | 补齐入口与全套渲染层（适配器 / store / 路由 / 页面 / React Flow 地图） | AGENTS.md |
| 2026-09-20 | `npm run dev` 看似正常但拿不到入口 | dev server 对不存在的入口返回 SPA 兜底的 `index.html`（200 + `text/html`），被误判为成功 | 改为检查 `Content-Type` 与响应体；已写入验证基线作为陷阱提示 | AGENTS.md |
| 2026-09-20 | 地图渲染后**边全部消失**（`edges=0`），5 秒后才出现 | `vehicle.changed` 每秒触发全量快照重拉 → `nodes`/`edges` 每秒重建 → React Flow 重新测量节点 | 事件分层（D-23）：位置类事件只写 `positionsRef`；并加 `model/structural.ts` 结构签名 | `docs/module-M6-map.md` §11.5 |
| 2026-09-20 | `<MiniMap>` 一个方块都不画，仅剩空框 + 遮罩，且不报错 | React Flow 只为「有尺寸」的节点画方块，而用户节点的 `measured` 在渲染后仍未落位 | `toFlow.ts` 给每类节点补 `initialWidth`/`initialHeight`（不能用 `width`/`height`，避免与真实测量竞争） | `docs/module-M6-map.md` §11.5.1 |
| 2026-09-20 | 路线高亮视觉上完全看不出，但页面不报错 | `<BaseEdge>` 把 `className` 拼到 `<path>` 自身，`.udm-edge-route.is-active path` 是死选择器（同类问题还有 `.react-flow__node.is-selected`） | 改为「同元素多类」写法 | AGENTS.md |
| 2026-09-20 | 深色画布上 `Controls`/`MiniMap` 是一块白方块 | 两者用 React Flow 自带浅色默认样式，且不提供深色变量 | `style/map.css` 显式覆盖为 `theme.css` 变量 | AGENTS.md |
| 2026-09-20 | 生产形态（`loadFile`）**静默使用假数据** | 打包构建不带 `.env`，`VITE_API_ADAPTER` 为 `undefined`，原逻辑默认落 `mock` | 默认值按「有没有 preload 桥」判定（D-22），并用测试锁死 | `renderer/src/api/index.ts` |
| 2026-09-20 | seed 写入的路线 `edge_ids` 全部指向**不存在的边**，无任何报错 | `edges.id` 的 code 是大写而节点 id 是小写；`edge_ids` 是 JSON 文本列无外键保护，只在前端高亮时静默匹配不上 | 改为用节点序号推导 `nodeCode()`；新增「每段边都存在且相邻节点连通」断言 | `desktop/src/db/seed.ts` |
| 2026-09-20 | mock 快照与真实 seed 库**形状相同但内容不同**（id 不一致） | `mock-data.ts` 手抄了 id（`seed-n-N1` vs `seed-n01`），两边相似但不相等，浏览器正常、切 Electron 后选中态/事件/角标静默失效 | mock 改为从 `SEED_IDS` 同规则派生（D-27），并加逐字段比对用例 | `renderer/src/api/mock-data.ts` |
| 2026-09-20 | 表数量口径自检不一致：测试期望 17 张业务表，实测 16 | 原口径把 `schema_version` 也算成了业务表 | 修正为 16 并新增「精确表集合」断言；同步架构图 / 数据库文档 / README | `desktop/src/db/db.test.ts` |
| 2026-09-20 | `design.md` §2.3 与 `build-plan.md` §2/§7 仍以 `better-sqlite3` 为前提 | 文档阶段选型未随 D-14 更新（挂账 6 天） | 统一为 Node 内置 `node:sqlite`；风险表替换为 `node:sqlite` 版本下限与 vite-node 解析风险 | `design.md` / `docs/build-plan.md` |
| 2026-09-20 | `README.md` 状态段仍写「P0 文档阶段 / 尚未 git init」 | 长期未同步（挂账 6 天） | 改为「P1 地基已通 + M6 地图已实现」，补三端现状与命令 | `README.md` |
| 2026-09-21 | `data-interfaces.md` 的 F1/F2/F3 三章字段契约与真实样本**大面积不符** | 三章写于 2026-09-15，当时**没有样本文件**，字段按常识推演（时间假设 ISO 8601、优先级假设英文枚举、站点假设节点绑定、能耗假设 Wh/km） | 按样本逐字段重写三章（§3/§4/§5）+ 新增 §13 实测速查 + D-28…D-31 | `docs/data-interfaces.md` |
| 2026-09-21 | 样本订单 `tw_start` 文本与 `tw_start_s` **对不上**（197/200 行） | 文本是分精度（`08:21`），秒数列可含非零秒（30066 = 08:21:06）；按秒级严格相等会误判 197 行为错误数据 | 契约明确「比对按分钟下取整」，并把「实际存在非零秒」写入 §13 速查 | `docs/data-interfaces.md` §3.3 |
| 2026-09-21 | 文档中「Solomon 56 个已转 CSV」「Li & Lim 各 52–55 行」**两处数字是错的** | 凭印象写数字，未逐个 `ls`/`wc` 复核 | 更正为「Solomon 只转了 `c101` 一个 CSV」「Li & Lim 56 个文件行数 50–55」；并写入问题记录作为方法论警示 | `docs/data-interfaces.md` §3.1/§13.2 |
| 2026-09-21 | 一度以为 `UGV-L` 的 `kerb_weight_kg = 500`（与 UGV-S 同值）是笔误 | 未先读该字段的溯源标注 | 确认样本标为 `[B]` 级并附「满载质量 1000 kg 按 50% 拆分」说明，属有意为之；已在契约中标注「不要当笔误改掉」 | `docs/data-interfaces.md` §5.3 |
| 2026-09-21 | `campus.geojson` 一度被怀疑是 WGS84 经纬度 | 文件**没有 `crs` 成员**，坐标形如 `[[0,0],[150,0]]`、量级 0–760；按经纬度解析会得到空白图且不报错 | 确认为平面米制；契约固定 `meta.coordinateSystem` 为 `planar-meters`，非该值直接拒绝，把静默错误变为显式报错 | `docs/data-interfaces.md` §4.1 |
| 2026-09-21 | 项目同时存在**两套错误码目录**（34 条 vs 97 条，零重叠），两份文档各自声称「唯一登记处」 | 「文档先行」阶段两份文档各写一套命名，且都按「文件族」而非「概念」划分前缀（`MAP.EMPTY_GRAPH` vs `GRAPH.EMPTY`） | 选定 `shared/src/errors.ts` 为唯一登记处并合并两套（123 条）；命名统一为 `域.原因`（AIP-193）；新增 `errors.catalog.test.ts` 把「文档中每个 code 都必须已登记」变成可执行断言 | `shared/src/errors.ts` / `docs/api.md` §2 / `docs/data-interfaces.md` §8（ISS-001，D-33） |
| 2026-09-21 | 第二个窗口/会话能收到与其角色无关的领域事件 | `EventBus.emit()` 对全部已 attach 的 `webContents` 无条件群发，不判断接收方会话权限，绕过了 D-08 的服务端强制校验 | `EventBus` 增加 `EVENT_PERMISSIONS` 映射与 `attach(target, token)` / `bindSession()`；未登录窗口收不到任何登记过权限的事件；`main.ts` 在登录/登出后同步窗口身份；新增 8 条单测 | `desktop/src/services/event-bus.ts`（ISS-009） |
| 2026-09-21 | mock 适配器返回主进程并不存在的错误码 `AUTH.INVALID_CREDENTIALS` | mock 的失败助手接收任意字符串，未把 code 约束到 `ERROR_CODES` 类型上 | 改为 `fromCatalog(code: ErrorCode)` 并从目录取 source/文案；新增 `mock-parity.test.ts` 锁死三层适配器的错误码一致 | `renderer/src/api/mock.ts`（ISS-030） |
| 2026-09-21 | `engines.node` 声明 `>=20.11`，但 `node:sqlite` 自 Node 22.5 起才存在 | 脚手架阶段按「LTS 下限」随手填写，未与 D-14 的驱动选型对齐 | 收紧为 `>=22.5`；`build-plan.md` §2/§7 同步（已核实 `DatabaseSync` Added in v22.5.0，v22.13.0 起免实验标志） | `package.json`（ISS-008） |
| 2026-09-21 | 设计决策表只有 3 行带「待评审」字样，工作日志却称 D-15…D-31 待评审 | 评审状态写在「理由/备注」列的自由文本里，无法逐行核对 | 决策表新增独立「状态」列（`已定`/`待评审`）并逐行补齐；今后评审状态以该列为准 | `AGENTS.md`（ISS-007） |
| 2026-09-21 | 架构图 §8.3 把已落地的 renderer 与已解除的测试阻塞仍标为【设计中】/【阻塞】 | 该图定稿于 2026-09-14，之后 renderer 全层与 M6 落地、测试阻塞解除，但图未回写 | 更新为「截至 2026-09-21」，阻塞节点改为「历史注记（已解除）」，待实现清单移除 M6 与测试 setup | `docs/architecture.md` §8.3（ISS-003/ISS-004） |
| 2026-09-21 | 同一事实在 13 份 Markdown 中有 **18 处**写法不同（12 处数值 + 6 处**源码路径**），文档索引还有三份副本 | 「文档先行」阶段多份文档各自复述同一批数值与路径；索引也在三处各维护一份。路径类写法（`desktop/db/…` vs `desktop/src/db/…`）不改任何结论，故按数值清单核对时发现不了 | 18 处逐条按实现改正（路径部分用脚本逐个校验反引号路径是否存在，最终 0 悬空）；新增 `docs/api.md` §0「文档事实单一来源」把每个事实指派给唯一负责文档，其余只许引用；索引收敛为 `README.md`「文档入口」一份权威 | `README.md` / `design.md` / `docs/*.md`（ISS-032） |
| 2026-09-21 | `docs/api.md` §3.1/§3.2 与 `docs/module-M4-dispatch.md` §6 的表格被单元格内裸 `\|` 截断，预览多出幽灵列 | JSON/TS 联合类型示例里的 `\|` 未转义，被 Markdown 当列分隔符 | 改为 `/` + 「（二选一）」；改后 13 份 Markdown 表格列数逐块一致 | `docs/api.md` / `docs/module-M4-dispatch.md`（ISS-031） |
| 2026-09-21 | 主修正只改了定义处：地图包 4→5 文件后，§0/§2.7/§4.1 标题/§7.2/§9/Q10 仍写 4 个文件；新增错误码后 124 条仍被写成 123 条；§11.3 出现两条 `M17` | 点状修正：改了「定义处」未回扫「派生引用」；同一文档内部的引用比跨文档更隐蔽（以为改过表格就改完了） | 5 处文件数同步为 5/7；`docs/api.md` §2 声明「条数不在此处固化」并成为唯一出处；124 条同步到快照/图；`M17` 重复改为 `M18…M21`；历史日志旧值加删除线保留 | `docs/data-interfaces.md` / `docs/api.md` / `docs/architecture.md` / `AGENTS.md`（ISS-033） |
| 2026-09-21 | 干净检出上 `npm run dev` / `dev:electron` 起不来：Vite 打印 ready 但 `Failed to resolve entry for package "@udm/shared"` | `shared` 的 `main` 指向被 gitignore 的 `dist/`，而 renderer/desktop 有**运行时**导入；`test`/`typecheck`/`db:*` 都带了 `build:shared`，唯独两个 dev 脚本漏加 | 给两个 dev 脚本前置 `build:shared`（`dev:electron` 另加 `build:desktop`，因其执行 `electron dist/main.js`）；删掉两个 dist 目录后复跑验证通过 | `package.json`（ISS-034） |
| 2026-09-22 | `PATCH /api/vehicles/{id}/status` 的文档取值 `enabled` 不在车辆状态枚举里 | 该段从 `sites` 的启停写法复制而来（`sites`/`nodes`/`edges` 确有 `enabled`），而车辆 7 态无此值；同段落还把「更新基础属性」写成可含 `status` | 取值改为 `disabled`/`idle`，显式声明「车辆域没有 `enabled`」、占用中停用被拒、`PUT` 不含 `status`；口径写入 `docs/module-M2-base-data.md` §6.1 | `docs/api.md` §3.2.2（ISS-036） |
| 2026-09-22 | P2 阶段开工在即，M2 却没有模块开发文档（M4/M6 都有） | 新模块文档的编写**晚于**实现启动，M2 的 7 条 `Req-*` 与软删/审计规则分散在三份文档里，只能靠实现者自行拼装 | 新增 `docs/module-M2-base-data.md`；编写过程中即暴露出 ISS-036 与 6 个待决项（`OBJECT_TYPES` 无 `restriction`、`edges` 缺 `code` 列等） | `docs/module-M2-base-data.md`（ISS-037） |
| 2026-09-22 | `docs/issues.md` §0.2 的 37 条索引链接渲染后全部点不动 | 缺失显式锚点：`](#iss037)` 对应的 `<a id="iss037">` 从未写入，而明细标题渲染出的锚点是 `iss-037-标题` 形态；Markdown 源码里看不出异常 | 明细标题前补 38 个显式锚点，并断言 `dangling=0 / unused=0` | `docs/issues.md`（ISS-038） |
| 2026-09-22 | 工作区长期存在大量未提交改动，基线距今较远（登记时 `66fa7d2`，一度叠加到 13+ 份文档 + 代码 + `.env.example`） | 「文档先行」阶段改动面广，且每批都「先写日志、等评审」，评审未到就一直不提交；工作区越积越远 | 按纪律分四批提交（代码 `3e33de7`/`121af4d`/`ab9a762`，文档 `076714e`/`84fa028`）；提交后工作区干净，基线推进到 `84fa028` | `docs/issues.md`（ISS-029） |

---

## 3. 如何使用本文件

**评审前**：只看 §0.1 的 5 行，就能决定「现在能不能开工、要先定什么」。

**开发中**：开工某模块前，按「领域」列筛一遍相关条目；
开工后若发现新问题，先加进 §1 再动手修（与 `AGENTS.md` 的提交纪律一致：先记录、后提交）。

**提交前**（对应 `AGENTS.md` 提交纪律第 4 步）：

1. 本次修掉的条目 → 状态改「已解决」，并在本文件 §2 追加一行（日期/问题/根因/解法/出处）。
2. 本次新发现的条目 → 按 §1 格式新增，编号顺延。
3. `AGENTS.md` 的工作日志条目里**引用相关 `ISS-xxx` 编号**，两边即可互相追溯。

**与 `AGENTS.md` 的分工再强调一次**：`AGENTS.md` 记「**什么时候发生了什么**」（时间线）；
本文件记「**现在还剩什么问题**」（状态表）。两边都保留，互不替代。

---

## 4. 统计口径说明

| 项 | 说明 |
| --- | --- |
| 数据来源 | `AGENTS.md`「困难与问题记录」+「设计决策记录」· `docs/data-interfaces.md` §12 · `docs/module-M2-base-data.md` §11 · `docs/module-M6-map.md` §12 · `docs/build-plan.md` §7 · `docs/architecture.md` 缺口表与 §8.3 · 对 `shared/` `desktop/` `renderer/` 源码的实测核对 |
| 严重度判定 | `P1` = 阻断开工 / 安全 / 契约根因；`P2` = 影响正确性或可信度；`P3` = 整洁性、体验、已知取舍 |
| 状态判定 | `待办` 未开始 · `待评审` 等决策 · `计划内` 属正常排期缺口 · `已接受` 已知取舍非缺陷 · `已排除` 曾疑似问题已澄清 |
| 不收录的内容 | 一次性排查过程（在 `AGENTS.md` 与模块文档的「实测结论」里）；纯知识性说明；未经验证的猜测 |
