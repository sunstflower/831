/**
 * 分页换算（纯函数）。
 *
 * 为什么独立成一份：M2 基础数据页与 M3 任务页都要「总数 → 页数」与「把页码夹回范围」，
 * 两处各写一份 `Math.ceil` 就会出现「一处把 0 条算成 0 页、另一处算成 1 页」这类分歧，
 * 而分页器显示 `0 / 0` 时没人会怀疑是公式写错了。
 */

/** 总页数（总数为 0 时仍是 1 页，否则分页器会显示「0 / 0」）。 */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * 收敛页码。
 *
 * 场景：在第 3 页把筛选改成「已停用」，结果只剩 2 条 —— 若仍请求第 3 页，
 * 使用者会看到一张**空表**，而数据其实是有的（在前 1 页）。
 * 因此拿到 `total` 后要把页码夹回范围内并重新请求。
 */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCountOf(total, pageSize));
}
