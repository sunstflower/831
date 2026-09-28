/**
 * 应用外壳：左侧导航栏 + 顶栏（当前页标题 / 连接状态 / 用户菜单）+ 内容区。
 *
 * 三条实现约束：
 * 1. **导航按权限过滤**（`design.md` §7.1 的「可见角色」列）——但隐藏入口只是体验优化，
 *    权限强制在主进程（`design.md` §3.7 / D-08）。前端不把「按钮没显示」当安全边界。
 * 2. **当前页标题来自路由表**（`app/modules.ts`），不写在每个页面里：否则同一个模块会有
 *    「导航叫任务管理、页面标题叫任务列表」两套叫法。
 * 3. **适配器必须常驻可见**（顶栏徽标）：D-22 的教训是「桌面端静默跑 mock 数据」最难排查，
 *    把当前形态放在每个页面都能看到的位置，是最便宜的一道防线。
 */
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { hasPermission } from '@udm/shared';
import { adapterKind } from '../api';
import { useSessionStore } from '../store/session';
import { NAV_GROUPS, NAV_ITEMS, navItemOf, type NavItem } from '../app/modules';
import { BrandMark } from './BrandMark';
import { UserMenu } from './UserMenu';
import { IconCollapse, IconExpand } from './icons';

/** 侧栏收起状态在会话间保留：每次进来都要重新收起一次是无谓的重复动作。 */
const RAIL_STORAGE_KEY = 'udm.rail.collapsed';

function readRailCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === '1';
  } catch {
    // 隐私模式 / 存储被禁用时 localStorage 会抛异常 —— 折叠状态不值得让整个外壳挂掉
    return false;
  }
}

function writeRailCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* 同上：静默降级为「本次会话内有效」 */
  }
}

/** 适配器徽标：`mock` 用警示色，提醒这不是真实数据链路。 */
const ADAPTER_TONE: Record<string, string> = {
  mock: 'udm-badge udm-badge--warn',
  ipc: 'udm-badge udm-badge--ok',
  http: 'udm-badge udm-badge--info'
};

export function AppLayout() {
  const user = useSessionStore((state) => state.user);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readRailCollapsed);

  useEffect(() => {
    writeRailCollapsed(collapsed);
  }, [collapsed]);

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || (user && hasPermission(user.role, item.permission))
  );
  const current = navItemOf(location.pathname);

  /** 收起时把文字藏起来，靠 `title` 与读屏文本保住可访问性（不能只靠视觉）。 */
  function renderItem(item: NavItem) {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.route}
        to={item.route}
        end={item.route === '/'}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) => (isActive ? 'udm-nav__item is-active' : 'udm-nav__item')}
      >
        <Icon className="udm-nav__icon" />
        <span className="udm-nav__label">{item.label}</span>
      </NavLink>
    );
  }

  return (
    <div className={collapsed ? 'udm-shell is-rail-collapsed' : 'udm-shell'}>
      {/* 键盘用户跳过九个导航项直达内容（九个 tab 才能到正文是不可接受的） */}
      <a className="udm-skip" href="#udm-main">
        跳到主要内容
      </a>

      {/* 标签挂在 <nav> 上而不是外层 <aside>：aside 里还有品牌与折叠按钮，
          把「主导航」这个名字给它，读屏会念成「主导航 补充区域」，与内容不符。 */}
      <aside className="udm-rail">
        <div className="udm-rail__brand">
          <BrandMark className="udm-rail__mark" />
          <span className="udm-rail__titles">
            <span className="udm-rail__name">无人物流调度</span>
            <span className="udm-rail__sub">园区车队管理</span>
          </span>
        </div>

        <nav className="udm-nav" aria-label="主导航">
          {NAV_GROUPS.map((group) => {
            const items = visibleItems.filter((item) => item.group === group.key);
            if (items.length === 0) {
              // 该分组在当前角色的可见范围内为空（如 monitor 看不到「系统」组）——整组不渲染
              return null;
            }
            return (
              <div className="udm-nav__group" key={group.key}>
                <h2 className="udm-nav__group-title">{group.label}</h2>
                {items.map(renderItem)}
              </div>
            );
          })}
        </nav>

        <div className="udm-rail__foot">
          <span className={ADAPTER_TONE[adapterKind] ?? 'udm-badge'}>
            <span className="udm-dot" aria-hidden="true" />
            {adapterKind}
          </span>
          <button
            type="button"
            className="udm-icon-btn udm-icon-btn--plain"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            title={collapsed ? '展开导航' : '收起导航'}
          >
            {collapsed ? <IconExpand /> : <IconCollapse />}
            <span className="udm-sr-only">{collapsed ? '展开导航' : '收起导航'}</span>
          </button>
        </div>
      </aside>

      <div className="udm-main">
        <header className="udm-topbar">
          <div className="udm-topbar__titles">
            <h1 className="udm-topbar__title">{current?.label ?? '无人物流调度管理软件'}</h1>
            {current ? <p className="udm-topbar__desc">{current.description}</p> : null}
          </div>
          <div className="udm-topbar__actions">
            <span className="udm-badge udm-badge--ok">
              <span className="udm-dot udm-dot--pulse" aria-hidden="true" />
              实时
            </span>
            <UserMenu />
          </div>
        </header>
        <main className="udm-content" id="udm-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
