/**
 * 地图页容器。
 *
 * 职责边界（D-21）：
 * - 只渲染 `map/overview` 提供的数据，**不自行搜索路径**（路径权威在 M5，自行搜索会绕过禁行规则）；
 * - 选中态写入全局 `selection`（与列表联动），图层开关与缩放是页面态；
 * - 车辆位置用 `updateNode` **定向更新**，绝不重建 `nodes` 数组 —— 否则 React Flow
 *   会把全部节点/边重挂载（实测表现为边直接不渲染）。
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ReactFlowProvider, useReactFlow, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style/map.css';

import { FlowCanvas } from './stage/FlowCanvas';
import { toFlow } from './model/toFlow';
import { LAYERS } from './model/layers';
import { useMapOverview } from './hooks/useMapOverview';
import { useLayerVisibility } from './hooks/useLayerVisibility';
import { useVehicleMotion } from './hooks/useVehicleMotion';
import { useSelectionSync } from './hooks/useSelectionSync';
import { useSessionStore } from '../store/session';
import { useSelectionStore } from '../store/selection';
import { vehicleNodeId } from './model/ids';
import type { ObjectType } from '@udm/shared';
import type { XY } from './model/motion';

function MapCanvas() {
  const token = useSessionStore((state) => state.token);
  const { visibility, toggle, setAll } = useLayerVisibility();
  const { overview, loading, error, lastEventSeq, positionsRef, statusRevision } = useMapOverview(token);
  const selected = useSelectionStore((state) => state.selected);
  const select = useSelectionStore((state) => state.select);
  const clearSelection = useSelectionStore((state) => state.clear);
  const { updateNode } = useReactFlow();

  /**
   * 图结构（节点/边）只在「快照 / 图层 / 选中 / 运行态」变化时重建。
   * 车辆**位置**刻意不在此依赖里：位置走 `updateNode` 定向更新。
   * `statusRevision` 只在状态或电量真的变化时自增（低频），用于刷新车辆节点的徽标。
   */
  const graph = useMemo(
    () =>
      overview
        ? toFlow(overview, visibility, selected, positionsRef.current ?? {})
        : { nodes: [] as Node[], edges: [] },
    // positionsRef 是 ref，故意不进依赖：位置不参与图重建
    [overview, visibility, selected, statusRevision]
  );

  // 补帧只改车辆节点的 position，不触发上面的 useMemo
  const handleMotionFrame = useCallback(
    (positions: Record<string, XY>) => {
      for (const [vehicleId, xy] of Object.entries(positions)) {
        updateNode(vehicleNodeId(vehicleId), { position: xy });
      }
    },
    [updateNode]
  );
  useVehicleMotion({ onFrame: handleMotionFrame, sourceRef: positionsRef });

  useSelectionSync();

  // 首次拿到数据时把视口对准整张图
  const fittedRef = useRef(false);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (graph.nodes.length > 0 && !fittedRef.current) {
      fittedRef.current = true;
      void fitView({ padding: 0.25, maxZoom: 1.6, duration: 0 });
    }
  }, [graph.nodes.length, fitView]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as { entityType?: ObjectType; entityId?: string; code?: string; name?: string };
      if (!data.entityType || !data.entityId) {
        return;
      }
      select({
        entityType: data.entityType,
        entityId: data.entityId,
        flowId: node.id,
        label: data.code ?? data.name ?? data.entityId
      });
    },
    [select]
  );

  if (error) {
    return (
      <div className="udm-map-state is-error" role="alert">
        <p>地图数据加载失败：{error}</p>
      </div>
    );
  }
  if (!overview) {
    return <div className="udm-map-state">{loading ? '正在加载地图数据…' : '暂无地图数据'}</div>;
  }
  if (overview.nodes.length === 0 && overview.sites.length === 0) {
    return <div className="udm-map-state">路网为空：请先在「基础数据」导入或创建路网节点与站点。</div>;
  }

  return (
    <div className="udm-map-layout">
      <div className="udm-map-canvas">
        <FlowCanvas nodes={graph.nodes} edges={graph.edges} onNodeClick={handleNodeClick} onPaneClick={clearSelection} />
      </div>
      <aside className="udm-map-legend" aria-label="图层控制与图例">
        <h2>图层</h2>
        <ul>
          {LAYERS.map((layer) => (
            <li key={layer.key}>
              <label>
                <input
                  type="checkbox"
                  checked={visibility[layer.key]}
                  disabled={!layer.toggleable}
                  onChange={() => toggle(layer.key)}
                />
                <span>{layer.label}</span>
                {!layer.toggleable ? <em className="udm-map-legend__hint">常显</em> : null}
              </label>
            </li>
          ))}
        </ul>
        <div className="udm-map-legend__actions">
          <button type="button" onClick={() => setAll(true)}>
            全部显示
          </button>
          <button type="button" onClick={() => setAll(false)}>
            仅看车辆
          </button>
        </div>
        <dl className="udm-map-legend__stats">
          <dt>路网</dt>
          <dd>
            {overview.nodes.length} 节点 / {overview.edges.length} 边
          </dd>
          <dt>站点 · 车辆</dt>
          <dd>
            {overview.sites.length} · {overview.vehicles.length}
          </dd>
          <dt>任务 · 路线</dt>
          <dd>
            {overview.tasks.length} · {overview.routes.length}
          </dd>
          <dt>事件序号</dt>
          <dd>{lastEventSeq}</dd>
        </dl>
        {selected ? (
          <p className="udm-map-legend__selected">
            已选中：{selected.entityType} · {selected.label}
          </p>
        ) : (
          <p className="udm-map-legend__selected is-empty">未选中任何对象（点击地图实体或列表）</p>
        )}
      </aside>
    </div>
  );
}

export function MapView() {
  return (
    <ReactFlowProvider>
      <MapCanvas />
    </ReactFlowProvider>
  );
}
