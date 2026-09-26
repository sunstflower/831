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
  tasks: {
    id: 'M3',
    title: '任务管理',
    goal: '任务的创建、批量导入、编辑与状态流转操作',
    capabilities: [
      { requirement: 'Req-M3-1', label: '任务创建（套模板 / 手填）' },
      { requirement: 'Req-M3-2', label: 'CSV / JSON 批量导入与失败明细' },
      { requirement: 'Req-M3-4', label: '暂停 / 恢复 / 取消 / 重派' },
      { requirement: 'Req-M3-5', label: '高风险操作二次确认' },
      { requirement: 'Req-M3-7', label: '状态 / 优先级 / 车辆 / 时间过滤' }
    ],
    interfaces: ['/api/tasks'],
    permissions: ['task:read', 'task:write']
  },
  dispatch: {
    id: 'M4 / M5',
    title: '调度中心',
    goal: '多策略派发预览对比，确认后落库生效，并给出可解释的路线',
    capabilities: [
      { requirement: 'Req-M4-1', label: '贪心 / 匈牙利策略对比' },
      { requirement: 'Req-M4-2', label: '约束不满足的拒绝原因' },
      { requirement: 'Req-M4-3', label: '先预览、后应用（预览不落库）' },
      { requirement: 'Req-M4-4', label: '手动指派指定车辆' },
      { requirement: 'Req-M5-2', label: 'A* 与 Dijkstra 路线对比' }
    ],
    interfaces: ['/api/dispatch', '/api/routes'],
    permissions: ['dispatch:read', 'dispatch:preview', 'dispatch:apply', 'route:plan']
  },
  'base-data': {
    id: 'M2',
    title: '基础数据',
    goal: '站点、车辆、路网、禁行规则与任务模板的维护',
    capabilities: [
      { requirement: 'Req-M2-1', label: '站点增删改查（编码唯一）' },
      { requirement: 'Req-M2-2', label: '车辆增删改查（含状态）' },
      { requirement: 'Req-M2-3', label: '路网节点与有向边维护' },
      { requirement: 'Req-M2-4', label: '禁行规则与生效时间窗' },
      { requirement: 'Req-M2-6', label: '主数据变更写审计（before/after）' }
    ],
    interfaces: ['/api/sites', '/api/vehicles', '/api/nodes', '/api/edges', '/api/restrictions'],
    permissions: ['base:read', 'base:write']
  },
  alerts: {
    id: 'M8',
    title: '告警中心',
    goal: '异常事件归类、提示与留痕，形成「生成 → 确认 → 处理 → 归档」闭环',
    capabilities: [
      { requirement: 'Req-M8-2', label: '确认 / 处理 / 归档（记录操作者与时间）' },
      { requirement: 'Req-M8-3', label: '按类型 / 级别 / 状态 / 对象过滤' },
      { requirement: 'Req-M8-4', label: '去重窗口，同一原因不刷屏' },
      { requirement: 'Req-M8-5', label: '新告警实时推送与地图角标' }
    ],
    interfaces: ['/api/alerts'],
    permissions: ['alert:read', 'alert:ack', 'alert:resolve', 'alert:archive']
  },
  audit: {
    id: 'M9',
    title: '审计日志',
    goal: '全量操作的留痕查询与导出，只增不改不删',
    capabilities: [
      { requirement: 'Req-M9-1', label: '登录 / 主数据 / 任务 / 调度 / 接管全部留痕' },
      { requirement: 'Req-M9-2', label: '模块 / 动作 / 操作者 / 时间过滤与分页' },
      { requirement: 'Req-M9-3', label: '调度结果留痕（输入快照 / 策略 / 耗时）' },
      { requirement: 'Req-M9-4', label: '导出 CSV（仅 admin）' }
    ],
    interfaces: ['/api/audit', '/api/dispatch-logs'],
    permissions: ['audit:read']
  },
  settings: {
    id: 'M10',
    title: '系统设置',
    goal: '按 schema 校验后保存全局参数，主进程重启生效',
    capabilities: [
      { requirement: 'Req-M10-1', label: '按 schema 校验类型与范围' },
      { requirement: 'Req-M10-4', label: '前端按 schema 动态渲染表单' },
      { requirement: 'Req-M10-2', label: '修改写审计' },
      { requirement: 'Req-M10-3', label: '启动读取，缺失用默认值' }
    ],
    interfaces: ['/api/settings', '/api/settings/schema'],
    permissions: ['settings:read', 'settings:write']
  },
  users: {
    id: 'M1',
    title: '用户管理',
    goal: '账号、角色与密码维护（登录链路已实现，管理界面待补）',
    capabilities: [
      { requirement: 'Req-M1-5', label: '账号增 / 禁 / 启用 / 重置密码' },
      { requirement: 'Req-M1-6', label: '登录 / 退出 / 密码变更记审计' },
      { requirement: 'Req-M1-7', label: '连续失败锁定策略（参数可配）' }
    ],
    interfaces: ['/api/users'],
    permissions: ['user:manage']
  }
};

/** 按路由取导航项（顶栏据此显示标题与说明）。 */
export function navItemOf(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.route === pathname);
}
