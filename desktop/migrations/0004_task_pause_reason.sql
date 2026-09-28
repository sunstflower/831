-- 0004_task_pause_reason.sql
--
-- 给 `tasks` 补一个 `pause_reason` 列。
--
-- 为什么要有这条迁移（而不是把暂停原因只写进审计）：
--   `design.md` §4.3 的迁移表把 `running → paused` 的副作用写成「仅运行中可暂停；**写暂停原因**」，
--   而 0001 建表时 `tasks` 只有 `cancel_reason` / `fail_reason` 两列 ——
--   契约要求的字段无处落库。暂停原因是**任务自身的状态**（「这条任务为什么停着」），
--   不是一次操作的历史：只写审计的话，界面要回答这个问题就得去 join 审计表，
--   而审计是 M9 的实现细节，任务详情不该依赖它。
--
-- 为什么直接 ADD COLUMN 而不是「新表 + 搬迁 + 改名」（§6 规则 3）：
--   规则 3 针对**破坏性**变更（删列 / 改类型）。新增可空列不破坏既有读写，
--   SQLite 的 `ALTER TABLE ... ADD COLUMN` 是原地操作，且不触碰任何 CHECK 约束。
--
-- 与 `resume` 的配合：恢复执行时把该列清空 —— 一条正在跑的任务挂着
-- 「上次为什么被暂停」的旧原因，会让下一个看到它的人以为它现在还是因为那个原因停着。

ALTER TABLE tasks ADD COLUMN pause_reason TEXT;
