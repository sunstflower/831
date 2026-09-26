/**
 * 图层面板：预设 + 分组开关 + 单层开关 + 图例。
 *
 * 三类信息合并到一屏，是为了回答使用者的三个连续问题：
 * 「这是什么图」（图例）→「我想看哪一部分」（开关/预设）→「现在有多少」（计数）。
 * 原实现把这三件事拆成了右侧面板的三个段落，但没有任何分组，7 个复选框平铺；
 * 现在按「路网 / 设施 / 配送」分组，并提供三态分组开关（全亮/部分/全灭）。
 */
import { LAYER_GROUPS, LAYER_PRESETS, layersOfGroup } from '../model/layers';
import type { LayerVisibilityState } from '../hooks/useLayerVisibility';
import type { MapMetrics } from '../model/metrics';
import { IconLayers } from '../../components/icons';

export interface LayerPanelProps {
  state: LayerVisibilityState;
  metrics: MapMetrics;
}

/** 每个图层右侧显示的数量（用真实快照计数，不用图例里的静态说明）。 */
function countOf(key: string, metrics: MapMetrics): string {
  switch (key) {
    case 'netEdges':
      return `${metrics.edges}`;
    case 'netNodes':
      return `${metrics.nodes}`;
    case 'sites':
      return `${metrics.sites}`;
    case 'routeEdges':
      return `${metrics.routes}`;
    case 'taskEndpoints':
      return `${metrics.tasks}`;
    case 'orderEndpoints':
      return `${metrics.orderEndpoints}`;
    case 'vehicles':
      return `${metrics.vehicles}`;
    default:
      return '';
  }
}

export function LayerPanel({ state, metrics }: LayerPanelProps) {
  const { visibility, toggle, toggleGroup, isGroupVisible, isGroupMixed, applyPreset, setAll } = state;

  return (
    <aside className="udm-panel udm-layer-panel" aria-label="图层控制">
      <header className="udm-panel__head">
        <IconLayers className="udm-panel__icon" />
        <h2>图层</h2>
      </header>

      <div className="udm-layer-presets" role="group" aria-label="快速视图">
        {LAYER_PRESETS.map((preset) => (
          <button key={preset.key} type="button" className="udm-chip" onClick={() => applyPreset(preset.key)}>
            {preset.label}
          </button>
        ))}
      </div>

      {LAYER_GROUPS.map((group) => {
        const layers = layersOfGroup(group.key);
        const allOn = isGroupVisible(group.key);
        const mixed = isGroupMixed(group.key);
        return (
          <section key={group.key} className="udm-layer-group">
            <label className="udm-layer-group__head">
              <input
                type="checkbox"
                checked={allOn}
                ref={(node) => {
                  // indeterminate 只能通过 DOM 属性设置，不是 React 属性
                  if (node) {
                    node.indeterminate = mixed;
                  }
                }}
                onChange={() => toggleGroup(group.key)}
                aria-label={`${group.label}（整组切换）`}
              />
              <span className="udm-layer-group__title">{group.label}</span>
            </label>
            <ul className="udm-layer-list">
              {layers.map((layer) => (
                <li key={layer.key}>
                  <label className="udm-layer-item" title={layer.hint}>
                    <input
                      type="checkbox"
                      checked={visibility[layer.key]}
                      disabled={!layer.toggleable}
                      onChange={() => toggle(layer.key)}
                    />
                    <span className={`udm-swatch udm-swatch--${layer.tone}`} aria-hidden="true" />
                    <span className="udm-layer-item__label">{layer.label}</span>
                    <span className="udm-layer-item__count">{countOf(layer.key, metrics)}</span>
                    {!layer.toggleable ? <span className="udm-layer-item__lock" title="该图层常显">常显</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <div className="udm-layer-panel__actions">
        <button type="button" className="udm-btn udm-btn--ghost" onClick={() => setAll(true)}>
          全部显示
        </button>
        <button type="button" className="udm-btn udm-btn--ghost" onClick={() => setAll(false)}>
          仅看车辆
        </button>
      </div>

      <dl className="udm-kv">
        <div>
          <dt>未处理告警</dt>
          <dd className={metrics.newAlerts > 0 ? 'tone-danger' : 'tone-dim'}>{metrics.newAlerts}</dd>
        </div>
        <div>
          <dt>执行中任务</dt>
          <dd>{metrics.runningTasks} / {metrics.tasks}</dd>
        </div>
        <div>
          <dt>低电车辆</dt>
          <dd className={metrics.lowBatteryVehicles > 0 ? 'tone-warn' : 'tone-dim'}>{metrics.lowBatteryVehicles}</dd>
        </div>
      </dl>

      {/* 帮助使用者理解图例含义；颜色由 CSS 定义，这里只给语义 */}
      <p className="udm-layer-panel__note">
        图层开关只影响显示（页面态），不改变业务数据；关闭后重新打开，选中态与视口保持不变。
      </p>
    </aside>
  );
}
