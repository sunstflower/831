/**
 * 数据源与运行环境卡片。
 *
 * 为什么工作台要放这样一张「技术向」的卡片：本项目最贵的一类问题不是算错，
 * 而是**静默地拿着错的数据在跑** —— 打包后的 Electron 若默认落到 mock 适配器，
 * 界面一切正常但不读 SQLite（D-22）。把「数据来自哪个接口、哪个适配器、
 * 事件水位线到哪了、路网规模多少」摆在首屏，等于把这类问题从「事后排查」
 * 变成「一眼看见」。
 */
import { adapterKind } from '../../api';
import type { MapMetrics } from '../../map/model/metrics';

export interface SourceCardProps {
  metrics: MapMetrics;
  /** 事件日志水位线（D-24：来自 `sqlite_sequence`，只增不减）。 */
  lastEventSeq: number;
}

export function SourceCard({ metrics, lastEventSeq }: SourceCardProps) {
  return (
    <dl className="udm-kv udm-kv--flush udm-sources">
      <div>
        <dt>数据来源</dt>
        <dd>
          <code>GET /api/map/overview</code>
        </dd>
      </div>
      <div>
        <dt>适配器</dt>
        <dd>
          <code>{adapterKind}</code>
        </dd>
      </div>
      <div>
        <dt>刷新方式</dt>
        <dd>事件推送 + 1s 轮询兜底</dd>
      </div>
      <div>
        <dt>事件水位线</dt>
        <dd>{lastEventSeq}</dd>
      </div>
      <div>
        <dt>路网规模</dt>
        <dd>
          {metrics.nodes} 节点 · {metrics.edges} 边 · {metrics.sites} 站点
        </dd>
      </div>
      <div>
        <dt>路线</dt>
        <dd>
          生效 {metrics.activeRoutes} / 共 {metrics.routes}
        </dd>
      </div>
    </dl>
  );
}
