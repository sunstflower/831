/**
 * 画布配色：**唯一来源**，供需要「真色值」而 CSS 变量到不了的地方使用。
 *
 * 为什么必须有这份文件：React Flow 的 `<MiniMap>` 把颜色当作 `<rect style={{fill}}>` 的
 * **内联样式**写进 SVG，读不到 CSS 类；而 CSS 变量要生效又必须经 `var()` 解析 ——
 * 内联样式在 svg 上可用 `var(...)`，但 MiniMap 的 `nodeColor` 返回的是字符串，
 * 传 `var(--x)` 只有在同一 svg 祖先上定义了该变量才成立（跨组件层不保证）。
 *
 * 因此这里给出**字面量色值**，并用 `palette.test.ts` 断言它们与 `theme.css` 的变量
 * 逐一吻合 —— 这样既满足 SVG 的取值方式，又不会变成「第二套色值」。
 * 改配色时：先改 `theme.css`，再让测试告诉你这里哪一条过期了。
 */

/** 图例/缩略图用的图层主色（与 `theme.css` 的同名变量必须一致）。 */
export const PALETTE = {
  net: '#64748b',
  route: '#38bdf8',
  site: '#a78bfa',
  task: '#4ade80',
  order: '#fbbf24',
  vehicle: '#38bdf8',
  accent: '#38bdf8',
  warn: '#fbbf24',
  danger: '#f87171',
  ok: '#4ade80'
} as const;

/** 缩略图节点配色：按图层区分，与画布上的视觉语义保持一致。 */
export const MINIMAP_NODE_COLORS: Record<string, string> = {
  net: PALETTE.net,
  site: PALETTE.site,
  vehicle: PALETTE.vehicle,
  taskEndpoint: PALETTE.task,
  orderEndpoint: PALETTE.order
};

/** 未注册的节点类型（未来新增图层忘记登记）时的兜底色。 */
export const MINIMAP_FALLBACK_COLOR = PALETTE.net;
