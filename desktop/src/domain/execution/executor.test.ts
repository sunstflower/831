import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS, type AuditContext } from '@udm/shared';
import { all, get, openDatabase, run, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { seedFixture } from '../../db/seed-fixture.js';
import { EventBus, type EventTargetLike } from '../../services/event-bus.js';
import { SessionStore } from '../../services/session.js';
import { ExecutionRunner } from './executor.js';

/**
 * M7 本地模拟执行器。
 *
 * 这里**不启动定时器**：`tick()` 是纯推进，测试直接连调若干帧，
 * 因此断言是确定的（这也正是把「推进」与「调度」分开的原因）。
 */
const actor: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 't-exec' };

interface Captured {
  type: string;
  payload: Record<string, unknown>;
}

function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  const events: Captured[] = [];
  const target: EventTargetLike = {
    send: (_channel: string, payload: unknown) => {
      events.push(payload as Captured);
    }
  };
  bus.attach(target);
  // 事件通道是 deny-by-default（D-32）：窗口不绑一个**已登录**的会话，
  // `task.changed` 这类登记了权限的事件会被静默丢弃，测试就看不到它们了
  const session = sessions.create({
    id: 'seed-admin',
    username: 'admin',
    role: 'admin',
    displayName: '系统管理员',
    permissions: []
  });
  bus.bindSession(target, session.token);
  const runner = new ExecutionRunner(db, bus, { tickMs: 1000, speedFactor: 4 });
  return { db, bus, runner, events };
}

/** seed 的演示任务：running + 车 busy + 一条真实路网上的路线。把它改回「已派发未开始」。 */
function makeAssigned(db: Db): void {
  run(db, "UPDATE tasks SET status = 'assigned', progress = 0 WHERE id = ?", [SEED_IDS.demoTask]);
  run(db, "UPDATE vehicles SET status = 'reserved', load_kg = 0 WHERE id = ?", [SEED_IDS.vehicleAgv]);
}

const taskRow = (db: Db) =>
  get<{ status: string; progress: number; finished_at: string | null }>(
    db,
    'SELECT status, progress, finished_at FROM tasks WHERE id = ?',
    [SEED_IDS.demoTask]
  )!;
const vehicleRow = (db: Db) =>
  get<{ status: string; x: number; y: number; load_kg: number; battery: number }>(
    db,
    'SELECT status, x, y, load_kg, battery FROM vehicles WHERE id = ?',
    [SEED_IDS.vehicleAgv]
  )!;
const trackCount = (db: Db) =>
  Number(get<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM vehicle_tracks WHERE vehicle_id = ?', [SEED_IDS.vehicleAgv])?.total ?? 0);

describe('executor · 开始执行', () => {
  let db: Db;
  let runner: ExecutionRunner;
  let events: Captured[];
  beforeEach(() => {
    ({ db, runner, events } = setup());
  });

  it('assigned → running：任务开跑、车置 busy 并装载，落第一个轨迹点', () => {
    makeAssigned(db);
    const result = runner.startTask(actor, SEED_IDS.demoTask, { note: '车辆已到达起点' });
    expect(result).toMatchObject({ taskId: SEED_IDS.demoTask, vehicleId: SEED_IDS.vehicleAgv, status: 'running' });
    expect(taskRow(db).status).toBe('running');
    expect(vehicleRow(db)).toMatchObject({ status: 'busy', load_kg: 100 });
    expect(trackCount(db)).toBe(1);
    expect(runner.activeCount()).toBe(1);
    // 事件：任务变化 + 车辆变化 + 地图刷新
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['task.changed', 'vehicle.changed', 'execution.progress'])
    );
  });

  it('状态不对就别动数据：pending 的任务开始执行 → TASK.STATE_CONFLICT，车仍是 idle', () => {
    run(db, "UPDATE tasks SET status = 'pending', assigned_vehicle_id = NULL WHERE id = ?", [SEED_IDS.demoTask]);
    const before = taskRow(db);
    expect(() => runner.startTask(actor, SEED_IDS.demoTask, {})).toThrowError();
    // 前置校验先跑完：任务没被改成 running、进度没被动、也没登记进内存
    expect(taskRow(db)).toMatchObject({ status: 'pending', progress: before.progress });
    expect(runner.activeCount()).toBe(0);
  });

  it('查不到路线 → ROUTE.NOT_FOUND，且任务停在 assigned（不会变成「跑不动的 running」）', () => {
    makeAssigned(db);
    // 任务若查不到任何路线（计划被删、路线行丢失），执行器必须拒绝开工：
    // 让它进 running 只会得到一条永远不动的任务
    run(db, 'DELETE FROM routes WHERE task_id = ?', [SEED_IDS.demoTask]);
    expect(() => runner.startTask(actor, SEED_IDS.demoTask, {})).toThrowError(/没有可用的已生效路线/);
    expect(taskRow(db).status).toBe('assigned');
  });

  it('不存在的任务 → TASK.NOT_FOUND', () => {
    expect(() => runner.startTask(actor, 'task-missing', {})).toThrowError(/任务不存在/);
  });
});

describe('executor · 推进与到位', () => {
  let db: Db;
  let runner: ExecutionRunner;
  beforeEach(() => {
    ({ db, runner } = setup());
    makeAssigned(db);
    runner.startTask(actor, SEED_IDS.demoTask, {});
  });

  it('tick 让车真的移动、进度增长、电量下降，并逐帧写轨迹', () => {
    const before = vehicleRow(db);
    const result = runner.tick();
    const after = vehicleRow(db);
    expect(result.advanced).toEqual([SEED_IDS.demoTask]);
    // 只断言「位置变了」而不是「x 变了」：路线第一段是竖直的（N01 → N05），
    // x 本来就不该动 —— 写死某一个轴会让用例与路网布局耦合
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
    expect(after.battery).toBeLessThan(before.battery);
    expect(taskRow(db).progress).toBeGreaterThan(0);
    expect(taskRow(db).progress).toBeLessThan(1);
    expect(trackCount(db)).toBe(2);
  });

  it('跑完全程后：任务 finished、车回 idle 且卸货、最后一帧轨迹标记 finished', () => {
    // 帧数由路线里程推出：每帧前进 `maxSpeed × tickMs/1000 × speedFactor`（1.5 × 1 × 4 = 6 m）。
    // 写死「20 帧」在演示路线换成真实校园路网（数百米）后会停在半路，
    // 而失败信息是「任务还没结束」——看起来像执行器没跑完，实际是帧数不够
    const stepM = 1.5 * 4;
    const frames = Math.ceil(seedFixture().demoRoute.distanceM / stepM) + 5;
    for (let index = 0; index < frames; index += 1) {
      runner.tick();
    }
    const task = taskRow(db);
    expect(task.status).toBe('finished');
    expect(task.progress).toBe(1);
    expect(task.finished_at).toBeTruthy();
    expect(vehicleRow(db)).toMatchObject({ status: 'idle', load_kg: 0 });
    // 按 `rowid` 取「最后插入的那一行」：测试里多帧 tick 落在**同一毫秒**，
    // 按 `ts` 排序会平局，而 `id` 是随机 UUID —— 两者都表达不了写入顺序
    const last = all<{ status: string }>(
      db,
      'SELECT status FROM vehicle_tracks WHERE vehicle_id = ? ORDER BY rowid DESC LIMIT 1',
      [SEED_IDS.vehicleAgv]
    )[0]!;
    expect(last.status).toBe('finished');
    // 再 tick 不会对已完成的任务做任何事（内存里已经摘掉）
    expect(runner.tick()).toEqual({ advanced: [], finished: [], dropped: [] });
    expect(runner.activeCount()).toBe(0);
  });

  it('任务被外部改状态（取消）后，执行器下一帧丢弃它并不再移动车', () => {
    run(db, "UPDATE tasks SET status = 'cancelled' WHERE id = ?", [SEED_IDS.demoTask]);
    const before = vehicleRow(db);
    const result = runner.tick();
    expect(result.dropped).toEqual([SEED_IDS.demoTask]);
    expect(runner.activeCount()).toBe(0);
    expect(vehicleRow(db).x).toBe(before.x);
  });
});

describe('executor · 接管与续跑', () => {
  let db: Db;
  let runner: ExecutionRunner;
  beforeEach(() => {
    ({ db, runner } = setup());
  });

  it('接管 running 任务：任务转 paused、车回 reserved、落一条带建议的告警', () => {
    runner.adoptRunningTasks();
    const result = runner.takeover(actor, SEED_IDS.demoTask, { note: '现场检查，暂停执行', alertType: 'route_blocked' });
    expect(taskRow(db).status).toBe('paused');
    expect(vehicleRow(db).status).toBe('reserved');
    expect(result.nextSteps.length).toBeGreaterThan(0);
    const alert = get<{ type: string; level: string; status: string }>(db, 'SELECT type, level, status FROM alerts WHERE id = ?', [
      result.alertId
    ])!;
    expect(alert).toMatchObject({ type: 'route_blocked', level: 'warning', status: 'new' });
    // 接管后推进已停止：再 tick 也不会动
    expect(runner.activeCount()).toBe(0);
  });

  it('接管 assigned 任务：任务状态不变，但同样落告警（现场还没出发也常常要接管）', () => {
    makeAssigned(db);
    const result = runner.takeover(actor, SEED_IDS.demoTask, { note: '取消发车' });
    expect(taskRow(db).status).toBe('assigned');
    expect(result.alertId).toBeTruthy();
  });

  it('接管不允许的状态（pending）→ TASK.STATE_CONFLICT', () => {
    run(db, "UPDATE tasks SET status = 'pending' WHERE id = ?", [SEED_IDS.demoTask]);
    expect(() => runner.takeover(actor, SEED_IDS.demoTask, { note: 'x' })).toThrowError(/不能接管/);
  });

  it('adoptRunningTasks 把库里 running 的任务接进内存续跑（seed 的演示任务）', () => {
    expect(runner.activeCount()).toBe(0);
    expect(runner.adoptRunningTasks()).toBe(1);
    expect(runner.activeCount()).toBe(1);
    // 续跑从已有进度出发：tick 一帧后进度**大于**原值，而不是从 0 重来
    const before = taskRow(db).progress;
    runner.tick();
    expect(taskRow(db).progress).toBeGreaterThan(before);
    // 幂等：再调一次**没有新增**（返回 0），内存里仍然只有一条
    expect(runner.adoptRunningTasks()).toBe(0);
    expect(runner.activeCount()).toBe(1);
  });
});
