/**
 * 信息架构：**导航清单**与**未实现模块的自我介绍**。
 *
 * 为什么单独一份而不写在 `AppLayout.tsx` 里：同一份「模块 → 路由 / 标题 / 权限 / 图标」
 * 事实有三个使用方 —— 侧栏导航（渲染入口）、顶栏（显示当前页标题与说明）、
 * 占位页（说明这个模块将来做什么）。三处各写一份就是本项目反复踩过的「同一事实多个作者」
 * （D-34）。
 *
 * **边界**：本文件不定义需求。`capabilities` 里每条都带 `Req-*` 编号，
 * 编号与文案的唯一来源是 [`design.md`](../../../design.md) §4；这里只是**索引 + 一句短标签**，
 * 供占位页告诉使用者「点进来的这一页将来会有什么、去哪查需求」。需求变更时先改 `design.md`。
 */
import type { ComponentType } from 'react';
import type { Permission } from '@udm/shared';
import {
  IconAlert,
  IconAudit,
  IconDashboard,
  IconDatabase,
  IconDispatch,
  IconMap,
  IconSettings,
  IconTasks,
  IconUsers,
  IconVehicle,
  type IconProps
} from '../components/icons';

/**
 * 导航分组。
 *
 * 为什么分组而不是平铺 9 项：平铺会把「看现状（监控）」与「改配置（系统）」混在一列，
 * 使用者每次都要**逐个读完**才能定位；分组后按意图找即可。
 */
export const NAV_GROUPS = [
  { key: 'monitor', label: '监控' },
  { key: 'dispatch', label: '调度' },
  { key: 'govern', label: '系统' }
] as const;

export type NavGroupKey = (typeof NAV_GROUPS)[number]['key'];

export interface NavItem {
  /** 路由路径（与 `design.md` §7.1 的页面清单一致）。 */
  route: string;
  label: string;
  icon: ComponentType<IconProps>;
  group: NavGroupKey;
  /**
   * 进入该页所需权限点。
   *
   * ⚠️ 只用于**隐藏入口**。权限强制在主进程（`design.md` §3.7 / D-08）——
   * 前端不把「按钮没显示」当安全边界。
   */
  permission?: Permission;
  /** 顶栏的一句话说明（也是该页的一句话定义）。 */
  description: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    route: '/',
    label: '监控工作台',
    icon: IconDashboard,
    group: 'monitor',
    description: '车队与任务的实时概览'
  },
  {
    route: '/map',
    label: '地图',
    icon: IconMap,
    group: 'monitor',
    permission: 'map:read',
    description: '路网、车辆、路线与告警同图联动'
  },
  {
    route: '/fleet',
    label: '车辆中心',
    icon: IconVehicle,
    group: 'monitor',
    permission: 'monitor:read',
    description: '车队运行态、单车位置与轨迹'
  },
  {
    route: '/alerts',
    label: '告警中心',
    icon: IconAlert,
    group: 'monitor',
    permission: 'alert:read',
    description: '告警的确认、处理与归档'
  },
  {
    route: '/tasks',
    label: '任务管理',
    icon: IconTasks,
    group: 'dispatch',
    permission: 'task:read',
    description: '任务创建、导入与状态流转'
  },
  {
    route: '/dispatch',
    label: '调度中心',
    icon: IconDispatch,
    group: 'dispatch',
    permission: 'dispatch:read',
    description: '策略预览对比与应用派发'
  },
  {
    route: '/base-data',
    label: '基础数据',
    icon: IconDatabase,
    group: 'govern',
    permission: 'base:read',
    description: '站点、车辆、路网与任务模板'
  },
  {
    route: '/audit',
    label: '审计日志',
    icon: IconAudit,
    group: 'govern',
    permission: 'audit:read',
    description: '全量操作留痕与调度日志'
  },
  {
    route: '/settings',
    label: '系统设置',
    icon: IconSettings,
    group: 'govern',
    permission: 'settings:read',
    description: '全局参数（重启生效）'
  },
  {
    route: '/users',
    label: '用户管理',
    icon: IconUsers,
    group: 'govern',
    permission: 'user:manage',
    description: '账号、角色与密码重置'
  }
];

/** 未实现模块的自我介绍（占位页数据源）。 */
export interface PlannedModule {
  /** 模块编号，与 `design.md` §4 的 M 编号一致 —— 使用者照此回查需求条目。 */
  id: string;
  title: string;
  /** 顶栏副标题：这一页要解决什么（取自 `design.md` §4 的「目标」）。 */
  goal: string;
  /** 计划能力，每条都带 `Req-*` 编号（唯一来源见文件头）。 */
  capabilities: Array<{ requirement: string; label: string }>;
  /** 该模块依赖的接口前缀（`docs/api.md`）与权限点。 */
  interfaces: string[];
  permissions: Permission[];
}

export const PLANNED_MODULES: Record<string, PlannedModule> = {
  /*
   * 这里是**空表**，而且现在就该是空的。
   *
   * `PLANNED_MODULES` 的语义是「还没实现、因此被挂到 `PlaceholderPage` 上的模块」。
   * M1-M10 九个模块的页面如今**全部落地**，没有任何路由再指向 `PlaceholderPage`
   * —— 表里再留条目就等于声称「这个模块没实现」，与 `App.tsx` 的路由表直接矛盾。
   *
   * 保留这张表与 `PlaceholderPage` 是为了**下一个模块**：先登记「将来有什么能力、
   * 依赖哪些接口」，路由挂占位页；模块落地后再把这一条删掉、改指真实页面。
   * 反过来（先挂占位页、不登记）会让使用者看到一张空白页（ISS-010 的教训）。
   *
   * 先例与理由（D-34）：M2/M3/M4+M5 落地时都从这张表里删过条目 —— 同一件事
   * 一旦有两个作者（路由说已实现、登记表说未实现），它们必然随开发进度分叉。
   */
};

/** 按路由取导航项（顶栏据此显示标题与说明）。 */
export function navItemOf(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.route === pathname);
}
