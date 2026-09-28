import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { UserMenu } from './UserMenu';
import { useSessionStore } from '../store/session';

/**
 * 顶栏用户菜单的交互测试。
 *
 * 重点在两件**看不见但会坏**的事：
 * 1. 菜单项的键盘可达性 —— 菜单项带 `tabindex="-1"`，方向键是键盘用户唯一的入口，
 *    写错（或以后被顺手删掉）时界面看起来完全正常，只有键盘用户用不了。
 * 2. 「权限点用会话里那一份」这个决定（D-08）—— 若有人改成按角色本地重算，
 *    在服务端下发的授权与本地角色不一致时就会显示错值，而这正是排查越权时最误导人的地方。
 */
function renderMenu() {
  useSessionStore.setState({
    token: 'mock-admin-1',
    user: {
      id: 'seed-admin',
      username: 'admin',
      role: 'admin',
      displayName: '系统管理员',
      // 刻意只给 2 个：admin 角色本身有 20 个权限点，用它来区分「会话里那一份」与「本地重算」
      permissions: ['map:read', 'task:read']
    }
  });
  return render(
    <MemoryRouter>
      <button type="button">前一个按钮</button>
      <UserMenu />
      <button type="button">末尾按钮</button>
    </MemoryRouter>
  );
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /系统管理员/ });
}

describe('UserMenu · 交互', () => {
  it('初始关闭，触发器声明弹出类型与展开状态', () => {
    renderMenu();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('方向键打开菜单，并把焦点送进第一项', () => {
    renderMenu();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', 'udm-user-menu');
    // 菜单项 tabindex=-1 时，若打开后不落焦点，键盘用户得靠 Tab 才能进去
    expect(document.activeElement).toBe(screen.getByRole('menuitem'));
  });

  it('ArrowUp 打开菜单时聚焦最后一项', () => {
    renderMenu();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem'));
  });

  it('菜单已打开、焦点仍在触发器上时，方向键把焦点移进菜单', () => {
    renderMenu();
    // 真实浏览器里点按钮会给它焦点，jsdom 的 `fireEvent.click` 不会移动焦点
    // （它只派发事件）—— 所以这里手动 focus 一次，复现浏览器点击后的真实状态。
    trigger().focus();
    fireEvent.click(trigger());
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem'));
  });

  it('Esc 关闭菜单并把焦点送回触发器', () => {
    renderMenu();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('Tab 关闭菜单并把焦点交接给菜单之后的可聚焦元素（不掉到 body）', () => {
    renderMenu();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '末尾按钮' }));
  });

  it('Shift+Tab 向前交接给菜单之前的可聚焦元素', () => {
    renderMenu();
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '前一个按钮' }));
  });

  it('权限点显示会话里的那一份，不按角色本地重算（D-08）', () => {
    renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByText('2 项')).toBeInTheDocument();
    expect(screen.queryByText('20 项')).toBeNull();
  });
});
