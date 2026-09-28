-- 0003_object_types.sql
--
-- 目的：把 `OBJECT_TYPES`（`shared/src/enums.ts`）新增的 `restriction` / `taskTemplate`
-- 同步到 `alerts.object_type` 的 CHECK 约束（`docs/database.md` §6 规则 4）。
--
-- **为什么是 0003 而不是 0002**：`0002_data_import.sql` 已被登记表指派给导入管线（草案，未落地）。
-- 登记表是编号的唯一来源，因此不能挪用；取下一个空号 0003。
-- 执行顺序按**文件名**排序、跳过已应用者，所以本文件会先于将来的 `0002` 应用 ——
-- 两者互不依赖（本条只动 `alerts` 的 CHECK，导入管线动的是新表与新列），顺序无影响。
--
-- 为什么必须是一个新迁移：SQLite 不支持 `ALTER TABLE ... ALTER COLUMN`，
-- CHECK 约束无法就地修改；按 §6 规则 3 的「新表 + 数据搬迁 + 改名」三步做。
--
-- 为什么只动 `alerts` 不动 `audit_logs` / `event_log`：后两者的 `object_type` 列**没有** CHECK
-- （`0001_init.sql` 第 220 / 236 行），因此无需重建。这一点容易反过来想 ——
-- 「枚举加了值就重建所有带 object_type 的表」会做两件多余且带风险的搬迁。
--
-- 不涉及数据语义变化：仅放宽一个取值集合，既有行全部合法，搬迁是逐字复制。
--
-- 为什么这里没有 `PRAGMA foreign_keys = OFF`：`alerts` 既没有外键列，也没有被任何表引用
-- （`0001_init.sql` 里对它的引用只有 3 条索引），所以重命名不会牵动别的表；
-- 而且迁移器把整个文件包在事务里执行，而 `PRAGMA foreign_keys` 在事务内**是空操作** ——
-- 写上去只会让人以为它起了作用。

CREATE TABLE alerts_new (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('vehicle_offline','task_timeout','task_failed','route_blocked','data_error')),
  level        TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
  object_type  TEXT NOT NULL CHECK (object_type IN ('site','vehicle','task','route','node','edge','restriction','taskTemplate','user','system','alert','settings')),
  object_id    TEXT,
  message      TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','processing','resolved','archived')),
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

INSERT INTO alerts_new SELECT
  id, type, level, object_type, object_id, message, detail, status, dedupe_key,
  created_at, ack_at, ack_by, resolve_at, resolve_by, resolution, archived_at, archived_by
FROM alerts;

DROP TABLE alerts;
ALTER TABLE alerts_new RENAME TO alerts;

-- 索引随表一起被 DROP，必须按 0001 的定义重建（含索引名，保持一致）
CREATE INDEX IF NOT EXISTS idx_alerts_status_type ON alerts(status, type);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe      ON alerts(dedupe_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_object      ON alerts(object_type, object_id);
