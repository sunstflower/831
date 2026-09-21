/**
 * 应用外壳：顶栏 + 侧边导航 + 内容区。
 *
 * 导航项按权限显示 —— 但注意：**隐藏按钮只是体验优化，权限校验以主进程为准**
 * （`design.md` §3.7 / D-08）。前端不得把「没显示按钮」当作安全边界。
 */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { hasPermission, type Permission } from '@udm/shared';
import { useSessionStore } from '../store/session';
import { apiClient } from '../api';

interface NavItem {
  to: string;
  label: string;
  permission?: Permission;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '监控工作台' },
  { to: '/map', label: '地图', permission: 'map:read' },
  { to: '/tasks', label: '任务管理', permission: 'task:read' },
  { to: '/alerts', label: '告警中心', permission: 'alert:read' },
  { to: '/base-data', label: '基础数据', permission: 'base:read' },
  { to: '/settings', label: '系统设置', permission: 'settings:read' }
];

export function AppLayout() {
  const user = useSessionStore((state) => state.user);
  const token = useSessionStore((state) => state.token);
  const logout = useSessionStore((state) => state.logout);
  const navigate = useNavigate();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || (user && hasPermission(user.role, item.permission))
  );

  async function handleLogout() {
    await apiClient.invoke('/api/auth/logout', {}, token);
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="udm-shell">
      <header className="udm-topbar">
        <span className="udm-topbar__title">无人物流调度管理软件</span>
        <span className="udm-topbar__spacer" />
        {user ? (
          <>
            <span className="udm-topbar__user">
              {user.displayName}（{user.role}）
            </span>
            <button type="button" className="udm-btn" onClick={() => void handleLogout()}>
              退出登录
            </button>
          </>
        ) : null}
      </header>
      <div className="udm-body">
        <nav className="udm-nav" aria-label="主导航">
          {visibleItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'udm-nav__link is-active' : 'udm-nav__link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="udm-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
