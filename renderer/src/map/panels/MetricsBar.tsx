/**
 * 画布左上角的指标卡（KPI strip）。
 *
 * 为什么放在画布上而不是只在侧栏：使用者的注意力在图上，
 * 「有多少台车在执行、有多少告警没处理」必须**同屏**可见，
 * 否则每次都要把视线移到侧栏再移回来。官方示例（「Layouting / Panel」）
 * 就是用 `<Panel>` 承载这类画布内工具条。
 */
import { IconAlert, IconVehicle, IconTasks, IconLayers } from '../../components/icons';
import type { MapMetrics } from '../model/metrics';

export interface MetricsBarProps {
  metrics: MapMetrics;
  /** 实时连接状态（轮询兜底 vs 事件已到）。 */
  lastEventSeq: number;
  /** 当前缩放百分比（1 = 100%）。 */
  zoom: number;
}

export function MetricsBar({ metrics, lastEventSeq, zoom }: MetricsBarProps) {
  return (
    <div className="udm-metrics" aria-label="画布指标">
      <div className="udm-metric">
        <IconVehicle className="udm-metric__icon" />
        <span className="udm-metric__value">{metrics.vehicles}</span>
        <span className="udm-metric__label">车辆</span>
      </div>
      <div className="udm-metric">
        <IconTasks className="udm-metric__icon" />
        <span className="udm-metric__value">{metrics.runningTasks}</span>
        <span className="udm-metric__label">执行中</span>
      </div>
      <div className={metrics.newAlerts > 0 ? 'udm-metric is-danger' : 'udm-metric'}>
        <IconAlert className="udm-metric__icon" />
        <span className="udm-metric__value">{metrics.newAlerts}</span>
        <span className="udm-metric__label">未处理告警</span>
      </div>
      <div className="udm-metric udm-metric--dim">
        <IconLayers className="udm-metric__icon" />
        <span className="udm-metric__value">
          {metrics.nodes}/{metrics.edges}
        </span>
        <span className="udm-metric__label">节点/边</span>
      </div>
      <div className="udm-metric udm-metric--dim">
        <span className="udm-metric__value">{Math.round(zoom * 100)}%</span>
        <span className="udm-metric__label">缩放 · 事件 {lastEventSeq}</span>
      </div>
    </div>
  );
}
