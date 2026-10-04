/**
 * 枚举值 → **视觉色调**（`ui.css` 的 `tone-*` / `udm-badge--*` / `udm-progress--*` 类）。
 *
 * 与 `labels.ts` 的分工：那里是「值 → 文案」，这里是「值 → 颜色」。
 * 两者都是**展示口径**，因此同样要遵守「每个事实只有一个作者」（D-34）——
 * 同一状态在工作台与任务页显示成不同颜色，比不显示颜色更糟：使用者会以为
 * 两处说的不是同一件事，而任何一处都不报错。
 *
 * **谁在这里、谁不在这里**：按「有几个使用者」决定。
 *   - `TASK_STATUS_TONE` —— 监控工作台的任务进度条与 M3 任务页共用，故在这里；
 *   - `VEHICLE_STATUS_TONE` —— 原只在工作台的车队分布条里，车辆中心（`pages/FleetPage.tsx`）
 *     落地后出现第二个使用者，按本条规则上移到这里；
 *   - 告警级别的色调目前仍只有工作台用，留在 `dashboard/model/summary.ts`。
 * 多一个使用者时把它搬过来，而不是在第二个模块里再写一份。
 */
import type { TaskStatus, VehicleStatus } from '@udm/shared';

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'dim';

/**
 * 把 tone 映射成 CSS 类名：**原样拼接**（`prefix + tone`）。
 *
 * ⚠️ `prefix` 必须**连分隔符一起给**，因为没有一种分隔符适合所有族：
 * `ui.css` 里是 `.tone-ok`（单横线）与 `.udm-badge--ok` / `.udm-progress--ok`（BEM 双横线），
 * 而 `dashboard.css` 里是 `.udm-fleet__seg--ok`。函数替调用方猜分隔符，就一定会猜错一半。
 *
 * 实测（2026-09-26，写任务页时发现）：早先的实现是 `` `${prefix}-${tone}` ``，
 * 于是传 `'udm-progress--'` 的调用点拼出 `udm-progress---ok`、传 `'udm-badge'` 的拼出
 * `udm-badge-ok` —— 两个 CSS 里都不存在的类名。表现是**进度条与徽标的色调全部失效**
 * （退回基础色），既不报错也不影响任何测试。改成原样拼接后，这些调用点直接变正确。
 */
export function toneClass(tone: Tone, prefix = 'tone-'): string {
  return `${prefix}${tone}`;
}

/**
 * 徽标（`.udm-badge`）的色调修饰类。
 *
 * `dim` **有意不加修饰类**：基础款 `.udm-badge` 本身就是中性色
 * （`--udm-text-dim` 文字 + `--udm-surface-3` 底），而 CSS 里也没有 `.udm-badge--dim`。
 * 直接拼会得到一个未定义的类名 —— 显示结果虽然正确（退回基础款），
 * 但那属于「碰巧对」，下一个读代码的人无从判断是有意还是忘了写。
 *
 * 进度条（`.udm-progress`）不套这个函数：它的修饰类只有 ok/warn/danger，
 * `info` / `dim` 退回基础填充色（accent 蓝）正是想要的效果。
 */
export function badgeToneClass(tone: Tone): string {
  return tone === 'dim' ? 'udm-badge' : toneClass(tone, 'udm-badge--');
}

/**
 * 任务状态 → tone。
 *
 * 取色依据：只有「需要人介入或可能出错」的状态才给警示色，
 * 已完成 / 已取消用中性色收尾 —— 一串全红的列表等于没有信号。
 */
export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = {
  draft: 'dim',
  pending: 'warn',
  assigned: 'info',
  running: 'ok',
  paused: 'warn',
  finished: 'dim',
  cancelled: 'dim',
  failed: 'danger'
};

/**
 * 车辆状态 → tone。
 *
 * 判据与任务状态一致：只有「需要人介入或可能出错」的状态才给警示色 ——
 * `idle` 是可用运力（ok），`reserved`/`busy` 是正常在途（info），
 * `charging` 是计划内的等待（warn，提示运力暂时不可用），
 * `offline`/`disabled` 是中性收尾（dim），只有 `fault` 是 danger。
 * 一串全红的车队列表等于没有信号。
 */
export const VEHICLE_STATUS_TONE: Record<VehicleStatus, Tone> = {
  idle: 'ok',
  reserved: 'info',
  busy: 'info',
  charging: 'warn',
  offline: 'dim',
  fault: 'danger',
  disabled: 'dim'
};
