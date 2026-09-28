/**
 * 系统设置（M10，`design.md` §7.1 `/settings`）。
 *
 * ## 表单为什么是**按 schema 动态渲染**的
 *
 * 键目录的唯一作者是 `shared/src/constants.ts` 的 `SETTINGS_SCHEMA`：
 * 主进程按它校验、Mock 按它校验、这里按它渲染输入控件。
 * 手写九个 `<input>` 的后果是「加了一个设置项，只有后端知道」——
 * 而使用者打开设置页看不到它，只会继续用手工 SQL 去改库。
 *
 * ## 一次改一批
 *
 * `PATCH /api/settings` 的语义是「只改我提到的这些键」，因此页面维护一份草稿，
 * 点「保存」时只提交**真正被改过**的键（值与原值不同）——
 * 提交全部键会让「两个页面各改一个」变成后提交者覆盖前者。
 *
 * ## 为什么版本不写「重启生效」以外的承诺
 *
 * `design.md` §7.1 的说明就是「全局参数（重启生效）」。主进程读设置是在启动时，
 * 因此页面上如实标注：保存立即落库、部分参数要重启后才被读取。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  hasPermission,
  SETTINGS_SCHEMA,
  type SettingSchemaItem,
  type SettingsUpdateResult
} from '@udm/shared';
import { apiClient } from '../api';
import { useApiWrite } from '../api/useApiWrite';
import { IconAlert, IconCheck, IconRefresh, IconSettings } from '../components/icons';
import { useSessionStore } from '../store/session';
import '../ops/style/ops.css';

type Values = Record<string, unknown>;

/** 一个设置项的输入控件；`type` 决定形态（与 `SETTINGS_SCHEMA` 的取值一一对应）。 */
function SettingField({
  item,
  value,
  error,
  disabled,
  onChange
}: {
  item: SettingSchemaItem;
  value: unknown;
  error?: string;
  disabled: boolean;
  onChange: (next: unknown) => void;
}) {
  const id = `setting-${item.key}`;
  return (
    <div className={`udm-ops__setting${error ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>
        <span className="udm-ops__setting-label">{item.label}</span>
        <code className="udm-ops__code">{item.key}</code>
      </label>
      <div className="udm-ops__setting-input">
        {item.type === 'select' ? (
          <select id={id} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
            {(item.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : item.type === 'boolean' ? (
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
          />
        ) : item.type === 'number' ? (
          <input
            id={id}
            type="number"
            value={typeof value === 'number' ? value : ''}
            min={item.min}
            max={item.max}
            disabled={disabled}
            onChange={(event) => {
              // 空串必须映射成 `undefined` 而不是 0：把「清空了输入框」当成「设为 0」
              // 会静默写入一个使用者没打算要的值
              const raw = event.target.value;
              onChange(raw === '' ? undefined : Number(raw));
            }}
          />
        ) : (
          <input id={id} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        )}
        {item.unit ? <span className="udm-ops__unit">{item.unit}</span> : null}
      </div>
      {item.remark ? <p className="udm-ops__setting-remark">{item.remark}</p> : null}
      {error ? <p className="udm-ops__setting-error">{error}</p> : null}
    </div>
  );
}

export function SettingsPage() {
  const token = useSessionStore((state) => state.token);
  const user = useSessionStore((state) => state.user);
  const canWrite = Boolean(user && hasPermission(user.role, 'settings:write'));
  const [saved, setSaved] = useState<Values | null>(null);
  const [draft, setDraft] = useState<Values>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const write = useApiWrite(token);

  async function load() {
    setLoading(true);
    setNotice(null);
    const result = await apiClient.invoke<Values>('/api/settings', {}, token);
    if (result.code === 0) {
      setSaved(result.data);
      setDraft(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.message);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // 只在 token 变化时重取：`load` 每次渲染都是新函数，放进依赖会变成无限请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /** 被改过的键（值与已保存的不同）。用 `JSON.stringify` 比对，避免 `NaN` 与对象身份的问题。 */
  const changedKeys = useMemo(() => {
    if (!saved) {
      return [];
    }
    return SETTINGS_SCHEMA.map((item) => item.key).filter(
      (key) => JSON.stringify(saved[key]) !== JSON.stringify(draft[key])
    );
  }, [saved, draft]);

  async function save() {
    if (changedKeys.length === 0) {
      return;
    }
    setNotice(null);
    setFields({});
    const updates = Object.fromEntries(changedKeys.map((key) => [key, draft[key]]));
    const result = await write.run('/api/settings', 'PATCH', { updates }, '设置已保存');
    if (!result.ok) {
      setFields(result.fields);
      if (result.formError) {
        setNotice(result.formError);
      }
      return;
    }
    const data = result.data as SettingsUpdateResult | undefined;
    if (data) {
      setSaved(data.values);
      setDraft(data.values);
    }
    setNotice(`已保存 ${changedKeys.length} 项：${changedKeys.join('、')}。部分参数需要重启主进程后生效。`);
  }

  return (
    <div className="udm-page">
      <div className="udm-planned__head">
        <IconSettings className="udm-card__icon" />
        <h2 className="udm-card__title">系统设置</h2>
        {canWrite ? (
          <span className="udm-badge udm-badge--ok">可修改</span>
        ) : (
          <span className="udm-badge">只读（需要 settings:write）</span>
        )}
      </div>
      <p className="udm-page__lead">
        表单由 <code>SETTINGS_SCHEMA</code> 动态渲染，字段范围与主进程校验用的是同一份判据 ——
        这里能提交的，服务端一定放行。
      </p>

      {notice ? (
        <div className="udm-list__banner udm-list__banner--ok" role="status">
          <IconCheck />
          <span>{notice}</span>
        </div>
      ) : null}
      {loadError ? (
        <div className="udm-alert" role="alert">
          <IconAlert />
          <span>读取设置失败：{loadError}</span>
        </div>
      ) : null}

      <section className="udm-card">
        <header className="udm-card__head">
          <h3 className="udm-card__title">全局参数</h3>
          <span className="udm-card__aside">
            {changedKeys.length > 0 ? (
              <span className="udm-badge udm-badge--warn">{changedKeys.length} 项待保存</span>
            ) : (
              '无改动'
            )}
          </span>
        </header>
        <div className="udm-card__body">
          {loading ? (
            <div className="udm-empty" role="status">
              <span className="udm-spinner" aria-hidden="true" />
              <p className="udm-empty__title">正在加载…</p>
            </div>
          ) : (
            <div className="udm-ops__settings">
              {SETTINGS_SCHEMA.map((item) => (
                <SettingField
                  key={item.key}
                  item={item}
                  value={draft[item.key]}
                  error={fields[item.key]}
                  disabled={!canWrite || write.busy}
                  onChange={(next) => setDraft((prev) => ({ ...prev, [item.key]: next }))}
                />
              ))}
            </div>
          )}
        </div>
        <footer className="udm-card__foot">
          <button type="button" className="udm-btn udm-btn--ghost" onClick={() => void load()} disabled={write.busy}>
            <IconRefresh />
            放弃改动并重载
          </button>
          <button
            type="button"
            className="udm-btn udm-btn--primary"
            onClick={() => void save()}
            disabled={!canWrite || write.busy || changedKeys.length === 0}
          >
            保存改动
          </button>
        </footer>
      </section>
    </div>
  );
}
