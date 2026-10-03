/**
 * 告警中心（M8，`design.md` §7.1 `/alerts`）。
 *
 * 主能力是**闭环**：`new → acknowledged → processing → resolved → archived`
 * （`design.md` §4.8）。界面上只做三件事：
 *   1. 列出告警（类型 / 级别 / 状态 / 对象筛选 + 分页）；
 *   2. 对选中的那一条执行当前状态**允许**的操作（按钮由 `shared` 的状态机派生）；
 *   3. 详情里给出「建议下一步」（与人工接管返回的 `nextSteps` 同源）。
 *
 * ## 为什么操作按钮按状态渲染、而不是排一排禁用
 *
 * 一个点不动且不说原因的按钮比没有按钮更糟（ISS-010 的教训）。
 * `alertActionsOf(status)` 与主进程判的是同一份迁移表，因此**这里能点的、
 * 服务端一定放行**；反之服务端拒绝时也会在页面上给出原因（不是静默失败）。
 *
 * ## 为什么「解决」必须填说明
 *
 * 处置结论是这条告警唯一有价值的知识（「上次同类问题是怎么解决的」）。
 * 允许留空等于把它永久丢掉，因此按钮在输入框为空时是禁用的 ——
 * 而不是等提交后由服务端报错。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ALERT_LEVELS,
  ALERT_STATUSES,
  ALERT_TYPES,
  DEFAULT_PAGE_SIZE,
  OBJECT_TYPES,
  hasPermission,
  type AlertDetail,
  type AlertListItem,
  type AlertStatus,
  type PlanRiskReport
} from '@udm/shared';
import { Link } from 'react-router-dom';
import { apiClient } from '../api';
import { usePagedList } from '../api/usePagedList';
import { useApiWrite } from '../api/useApiWrite';
import { IconAlert, IconCheck, IconInfo, IconRefresh } from '../components/icons';
import { ALERT_LEVEL_LABEL, ALERT_STATUS_LABEL, ALERT_TYPE_LABEL, OBJECT_TYPE_LABEL } from '../domain/labels';
import { toneClass } from '../domain/tone';
import {
  ALERT_ACTION_LABEL,
  ALERT_ACTION_REQUIRES_NOTE,
  ALERT_TYPE_HINT,
  ackTargetsOf,
  actionsOf,
  alertActionNotice,
  alertAgeOf,
  batchAckNotice,
  isOpenAlert,
  pageSummary,
  shortTime
} from '../ops/model';
import { useSessionStore } from '../store/session';
import { RiskPanels } from '../ops/RiskPanels';
import '../ops/style/ops.css';

/** 级别 → 视觉色调（与地图/看板的 `tone-*` 一致，避免出现第二套配色语义）。 */
const LEVEL_TONE: Record<string, string> = {
  info: 'tone-info',
  warning: 'tone-warn',
  critical: 'tone-danger'
};

export function AlertsPage() {
  const token = useSessionStore((state) => state.token);
  const user = useSessionStore((state) => state.user);
  const [type, setType] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [objectType, setObjectType] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const write = useApiWrite(token);
  /*
   * 批量认领：异常常常是成批来的（一次断网让一片车同时心跳超时）。
   * 逐条点「认领」在真实处置里最容易整步跳过，而跳过认领，
   * 后面接手的人就看不出「这条已经有人在看了」。
   *
   * 这里不新增接口：逐条打已有的 `POST /api/alerts/:id/acknowledge`，
   * 因此**权限与状态机校验完全复用**，不会绕过服务端。
   */
  const [nowMs] = useState(() => Date.now());

  /*
   * 风险预检（`GET /api/alerts/risks`）：与告警列表**分开取**。
   *
   * 为什么不合进列表接口：两者回答不同的问题，且刷新时机不同 —— 告警列表按筛选与分页取，
   * 预检是「当前世界的全量扫描」，没有分页也没有筛选（分页会让使用者以为
   * 「这一页没有冲突」，而冲突在第二页）。
   */
  const [risks, setRisks] = useState<PlanRiskReport | null>(null);
  const [riskError, setRiskError] = useState<string | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskRevision, setRiskRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setRiskLoading(true);
    void apiClient
      .invoke<PlanRiskReport>('/api/alerts/risks', {}, token)
      .then((result) => {
        if (cancelled) return;
        if (result.code === 0) {
          setRisks(result.data);
          setRiskError(null);
        } else {
          setRiskError(result.message);
        }
      })
      .finally(() => {
        if (!cancelled) setRiskLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, riskRevision]);


  const query = useMemo(
    () => ({
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      ...(type ? { type } : {}),
      ...(level ? { level } : {}),
      ...(status ? { status } : {}),
      ...(objectType ? { objectType } : {})
    }),
    [page, type, level, status, objectType]
  );
  const list = usePagedList<AlertListItem>('/api/alerts', query, token);
  const ackTargets = useMemo(() => ackTargetsOf(list.records), [list.records]);

  /** 详情单独取：列表项没有 `detail` / `related` / 建议（契约 §3.8.2）。 */
  const loadDetail = useCallback(
    async (id: string) => {
      const result = await apiClient.invoke<AlertDetail>(`/api/alerts/${id}`, {}, token);
      if (result.code === 0) {
        setDetail(result.data);
        setActionError(null);
      } else {
        setDetail(null);
        setActionError(result.message);
      }
    },
    [token]
  );

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  // 列表刷新（例如状态变了）时把详情对齐到最新状态，否则按钮会按旧状态渲染
  useEffect(() => {
    const row = list.records.find((item) => item.id === selectedId);
    if (row && detail && row.status !== detail.status) {
      void loadDetail(row.id);
    }
  }, [list.records, selectedId, detail, loadDetail]);

  const canWrite = Boolean(user && hasPermission(user.role, 'alert:ack'));
  const actions = detail ? actionsOf(detail.status) : [];

  /** 一键认领本页所有 `new` 告警，并**分开**报出成功与失败。 */
  async function runBatchAck() {
    if (ackTargets.length === 0) {
      setNotice(batchAckNotice(0, 0));
      return;
    }
    setNotice(null);
    setActionError(null);
    setBusy(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const id of ackTargets) {
        const result = await apiClient.invoke(`/api/alerts/${id}/acknowledge`, { note: '' }, token, { method: 'POST' });
        if (result.code === 0) {
          succeeded += 1;
        } else {
          failed += 1;
        }
      }
    } finally {
      setBusy(false);
    }
    setNotice(batchAckNotice(succeeded, failed));
    // 详情对齐到最新状态：被认领的那一条如果正开着详情，按钮必须跟着变
    if (selectedId) {
      void loadDetail(selectedId);
    }
    list.refresh();
    // 认领只改告警状态，不改派发 —— 预检不必重扫（省一次全量查询）

  }

  async function runAction(action: 'acknowledge' | 'resolve' | 'archive') {
    if (!detail) {
      return;
    }
    setNotice(null);
    setActionError(null);
    const payload: Record<string, unknown> = ALERT_ACTION_REQUIRES_NOTE[action] ? { resolution: note } : { note };
    const result = await write.run(`/api/alerts/${detail.id}/${action}`, 'POST', payload, '操作成功');
    if (!result.ok) {
      // 优先显示**字段级**原因（`resolve` 缺处置结论时它才是有用的那一句），
      // 没有字段可归属再用整表文案
      setActionError(Object.values(result.fields)[0] ?? result.formError ?? '操作失败');
      return;
    }
    const next = (result.data as { status?: AlertStatus } | undefined)?.status ?? detail.status;
    setNotice(alertActionNotice(action, next));
    setNote('');
    // 先刷自己（详情），再刷列表：顺序反过来的话，列表先变而详情还是旧状态，
    // 按钮会在一瞬间显示成「还能再点一次」
    await loadDetail(detail.id);
    list.refresh();
  }

  return (
    <div className="udm-page">
      <div className="udm-planned__head">
        <IconAlert className="udm-card__icon" />
        <h2 className="udm-card__title">告警中心</h2>
        <span className="udm-badge udm-badge--ok">生成 · 确认 · 处置 · 归档可用</span>
      </div>
      <p className="udm-page__lead">
        异常事件按类型归类并留痕。选中一条告警即可执行当前状态允许的操作 ——
        能点的按钮与服务端判的是同一份状态机。
      </p>

      <div className="udm-ops__filters" role="search">
        <label className="udm-field">
          <span>类型</span>
          <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
            <option value="">全部</option>
            {ALERT_TYPES.map((value) => (
              <option key={value} value={value}>
                {ALERT_TYPE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="udm-field">
          <span>级别</span>
          <select value={level} onChange={(event) => { setLevel(event.target.value); setPage(1); }}>
            <option value="">全部</option>
            {ALERT_LEVELS.map((value) => (
              <option key={value} value={value}>
                {ALERT_LEVEL_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="udm-field">
          <span>状态</span>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">全部</option>
            {ALERT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {ALERT_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="udm-field">
          <span>对象</span>
          <select value={objectType} onChange={(event) => { setObjectType(event.target.value); setPage(1); }}>
            <option value="">全部</option>
            {OBJECT_TYPES.map((value) => (
              <option key={value} value={value}>
                {OBJECT_TYPE_LABEL[value as keyof typeof OBJECT_TYPE_LABEL] ?? value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="udm-btn udm-btn--ghost"
          onClick={() => {
            list.refresh();
            // 预检是「当前世界的全量扫描」，与列表筛选无关：刷新时一起重扫，
            // 否则会出现「刚改完派发，风险区块还停在旧结论」
            setRiskRevision((value) => value + 1);
          }}
        >
          <IconRefresh />
          刷新
        </button>
        {canWrite ? (
          <button
            type="button"
            className="udm-btn"
            disabled={busy || write.busy || ackTargets.length === 0}
            title={ackTargets.length === 0 ? '本页没有待确认的告警' : `逐条调用认领接口，共 ${ackTargets.length} 条`}
            onClick={() => void runBatchAck()}
          >
            批量认领本页待确认（{ackTargets.length}）
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className="udm-list__banner udm-list__banner--ok" role="status">
          <IconCheck />
          <span>{notice}</span>
        </div>
      ) : null}
      {list.error ? (
        <div className="udm-alert" role="alert">
          <IconAlert />
          <span>读取告警失败：{list.error}</span>
        </div>
      ) : null}

      <RiskPanels
        report={risks}
        loading={riskLoading}
        error={riskError}
        onRefresh={() => setRiskRevision((value) => value + 1)}
      />

      <div className="udm-ops__split">
        <section className="udm-card" aria-label="告警列表">
          <header className="udm-card__head">
            <h3 className="udm-card__title">告警列表</h3>
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
                <p className="udm-empty__title">没有符合条件的告警</p>
                <p className="udm-empty__hint">换一个筛选条件，或清空筛选看全部。</p>
              </div>
            ) : (
              <div className="udm-table__wrap">
                <table className="udm-table">
                  <thead>
                    <tr>
                      <th>级别</th>
                      <th>类型</th>
                      <th>消息</th>
                      <th>状态</th>
                      <th>停滞</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.records.map((row) => {
                      const age = alertAgeOf(row, nowMs);
                      // 严重 + 仍在流程里 → 整行加一层提醒：真正烧起来的那几条要一眼看到
                      const attention = age.open && row.level === 'critical';
                      return (
                        <tr
                          key={row.id}
                          className={[
                            row.id === selectedId ? 'is-selected' : undefined,
                            attention ? 'udm-ops__row--attention' : undefined
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined}
                          onClick={() => setSelectedId(row.id)}
                        >
                          <td>
                            <span className={`udm-badge ${LEVEL_TONE[row.level] ?? ''}`}>{ALERT_LEVEL_LABEL[row.level]}</span>
                          </td>
                          <td>{ALERT_TYPE_LABEL[row.type]}</td>
                          <td>{row.message}</td>
                          <td>{ALERT_STATUS_LABEL[row.status]}</td>
                          <td className="udm-table__num">
                            {age.text === '—' ? (
                              '—'
                            ) : (
                              <span className={age.stale ? 'udm-ops__age udm-ops__age--stale' : 'udm-ops__age'}>{age.text}</span>
                            )}
                          </td>
                          <td className="udm-table__num">{shortTime(row.createdAt)}</td>
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

        <section className="udm-card" aria-label="告警详情">
          <header className="udm-card__head">
            <h3 className="udm-card__title">详情与处置</h3>
            {detail ? <span className="udm-card__aside">{ALERT_STATUS_LABEL[detail.status]}</span> : null}
          </header>
          <div className="udm-card__body">
            {!selectedId ? (
              <div className="udm-empty">
                <p className="udm-empty__title">未选中告警</p>
                <p className="udm-empty__hint">点左侧任意一行查看详情与可执行的操作。</p>
              </div>
            ) : !detail ? (
              <div className="udm-empty" role="status">
                <span className="udm-spinner" aria-hidden="true" />
                <p className="udm-empty__title">正在加载详情…</p>
              </div>
            ) : (
              <>
                <dl className="udm-kv">
                  <div>
                    <dt>消息</dt>
                    <dd>{detail.message}</dd>
                  </div>
                  <div>
                    <dt>类型</dt>
                    <dd>
                      {ALERT_TYPE_LABEL[detail.type]}
                      <span className="udm-ops__hint">（{ALERT_TYPE_HINT[detail.type]}）</span>
                    </dd>
                  </div>
                  <div>
                    <dt>对象</dt>
                    <dd>
                      {/*
                        可直接跳到那一页去处置：告警页只回答「哪里不对」，
                        真正要动手的地方是任务管理 / 基础数据（车辆的停用启用在那里）。
                      */}
                      {detail.related.task ? (
                        <>
                          任务 <Link to="/tasks">{detail.related.task.code}</Link> · {detail.related.task.title}
                        </>
                      ) : detail.related.vehicle ? (
                        <>
                          车辆 <Link to="/base-data">{detail.related.vehicle.code}</Link> · {detail.related.vehicle.name}
                        </>
                      ) : (
                        `${detail.objectType}${detail.objectId ? ` / ${detail.objectId}` : ''}（关联对象已不存在）`
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>创建 / 认领 / 解决</dt>
                    <dd>
                      {shortTime(detail.createdAt)} · {shortTime(detail.ackAt)} · {shortTime(detail.resolveAt)}
                    </dd>
                  </div>
                  {detail.resolution ? (
                    <div>
                      <dt>处置结论</dt>
                      <dd>{detail.resolution}</dd>
                    </div>
                  ) : null}
                </dl>

                <div className="udm-ops__next" role="note">
                  <IconInfo />
                  <div>
                    <strong>建议下一步</strong>
                    <ul>
                      {detail.suggestedNextSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {canWrite && actions.length > 0 ? (
                  <div className="udm-ops__actions">
                    {actions.some((action) => ALERT_ACTION_REQUIRES_NOTE[action]) ? (
                      <label className="udm-field">
                        <span>{detail.status === 'acknowledged' || detail.status === 'processing' ? '处置结论（必填）' : '备注'}</span>
                        <input
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="例如：已重启车辆并恢复心跳"
                        />
                      </label>
                    ) : null}
                    <div className="udm-ops__buttons">
                      {actions.map((action) => {
                        const blocked = ALERT_ACTION_REQUIRES_NOTE[action] && note.trim().length === 0;
                        return (
                          <button
                            key={action}
                            type="button"
                            className={action === 'resolve' ? 'udm-btn udm-btn--primary' : 'udm-btn'}
                            disabled={write.busy || blocked}
                            title={blocked ? '必须先填写处置结论' : undefined}
                            onClick={() => void runAction(action)}
                          >
                            {ALERT_ACTION_LABEL[action]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="udm-sources__note">
                    {canWrite ? '这条告警当前状态没有可执行的操作（已归档）。' : '当前账号没有处置告警的权限（需要 alert:ack）。'}
                  </p>
                )}
                {actionError ? (
                  <div className="udm-alert" role="alert">
                    <IconAlert />
                    <span>{actionError}</span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
