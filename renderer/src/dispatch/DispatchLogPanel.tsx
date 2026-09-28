/**
 * 调度日志（`GET /api/dispatch/logs`，`docs/api.md` §3.4.6 / Req-M4-6）。
 *
 * ## 为什么每一行都要有「小结」而不是只有时间与动作
 *
 * 日志的价值在于「事后能复核当时为什么那样派」。只写「预览 2026-09-26 08:05:00」，
 * 使用者还得去别处查这一批派了几单 —— 而正是「派 2/3 · 拒 1 · 代价 120.4 · 12ms」
 * 这一行数字让他判断得出「这条日志值不值得点开看」。
 *
 * ## 筛选一律**服务端**做
 *
 * 动作 / 策略筛选走请求参数，而不是在已取回的这一页里前端过滤 ——
 * 后者会得到「这一页里没有符合条件的结果」，而真正的结果在下一页，
 * 使用者会得出「这段时间没有重算过」的错误结论。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { DISPATCH_LOG_ACTIONS, DISPATCH_STRATEGY_SELECTIONS, DEFAULT_PAGE_SIZE } from '@udm/shared';
import type { DispatchLogListItem } from '@udm/shared';
import { usePagedList } from '../api/usePagedList';
import { IconRefresh } from '../components/icons';
import { DISPATCH_LOG_ACTION_LABEL } from '../domain/labels';
import { pageCountOf } from '../domain/paging';
import { logRowOf, strategyLabel } from './model';

interface Props {
  token: string | null;
  /** 外部的「有写入发生」信号：值变化即重新取数（预览 / 应用 / 重算之后）。 */
  revision: number;
}

export function DispatchLogPanel({ token, revision }: Props) {
  const [action, setAction] = useState('');
  const [strategy, setStrategy] = useState('');
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      ...(action ? { action } : {}),
      ...(strategy ? { strategy } : {})
    }),
    [action, page, strategy]
  );
  const logs = usePagedList<DispatchLogListItem>('/api/dispatch/logs', query, token);
  const { refresh } = logs;
  const skipFirst = useRef(true);
  /*
   * 外部的「有写入发生」信号：值一变就重新取数。
   *
   * 首帧跳过：`usePagedList` 挂载时本来就会取一次，这里再取一次等于**每次打开页面都发两个请求**
   * ——而这两个请求的结果完全一样。跳过第一次是这条 effect 唯一需要解释的地方。
   */
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    refresh();
  }, [revision, refresh]);
  const rows = logs.records.map(logRowOf);
  const pages = pageCountOf(logs.total, logs.pageSize || DEFAULT_PAGE_SIZE);

  return (
    <div>
      <div className="udm-dispatch__block-head">
        <h3 className="udm-dispatch__block-title">调度日志（最近 {logs.total} 条）</h3>
        <div className="udm-dispatch__toolbar">
          <label className="udm-sr-only" htmlFor="dispatch-log-action">
            动作筛选
          </label>
          <select
            id="dispatch-log-action"
            className="udm-list__select"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部动作</option>
            {DISPATCH_LOG_ACTIONS.map((value) => (
              <option key={value} value={value}>
                {DISPATCH_LOG_ACTION_LABEL[value]}
              </option>
            ))}
          </select>
          <label className="udm-sr-only" htmlFor="dispatch-log-strategy">
            策略筛选
          </label>
          <select
            id="dispatch-log-strategy"
            className="udm-list__select"
            value={strategy}
            onChange={(event) => {
              setStrategy(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部策略</option>
            {DISPATCH_STRATEGY_SELECTIONS.map((value) => (
              <option key={value} value={value}>
                {strategyLabel(value)}
              </option>
            ))}
          </select>
          <button type="button" className="udm-btn udm-btn--ghost" onClick={logs.refresh} disabled={logs.loading}>
            <IconRefresh /> 刷新
          </button>
        </div>
      </div>

      {logs.error ? (
        <div className="udm-alert" role="alert">
          {logs.error}
        </div>
      ) : null}

      {rows.length === 0 && !logs.loading ? (
        <div className="udm-empty">
          <p className="udm-empty__title">还没有调度日志</p>
          <p className="udm-empty__hint">预览、应用、手动指派与重算都会在这里留下一条可复核的记录</p>
        </div>
      ) : (
        <div className="udm-table__wrap">
          <table className="udm-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>动作</th>
                <th>策略</th>
                <th className="udm-table__num">任务</th>
                <th>小结</th>
                <th>原因</th>
                <th>操作者</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.time}</td>
                  <td>{row.action}</td>
                  <td>{row.strategy}</td>
                  <td className="udm-table__num">{row.taskCount}</td>
                  <td>{row.summary}</td>
                  <td className="udm-dispatch__reason">{row.reason}</td>
                  <td>{row.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="udm-list__foot">
        <span className="udm-list__count">
          共 <strong>{logs.total}</strong> 条 · 第 {page} / {pages} 页
          {/* 「更新中」贴在计数后面而不是替换表格：替换会让表格高度跳动（与任务页同一取舍） */}
          {logs.loading && rows.length > 0 ? ' · 更新中…' : ''}
        </span>
        <div className="udm-list__pager">
          <button
            type="button"
            className="udm-btn udm-btn--ghost"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
          >
            上一页
          </button>
          <button
            type="button"
            className="udm-btn udm-btn--ghost"
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
            disabled={page >= pages}
          >
            下一页
          </button>
        </div>
      </footer>
    </div>
  );
}
