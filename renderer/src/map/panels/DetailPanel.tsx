/**
 * 选中对象详情卡（Req-M6-2 的「详情」一半）。
 *
 * 与原实现的差别：原来只有一句 `已选中：vehicle · AGV-01`，
 * 使用者点了一台车却看不到它的任务、电量、路线与告警 —— 等于「能点但不能用」。
 * 现在按对象类型给出结构化字段，并保留「无详情」的显式空态（不显示空卡）。
 *
 * 这一层**不引入新接口**：全部字段来自 `map/overview` 的同一份快照（Req-M6-5）。
 */
import { IconClose, IconTarget } from '../../components/icons';
import type { DetailCard } from '../model/detail';

export interface DetailPanelProps {
  card: DetailCard | null;
  /** 有选中对象但无法生成详情卡（例如 `settings` 类型）。 */
  hasSelection: boolean;
  onClear: () => void;
  onFocus: () => void;
}

export function DetailPanel({ card, hasSelection, onClear, onFocus }: DetailPanelProps) {
  if (!card) {
    return (
      <aside className="udm-panel udm-detail" aria-label="对象详情">
        <header className="udm-panel__head">
          <h2>对象详情</h2>
        </header>
        <p className="udm-detail__empty">
          {hasSelection ? '该对象在画布上没有可展示的详情。' : '未选中任何对象。点击地图上的车辆、任务起终点或站点查看详情。'}
        </p>
      </aside>
    );
  }

  return (
    <aside className="udm-panel udm-detail" aria-label="对象详情">
      <header className="udm-panel__head">
        <div className="udm-detail__title">
          <h2>{card.title}</h2>
          <span className="udm-detail__subtitle">{card.subtitle}</span>
        </div>
        <div className="udm-detail__actions">
          <button type="button" className="udm-icon-btn" onClick={onFocus} title="聚焦到该对象">
            <IconTarget />
            <span className="udm-sr-only">聚焦到该对象</span>
          </button>
          <button type="button" className="udm-icon-btn" onClick={onClear} title="取消选中">
            <IconClose />
            <span className="udm-sr-only">取消选中</span>
          </button>
        </div>
      </header>

      <dl className="udm-kv udm-kv--stacked">
        {card.rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.tone && row.tone !== 'default' ? `tone-${row.tone}` : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {card.alerts.length > 0 ? (
        <section className="udm-detail__alerts">
          <h3>关联告警（{card.alerts.length}）</h3>
          <ul>
            {card.alerts.map((alert) => (
              <li key={alert.id} className={`tone-${alert.tone}`}>
                {alert.label}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="udm-detail__ok">无关联告警</p>
      )}
    </aside>
  );
}
