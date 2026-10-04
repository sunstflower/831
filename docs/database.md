# 数据库设计（SQLite）

> 版本：v1.0 · 配套：`design.md` §6（字段语义唯一来源）、`docs/api.md` §1（枚举与单位）
> 用途：建表、索引、约束、seed 规则与常用查询的**唯一来源**。
> 文件位置：`desktop/migrations/0001_init.sql`（**实际路径**；早期文档曾写作 `desktop/db/migrations/`，已更正）。
> 命名映射：DB 用 `snake_case`，API/TS 用 `camelCase`（Repository 负责转换，`map-underscore-to-camel-case` 约定）。
> **文档边界**：本文件只负责「数据表 DDL、索引、字段约束、迁移编号」。其余事实按 [`docs/api.md`](./api.md) §0「文档事实单一来源」引用，**不复述可漂移的数值**。

## 1. 通用约定

1. 主键一律 `id TEXT PRIMARY KEY`（UUID v4；种子用 `seed-*` 固定串）。
2. 时间一律 TEXT，ISO 8601 UTC 毫秒，如 `2026-09-14T09:00:00.000Z`。
3. 枚举一律 TEXT，取值与 `shared/src/enums.ts` 一致；关键状态列加 `CHECK` 约束，双层兜底（服务层状态机 + DB 约束）。
4. 布尔用 `INTEGER` + `CHECK (col IN (0,1))`。
5. 单位固定：距离米、时长秒、速度 m/s、载重千克、电量 0-100（见 api §1.4）。
6. 外键默认 `PRAGMA foreign_keys = ON`；删除策略遵循 design §6.3（主数据软删，草稿任务可物理删）。
7. 每个连接启动即设置：`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`。
8. 多态/循环引用不设数据库外键，由服务层保证一致性：`restrictions.target_id`（节点或边）、`alerts.object_id`（任意对象）、`tasks.plan_id`（指向当前 applied 计划，避免 tasks ↔ dispatch_plans 循环 FK）。

## 2. 建表 DDL（0001_init.sql）

> 规模口径：**业务表 16 张 + `schema_version` = 合计 17 张**（另有 18 条索引）。此前多处写作「17 张业务表」，实为把 `schema_version` 一并计入，已于 2026-09-20 更正。

### 2.1 版本与账号

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','dispatcher','monitor')),
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT
);
```

### 2.2 路网与站点（先建节点，供站点/车辆/边引用）

```sql
CREATE TABLE IF NOT EXISTS nodes (
  id      TEXT PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  x       REAL NOT NULL,
  y       REAL NOT NULL,
  status  TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  remark  TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id              TEXT PRIMARY KEY,
  from_node_id    TEXT NOT NULL REFERENCES nodes(id),
  to_node_id      TEXT NOT NULL REFERENCES nodes(id),
  length_m        REAL NOT NULL CHECK (length_m > 0),
  speed_limit_mps REAL CHECK (speed_limit_mps IS NULL OR speed_limit_mps > 0),
  status          TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  remark          TEXT,
  UNIQUE (from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);

-- `weight` 由 0005 追加（本段是**迁移后的最终形态**，不是 0001 的原文）：
--   weight REAL NOT NULL DEFAULT 1 CHECK (weight >= 1)
-- 语义是「耗时惩罚系数」而不是长度：通行耗时 = length_m × weight ÷ 有效限速。
-- 约束 >= 1 是**有原因的**，不是随手写的下限 —— 见 `docs/api.md` §3.2.4（A* 可采纳性）。

CREATE TABLE IF NOT EXISTS sites (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('depot','dock','charging','gate','other')),
  node_id    TEXT REFERENCES nodes(id),
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  remark     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
```

### 2.3 车辆与通行限制

```sql
CREATE TABLE IF NOT EXISTS vehicles (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('agv','carrier','drone','other')),
  status            TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','reserved','busy','charging','offline','fault','disabled')),
  capacity_kg       REAL NOT NULL CHECK (capacity_kg > 0),
  load_kg           REAL NOT NULL DEFAULT 0 CHECK (load_kg >= 0),
  max_speed_mps     REAL NOT NULL CHECK (max_speed_mps > 0),
  battery           REAL NOT NULL DEFAULT 100 CHECK (battery BETWEEN 0 AND 100),
  x                 REAL NOT NULL,
  y                 REAL NOT NULL,
  current_node_id   TEXT REFERENCES nodes(id),
  online            INTEGER NOT NULL DEFAULT 1 CHECK (online IN (0,1)),
  last_heartbeat_at TEXT,
  remark            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restrictions (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('node','edge')),
  target_id    TEXT NOT NULL,
  start_at     TEXT,
  end_at       TEXT,
  vehicle_type TEXT CHECK (vehicle_type IS NULL OR vehicle_type IN ('agv','carrier','drone','other')),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at)
);
```

### 2.4 任务模板

```sql
CREATE TABLE IF NOT EXISTS task_templates (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  default_cargo_kg    REAL CHECK (default_cargo_kg IS NULL OR default_cargo_kg >= 0),
  time_window_minutes INTEGER CHECK (time_window_minutes IS NULL OR time_window_minutes > 0),
  from_site_type      TEXT CHECK (from_site_type IS NULL OR from_site_type IN ('depot','dock','charging','gate','other')),
  to_site_type        TEXT CHECK (to_site_type IS NULL OR to_site_type IN ('depot','dock','charging','gate','other')),
  remark              TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
```

### 2.5 任务

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  template_id       TEXT REFERENCES task_templates(id),
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','pending','assigned','running','paused','finished','cancelled','failed')),
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  cargo_kg          REAL NOT NULL CHECK (cargo_kg >= 0),
  cargo_desc        TEXT,
  from_site_id      TEXT NOT NULL REFERENCES sites(id),
  to_site_id        TEXT NOT NULL REFERENCES sites(id),
  time_window_start TEXT,
  time_window_end   TEXT,
  assigned_vehicle_id TEXT REFERENCES vehicles(id),
  plan_id           TEXT,
  progress          REAL NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  cancel_reason     TEXT,
  fail_reason       TEXT,
  submitted_at      TEXT,
  assigned_at       TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  cancelled_at      TEXT,
  failed_at         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_by        TEXT,
  CHECK (time_window_end IS NULL OR time_window_start IS NULL OR time_window_end > time_window_start),
  CHECK (from_site_id <> to_site_id)
);
```

### 2.6 路线与派发计划

```sql
CREATE TABLE IF NOT EXISTS routes (
  id            TEXT PRIMARY KEY,
  task_id       TEXT REFERENCES tasks(id),
  algorithm     TEXT NOT NULL CHECK (algorithm IN ('aStar','dijkstra')),
  from_node_id  TEXT NOT NULL REFERENCES nodes(id),
  to_node_id    TEXT NOT NULL REFERENCES nodes(id),
  via_node_ids  TEXT NOT NULL DEFAULT '[]',
  node_ids      TEXT NOT NULL,
  edge_ids      TEXT NOT NULL,
  distance_m    REAL NOT NULL CHECK (distance_m >= 0),
  duration_s    REAL NOT NULL CHECK (duration_s >= 0),
  cost_detail   TEXT NOT NULL DEFAULT '{}',
  warnings      TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  created_by    TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_plans (
  id             TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  vehicle_id     TEXT NOT NULL REFERENCES vehicles(id),
  strategy       TEXT NOT NULL CHECK (strategy IN ('greedy','hungarian','genetic')),
  status         TEXT NOT NULL DEFAULT 'applied'
                 CHECK (status IN ('applied','superseded','cancelled')),
  cost           REAL NOT NULL DEFAULT 0,
  cost_detail    TEXT NOT NULL DEFAULT '{}',
  route_id       TEXT REFERENCES routes(id),
  occupied_from  TEXT NOT NULL,
  occupied_to    TEXT NOT NULL,
  reject_reason  TEXT,
  snapshot_id    TEXT,
  applied_at     TEXT,
  applied_by     TEXT,
  created_at     TEXT NOT NULL,
  CHECK (occupied_to > occupied_from)
);

CREATE TABLE IF NOT EXISTS dispatch_logs (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('preview','apply','recompute','manual_assign')),
  strategy        TEXT NOT NULL CHECK (strategy IN ('greedy','hungarian','genetic','all')),
  task_ids        TEXT NOT NULL DEFAULT '[]',
  input_snapshot  TEXT,
  output_snapshot TEXT,
  summary         TEXT NOT NULL DEFAULT '{}',
  rejected        TEXT NOT NULL DEFAULT '[]',
  reason          TEXT,
  elapsed_ms      INTEGER NOT NULL DEFAULT 0,
  operator_id     TEXT,
  created_at      TEXT NOT NULL
);
```

### 2.7 告警、审计与运行日志

```sql
CREATE TABLE IF NOT EXISTS alerts (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('vehicle_offline','task_timeout','task_failed','route_blocked','data_error')),
  level        TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
  object_type  TEXT NOT NULL CHECK (object_type IN ('site','vehicle','task','route','node','edge','user','system','alert','settings')),
  object_id    TEXT,
  message      TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new','acknowledged','processing','resolved','archived')),
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL,
  ack_at       TEXT,
  ack_by       TEXT,
  resolve_at   TEXT,
  resolve_by   TEXT,
  resolution   TEXT,
  archived_at  TEXT,
  archived_by  TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  role        TEXT,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  before      TEXT,
  after       TEXT,
  result      TEXT NOT NULL CHECK (result IN ('success','failure')),
  message     TEXT,
  error_code  TEXT,
  cost_ms     INTEGER NOT NULL DEFAULT 0,
  trace_id    TEXT
);

CREATE TABLE IF NOT EXISTS event_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  payload     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS vehicle_tracks (
  id        TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  ts        TEXT NOT NULL,
  x         REAL NOT NULL,
  y         REAL NOT NULL,
  status    TEXT NOT NULL,
  speed_mps REAL NOT NULL DEFAULT 0,
  task_id   TEXT
);
```

### 2.8 设置

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
```

## 3. 索引

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_status            ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_window   ON tasks(priority, time_window_start);
CREATE INDEX IF NOT EXISTS idx_tasks_vehicle           ON tasks(assigned_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_edges_from              ON edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_sites_node              ON sites(node_id);
CREATE INDEX IF NOT EXISTS idx_restrictions_target     ON restrictions(type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_request           ON dispatch_plans(request_id);
CREATE INDEX IF NOT EXISTS idx_plans_vehicle_time      ON dispatch_plans(vehicle_id, occupied_from, occupied_to);
CREATE INDEX IF NOT EXISTS idx_plans_task              ON dispatch_plans(task_id, status);
CREATE INDEX IF NOT EXISTS idx_dlogs_request           ON dispatch_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_dlogs_created           ON dispatch_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status_type      ON alerts(status, type);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe           ON alerts(dedupe_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_object           ON alerts(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts                ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor             ON audit_logs(actor_id, ts);
CREATE INDEX IF NOT EXISTS idx_tracks_vehicle_ts       ON vehicle_tracks(vehicle_id, ts);
CREATE INDEX IF NOT EXISTS idx_event_ts                ON event_log(ts);
```

## 4. 种子数据（seed 规则）

seed 由代码执行（`desktop/src/db/seed.ts`），**幂等**：全部使用固定 id，写入用 `INSERT OR IGNORE`；连续执行两次结果一致。

| 数据 | 内容 | 固定 id 示例 |
| --- | --- | --- |
| 账号 ×3 | admin / dispatcher / monitor；密码 bcrypt 运行时哈希（默认密码见 design §3.7） | `seed-admin`、`seed-dispatcher`、`seed-monitor` |
| 路网 | **`data/campus/` 的校园路网**（`campus_nodes.csv` / `campus_edges.csv`）：30 节点、90 条有向边 | `seed-n-N00`…、`seed-e-E_N00_N10`… |
| 边权重 | `campus_congestion.csv` 的拥堵叠加层（≥ 1 的耗时系数），逐**有向边**写；删掉该文件即回到全网畅通基线 | 列 `edge_code,weight,remark` |
| 站点 ×13 | 校园各站点，绑定到边 / 节点（泊位模型见 `docs/data-interfaces.md` §4.7） | `seed-site-DEPOT`、`seed-site-ST01`… |
| 禁行 ×2 | 演示占道规则 | `seed-restriction-*` |
| 车辆 ×5 | AGV-01/02、CAR-01/02、DRN-01；初始 `idle`（AGV-01 演示执行时置 `busy`）、电量 100 | `seed-veh-agv01`…、`seed-veh-car02` |
| 模板 ×2 | 仓到仓标准配送、仓到充电桩回充 | `seed-tpl-std`、`seed-tpl-return` |
| 设置 | design §4.10 键目录的默认值 | `dispatch.defaultStrategy`… |
| 演示执行 ×1 组 | 任务 `running`（含进度）+ 路线（**每一段都是库中真实存在的边**）+ 告警 1 条（挂 DRN-01）；同时把 AGV-01 置 `busy`、`load_kg` 与任务载重一致 | `seed-task-demo`、`seed-route-demo`、`seed-alert-demo` |
| 演示待派发 | `pending` 任务，供调度中心一打开就有活干（条数、任务清单与每条的设计意图见 [`docs/seed-dispatch-diversity.md`](./seed-dispatch-diversity.md) 与 [`shared/src/seed-data.ts`](../shared/src/seed-data.ts)，本条不复述数值）；**时间窗跟着当前时刻刷新**（只在仍为 `pending` 时），否则这份演示数据过一天就会被 100% 以「时间窗冲突」拒绝 | `SEED_IDS.pendingTasks` |

注意：seed **不写明文密码**；`admin123` 等仅在文档与演示说明中出现，DB 只存哈希。

**推导只有一处**：路网 / 站点 / 车辆 / 演示任务都来自 `shared/src/seed-data.ts` 的 `buildSeedDataset()`，
`desktop/src/db/seed.ts` 只负责「取数（读 `data/campus/`）→ 推导 → 落库」，
浏览器 Mock 调用的是**同一个函数**。因此本文件与 `seed.ts` 里都没有业务数字
（节点数、边长、权重、任务清单都在数据与推导里）—— 这是 D-27 的升级：从
「两边各写一遍再比对」改成「只写一遍」，比对就再也不会失败，因为它不再有两份。

演示执行数据的用途：真实业务中 `tasks`/`routes` 由调度流程产生、初始为空，
于是地图上永远只有路网，**路线高亮与车辆动画没有任何可见样本**。
该组数据必须**状态自洽**：任务 `running` 就必须有车辆 `busy` 且 `load_kg > 0`
（不能出现「running 任务挂在 idle 车上」），路线每一段也必须是真实存在的边。
约束已由 `desktop/src/db/db.test.ts` 的用例固定。

**演示待派发任务为什么远多于车辆数**：任务数 ≤ 车辆数时两种策略都是
「一车一单」、给出**完全一样**的计划，界面上「哪个策略更优」永远是平局；
多出来的任务只能靠**接力**（一辆车跑完一单再接下一单）派出，而接力只有贪心会做
（匈牙利是整体匹配），对比于是有了真实结论。这条与上一段一样，是**可执行的**：
`renderer/src/api/mock-parity.test.ts` 断言「贪心里至少有一台车带两条计划，
且两条计划的占用区间不重叠」。任务清单本身不在这里复述 ——
它（连同「每条任务放大哪种差异」的设计意图）的唯一作者是
[`shared/src/seed-data.ts`](../shared/src/seed-data.ts) 与
[`docs/seed-dispatch-diversity.md`](./seed-dispatch-diversity.md)（D-34）。

## 5. 常用查询（Repository 参考）

```sql
-- 1) 调度候选车辆：可用 + 剩余载重足够
SELECT * FROM vehicles
WHERE status = 'idle' AND online = 1 AND (capacity_kg - load_kg) >= :cargoKg;

-- 2) 车辆未来占用：与给定时间窗相交的已应用计划
SELECT occupied_from, occupied_to FROM dispatch_plans
WHERE vehicle_id = :vehicleId AND status = 'applied'
  AND occupied_from < :windowEnd AND occupied_to > :windowStart;

-- 3) 生效中的禁行（供构图剪枝；时间窗为空表示长期有效）
SELECT type, target_id FROM restrictions
WHERE status = 'active'
  AND (start_at IS NULL OR start_at <= :now)
  AND (end_at   IS NULL OR end_at   >  :now)
  AND (vehicle_type IS NULL OR vehicle_type = :vehicleType);

-- 4) 告警去重：同对象同类型在去重窗口内是否已有未解决告警
SELECT id FROM alerts
WHERE dedupe_key = :dedupeKey AND status NOT IN ('resolved','archived')
  AND created_at > :dedupeSince;

-- 5) 轨迹回放：某车某任务时间段内的采样点
SELECT ts, x, y, status, speed_mps FROM vehicle_tracks
WHERE vehicle_id = :vehicleId AND ts BETWEEN :from AND :to
ORDER BY ts;
```

## 6. 迁移与演进规则

1. 迁移文件命名 `NNNN_描述.sql`，位于 **`desktop/migrations/`**，只增不改：已发布迁移禁止修改，变更走新文件。

   **已登记编号（唯一来源，其它文档不得自行编号）**：

   | 文件 | 内容 | 状态 |
   | --- | --- | --- |
   | `0001_init.sql` | 首期 16 张业务表 + `schema_version`、18 条索引 | 已落地 |
   | `0002_data_import.sql` | 四类导入数据文件（订单 CSV / 仿真地图 / 车辆参数 / 算法配置）所需的新表与新列；含 `edges.code`（业务键，D-35） | **草案，待评审**；表/列建议见 `docs/data-interfaces.md` §10，订单领域见 `docs/order-data-map-design.md` §3 |
   | `0003_object_types.sql` | 重建 `alerts` 表以放宽 `object_type` 的 CHECK：加入 `restriction` / `taskTemplate`（`OBJECT_TYPES` 扩项，`docs/database.md` §6 规则 4） | 已落地（2026-09-26）。**编号说明**：`0002` 已指派给导入管线，故取下一个空号；本文件按文件名排序会先于将来的 `0002` 应用，两者互不依赖（本条只动 `alerts` 的 CHECK） |
   | `0004_task_pause_reason.sql` | `tasks` 新增 `pause_reason` 列（`design.md` §4.3 要求 pause 写暂停原因，而 0001 建表时漏了该列）；`resume` 时清空 | 已落地（2026-09-26）。非破坏性新增可空列，走裸 `ALTER TABLE` |
   | `0005_edge_weight.sql` | `edges` 新增 `weight`（通行权重，`REAL NOT NULL DEFAULT 1 CHECK (weight >= 1)`，见 D-54） | 已落地（2026-09-28）。非破坏性新增带缺省值的列；`>= 1` 的理由与「为什么不能放进 `length_m` / `speed_limit_mps`」写在 `docs/api.md` §3.2.4 与迁移文件头 |

   > 早期草案中的 `0002_seed.sql`（SQL 种子）与 `0002_order_ingestion.sql` 均已**作废** ——
   > 前者被代码侧 seed 取代，后者合并进 `0002_data_import.sql`（避免两个同号迁移）。
2. 迁移器在一个事务中执行单个文件；成功写 `schema_version(version, description, applied_at)`。
3. 破坏性变更（删列/改类型）用「新表 + 数据搬迁 + 改名」三步，并在 `AGENTS.md` 记录决策。
4. 新增枚举值需同步 `shared/src/enums.ts`、`design.md`、`docs/api.md` 与 DB `CHECK`（新迁移重建约束）。
   **本条已有可执行护栏**：`desktop/src/db/db.test.ts` 会真的往 `alerts` 插一条各枚举值的探针记录，
   漏做迁移即红（先例 `0003_object_types.sql`）。此前它只是一句文档要求，漏做要到写入时才炸。
5. 统计数据（二期）只加视图或聚合查询，不改动首期业务表语义。
