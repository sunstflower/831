/**
 * 审计日志（M9，`design.md` §7.1 `/audit`）。
 *
 * ## 这一页为什么只有读
 *
 * 「审计只增不改不删」（Req-M9-1）。一个能改审计的系统，审计就不再是证据 ——
 * 因此这一页**没有**删除/编辑入口，主进程也没有对应的写接口（`domain/audit/` 里只有读）。
 *
 * ## 导出为什么在浏览器里也走一遍「下载」
 *
 * 契约写的是 `Content-Disposition: attachment`，但本地 IPC 形态没有响应头可放它，
 * 两种形态共用同一个信封 —— 因此契约把「文件名 + 正文」放进 `data`，由前端拼 `Blob`
 * 触发下载。这也是**契约的语义**（导出一个带文件名的 CSV），只是承载方式不同。
 */
import { useMemo, useState } from 'react';
import { AUDIT_MODULES, DEFAULT_PAGE_SIZE, hasPermission, type AuditLogItem } from '@udm/shared';
import { apiClient } from '../api';
import { usePagedList } from '../api/usePagedList';
import { IconAlert, IconAudit, IconDownload, IconRefresh } from '../components/icons';
import { AUDIT_MODULE_LABEL, OBJECT_TYPE_LABEL, ROLE_LABEL } from '../domain/labels';
import { pageSummary, shortTime } from '../ops/model';
import { useSessionStore } from '../store/session';
import '../ops/style/ops.css';

/**
 * 下载 CSV。
 *
 * `URL.revokeObjectURL` 必须调：Electron 里不释放会让这份内容一直挂在内存里，
 * 而审计导出动辄数千行。
 */
function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AuditPage() {
  const token = useSessionStore((state) => state.token);
  const user = useSessionStore((state) => state.user);
  const [module, setModule] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(
    () => ({ page, pageSize: DEFAULT_PAGE_SIZE, ...(module ? { module } : {}), ...(action ? { action } : {}) }),
    [page, module, action]
  );
  const list = usePagedList<AuditLogItem>('/api/audit/logs', query, token);
  const canExport = Boolean(user && hasPermission(user.role, 'audit:read'));

  async function exportCsv() {
    setExporting(true);
    setNotice(null);
    try {
      const result = await apiClient.invoke<{ filename: string; content: string; total: number }>(
        '/api/audit/logs/export',
        { ...(module ? { module } : {}), ...(action ? { action } : {}) },
        token
      );
      if (result.code !== 0) {
        setNotice(`导出失败：${result.message}`);
        return;
      }
      downloadCsv(result.data.filename, result.data.content);
      // 如实报告导出了多少条：`total` 可能大于 0 但小于预期（有上限），
      // 不说清楚的话使用者会以为文件里是全部记录
      setNotice(`已导出 ${result.data.total} 条（文件名 ${result.data.filename}）。`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="udm-page">
      <div className="udm-planned__head">
        <IconAudit className="udm-card__icon" />
        <h2 className="udm-card__title">审计日志</h2>
        <span className="udm-badge udm-badge--ok">查询与导出可用</span>
        <span className="udm-badge">只增不改不删</span>
      </div>
      <p className="udm-page__lead">
        全量操作留痕：谁在什么时候对哪个对象做了什么、结果如何、用了多久。
        每条都带 <code>traceId</code>，可与响应信封对上同一次请求。
      </p>

      <div className="udm-ops__filters" role="search">
        <label className="udm-field">
          <span>模块</span>
          <select value={module} onChange={(event) => { setModule(event.target.value); setPage(1); }}>
            <option value="">全部</option>
            {AUDIT_MODULES.map((value) => (
              <option key={value} value={value}>
                {AUDIT_MODULE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="udm-field">
          <span>动作</span>
          <input value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }} placeholder="如 create / apply" />
        </label>
        <button type="button" className="udm-btn udm-btn--ghost" onClick={list.refresh}>
          <IconRefresh />
          刷新
        </button>
        {canExport ? (
          <button type="button" className="udm-btn udm-btn--primary" disabled={exporting} onClick={() => void exportCsv()}>
            <IconDownload />
            {exporting ? '导出中…' : '导出 CSV'}
          </button>
        ) : null}
      </div>

      {notice ? (
        <div className="udm-list__banner udm-list__banner--ok" role="status">
          <span>{notice}</span>
        </div>
      ) : null}
      {list.error ? (
        <div className="udm-alert" role="alert">
          <IconAlert />
          <span>读取审计失败：{list.error}</span>
        </div>
      ) : null}

      <section className="udm-card">
        <header className="udm-card__head">
          <h3 className="udm-card__title">记录</h3>
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
              <p className="udm-empty__title">没有符合条件的记录</p>
              <p className="udm-empty__hint">清空筛选看全部；审计是按时间倒序的。</p>
            </div>
          ) : (
            <div className="udm-table__wrap">
              <table className="udm-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作者</th>
                    <th>角色</th>
                    <th>模块 / 动作</th>
                    <th>对象</th>
                    <th>结果</th>
                    <th>耗时</th>
                    <th>traceId</th>
                  </tr>
                </thead>
                <tbody>
                  {list.records.map((row) => (
                    <tr key={row.id}>
                      <td className="udm-table__num">{shortTime(row.ts)}</td>
                      <td>{row.actorName ?? '（系统）'}</td>
                      <td>{row.role ? ROLE_LABEL[row.role] : '—'}</td>
                      <td>
                        <code className="udm-ops__code">{row.module}</code> / <code className="udm-ops__code">{row.action}</code>
                      </td>
                      <td>
                        {row.objectType
                          ? `${OBJECT_TYPE_LABEL[row.objectType as keyof typeof OBJECT_TYPE_LABEL] ?? row.objectType}${row.objectId ? ` / ${row.objectId.slice(0, 8)}…` : ''}`
                          : '—'}
                      </td>
                      <td>
                        {row.result === 'success' ? (
                          <span className="udm-badge udm-badge--ok">成功</span>
                        ) : (
                          <span className="udm-badge udm-badge--danger" title={row.message ?? undefined}>
                            失败
                          </span>
                        )}
                      </td>
                      <td className="udm-table__num">{row.costMs} ms</td>
                      <td className="udm-ops__trace" title={row.traceId ?? undefined}>
                        {row.traceId ? `${row.traceId.slice(0, 8)}…` : '—'}
                      </td>
                    </tr>
                  ))}
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
    </div>
  );
}
