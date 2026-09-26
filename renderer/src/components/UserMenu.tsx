/**
 * 顶栏用户菜单。
 *
 * 为什么做成下拉而不只是「名字 + 退出按钮」：会话信息里有三样东西使用者需要时**必须能找到**
 * —— 当前角色、这一角色实际拿到了哪些权限点、以及当前跑在哪个适配器上（D-22 明确
 * 要求不能让桌面端静默显示 mock 数据；把适配器放在随手可见处是最便宜的防线）。
 * 全铺在顶栏会让栏高失控，因此收进下拉。
 *
 * 交互按原生弹层的「最小正确集」实现（本项目不引第三方 UI 库）：
 * 点击外部关闭、Esc 关闭、`aria-expanded` / `aria-haspopup` 标注、焦点回到触发按钮。
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@udm/shared';
import { apiClient, adapterKind } from '../api';
import { useSessionStore } from '../store/session';
import { IconChevronDown, IconLogout, IconShield, IconUser } from './icons';

/** 角色中文名。与 `design.md` §3.7 的三种角色一一对应。 */
export const ROLE_LABEL: Record<Role, string> = {
  admin: '系统管理员',
  dispatcher: '调度员',
  monitor: '监控员'
};

export function UserMenu() {
  const user = useSessionStore((state) => state.user);
  const token = useSessionStore((state) => state.token);
  const logout = useSessionStore((state) => state.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) {
    return null;
  }

  /**
   * 权限点用**会话里的那一份**（`Req-M1-2`：登录成功返回 `user.permissions`），
   * 而不是本地按角色再算一遍 `ROLE_PERMISSIONS[user.role]` ——
   * 后者是「前端自己算权限」，与服务端实际下发的授权可能不一致，
   * 而这类不一致正好会在排查越权时把人带偏（D-08：权限以主进程为准）。
   */
  const permissions = user.permissions;

  async function handleLogout() {
    await apiClient.invoke('/api/auth/logout', {}, token);
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="udm-user" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="udm-user__button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="udm-user__avatar" aria-hidden="true">
          {user.displayName.slice(0, 1)}
        </span>
        <span className="udm-user__meta">
          <span className="udm-user__name">{user.displayName}</span>
          <span className="udm-user__role">{ROLE_LABEL[user.role] ?? user.role}</span>
        </span>
        <IconChevronDown className={open ? 'udm-user__caret is-open' : 'udm-user__caret'} />
      </button>

      {open ? (
        <div className="udm-menu" role="menu" aria-label="用户菜单">
          <div className="udm-menu__head">
            <IconUser className="udm-menu__icon" />
            <div>
              <div className="udm-menu__title">{user.displayName}</div>
              <div className="udm-menu__sub">
                {user.username} · {ROLE_LABEL[user.role] ?? user.role}
              </div>
            </div>
          </div>
          <dl className="udm-kv udm-kv--flush udm-menu__kv">
            <div>
              <dt>
                <IconShield size={12} /> 权限点
              </dt>
              <dd>{permissions.length} 项</dd>
            </div>
            <div>
              <dt>适配器</dt>
              <dd>
                <code>{adapterKind}</code>
              </dd>
            </div>
          </dl>
          <button type="button" className="udm-menu__item" role="menuitem" onClick={() => void handleLogout()}>
            <IconLogout />
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
