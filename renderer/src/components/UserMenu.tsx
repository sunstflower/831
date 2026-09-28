/**
 * 顶栏用户菜单。
 *
 * 为什么做成下拉而不只是「名字 + 退出按钮」：会话信息里有三样东西使用者需要时**必须能找到**
 * —— 当前角色、这一角色实际拿到了哪些权限点、以及当前跑在哪个适配器上（D-22 明确
 * 要求不能让桌面端静默显示 mock 数据；把适配器放在随手可见处是最便宜的防线）。
 * 全铺在顶栏会让栏高失控，因此收进下拉。
 *
 * 交互按原生弹层的「最小正确集」实现（本项目不引第三方 UI 库）：
 * 点击外部关闭、Esc 关闭并把焦点送回触发按钮、`aria-haspopup` / `aria-expanded` / `aria-controls` 标注、
 * 方向键在菜单项之间移动焦点、Home / End 跳到首尾、Tab 关闭菜单并把焦点交接给菜单外的相邻元素。
 *
 * 为什么方向键是**必需**而不是锦上添花：菜单项按 ARIA 的 roving focus 带 `tabindex="-1"`
 * （Tab 只停在触发按钮上），没有方向键，键盘用户就根本进不去菜单。
 */
// 显式改名：`KeyboardEvent` 同时也是 DOM 全局类型，而本文件下面还要用它写
// `document.addEventListener('keydown', …)` 的回调 —— 直接叫同名会把那个类型遮蔽掉
// （实测：`tsc` 报 TS2769，而 `vite build` 不做类型检查、照样通过）。
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@udm/shared';
import { apiClient, adapterKind } from '../api';
import { useSessionStore } from '../store/session';
import { IconChevronDown, IconLogout, IconShield, IconUser } from './icons';

/** 菜单容器 id：触发按钮的 `aria-controls` 指向它。 */
const MENU_ID = 'udm-user-menu';

/**
 * 可作为 Tab 落点的元素。
 *
 * 刻意保持朴素（只覆盖本外壳用到的 `a` / `button` / `input` / 显式 `tabindex`），
 * 不去追完整的「可聚焦元素」定义 —— 后者要考虑 `visibility`、`fieldset[disabled]`、
 * `<details>` 等分支，为一次焦点交接引入那些知识不划算。
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  /**
   * 「键盘打开菜单时该聚焦哪一项」的待办标记。
   * 打开菜单的那次按键发生在菜单挂载**之前**，此时 DOM 里还没有菜单项可聚焦，
   * 因此先记下意图、等 `open` 变 true 的渲染提交后再聚焦。
   */
  const pendingFocus = useRef<'first' | 'last' | null>(null);

  /** 当前菜单里的可操作项（取列表而不写死下标，避免后续加项时漏改）。 */
  function items(): HTMLElement[] {
    return Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  /** 把焦点交接给菜单之外的相邻可聚焦元素（Tab 关闭菜单时用，见 `onKeyDown`）。 */
  function focusOutside(backwards: boolean) {
    const trigger = buttonRef.current;
    if (!trigger) {
      return;
    }
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !rootRef.current?.contains(element) && !element.hasAttribute('hidden')
    );
    const target = (backwards ? [...candidates].reverse() : candidates).find((element) =>
      backwards
        ? Boolean(element.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING)
        : Boolean(trigger.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
    target?.focus();
  }

  /**
   * 键盘语义。挂在**外层容器**上而不是菜单本身：这样焦点还在触发按钮上时按方向键也能开菜单，
   * 不必区分「按键发生在打开前还是打开后」。
   */
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const list = items();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        pendingFocus.current = event.key === 'ArrowDown' ? 'first' : 'last';
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const current = list.indexOf(document.activeElement as HTMLElement);
      // 焦点不在菜单内（例如鼠标点开后停在触发按钮上）时，从首项/末项进入而不是原地不动
      const next =
        current === -1 ? (step === 1 ? 0 : list.length - 1) : (current + step + list.length) % list.length;
      list[next]?.focus();
      return;
    }
    if (!open) {
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? list[0] : list[list.length - 1])?.focus();
      return;
    }
    if (event.key === 'Tab') {
      // 菜单项马上要被卸载：不先把焦点接出去，焦点就会掉到 <body>（键盘用户当场迷失位置）
      event.preventDefault();
      setOpen(false);
      focusOutside(event.shiftKey);
    }
  }

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

  // 菜单挂载完成后再落焦点（见 `pendingFocus` 的注释）
  useEffect(() => {
    if (!open || pendingFocus.current === null) {
      return;
    }
    const list = items();
    const target = pendingFocus.current === 'first' ? list[0] : list[list.length - 1];
    pendingFocus.current = null;
    target?.focus();
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
    await apiClient.invoke('/api/auth/logout', {}, token, { method: 'POST' });
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="udm-user" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={buttonRef}
        className="udm-user__button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
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
        <div className="udm-menu" id={MENU_ID} role="menu" aria-label="用户菜单">
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
          <button
            type="button"
            className="udm-menu__item"
            role="menuitem"
            tabIndex={-1}
            onClick={() => void handleLogout()}
          >
            <IconLogout />
            退出登录
          </button>
        </div>
      ) : null}
    </div>
  );
}
