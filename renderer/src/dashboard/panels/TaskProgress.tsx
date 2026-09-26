/**
 * 任务执行进度列表。
 *
 * 每条显示「编码 / 状态 / 起终点 / 执行车辆 / 进度条 + 百分比」——
 * 这一组字段正好回答「这个任务在做什么、走到哪、谁在做」，缺任何一项都要跳页去查。
 *
 * 进度条对 `draft` 这类**还没开始**的状态不显示：画一条 0% 的空槽会让人以为「卡住了」，
 * 而它的真实语义是「尚未派发」。
 */
import { toneClass, type TaskRow } from '../model/summary';

export interface TaskProgressProps {
  rows: TaskRow[];
  hidden: number;
}

/** 只有进入执行链的状态才画进度条。 */
const PROGRESS_STATES = new Set(['assigned', 'running', 'paused', 'finished']);

export function TaskProgress({ rows, hidden }: TaskProgressProps) {
  if (rows.length === 0) {
    return (
      <div className="udm-empty">
        <p className="udm-empty__title">暂无任务</p>
        <p className="udm-empty__hint">
          任务由「任务管理」创建或导入后产生；M3 尚未实现，当前演示数据来自 seed。
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="udm-tasks">
        {rows.map((row) => (
          <li className="udm-tasks__row" key={row.id}>
            <div className="udm-tasks__head">
              <span className="udm-tasks__code">{row.code}</span>
              <span className={`udm-badge ${toneClass(row.tone, 'udm-badge')}`}>{row.statusLabel}</span>
              <span className="udm-tasks__vehicle">
                {row.vehicleCode ? `车辆 ${row.vehicleCode}` : '未指派车辆'}
              </span>
            </div>
            <div className="udm-tasks__route">
              <span>{row.fromCode}</span>
              <span className="udm-tasks__arrow" aria-hidden="true">
                →
              </span>
              <span>{row.toCode}</span>
            </div>
            {PROGRESS_STATES.has(row.status) ? (
              <div className="udm-tasks__progress">
                <div className={`udm-progress ${toneClass(row.tone, 'udm-progress--')}`}>
                  <div className="udm-progress__fill" style={{ width: `${row.percent}%` }} />
                </div>
                <span className="udm-tasks__percent">{row.percent}%</span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className="udm-list__more">另有 {hidden} 条任务未在此列出</p> : null}
    </>
  );
}
