/**
 * 待处理告警列表。
 *
 * 排序与状态口径在 `model/summary.ts`（未闭环优先、同级按严重度），组件只排版。
 * 每条给出「级别 / 类型 / 对象 / 状态」四要素与一处提示：告警必须能回答
 * 「谁出事了、多严重、该不该我现在动手」（`design.md` §4.8 的字段基线）。
 */
import { toneClass } from '../../domain/tone';
import type { AlertRow } from '../model/summary';

export interface AlertFeedProps {
  rows: AlertRow[];
  hidden: number;
  openCount: number;
}

export function AlertFeed({ rows, hidden, openCount }: AlertFeedProps) {
  if (rows.length === 0) {
    return (
      <div className="udm-empty">
        <p className="udm-empty__title">暂无告警</p>
        <p className="udm-empty__hint">告警由执行器与校验器上报；当前没有需要处理的记录。</p>
      </div>
    );
  }

  return (
    <>
      <ul className="udm-alerts">
        {rows.map((row) => (
          <li className={`udm-alerts__row${row.open ? '' : ' is-closed'}`} key={row.id}>
            <span className={`udm-alerts__level ${toneClass(row.tone)}`}>{row.levelLabel}</span>
            <div className="udm-alerts__body">
              <div className="udm-alerts__title">{row.typeLabel}</div>
              <div className="udm-alerts__object">{row.objectLabel}</div>
            </div>
            <span className="udm-badge">{row.statusLabel}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 || openCount > 0 ? (
        <p className="udm-list__more">
          {openCount > 0 ? `未闭环 ${openCount} 条` : '全部已闭环'}
          {hidden > 0 ? ` · 另有 ${hidden} 条未列出` : ''}
        </p>
      ) : null}
    </>
  );
}
