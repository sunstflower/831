/**
 * 内联 SVG 图标集。
 *
 * 为什么不用图标库/字体：`docs/module-M6-map.md` §1.3 要求**零在线依赖**
 * （离线启动、Electron 打包后无网络），而图标字体与 Icon CDN 都会破坏这一点。
 * 内联 `currentColor` 描边图标既离线可用，又能随主题色变化。
 *
 * 约定：全部为 16×16 视口、`stroke="currentColor"`、`fill="none"`，
 * 只接受 `className` 与 `size`，不暴露多余 props（避免各页写法不一致）。
 */
import type { SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest
  };
}

/** 工作台（仪表盘网格）。 */
export function IconDashboard(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </svg>
  );
}

/** 地图（图层叠加）。 */
export function IconMap(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 4.5 6 3l4 1.5L14 3v8.5L10 13l-4-1.5L2 13z" />
      <path d="M6 3v8.5M10 4.5V13" />
    </svg>
  );
}

/** 任务（清单）。 */
export function IconTasks(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 4h3M2 8h3M2 12h3" />
      <path d="M7 4h7M7 8h7M7 12h7" />
    </svg>
  );
}

/** 调度（分支/路由）。 */
export function IconDispatch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M4 6v3a3 3 0 0 0 3 3h3" />
    </svg>
  );
}

/** 告警（铃铛）。 */
export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 11V7a4 4 0 0 1 8 0v4l1 2H3z" />
      <path d="M6.5 13.5a1.8 1.8 0 0 0 3 0" />
    </svg>
  );
}

/** 基础数据（数据库）。 */
export function IconDatabase(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  );
}

/** 审计日志（文档）。 */
export function IconAudit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 2h5l3 3v9H4z" />
      <path d="M9 2v3h3" />
      <path d="M6 8h4M6 11h4" />
    </svg>
  );
}

/** 系统设置（齿轮）。 */
export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" />
    </svg>
  );
}

/** 用户管理（人像）。 */
export function IconUsers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="5.5" r="2.5" />
      <path d="M1.8 13.5a4.2 4.2 0 0 1 8.4 0" />
      <path d="M11 4.2a2.4 2.4 0 0 1 0 4.6M12.4 13.5a4 4 0 0 0-1.6-3.1" />
    </svg>
  );
}

/** 图层（堆叠方块）。 */
export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2 2 5l6 3 6-3z" />
      <path d="M2 8.5 8 11.5l6-3" />
      <path d="M2 11.5 8 14.5l6-3" />
    </svg>
  );
}

/** 定位/聚焦（准星）。 */
export function IconTarget(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="4.5" />
      <circle cx="8" cy="8" r="1.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
    </svg>
  );
}

/** 适配视图（四角括号）。 */
export function IconFit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  );
}

/** 关闭（叉）。 */
export function IconClose(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** 退出登录。 */
export function IconLogout(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 2.5H3.5v11H6" />
      <path d="M9 5.5 11.5 8 9 10.5M11 8H6" />
    </svg>
  );
}

/** 警告三角（故障/风险）。 */
export function IconWarning(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2.5 14.5 13.5h-13z" />
      <path d="M8 6.5v3.2M8 11.6v.1" />
    </svg>
  );
}

/** 车辆（小车）。 */
export function IconVehicle(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="5.5" width="11" height="6" rx="1.2" />
      <path d="M5 5.5 6.5 3h3L11 5.5" />
      <circle cx="5.5" cy="11.5" r="1" />
      <circle cx="10.5" cy="11.5" r="1" />
    </svg>
  );
}

/* ==================== 外壳与工作台补充（2026-09-25） ====================
 * 新增图标沿用同一约定（16×16 / currentColor / 仅 size 与 className）。
 * 之所以继续内联而非引图标库：`docs/module-M6-map.md` §1.3 的零在线依赖约束
 * 对外壳与工作台同样适用（Electron 打包后离线启动）。
 */

/** 刷新（环形箭头）。 */
export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.2 7A5.4 5.4 0 1 0 13 10.6" />
      <path d="M13.4 3v3.6H9.8" />
    </svg>
  );
}

/** 向右箭头（跳转、进入）。 */
export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />
    </svg>
  );
}

/** 展开/收起（向下箭头，配合 `is-open` 旋转 180°）。 */
export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6.2 8 10.2l4-4" />
    </svg>
  );
}

/** 侧栏收起（左侧竖线 + 向内箭头）。 */
export function IconCollapse(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M6 3v10M10.4 6.4 8.4 8l2 1.6" />
    </svg>
  );
}

/** 侧栏展开。 */
export function IconExpand(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M6 3v10M8.4 6.4 10.4 8l-2 1.6" />
    </svg>
  );
}

/** 用户（单人头像）。 */
export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="5.6" r="2.6" />
      <path d="M3 13.2c0-2.5 2.2-4 5-4s5 1.5 5 4" />
    </svg>
  );
}
/** 活动/脉冲（事件流、心跳）。 */
export function IconActivity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M1.5 8h3l2-4.5L9 12l2-4h3.5" />
    </svg>
  );
}

/** 时钟（刷新周期、超时）。 */
export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.4" />
    </svg>
  );
}

/** 盾牌（权限、双重校验）。 */
export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2 13 3.8v4.3c0 3-2.1 5.1-5 6-2.9-.9-5-3-5-6V3.8z" />
      <path d="M6 8l1.5 1.5L10.2 6.8" />
    </svg>
  );
}

/** 勾选（能力清单、已完成）。 */
export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.2 8.4 6.4 11.6 12.8 5.2" />
    </svg>
  );
}

/** 信息（提示语、口径说明）。 */
export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 7.2v3.4M8 5.3v.1" />
    </svg>
  );
}
