/**
 * 用户管理（M1 的管理界面，`design.md` §7.1 `/users`）。
 *
 * 登录链路在 M1 早期就已实现（`services/auth.ts`），这一页补的是**账号维护**：
 * 新建、停用/启用、重置密码、以及**改自己的密码**。
 *
 * ## 两条「别把自己锁在门外」的护栏在界面上也要看得见
 *
 * 禁止禁用自己、禁止禁用/降级最后一个启用的管理员（判据在主进程
 * `user.service.ts`，这里只是把按钮禁掉并说明原因）。**按钮禁用不等于安全边界**：
 * 服务端仍会独立校验（D-08），前端这么做只是为了让使用者不必先失败一次才知道。
 *
 * ## 密码只进不出
 *
 * 页面从不显示任何密码，重置密码后也只提示「已重置」——
 * 一个能把密码读出来的界面，等于把密码复制到一个没人会去轮换的地方。
 */
import { useMemo, useState } from 'react';
import { DEFAULT_PAGE_SIZE, ROLES, USER_STATUSES, hasPermission, type Role, type UserListItem } from '@udm/shared';
import { usePagedList } from '../api/usePagedList';
import { useApiWrite } from '../api/useApiWrite';
import { IconAlert, IconCheck, IconRefresh, IconUsers } from '../components/icons';
import { ROLE_LABEL } from '../domain/labels';
import { pageSummary, shortTime } from '../ops/model';
import { useSessionStore } from '../store/session';
import '../ops/style/ops.css';

const STATUS_LABEL: Record<string, string> = { active: '启用', disabled: '已停用' };

type Dialog =
  | { mode: 'create' }
  | { mode: 'edit'; row: UserListItem }
  | { mode: 'reset'; row: UserListItem }
  | { mode: 'password' }
  | null;

export function UsersPage() {
  const token = useSessionStore((state) => state.token);
  const current = useSessionStore((state) => state.user);
  const canManage = Boolean(current && hasPermission(current.role, 'user:manage'));
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const write = useApiWrite(token);

  const query = useMemo(
    () => ({ page, pageSize: DEFAULT_PAGE_SIZE, ...(keyword ? { keyword } : {}), ...(role ? { role } : {}) }),
    [page, keyword, role]
  );
  const list = usePagedList<UserListItem>('/api/users', query, token);

  /** 还有几个启用的管理员（用于判断「最后一个」）。只在当前页里数——够用，因为拦截在服务端。 */
  const activeAdmins = list.records.filter((row) => row.role === 'admin' && row.status === 'active').length;

  function open(dialogValue: Dialog, initial: Record<string, string> = {}) {
    setDialog(dialogValue);
    setForm(initial);
    setFields({});
    setFormError(null);
    setNotice(null);
  }

  async function submit() {
    setFields({});
    setFormError(null);
    setNotice(null);
    if (!dialog) {
      return;
    }
    if (dialog.mode === 'create') {
      const result = await write.run(
        '/api/users',
        'POST',
        { username: form.username ?? '', password: form.password ?? '', displayName: form.displayName ?? '', role: form.role ?? 'monitor' },
        '账号已创建'
      );
      if (!result.ok) {
        setFields(result.fields);
        setFormError(result.formError);
        return;
      }
      setNotice(`已创建账号 ${form.username}`);
      setDialog(null);
      list.refresh();
      return;
    }
    if (dialog.mode === 'edit') {
      const result = await write.run(
        `/api/users/${dialog.row.id}`,
        'PUT',
        { displayName: form.displayName ?? dialog.row.displayName, role: form.role ?? dialog.row.role },
        '已保存'
      );
      if (!result.ok) {
        setFields(result.fields);
        setFormError(result.formError);
        return;
      }
      setNotice(`已更新账号 ${dialog.row.username}`);
      setDialog(null);
      list.refresh();
      return;
    }
    if (dialog.mode === 'reset') {
      const result = await write.run(`/api/users/${dialog.row.id}/reset-password`, 'POST', { password: form.password ?? '' }, '密码已重置');
      if (!result.ok) {
        setFields(result.fields);
        setFormError(result.formError);
        return;
      }
      setNotice(`已重置 ${dialog.row.username} 的密码（新密码不再显示，请线下告知本人）`);
      setDialog(null);
      list.refresh();
      return;
    }
    // 改自己的密码：**不需要** user:manage（任何人都该能改自己的密码）
    const result = await write.run(
      '/api/users/me/password',
      'PUT',
      { oldPassword: form.oldPassword ?? '', newPassword: form.newPassword ?? '' },
      '密码已修改'
    );
    if (!result.ok) {
      setFields(result.fields);
      setFormError(result.formError);
      return;
    }
    setNotice('已修改本人密码，下次登录请使用新密码。');
    setDialog(null);
  }

  async function toggleStatus(row: UserListItem) {
    const next = row.status === 'active' ? 'disabled' : 'active';
    setNotice(null);
    const result = await write.run(`/api/users/${row.id}/status`, 'PATCH', { status: next }, '已更新状态');
    if (!result.ok) {
      setFormError(result.formError ?? Object.values(result.fields)[0] ?? '操作失败');
      return;
    }
    setNotice(`${row.username} 现在是「${STATUS_LABEL[next]}」`);
    list.refresh();
  }

  return (
    <div className="udm-page">
      <div className="udm-planned__head">
        <IconUsers className="udm-card__icon" />
        <h2 className="udm-card__title">用户管理</h2>
        <span className={`udm-badge ${canManage ? 'udm-badge--ok' : ''}`}>
          {canManage ? '可维护账号' : '只读（需要 user:manage）'}
        </span>
      </div>
      <p className="udm-page__lead">
        账号、角色与密码维护。停用与降级都有服务端护栏：不能停用自己，也不能让系统失去最后一个启用的管理员。
      </p>

      <div className="udm-ops__filters" role="search">
        <label className="udm-field">
          <span>关键词</span>
          <input value={keyword} onChange={(event) => { setKeyword(event.target.value); setPage(1); }} placeholder="用户名或显示名" />
        </label>
        <label className="udm-field">
          <span>角色</span>
          <select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}>
            <option value="">全部</option>
            {ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="udm-btn udm-btn--ghost" onClick={list.refresh}>
          <IconRefresh />
          刷新
        </button>
        <button type="button" className="udm-btn" onClick={() => open({ mode: 'password' }, { oldPassword: '', newPassword: '' })}>
          修改我的密码
        </button>
        {canManage ? (
          <button
            type="button"
            className="udm-btn udm-btn--primary"
            onClick={() => open({ mode: 'create' }, { username: '', password: '', displayName: '', role: 'monitor' })}
          >
            新建账号
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className="udm-list__banner udm-list__banner--ok" role="status">
          <IconCheck />
          <span>{notice}</span>
        </div>
      ) : null}
      {formError && !dialog ? (
        <div className="udm-alert" role="alert">
          <IconAlert />
          <span>{formError}</span>
        </div>
      ) : null}
      {list.error ? (
        <div className="udm-alert" role="alert">
          <IconAlert />
          <span>读取账号失败：{list.error}</span>
        </div>
      ) : null}

      <section className="udm-card">
        <header className="udm-card__head">
          <h3 className="udm-card__title">账号</h3>
          <span className="udm-card__aside">{pageSummary(list.total, list.page, list.pageSize)}</span>
        </header>
        <div className="udm-card__body udm-card__body--flush">
          {list.loading ? (
            <div className="udm-empty" role="status">
              <span className="udm-spinner" aria-hidden="true" />
              <p className="udm-empty__title">正在加载…</p>
            </div>
          ) : list.records.length === 0 ? (
            <div className="udm-empty">
              <p className="udm-empty__title">没有符合条件的账号</p>
            </div>
          ) : (
            <div className="udm-table__wrap">
              <table className="udm-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>显示名</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>最近登录</th>
                    {canManage ? <th>操作</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {list.records.map((row) => {
                    const isSelf = current?.id === row.id;
                    const lastAdmin = row.role === 'admin' && row.status === 'active' && activeAdmins <= 1;
                    return (
                      <tr key={row.id} className={isSelf ? 'is-selected' : undefined}>
                        <td>
                          {row.username}
                          {isSelf ? <span className="udm-ops__hint">（当前登录）</span> : null}
                        </td>
                        <td>{row.displayName}</td>
                        <td>{ROLE_LABEL[row.role]}</td>
                        <td>
                          <span className={`udm-badge ${row.status === 'active' ? 'udm-badge--ok' : ''}`}>
                            {STATUS_LABEL[row.status]}
                          </span>
                        </td>
                        <td className="udm-table__num">{shortTime(row.lastLoginAt)}</td>
                        {canManage ? (
                          <td className="udm-table__actions">
                            <button
                              type="button"
                              className="udm-btn udm-btn--ghost"
                              disabled={write.busy}
                              onClick={() => open({ mode: 'edit', row }, { displayName: row.displayName, role: row.role })}
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              className="udm-btn udm-btn--ghost"
                              disabled={write.busy}
                              onClick={() => open({ mode: 'reset', row }, { password: '' })}
                            >
                              重置密码
                            </button>
                            <button
                              type="button"
                              className="udm-btn udm-btn--ghost"
                              disabled={write.busy || isSelf || (row.status === 'active' && lastAdmin)}
                              // 禁用原因写在 title 里：一个点不动的按钮必须能解释自己
                              title={
                                isSelf
                                  ? '不能禁用当前登录的账号'
                                  : row.status === 'active' && lastAdmin
                                    ? '不能禁用最后一个启用的管理员'
                                    : undefined
                              }
                              onClick={() => void toggleStatus(row)}
                            >
                              {row.status === 'active' ? '停用' : '启用'}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <footer className="udm-card__foot">
          <button type="button" className="udm-btn udm-btn--ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            上一页
          </button>
          <button
            type="button"
            className="udm-btn udm-btn--ghost"
            disabled={page * list.pageSize >= list.total}
            onClick={() => setPage((value) => value + 1)}
          >
            下一页
          </button>
        </footer>
      </section>

      {dialog ? (
        <div className="udm-dialog" role="dialog" aria-modal="true">
          <div className="udm-dialog__head">
            <h3 className="udm-dialog__title">
              {dialog.mode === 'create'
                ? '新建账号'
                : dialog.mode === 'edit'
                  ? `编辑 ${dialog.row.username}`
                  : dialog.mode === 'reset'
                    ? `重置 ${dialog.row.username} 的密码`
                    : '修改我的密码'}
            </h3>
            <button type="button" className="udm-btn udm-btn--ghost" onClick={() => setDialog(null)}>
              取消
            </button>
          </div>
          <div className="udm-dialog__body udm-dialog__body--single">
            {dialog.mode === 'create' ? (
              <>
                <label className="udm-field">
                  <span>用户名</span>
                  <input value={form.username ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))} />
                  {fields['username'] ? <em className="udm-ops__setting-error">{fields['username']}</em> : null}
                </label>
                <label className="udm-field">
                  <span>显示名</span>
                  <input value={form.displayName ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))} />
                  {fields['displayName'] ? <em className="udm-ops__setting-error">{fields['displayName']}</em> : null}
                </label>
                <label className="udm-field">
                  <span>初始密码（6-32 位）</span>
                  <input type="password" value={form.password ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
                  {fields['password'] ? <em className="udm-ops__setting-error">{fields['password']}</em> : null}
                </label>
                <label className="udm-field">
                  <span>角色</span>
                  <select value={form.role ?? 'monitor'} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}>
                    {ROLES.map((value: Role) => (
                      <option key={value} value={value}>
                        {ROLE_LABEL[value]}
                      </option>
                    ))}
                  </select>
                  {fields['role'] ? <em className="udm-ops__setting-error">{fields['role']}</em> : null}
                </label>
              </>
            ) : null}

            {dialog.mode === 'edit' ? (
              <>
                <label className="udm-field">
                  <span>显示名</span>
                  <input value={form.displayName ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, displayName: event.target.value }))} />
                  {fields['displayName'] ? <em className="udm-ops__setting-error">{fields['displayName']}</em> : null}
                </label>
                <label className="udm-field">
                  <span>角色</span>
                  <select value={form.role ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}>
                    {ROLES.map((value: Role) => (
                      <option key={value} value={value}>
                        {ROLE_LABEL[value]}
                      </option>
                    ))}
                  </select>
                  {fields['role'] ? <em className="udm-ops__setting-error">{fields['role']}</em> : null}
                </label>
              </>
            ) : null}

            {dialog.mode === 'reset' ? (
              <label className="udm-field">
                <span>新密码（6-32 位）</span>
                <input type="password" value={form.password ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))} />
                {fields['password'] ? <em className="udm-ops__setting-error">{fields['password']}</em> : null}
              </label>
            ) : null}

            {dialog.mode === 'password' ? (
              <>
                <label className="udm-field">
                  <span>原密码</span>
                  <input type="password" value={form.oldPassword ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, oldPassword: event.target.value }))} />
                  {fields['oldPassword'] ? <em className="udm-ops__setting-error">{fields['oldPassword']}</em> : null}
                </label>
                <label className="udm-field">
                  <span>新密码（6-32 位）</span>
                  <input type="password" value={form.newPassword ?? ''} onChange={(event) => setForm((prev) => ({ ...prev, newPassword: event.target.value }))} />
                  {fields['newPassword'] ? <em className="udm-ops__setting-error">{fields['newPassword']}</em> : null}
                </label>
              </>
            ) : null}

            {formError ? (
              <div className="udm-alert" role="alert">
                <IconAlert />
                <span>{formError}</span>
              </div>
            ) : null}
          </div>
          <div className="udm-dialog__foot">
            <button type="button" className="udm-btn udm-btn--ghost" onClick={() => setDialog(null)}>
              取消
            </button>
            <button type="button" className="udm-btn udm-btn--primary" disabled={write.busy} onClick={() => void submit()}>
              确认
            </button>
          </div>
        </div>
      ) : null}

      {/* `USER_STATUSES` 目前只有两个取值；列出它让「状态」这个词在页面上有唯一来源 */}
      <p className="udm-sources__note">
        账号状态取值：{USER_STATUSES.map((value) => STATUS_LABEL[value]).join(' / ')}。
      </p>
    </div>
  );
}
