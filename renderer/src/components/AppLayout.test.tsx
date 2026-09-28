import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { Role } from '@udm/shared';
import { AppLayout } from './AppLayout';
import { useSessionStore } from '../store/session';

/**
 * 外壳的**权限过滤**测试。
 *
 * 为什么值得测：侧栏此前只按角色肉眼核对过（Electron 里数一遍），而它是「同名事实两个作者」
 * 最容易出事的地方 —— 新增一个模块时若忘了在 `app/modules.ts` 里写 `permission`，
 * 侧栏会对**所有角色**显示该入口，界面看起来完全正常（多一个能点、点进去 403 的链接）。
 *
 * 断言的是**具体条目的有/无**而非「共几项」：条数是派生事实（模块增删都会变），
 * 写死它只会让测试在每次加模块时变红，而抓不到真正的问题。
 */
function renderShell(role: Role, route: string) {
  useSessionStore.setState({
    token: 'mock-token',
    user: { id: `seed-${role}`, username: role, role, displayName: role, permissions: [] }
  });
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path={route} element={<p>页面内容</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

/** 侧栏导航项的文字（读渲染结果，不读 `NAV_ITEMS` —— 否则测的是常量不是界面）。 */
function navLabels(): string[] {
  return Array.from(document.querySelectorAll('.udm-nav__item')).map((el) => el.textContent?.trim() ?? '');
}

describe('AppLayout · 导航权限过滤', () => {
  it('admin 能看到全部入口，含审计日志与用户管理', () => {
    renderShell('admin', '/');
    const labels = navLabels();
    expect(labels).toContain('审计日志');
    expect(labels).toContain('用户管理');
    expect(labels).toContain('调度中心');
  });

  it('dispatcher 看得到系统设置，但看不到审计日志与用户管理', () => {
    renderShell('dispatcher', '/');
    const labels = navLabels();
    expect(labels).toContain('系统设置');
    expect(labels).not.toContain('审计日志');
    expect(labels).not.toContain('用户管理');
  });

  it('monitor 是只读角色：看得到告警中心，看不到调度中心，也看不到系统设置/审计/用户管理', () => {
    renderShell('monitor', '/');
    const labels = navLabels();
    expect(labels).toContain('告警中心');
    expect(labels).not.toContain('调度中心');
    expect(labels).not.toContain('系统设置');
    // 「基础数据」同属「系统」组且 monitor 有权（`base:read`），所以整组**不是**空的 ——
    // 过滤是按导航项做的，一个组只要还剩一项就照常渲染（下面这条断言正是在锁这一点）
    expect(labels).toContain('基础数据');
    expect(screen.getByRole('heading', { name: '监控' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '系统' })).toBeInTheDocument();
  });

  it('当前页标题取自模块元数据，并与导航项一致（同一事实没有第二个作者）', () => {
    renderShell('admin', '/map');
    const rail = screen.getByRole('navigation', { name: '主导航' });
    const active = within(rail)
      .getAllByRole('link')
      .find((link) => link.getAttribute('aria-current') === 'page');
    expect(active?.textContent?.trim()).toBe('地图');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('地图');
  });

  it('未知路由不显示任何导航项为当前页（不回退到第一个模块）', () => {
    renderShell('admin', '/not-a-page');
    expect(document.querySelector('.udm-nav__item.is-active')).toBeNull();
  });

  it('localStorage 不可用时外壳照常渲染，折叠按钮仍然生效（隐私模式不能整壳挂掉）', () => {
    // jsdom（vitest 环境）里的 `localStorage` 没有 `getItem` / `setItem`（实测：
    // 它是个没有原型方法的空对象），正好等价于浏览器隐私模式下访问存储会抛异常的情形 ——
    // 因此这条断言在真实环境里很难复现，在这里却是免费的。
    const { container } = renderShell('admin', '/');
    expect(container.querySelector('.udm-shell')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '收起导航' }));
    expect(container.querySelector('.udm-shell')?.className).toContain('is-rail-collapsed');
  });
});
