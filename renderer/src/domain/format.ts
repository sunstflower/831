/**
 * 展示层的**格式换算**（值 → 给人看的字符串）。
 *
 * 与 `labels.ts`（值 → 中文名）、`tone.ts`（值 → 色调）并列，同属展示口径的单一来源：
 * 同一个数字在基础数据页与任务页保留不同的小数位，会让人以为两处说的不是同一件事。
 * 具体口径写在每个函数上，改口径请改这里 —— 不要在页面里就地 `toFixed`。
 *
 * **边界**：本文件只做字符串格式化，不做本地化（没有 i18n 框架），也不解析用户输入
 * （那是表单模型的事，见各模块的 `form.ts`）。
 */

/** 保留至多一位小数：坐标与长度都是米，第二位小数没有意义但会让列宽跳动。 */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * ISO 时间 → `2026-09-27 08:00:00`。
 *
 * 口径：把 `T` 换成空格、去掉毫秒与末尾的 `Z`，**秒保留** ——
 * 调度与执行的时间线里秒是有意义的（同一分钟内的两次变更要能区分），
 * 而凑近看的十进制小数并不会。这个口径原先写在 `base/model.ts` 的列里，
 * 抽出来时保持不变（改它会同时改掉基础数据页与任务页两处的显示）。
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  // 先去掉末尾的 `Z`（`.000Z` 与 `:12Z` 两种形态都有），再按需去掉毫秒
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '');
}

/**
 * 时间窗的展示。
 *
 * 三种状态各有含义，必须能区分：无时间窗（`不限时段`）、只有开始（`2026-09-27 08:00 起`）、有界区间。
 * 只显示成 `—` 会把「不限时段」与「数据缺失」混为一谈。
 */
export function timeWindowText(startAt: string | null, endAt: string | null): string {
  if (!startAt && !endAt) {
    return '不限时段';
  }
  if (startAt && !endAt) {
    return `${formatDateTime(startAt)} 起`;
  }
  if (!startAt && endAt) {
    return `至 ${formatDateTime(endAt)}`;
  }
  return `${formatDateTime(startAt)} → ${formatDateTime(endAt)}`;
}
