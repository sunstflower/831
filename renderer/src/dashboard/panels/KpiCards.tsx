/**
 * 首屏四个指标卡。
 *
 * 排版决策：数值用最大字号（`--udm-font-2xl`）且等宽数字 —— 视线扫过一排数字时，
 * 等宽能让「3 / 100 / 1」对齐成列而不是各占宽窄；口径说明压到 footnote 字号，
 * 保证「看数字」优先、「看口径」按需。
 */
import { toneClass, type Kpi } from '../model/summary';

export interface KpiCardsProps {
  kpis: Kpi[];
}

export function KpiCards({ kpis }: KpiCardsProps) {
  return (
    <div className="udm-kpis">
      {kpis.map((kpi) => (
        <article className="udm-card udm-kpi" key={kpi.key}>
          <div className="udm-kpi__head">
            <span className="udm-kpi__label">{kpi.label}</span>
            <span className={`udm-dot ${toneClass(kpi.tone)}`} aria-hidden="true" />
          </div>
          <p className="udm-kpi__value">
            <span className={toneClass(kpi.tone)}>{kpi.value}</span>
            {kpi.suffix ? <span className="udm-kpi__suffix">{kpi.suffix}</span> : null}
          </p>
          <p className="udm-kpi__hint">{kpi.hint}</p>
        </article>
      ))}
    </div>
  );
}
