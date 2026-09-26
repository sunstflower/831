/**
 * 应用标识（内联 SVG）。
 *
 * 为什么自己画而不是用图片：`docs/module-M6-map.md` §1.3 的零在线依赖约束
 * （Electron 打包后离线启动）排除了图标字体与远程图片；而位图 logo 在
 * 高分屏与主题色切换下都要额外准备多份资源。内联 SVG 只有一份，且能吃 `currentColor`。
 *
 * 图形语义：一条折线（路线）+ 三个节点（站点/车辆）+ 一条虚线边（可行驶路段），
 * 即项目的核心对象；配色全部取自 `theme.css` 的画布变量，与地图上的同一含义同色。
 */
export interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 30, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="无人物流调度管理软件"
    >
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="8.5"
        fill="var(--udm-surface-3)"
        stroke="var(--udm-hairline)"
        strokeWidth="1.5"
      />
      {/* 路线：横向两段 + 一段纵向连接，对应「路网由节点与有向边组成」 */}
      <path
        d="M8.5 21.5V11h7.5v6.5h7"
        stroke="var(--udm-canvas-route)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 剩余路段用虚线：禁行/未通行边在地图上就是虚线 */}
      <path
        d="M8.5 21.5h9"
        stroke="var(--udm-canvas-net)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="3 3"
      />
      <circle cx="8.5" cy="11" r="2.6" fill="var(--udm-canvas-site)" />
      <circle cx="23" cy="17.5" r="2.6" fill="var(--udm-canvas-task)" />
      <circle cx="17.5" cy="21.5" r="2.6" fill="var(--udm-canvas-vehicle)" />
    </svg>
  );
}
