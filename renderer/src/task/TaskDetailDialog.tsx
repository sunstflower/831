/**
 * 任务**详情弹层**（M3）。
 *
 * 为什么值得单独一个弹层：列表列宽有限，只能承载「一眼判断」的字段；
 * 而「这条任务为什么失败 / 取消 / 暂停」「当时按哪个计划跑的、路线多长」这些
 * 恰恰是复盘时要看的。契约里 `GET /api/tasks/{id}` 的四个附加块
 * （当前计划 / 路线 / 告警 / 最近操作）就是为这一屏准备的。
 *
 * 数据在**打开时才拉取**（`docs/api.md` §3.3.2），不随列表轮询：
 * 详情里含 5 条审计与关联告警，跟着列表每页拉一次会让翻页明显变慢，
 * 而使用者大多数时候并不看详情。
 *
 * 失败处理：与列表一致，把失败原因整条显示出来，而不是渲染一个空壳
 * （空壳会让人以为「这条任务没有计划和告警」——两件完全不同的事）。
 */
import { useEffect, useState } from 'react';
import { ApiClient } from '../api/client';
import { apiClient } from '../api';
import { IconAlert, IconClose } from '../components/icons';
import { formatDateTime, formatNumber, timeWindowText } from '../domain/format';
import {
  ALERT_LEVEL_LABEL,
  COST_METRIC_LABEL,
  TASK_ACTION_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  labelOf
} from '../domain/labels';
import { TASK_STATUS_TONE, badgeToneClass } from '../domain/tone';
import type { AlertLevel, TaskAction, TaskDetail } from '@udm/shared';

export interface TaskDetailDialogProps {
  taskId: string;
  token: string | null;
  onClose: () => void;
}

/** 详情里的「原因」字段：三种终态各有自己的列，用一张表把它们念成一句人话。 */
function reasonRows(detail: TaskDetail): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (detail.pauseReason) {
    rows.push({ label: '暂停原因', value: detail.pauseReason });
  }
  if (detail.cancelReason) {
    rows.push({ label: '取消原因', value: detail.cancelReason });
  }
  if (detail.failReason) {
    rows.push({ label: '失败原因', value: detail.failReason });
  }
  return rows;
}

export function TaskDetailDialog({ taskId, token, onClose }: TaskDetailDialogProps) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const client: ApiClient = apiClient;
      const result = await client.invoke<TaskDetail>(`/api/tasks/${taskId}`, {}, token);
      if (cancelled) {
        return;
      }
      if (result.code === 0) {
        setDetail(result.data);
      } else {
        setError(result.message);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [taskId, token]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const plan = detail?.currentPlan ?? null;
  const route = detail?.route ?? null;

  return (
    <div className="udm-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="udm-dialog" role="dialog" aria-modal="true" aria-label="任务详情">
        <header className="udm-dialog__head">
          <h2 className="udm-dialog__title">
            {detail ? `${detail.code} · ${detail.title}` : '任务详情'}
          </h2>
          {/* 无障碍名带上「详情」：弹层里还有一个「关闭」按钮，两个同名按钮读屏时分不清 */}
          <button type="button" className="udm-icon-btn" onClick={onClose} aria-label="关闭详情">
            <IconClose size={14} />
          </button>
        </header>

        <div className="udm-dialog__body udm-dialog__body--single">
          {error ? (
            <div className="udm-alert" role="alert">
              <IconAlert size={16} />
              <span>读取失败：{error}</span>
            </div>
          ) : !detail ? (
            <div className="udm-empty" role="status">
              <span className="udm-spinner" aria-hidden="true" />
              <p className="udm-empty__title">正在读取详情…</p>
            </div>
          ) : (
            <>
              <dl className="udm-kv udm-kv--stacked">
                <div>
                  <dt>状态</dt>
                  <dd>
                    <span className={`udm-badge ${badgeToneClass(TASK_STATUS_TONE[detail.status])}`}>
                      {labelOf(TASK_STATUS_LABEL, detail.status)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{labelOf(TASK_PRIORITY_LABEL, detail.priority)}</dd>
                </div>
                <div>
                  <dt>货物</dt>
                  <dd>
                    {formatNumber(detail.cargoKg)} kg
                    {detail.cargoDesc ? ` · ${detail.cargoDesc}` : ''}
                  </dd>
                </div>
                <div>
                  <dt>起终点</dt>
                  <dd>
                    {detail.fromSiteName ?? detail.fromSiteId} → {detail.toSiteName ?? detail.toSiteId}
                  </dd>
                </div>
                <div>
                  <dt>时间窗</dt>
                  <dd>{timeWindowText(detail.timeWindowStart, detail.timeWindowEnd)}</dd>
                </div>
                <div>
                  <dt>执行车辆</dt>
                  <dd>{detail.vehicleCode ?? '未指派'}</dd>
                </div>
                <div>
                  <dt>进度</dt>
                  <dd>{Math.round(detail.progress * 100)}%</dd>
                </div>
                <div>
                  <dt>创建</dt>
                  <dd>
                    {formatDateTime(detail.createdAt)}
                    {detail.createdBy ? ` · ${detail.createdBy}` : ''}
                  </dd>
                </div>
                {reasonRows(detail).map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd className="tone-warn">{row.value}</dd>
                  </div>
                ))}
              </dl>

              <section className="udm-task__section">
                <h3>当前计划</h3>
                {plan ? (
                  <dl className="udm-kv udm-kv--stacked">
                    <div>
                      <dt>车辆</dt>
                      <dd>{plan.vehicleCode ?? plan.vehicleId}</dd>
                    </div>
                    <div>
                      <dt>策略</dt>
                      <dd>{plan.strategy}</dd>
                    </div>
                    <div>
                      <dt>{COST_METRIC_LABEL}</dt>
                      <dd>{formatNumber(plan.cost)}</dd>
                    </div>
                    <div>
                      <dt>生效时间</dt>
                      <dd>{plan.appliedAt ? formatDateTime(plan.appliedAt) : '—'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="udm-form__help">还没有已生效的派发计划（未派发、已重派或被取消）。</p>
                )}
              </section>

              <section className="udm-task__section">
                <h3>路线</h3>
                {route ? (
                  <p className="udm-task__route">
                    {route.algorithm} · {formatNumber(route.distanceM)} m · {formatNumber(route.durationS)} s ·{' '}
                    {route.nodeCount} 节点 / {route.edgeCount} 边
                  </p>
                ) : (
                  <p className="udm-form__help">没有已保存的路线。</p>
                )}
              </section>

              <section className="udm-task__section">
                <h3>关联告警（{detail.alerts.length}）</h3>
                {detail.alerts.length > 0 ? (
                  <ul className="udm-task__alerts">
                    {detail.alerts.map((alert) => (
                      <li key={alert.id} className={`tone-${alertTone(alert.level)}`}>
                        {labelOf(ALERT_LEVEL_LABEL, alert.level)} · {alert.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="udm-form__help">没有未归档的告警。</p>
                )}
              </section>

              <section className="udm-task__section">
                <h3>最近操作</h3>
                {detail.auditSummaries.length > 0 ? (
                  <ul className="udm-task__audits">
                    {detail.auditSummaries.map((entry, index) => (
                      <li key={`${entry.ts}-${index}`}>
                        <span className="udm-task__audit-ts">{formatDateTime(entry.ts)}</span>
                        <span className="udm-task__audit-action">{auditActionText(entry.action)}</span>
                        <span className="udm-task__audit-actor">{entry.actorName ?? '—'}</span>
                        {entry.message ? <span className="udm-task__audit-msg">{entry.message}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="udm-form__help">没有操作记录。</p>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="udm-dialog__foot">
          <button type="button" className="udm-btn udm-btn--ghost" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 告警级别 → 色调（与工作台同一映射；这里只用于一行文字的颜色，因此就近写）。 */
function alertTone(level: AlertLevel): string {
  return level === 'critical' ? 'danger' : level === 'warning' ? 'warn' : 'info';
}

/**
 * 审计里的动作名 → 中文。
 *
 * 审计行由后端写（`action` 存的是机器值，如 `cancel` / `task.created`），
 * 界面必须给出可读说法。已知的动作走 `TASK_ACTION_LABEL`；
 * 其余（`task.created` 这类带前缀的）取最后一段再试一次，
 * 实在认不出就**原样回显** —— 显示一个机器值好过显示空白（`design.md` §7.2 第 6 条）。
 */
function auditActionText(action: string): string {
  const bare = action.includes('.') ? action.slice(action.lastIndexOf('.') + 1) : action;
  return bare in TASK_ACTION_LABEL ? TASK_ACTION_LABEL[bare as TaskAction] : action;
}
