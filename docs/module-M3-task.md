# 模块开发文档：任务管理（M3）

> 版本：v1.0 · 面向开发 · 状态：**已实现**（任务全生命周期已落地：单任务创建、编辑、六类状态操作、
> 草稿物理删除、只读详情；接口范围见 `docs/api.md` §3.3 的「已实现范围」）。
> 关联：`design.md` §4.3 / §6.2 / §7.1 · `docs/api.md` §3.3 · `docs/database.md` §2.5 / §2.6 ·
> `docs/module-M2-base-data.md`（站点与模板来源）· `docs/module-M4-dispatch.md`（`assign` 的触发方）
> 定位：把 `design.md` §4.3 的状态机与 `Req-M3-*` 落成可直接编码的口径 —— 状态机的唯一作者、
> 校验顺序、事务与副作用边界、审计动作命名、错误映射、渲染层口径与测试清单。
> 任何实现偏差必须先回写本文档与 `AGENTS.md`。
> **文档边界**：本文件只负责「M3 任务管理模块的模块内实现口径」。接口路径 / 请求字段 / 权限点以
> `docs/api.md` §3.3 为准，表结构与列 `docs/database.md` §2.5-§2.6 为准，`Req-M3-*` 与状态机图
> `design.md` §4.3 为准；**状态机的代码侧唯一作者**是 `shared/src/task-state.ts`。
> 本文件**不复述可漂移的数值**（用例数、路由条数、字段上限的具体数字、seed 规模），需要时引用对应 §号（D-34）。

## 1. 模块定位

M3 是**任务这一业务实体的唯一生命周期管理者**。它把「一条运输需求」从草稿推进到终态，
并在每一步留下可追溯的原因与操作记录。它本身不派车、不算路、不驱动执行 —— 它决定的是
**其它模块看到的任务处于什么状态、下一步允许被谁做什么**：

- M4 调度只从 `pending` 里挑任务，`apply` 成功后调本模块的 `assign` 把任务推到 `assigned`；
- M6 地图与工作台监听 `task.changed`，据此重拉快照（路线颜色、看板计数）；
- M7 执行器用本模块的状态机推进 `start` / `complete` / `fail`；
- M8 告警与 M9 审计读的是本模块写下的 `cancel_reason` / `pause_reason` / `fail_reason` 与操作记录。

因此本模块的设计目标只有一句：**任务在任意时刻的状态、原因与操作痕迹都是自洽且可复核的**。

## 2. 范围与边界

### 2.1 功能范围（对应 Req-M3）

| 需求 | 能力 | 落点 | 状态 |
| --- | --- | --- | --- |
| Req-M3-1 | 单任务创建（套模板 / 手填），字段含起终点、载重、时间窗、优先级、备注 | `createTask`（`desktop/src/domain/task/task.service.ts`） | 已实现 |
| Req-M3-2 | 批量导入：CSV / JSON 数组，返回成功/失败明细与原因，部分失败不影响成功项 | `POST /api/tasks/batch-import`（`TASK.BATCH_PARTIAL_FAIL` 已登记） | **未实现**（见 §12 Q1） |
| Req-M3-3 | 编辑仅限 `draft` / `pending` / `failed` | `updateTask` + `TASK_EDITABLE_STATUSES` | 已实现 |
| Req-M3-4 | 暂停 / 恢复 / 取消 / 重派具备明确前置状态，非法迁移返回业务错误 | `operateTask` + `checkTaskTransition` | 已实现 |
| Req-M3-5 | 取消与重派必须二次确认（前端）且记录原因 | `renderer/src/task/TaskActionDialog.tsx` + 审计 | 已实现 |
| Req-M3-6 | 取消已派发任务时车辆回到 `idle` 并回收 | `releaseVehicle` | 已实现 |
| Req-M3-7 | 列表支持状态 / 优先级 / 车辆 / 时间范围过滤与关键词，联动地图 | `listTasks` + `task.changed` 事件 | 已实现 |

### 2.2 本模块**不负责**什么

划清边界是为了避免同一件事两处实现：

| 不负责 | 归属 | 原因 |
| --- | --- | --- |
| `pending → assigned` 的选车决策 | M4 | M3 只提供 `assign` 这个**受控入口**，选谁由调度算法决定（`docs/module-M4-dispatch.md`） |
| 路径计算与连通性判定 | M5 | 任务只存起终点站点 id，路线由调度生成后落到 `routes` |
| `assigned → running` / `running → finished` / `→ failed` 的推进 | M7 执行器 | 由设备与执行器按真实进度触发；**HTTP 不为这些动作开口子**（见 §4.2） |
| 车辆运行态（`charging` / `offline` / `fault`） | M7 执行器 + 心跳 | 本模块的 `releaseVehicle` 只在 `busy` / `reserved` 时回 `idle`，不代写其它状态 |
| 站点与模板的字段规则 | M2 | 本模块只按 id 引用并校验「存在且启用」「类型符合模板要求」 |
| 告警的产生与确认 | M8 | 任务详情里的 `alerts` 是**读取**关联未归档告警，不产生告警 |
| 导入了什么文件、批次结果 | 导入管线（`docs/data-interfaces.md`） | M3 的批量导入消费导入后的标准形态，不自建第二套解析语义 |

### 2.3 依赖与数据来源

| 依赖 | 来源 | 说明 |
| --- | --- | --- |
| 表结构 | `desktop/migrations/0001_init.sql` · `desktop/migrations/0004_task_pause_reason.sql` | `tasks` / `routes` / `dispatch_plans`；DDL 契约见 `docs/database.md` §2.5-§2.6（**列清单不复述**，D-34） |
| 状态机 | `shared/src/task-state.ts` | **唯一作者**；主进程、Mock、渲染层三处都读它 |
| 字段规则 | `shared/src/task-rules.ts` | **唯一作者**；复用 `shared/src/base-rules.ts` 的原语（D-44） |
| 站点 / 模板仓库 | `desktop/src/db/repositories/{site,template}.repo.ts` | 引用校验与模板默认值套用 |
| 车辆仓库 | `desktop/src/db/repositories/vehicle.repo.ts` | 取消 / 重派时的车辆回收 |
| 审计写入 | `desktop/src/services/audit.ts` 的 `writeAudit` | 每个写操作一条审计，`before` / `after` 存全量快照 |
| 事件推送 | `desktop/src/services/event-bus.ts` 的 `EventBus.emit` | `task.changed` 已登记 `EVENT_PERMISSIONS`（D-32） |
| 枚举 | `shared/src/enums.ts` | **唯一来源**；本模块不得自定义状态取值 |

## 3. 代码结构

> **已落地部分（2026-09-26，本模块收口）**：单任务全链路（创建 / 编辑 / 六类状态操作 / 删除 / 详情）已实现。
> 落地清单（按层）：

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 共享状态机 | `shared/src/task-state.ts` | `TASK_TRANSITIONS`（`Record<TaskAction, …>`，漏一条编译报错）· `checkTaskTransition` · `taskActionsOf` · `TASK_EDITABLE_STATUSES` |
| 共享字段规则 | `shared/src/task-rules.ts` | `validateTaskInput(create/patch)` · `taskWindowError` · `taskEndpointError` · `TASK_MAX_CARGO_KG` / 标题与货物描述上限 |
| 仓库 | `desktop/src/db/repositories/task.repo.ts` | 列表（含筛选与派生列）+ 详情（含计划 / 路线 / 告警 / 审计四块）+ 单条读写 + 状态写入 + 计划作废 + 物理删除 |
| 领域 | `desktop/src/domain/task/task.service.ts` | 一个事务 + 一条审计；套模板、状态机执行器、车辆回收、原因落列 |
| 传输 | `desktop/src/ipc/api.ts` | 任务路由（列表 / 详情 / 创建 / 编辑 / `POST :id/:action` / `DELETE :id`）；动作名由状态机校验 |
| 渲染 | `renderer/src/task/` + `renderer/src/pages/TasksPage.tsx` | 列模型 / 表单 / 动作展示 / 确认层 / 详情弹层 + 列表页 |
| 公共骨架 | `renderer/src/domain/{table,form,paging,tone,format,labels}.ts` · `renderer/src/api/{usePagedList,useApiWrite}.ts` · `renderer/src/styles/ui.css` | M2 与 M3 共用的列表 / 弹层 / 表单机制（D-47） |
| Mock | `renderer/src/api/mock-tasks.ts`（+ `mock-data.ts` 的 `MockTaskStore`） | 浏览器形态的读写路径：**规则共享、存储各自**，状态机与主进程逐条一致 |
| 迁移 | `desktop/migrations/0004_task_pause_reason.sql` | `tasks.pause_reason` 列（暂停原因落库，见 §6.3） |

边界约束（与 `docs/module-M2-base-data.md` §3 同口径）：

1. 领域服务**不写 SQL**，只调用 Repository；Repository 不做业务判断，只做查询与受控写入。
2. `desktop/src/domain/task/*` 不得 import 任何渲染层内容，也不得 import `desktop/src/ipc/*`。
3. **seed 不调用领域服务**：演示任务由 `seed.ts` 直接写表，因此不产生审计（演示数据不是用户行为）。
4. **状态机不重复实现**：三处（主进程 / Mock / 渲染层）都从 `shared/src/task-state.ts` 取判据，
   任何一处出现第二份「这个状态能不能那样改」的清单即为缺陷（与 D-33 / D-34 同一原则）。

## 4. 状态机口径（唯一作者）

`shared/src/task-state.ts` 是 `design.md` §4.3 mermaid 与迁移表的**代码侧逐条落地**。它为纯函数 + 常量：
不读时间、不碰数据库、不抛异常（返回结果对象，由领域层决定抛哪个 `DomainError`）。

### 4.1 迁移与触发者

| 动作 | 从 | 到 | 需原因 | 触发者 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `submit` | `draft` | `pending` | 否 | `task-api` | 提交进候选池，等待调度 |
| `assign` | `pending` | `assigned` | 否 | `dispatch` | 派发车辆并生成计划、路线（M4 apply / 手动指派） |
| `start` | `assigned` | `running` | 否 | `executor` | 车辆到起点、开始执行（M7） |
| `pause` | `running` | `paused` | **是** | `task-api` | 暂停执行，写暂停原因 |
| `resume` | `paused` | `running` | 否 | `task-api` | 继续执行（清空暂停原因） |
| `complete` | `running` / `assigned` | `finished` | 否 | `executor` | 到达终点并卸货完成（M7） |
| `fail` | `assigned` / `running` | `failed` | **是** | `executor` | 执行器或车辆异常（M7） |
| `cancel` | `pending` / `assigned` / `running` / `paused` | `cancelled` | **是** | `task-api` | 取消任务；已派发的先回收车辆 |
| `requeue` | `failed` | `pending` | **是** | `task-api` | 重新进入候选池 |
| `reassign` | `assigned` / `running` / `paused` | `pending` | **是** | `task-api` | 原计划置 `superseded`、回收车辆，回候选池 |
| `delete` | `draft` | （移出表） | 否 | `task-api` | 物理删除草稿 |

`finished` 与 `cancelled` 是**终态**：没有任何出边。给终态开一条「重开」会让「任务已完成 / 已取消」
失去意义 —— 需要新任务就再建一条。

### 4.2 哪些动作有 HTTP 入口

只有 `trigger === 'task-api'` 的动作暴露成 `POST /api/tasks/{id}/{action}`（`delete` 走 `DELETE` 方法）。
`assign` / `start` / `complete` / `fail` 各有自己的调用点，**不给内部迁移开 HTTP 入口**：
否则使用者可以手工把任务标成「执行中」，而执行器并不知情，任务随后会停在一个
没有任何模块认可的中间态上。路由侧的允许清单**派生自**状态机（`TASK_API_ACTIONS - {delete}`），
不另写一份 —— 由此得到一条可断言的性质：注册的 POST 动作集合恒等于该派生集合（见 §10）。

### 4.3 `reassign` 的终点为什么是 `pending` 而不是 `assigned`

重派的语义是「换一台车重新派」，但**换谁**属于调度决策。若直接落到 `assigned`，本模块就得
自己选车 —— 那是 M4 的职责，而且会绕过调度算法（无候选评估、无代价比较、无拒绝原因）。
因此 `reassign` 只做「回收 + 作废旧计划 + 回候选池」，新的 `assign` 由下一次调度产生。
`design.md` §4.3 表格行里「draft / pending」与说明「仅草稿可物理删除」冲突时以**说明**为准
（契约 `docs/api.md` §3.3.6 也这么写）。

### 4.4 可编辑状态

`TASK_EDITABLE_STATUSES = ['draft', 'pending', 'failed']`，**唯一作者**是共享状态机文件。
这条规则同时被三处用到 —— 主进程服务、浏览器 Mock、任务页（决定「编辑」按钮渲不渲染）——
三处各写一个数组时，界面上能点进去的状态与服务端放行的状态迟早不一致，表现为
「按钮点了报错」或「能改但服务端拒绝」。判据是**有没有派发痕迹**：`assigned` 之后任务已绑车辆与计划，
改起终点等于让执行中的车开去别处 —— 那是 `reassign` 的语义，不是编辑。

## 5. 校验规则（按固定顺序，命中即返回）

顺序不可随意调换：**先套模板 → 再校验字段 → 再校验跨字段 → 最后校验跨表引用**。
字段格式错误是调用方的输入问题（`VALIDATION.FAILED`），引用问题要按「不存在」与「存在但不可用」分开引导。

| # | 校验 | 失败 |
| --- | --- | --- |
| 1 | 套模板：`templateId` 存在则补齐未给的默认值（标题 / 优先级 / 载重 / 由开始时间 + 时长推导结束时间） | `TEMPLATE.NOT_FOUND` |
| 2 | 必填字段非空、类型正确（标题、载重、起终点） | `VALIDATION.FAILED` + `detail.fields` |
| 3 | 长度上限：标题 ≤ 200、`code` / id 类 ≤ 64、货物描述与原因同 `remark` 一档 | `VALIDATION.FAILED` |
| 4 | 数值域：`cargoKg ∈ [0, 20000]`（**字段上限以 `shared/src/task-rules.ts` 为准**） | `VALIDATION.FAILED` |
| 5 | 枚举：`priority` 必须是 `TASK_PRIORITIES` 成员（缺省 `normal`，与 DDL 的 `DEFAULT` 一致，**不是**枚举首项） | `VALIDATION.FAILED` |
| 6 | 跨字段：起终点不能相同 | `VALIDATION.FAILED`（标在 `toSiteId`） |
| 7 | 跨字段：时间窗「成对出现且 `end > start`」（只给一端也拒） | `VALIDATION.FAILED`（标在 `timeWindowEnd`） |
| 8 | 套模板的站点类型约束：模板要求的 `fromSiteType` / `toSiteType` 与所选站点不符 | `VALIDATION.FAILED`（标在对应字段） |
| 9 | 起点站点存在 | `SITE.NOT_FOUND` |
| 10 | 终点站点存在 | `SITE.NOT_FOUND` |
| 11 | 起终点站点处于 `enabled`（停用站点不能作为起终点） | `VALIDATION.FAILED`（字段级，指出是哪个编码） |
| 12 | 编辑：当前状态在 `TASK_EDITABLE_STATUSES` 内 | `TASK.STATE_CONFLICT`（`detail` 带 `from` / `expected` / `hint`） |
| 13 | 编辑：不允许传 `templateId`（模板只在创建时生效） | `VALIDATION.FAILED` |

两条跨字段约束的判据由 `task-rules.ts` 的纯函数（`taskWindowError` / `taskEndpointError`）**唯一提供**：

- 创建时两个值在同一份载荷里，能一次判完；
- 编辑时可能只传来其中一个，另一个要用库里的旧值 —— 只有领域服务拿得到，因此它调用**同一对纯函数**做「新旧配对」判断。
  少了这一步，请求会通过字段校验却被 SQLite 的 CHECK 拒掉，报出来是看不出原因的 `SYS.INTERNAL`。

## 6. 写操作口径

### 6.1 事务与审计

**统一事务纪律**：每个写方法（`createTask` / `updateTask` / `operateTask` / `deleteDraftTask`）= 一个 `tx()`。
事务内顺序固定为「读旧值 → 校验 → 写表 → 写审计」。`EventBus.emit` 放在**事务提交之后**
（在 `desktop/src/ipc/api.ts` 的 handler 里发），避免事件先于数据可见而让渲染层读到旧快照。

`createTask(submit=true)` 的 `draft → pending` 推进在**同一个事务里**完成（内部调用状态机执行器）：
分两个事务的话，第一步成功、第二步失败会留下一条「使用者以为提交了、其实还是草稿」的任务，
而界面提示是错误。

### 6.2 草稿删除是物理删除

`DELETE /api/tasks/{id}` 只允许 `draft`，其余状态一律走 `cancel`（软删、留痕）。
删除前先写一条 `action='delete'`、`after=null`、`before` 存全量快照的审计 —— 行真的从库里移除，
审计是唯一的痕迹。这与 M2 的禁行规则同属 D-07「一律软删」的例外，例外清单见 `docs/api.md`。

### 6.3 取消 / 重派的副作用（Req-M3-6）

`cancel` 与 `reassign` 在改状态之前先做两件事：

1. **回收车辆**（`releaseVehicle`）：仅当车辆确实被占用（`busy` / `reserved`）才置回 `idle`。
   故障 / 离线 / 充电中 / 已停用的车回 `idle` 是**谎报状态** —— 它会立刻重新出现在调度候选池里，
   而那些状态本来就是要把它挡在外面的。这种情况保留原状态，并把提示写进审计的 `message`。
   回收**不动 `load_kg`**：卸没卸货由执行器说了算，任务层改载重等于替它做了决定。
2. **作废旧计划**（`releaseTaskPlans`）：`cancel` 置 `cancelled`、`reassign` 置 `superseded`，并清空
   任务的 `assigned_vehicle_id` / `plan_id`。派发痕迹必须清掉：否则详情页会出现
   「状态：待派发」+「车辆：AGV-01」这种自相矛盾的组合，且下一次调度会以为这条任务已经有车了。

暂停原因（`pause_reason`）是**任务自身的状态**（「这条任务为什么停着」）而不是一次操作的历史，
因此落列而不是只写审计 —— 否则界面要回答这个问题就得去 join 审计表，而审计是 M9 的实现细节。
`resume` 时清空该列：一条正在跑的任务挂着旧暂停原因，会让下一个看到它的人以为它现在还因那个原因停着。
`requeue` 时清空 `fail_reason`，理由相同。

### 6.4 事件

任务的所有写操作（创建 / 编辑 / 每个状态动作 / 删除）都发一条 `task.changed`，载荷含
`reason`（如 `task.paused`）与 `taskId`（状态操作另带 `status`）。地图与工作台据此重拉快照。
按 D-32，`task.changed` 已在 `EVENT_PERMISSIONS` 登记所需权限 `task:read`，未登录窗口收不到。

## 7. 审计动作命名

审计对象统一为 `objectType='task'`、`module='task'`，`before` / `after` 存全量快照：

| 动作场景 | `action` |
| --- | --- |
| 创建 | `create` |
| 编辑字段 | `update` |
| 状态操作 | 与状态机动作同名（`submit` / `pause` / `resume` / `cancel` / `requeue` / `reassign`） |
| 物理删除草稿 | `delete` |

失败请求（`VALIDATION.FAILED` / `TASK.NOT_FOUND` / `TASK.STATE_CONFLICT`）**不写审计**：
审计记行为不记噪声。取消 / 重派时若车辆未能回收，提示写进该条审计的 `message`（只在真有内容时才带该字段）。

## 8. 错误映射

| 场景 | code | `detail` |
| --- | --- | --- |
| 任务 id 不存在 | `TASK.NOT_FOUND` | `{ id }` |
| 动作与当前状态不匹配 | `TASK.STATE_CONFLICT` | `{ id, action, from, expected, to }`，`message` 说明「当前状态 + 期望状态」 |
| 已派发 / 已完成等不可编辑 | `TASK.STATE_CONFLICT` | `{ id, from, expected, hint }` |
| 必填 / 长度 / 数值 / 枚举 / 跨字段失败 | `VALIDATION.FAILED` | `{ fields }` |
| 缺少必填原因（暂停 / 取消 / 重派 / 重排） | `VALIDATION.FAILED` | `{ reason }` |
| 起终点站点不存在 | `SITE.NOT_FOUND` | `{ fromSiteId }` 或 `{ toSiteId }` |
| 站点已停用 / 模板类型不符 | `VALIDATION.FAILED` | 字段级文案 |
| 模板不存在 | `TEMPLATE.NOT_FOUND` | `{ templateId }` |
| 动作名不在状态机里 / 不是 HTTP 动作 | `API.ROUTE_NOT_FOUND` | `{ path }`（不给 403 —— 那是「权限不够」，而这是「不该有这个入口」） |
| 批量导入部分失败 | `TASK.BATCH_PARTIAL_FAIL` | **已登记，尚未使用**（导入未实现，见 §12 Q1） |

**M3 未新增任何错误码**：上表 code 全部已登记在 `shared/src/errors.ts` 的 `ERROR_CODES`（D-33 唯一登记处）。

## 9. 渲染层口径（`renderer/src/task/` + `renderer/src/pages/TasksPage.tsx`）

| 关注点 | 落点 | 口径 |
| --- | --- | --- |
| 列与筛选 | `renderer/src/task/model.tsx` | 9 列（编码在前、标题随后、起终点合成一列）；「进行中（未结束）」是**逗号多值**筛选项，避免多次请求翻页漏行 |
| 表单 | `renderer/src/task/form.ts` | 时间用 `datetime-local`（提交与回填两处做本地时区转换）；`templateId` 编辑时 `immutableOnEdit` |
| 动作按钮 | `renderer/src/task/actions.ts` | 由 `taskActionsOf(status)` 从状态机派生；`Record<TaskAction, …>` 保证新增动作时编译报错；按钮文案与状态色取自 `renderer/src/domain/labels.ts` / `domain/tone.ts` |
| 二次确认 | `renderer/src/task/TaskActionDialog.tsx` | `needsConfirm = 需原因 ‖ delete`；需原因的动作由原因弹层兼任确认，不再叠一层「确定吗」 |
| 详情 | `renderer/src/task/TaskDetailDialog.tsx` | 只读展示计划 / 路线 / 告警 / 最近操作四块 |
| 页面 | `renderer/src/pages/TasksPage.tsx` | 按 `task:write` 开关写能力（monitor 为纯读取界面）；不提供批量操作（契约无批量接口，且批量会诱使人跳过原因输入） |

三条刻意的取舍：

1. **按钮按状态渲染，而不是渲染一排禁用按钮**：一个点不动且不说原因的按钮比没有按钮更糟（`ISS-010` 的教训）。
2. **写能力按 `task:write` 开关**：monitor 看到纯读取界面；主进程仍独立校验（D-08），前端隐藏只是体验优化。
3. **样式归属**：列表骨架 / 弹层 / 表单字段被 M2 与 M3 共用，因此住在 `renderer/src/styles/ui.css`；
   只有进度单元格、确认层、详情分区这些**本页特有**排版留在 `renderer/src/task/style/task.css`（D-36 / D-47）。

## 10. 测试清单

| 层 | 测试文件 | 覆盖 |
| --- | --- | --- |
| 共享状态机 | `shared/src/task-state.test.ts` | 迁移合法性、非法迁移的 `from` / `expected`、`taskActionsOf` 与可编辑状态 |
| 共享字段规则 | `shared/src/task-rules.test.ts` | 必填 / 长度 / 数值域 / 枚举缺省 / 时间窗成对与倒置 / 起终点相同的判定 |
| 仓库 | `desktop/src/db/repositories/task.repo.test.ts` | 列表（筛选与分页）、详情四块、编码生成、状态写入、计划作废、删除 |
| 领域 | `desktop/src/domain/task/task.service.test.ts` | 创建（套模板 / `submit=true`）、编辑（可编辑状态与新旧配对时间窗）、六类状态操作与副作用、删除 |
| 传输 | `desktop/src/ipc/api.task.test.ts` · `desktop/src/ipc/api.write.test.ts` | 任务路由的权限 / 参数 / 动作名校验；注册的 POST 动作集合 == 状态机派生集合 |
| 三层一致 | `renderer/src/api/mock-parity.test.ts` | Mock 与主进程：列表逐字段、详情四块、错误 code **与 message** 逐项相同 |
| 渲染模型 | `renderer/src/task/model.test.tsx` · `renderer/src/task/form.test.ts` · `renderer/src/task/actions.test.ts` | 列与筛选载荷、时间转换与跨字段预校验、动作展示与 `needsConfirm` |
| 渲染页面 | `renderer/src/pages/TasksPage.test.tsx` · `renderer/src/pages/TasksPage.write.test.tsx` | 读路径（筛选 / 分页 / 权限 / 详情）与写路径（新建 / 状态操作 / 删除） |
| 文档不变量 | `tests/docs.test.ts` | 文档边界行、源码路径存在、错误码闭环 |

## 11. 走查与 DoD

**当前进度（2026-09-26，本模块收口）**：Req-M3-1 / 3 / 4 / 5 / 6 / 7 已实现并有测试与真实 Electron 走查；
Req-M3-2（批量导入）**未实现** —— `docs/api.md` §3.3.4 保留契约，页面明确标注未实现，不在本批范围内。

真实 Electron 走查（步骤与结果见 `AGENTS.md` 的验证基线与工作日志）：

1. 新建任务（套模板与手填各一）→ 提交（`draft → pending`）→ 列表状态与进度更新。
2. 暂停（原因必填，缺原因无法提交）→ 列表显示暂停原因 → 恢复（暂停原因清空）。
3. 取消已派发任务：二次确认层说明「回收车辆、计划作废」→ 提交后车辆回到 `idle`、详情页派发痕迹清空。
4. 草稿删除：二次确认后行消失，`audit_logs` 留下 `action='delete'`。
5. 权限：monitor 账号下没有操作列与「新建任务」按钮，且详细接口仍可读。
6. 控制台 0 错误；走查后以 `npm run db:reset` 复位开发库。

**DoD（当前状态）**：Req-M3 范围内除批量导入外均已实现、有测试、有走查；
`docs/api.md` §3.3 的**已实现范围**与本文档一致；提交前按 `AGENTS.md` 纪律记录。

## 12. 风险与待评审

| 编号 | 事项 | 倾向 |
| --- | --- | --- |
| Q1 | Req-M3-2 批量导入（`POST /api/tasks/batch-import`）未实现 | 复用 `docs/data-interfaces.md` 的导入管线，与订单 CSV（D-15 / D-16）共用一套「预检 + 确认」语义，不在 M3 另开一套解析（与 `docs/module-M2-base-data.md` Q5 同口径） |
| Q2 | `operateTask` 接受 `assign` / `start` / `complete` / `fail`，M4 / M7 落地时直接复用 | 已定案：对外暴露面由路由控制，服务层是状态机执行器、不判断「谁在调我」（见 §4.2） |
| Q3 | 取消时车辆未回收（故障 / 离线 / 充电中）只在审计 `message` 里提示 | 倾向保持：任务层不谎报车辆状态；是否需要一条 M8 告警留给 M8 定义 |
| Q4 | 任务是否需要「重开」终态 | **不做**：终态开重开入口会让「已完成」失去意义；需要新任务再建一条（见 §4.1） |
| Q5 | 进度 `progress` 由谁推进 | M7 执行器写；M3 只读展示，未派发恒为 0（界面不替契约区分「未开始」与「未知」） |
