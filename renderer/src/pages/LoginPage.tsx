/**
 * 登录页。
 * 演示账号（seed，见 `design.md` §3.7）：admin/admin123 · dispatcher/dispatcher123 · monitor/monitor123。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResult } from '@udm/shared';
import { apiClient, adapterKind } from '../api';
import { useSessionStore } from '../store/session';

export function LoginPage() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const login = useSessionStore((state) => state.login);
  const navigate = useNavigate();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await apiClient.invoke<LoginResult>('/api/auth/login', { username, password });
    setSubmitting(false);
    if (result.code !== 0) {
      setError(result.message);
      return;
    }
    login(result.data.token, result.data.user);
    navigate('/', { replace: true });
  }

  return (
    <div className="udm-login">
      <form className="udm-login__card" onSubmit={(event) => void handleSubmit(event)}>
        <h1>无人物流调度管理软件</h1>
        <p className="udm-login__hint">
          当前适配器：<code>{adapterKind}</code>
        </p>
        {error ? (
          <p className="udm-alert" role="alert">
            {error}
          </p>
        ) : null}
        <label className="udm-field">
          <span>用户名</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
        </label>
        <label className="udm-field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button type="submit" className="udm-login__submit" disabled={submitting}>
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
