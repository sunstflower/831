/**
 * 登录页（`Req-M1-1` / `Req-M1-3`）。
 *
 * 三个体验点，都是实打实减少来回的：
 * 1. **演示账号一键填入**：seed 里有三个角色账号（`design.md` §3.7），
 *    逐个手打用户名密码是最没必要的输入成本；按钮只填表单、不自动提交，
 *    使用者仍能看清自己将要提交什么。
 * 2. **适配器徽标**：当前跑在 `mock` / `ipc` / `http` 哪个形态决定了数据从哪来（D-22），
 *    登录页是排查「为什么数据不对」时的第一站。
 * 3. **失败原因原样透出**：登录失败的具体原因由服务端返回（用户不存在 / 密码错误 / 账号禁用，
 *    `Req-M1-1` 要求区分），前端不自己造一句笼统的「登录失败」把它盖掉。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResult } from '@udm/shared';
import { apiClient, adapterKind } from '../api';
import { useSessionStore } from '../store/session';
import { BrandMark } from '../components/BrandMark';
import { IconAlert, IconCheck, IconClock, IconShield } from '../components/icons';

/** seed 演示账号（来源：`design.md` §3.7 与 `shared/src/constants.ts` 的 `SEED_ACCOUNTS`）。 */
const DEMO_ACCOUNTS = [
  { username: 'admin', role: '系统管理员', hint: '全量权限' },
  { username: 'dispatcher', role: '调度员', hint: '调度执行' },
  { username: 'monitor', role: '监控员', hint: '只读 + 告警确认' }
];

const BRAND_POINTS = [
  { icon: IconCheck, title: '同图联动', text: '登录后即可看到路网、车辆、路线与告警在同一张画布上联动。' },
  { icon: IconShield, title: '权限双轨', text: '角色决定入口，服务端强制校验；越权请求会被直接拒绝。' },
  { icon: IconClock, title: '实时推送', text: '状态变化由领域事件驱动，另有轮询兜底，不会停在旧数据上。' }
];

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
    // 方法必须显式给：契约（`docs/api.md` §3.1.1）是 POST，
    // 而适配器不传方法时一律按 GET 发（`client.ts` 的 `HttpMethod` 注释），
    // 主进程按「方法 + 路径」索引，漏传会得到 `API.ROUTE_NOT_FOUND`（ISS-066）
    const result = await apiClient.invoke<LoginResult>('/api/auth/login', { username, password }, null, {
      method: 'POST'
    });
    setSubmitting(false);
    if (result.code !== 0) {
      setError(result.message);
      return;
    }
    login(result.data.token, result.data.user);
    navigate('/', { replace: true });
  }

  function fillDemo(account: string) {
    setUsername(account);
    // seed 的密码规则是「用户名 + 123」（`design.md` §3.7 的演示账号表）
    setPassword(`${account}123`);
    setError(null);
  }

  return (
    <div className="udm-login">
      <section className="udm-login__brand">
        <div className="udm-login__grid" aria-hidden="true" />
        <div className="udm-login__brandHead">
          <BrandMark size={38} />
          <div>
            <div className="udm-login__brandName">无人物流调度管理软件</div>
            <div className="udm-rail__sub">PARK LOGISTICS · FLEET OPS</div>
          </div>
        </div>
        <p className="udm-login__tagline">
          面向园区与仓储场景的无人车队调度台：任务、派发、路径、执行与异常，在同一处闭环。
        </p>
        <ul className="udm-login__points">
          {BRAND_POINTS.map((point) => (
            <li key={point.title}>
              <point.icon />
              <span>
                <strong>{point.title}</strong> — {point.text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="udm-login__panel">
        <form className="udm-login__form" onSubmit={(event) => void handleSubmit(event)}>
          <h1 className="udm-login__formTitle">登录</h1>
          <p className="udm-login__hint">
            当前适配器 <code>{adapterKind}</code>
            {adapterKind === 'mock' ? '（浏览器独立开发形态，数据来自前端 mock）' : '（已连接真实主进程数据）'}
          </p>

          {error ? (
            <p className="udm-alert" role="alert">
              <IconAlert />
              <span>{error}</span>
            </p>
          ) : null}

          <label className="udm-field">
            <span>用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
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

          <button type="submit" className="udm-btn udm-btn--primary udm-btn--block" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>

          <div className="udm-login__demo">
            <p className="udm-login__demoTitle">演示账号（点击填入表单，不会自动提交）</p>
            <div className="udm-login__demoRow">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.username}
                  type="button"
                  className="udm-chip"
                  onClick={() => fillDemo(account.username)}
                  title={`${account.role} · ${account.hint}`}
                >
                  {account.username}
                </button>
              ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  );
}
