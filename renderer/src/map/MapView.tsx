/**
 * 地图页容器。
 *
 * 职责边界（D-21）：
 * - 只渲染 `map/overview` 提供的数据，**不自行搜索路径**（路径权威在 M5，自行搜索会绕过禁行规则）；
 * - 选中态写入全局 `selection`（与列表联动），图层开关与缩放是页面态；
 * - 车辆位置用 `updateNode` **定向更新**，绝不重建 `nodes` 数组 —— 否则 React Flow
 *   会把全部节点/边重挂载（实测表现为边直接不渲染）。
 *
 * 本文件是「装配层」：数据 → 图、面板布局、快捷键。所有可复用的判断
 * （指标、聚焦、详情、配色）都在 `model/` 里以纯函数实现并有单测。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlowProvider, useNodesInitialized, useReactFlow, type Node, type Viewport } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './style/map.css';

import { FlowCanvas } from './stage/FlowCanvas';
import { toFlow } from './model/toFlow';
import { computeMetrics } from './model/metrics';
import { buildDetailCard } from './model/detail';
import { useMapOverview } from './hooks/useMapOverview';
import { useLayerVisibility } from './hooks/useLayerVisibility';
import { useVehicleMotion } from './hooks/useVehicleMotion';
import { useVehicleTracks } from './hooks/useVehicleTracks';
import { useSelectionSync } from './hooks/useSelectionSync';
import { useMapShortcuts } from './hooks/useMapShortcuts';
import { COMPACT_ZOOM, useZoomLevel } from './hooks/useZoomLevel';
import { LayerPanel } from './panels/LayerPanel';
import { DetailPanel } from './panels/DetailPanel';
import { MetricsBar } from './panels/MetricsBar';
import { TrackPanel } from './panels/TrackPanel';
import { TrackLayer } from './stage/TrackLayer';
import { scrubIndex } from './model/track';
import { useSessionStore } from '../store/session';
import { useSelectionStore, type SelectableEntityType } from '../store/selection';
import { vehicleNodeId } from './model/ids';
import type { XY } from './model/motion';

function MapCanvas() {
  const token = useSessionStore((state) => state.token);
  const layers = useLayerVisibility();
  const { overview, loading, error, lastEventSeq, positionsRef, statusRevision } = useMapOverview(token);
  const selected = useSelectionStore((state) => state.selected);
  const select = useSelectionStore((state) => state.select);
  const clearSelection = useSelectionStore((state) => state.clear);
  const { updateNode, fitView, setCenter, getNode } = useReactFlow();
  const zoomState = useZoomLevel();
  // 图层面板在窄屏下可折叠，避免它吃掉画布宽度
  const [showLayers, setShowLayers] = useState(true);

  /**
   * 轨迹回放是**页面态**而不是全局态：它跟着「当前看的这一台车」走，
   * 换一台车就该重置到最新（留着上一台的回放位置会指向另一台车的历史）。
   * 折线开关与回放位置分开存：关掉折线不该丢掉「回看到哪」。
   */
  const [trackShow, setTrackShow] = useState(true);
  const [trackFraction, setTrackFraction] = useState(1);

  /**
   * 图结构（节点/边）只在「快照 / 图层 / 选中 / 运行态」变化时重建。
   * 车辆**位置**刻意不在此依赖里：位置走 `updateNode` 定向更新。
   * `statusRevision` 只在状态或电量真的变化时自增（低频），用于刷新车辆节点的徽标。
   */
  const graph = useMemo(
    () =>
      overview
        ? toFlow(overview, layers.visibility, selected, positionsRef.current ?? {})
        : { nodes: [] as Node[], edges: [] },
    // positionsRef 是 ref，故意不进依赖：位置不参与图重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, layers.visibility, selected, statusRevision]
  );

  const metrics = useMemo(() => (overview ? computeMetrics(overview) : null), [overview]);
  const selectedVehicleId = selected?.entityType === 'vehicle' ? selected.entityId : null;
  const tracks = useVehicleTracks(token, selectedVehicleId);
  const trackPoints = tracks.track?.points ?? [];
  const trackIndex = scrubIndex(trackPoints.length, trackFraction);

  // 换车即回到最新（见上：残留的回放位置会指向另一台车的历史）
  useEffect(() => {
    setTrackFraction(1);
  }, [selectedVehicleId]);
  const detailCard = useMemo(() => (overview ? buildDetailCard(overview, selected) : null), [overview, selected]);

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

  const handleFitView = useCallback(() => {
    void fitView({ padding: 0.22, maxZoom: 1.6, duration: 300 });
  }, [fitView]);

  /** 聚焦：把选中对象的视口居中（详情卡的「准星」按钮与双击节点共用）。 */
  const handleFocusSelection = useCallback(() => {
    if (!selected) {
      return;
    }
    const node = getNode(selected.flowId);
    if (!node) {
      return;
    }
    const width = node.measured?.width ?? 24;
    const height = node.measured?.height ?? 24;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1.5, duration: 400 });
  }, [getNode, selected, setCenter]);

  const handleToggleLayers = useCallback(() => setShowLayers((value) => !value), []);
  useMapShortcuts({
    onFitView: handleFitView,
    onClearSelection: clearSelection,
    onToggleLayers: handleToggleLayers
  });

  const handleViewportChange = useCallback(
    (viewport: Viewport) => zoomState.onViewportChange(viewport),
    [zoomState]
  );

  /**
   * 首次把视口对准整张图。
   *
   * ⚠️ 必须等节点**测量完成**再 fitView（`useNodesInitialized`）。
   * 实测（2026-09-25）：只在 `nodes.length` 变化时调用，会在节点尺寸还是 0 时就算包围盒，
   * fitView 得到的是错误的边界 → 图**没有居中**、贴在画布一角且偏小；
   * 而且它随后永远不会重试。等测量完成再调用即可正确居中。
   *
   * `padding` 取 0.18：给状态条与缩略图留出空间，同时不让图缩得太小。
   */
  const nodesInitialized = useNodesInitialized();
  const fittedRef = useRef(false);
  useEffect(() => {
    if (graph.nodes.length > 0 && nodesInitialized && !fittedRef.current) {
      fittedRef.current = true;
      void fitView({ padding: 0.18, maxZoom: 1.6, duration: 0 });
    }
  }, [graph.nodes.length, nodesInitialized, fitView]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as { entityType?: SelectableEntityType; entityId?: string; code?: string; name?: string };
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

  /** 双击 = 选中并聚焦（比「选中后再去找准星按钮」少一步）。 */
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      handleNodeClick(_event, node);
      const width = node.measured?.width ?? 24;
      const height = node.measured?.height ?? 24;
      void setCenter(node.position.x + width / 2, node.position.y + height / 2, { zoom: 1.5, duration: 400 });
    },
    [handleNodeClick, setCenter]
  );

  if (error) {
    return (
      <div className="udm-map-state is-error" role="alert">
        <p>地图数据加载失败：{error}</p>
        <p className="udm-map-state__hint">请确认已登录且主进程可用；Mock 形态下请检查适配器配置。</p>
      </div>
    );
  }
  if (!overview || !metrics) {
    return (
      <div className="udm-map-state" role="status">
        <span className="udm-spinner" aria-hidden="true" />
        <p>{loading ? '正在加载地图数据…' : '暂无地图数据'}</p>
      </div>
    );
  }
  if (overview.nodes.length === 0 && overview.sites.length === 0) {
    return (
      <div className="udm-map-state">
        <p>路网为空：请先在「基础数据」导入或创建路网节点与站点。</p>
      </div>
    );
  }

  return (
    <div className={showLayers ? 'udm-map-layout' : 'udm-map-layout is-collapsed'}>
      <div className="udm-map-canvas">
        <FlowCanvas
          nodes={graph.nodes}
          edges={graph.edges}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={clearSelection}
          onViewportChange={handleViewportChange}
          topLeftPanel={<MetricsBar metrics={metrics} lastEventSeq={lastEventSeq} zoom={zoomState.zoom} />}
          decorations={
            trackShow ? <TrackLayer points={trackPoints} uptoIndex={trackIndex} showCursor /> : null
          }
          bottomLeftPanel={
            zoomState.isCompact ? (
              <span className="udm-canvas-hint">
                缩放 {Math.round(zoomState.zoom * 100)}%，已隐藏文字标签以保持清晰（快捷键：F 适配视图 · L 切换图层面板 · Esc 取消选中）
              </span>
            ) : (
              <span className="udm-canvas-hint">
                快捷键：F 适配视图 · L 切换图层面板 · Esc 取消选中 · 双击实体聚焦
              </span>
            )
          }
        />
      </div>

      <div className="udm-map-side">
        <div className="udm-map-side__toggle">
          <button
            type="button"
            className="udm-btn udm-btn--ghost"
            onClick={handleToggleLayers}
            aria-expanded={showLayers}
          >
            {showLayers ? '收起图层面板' : '展开图层面板'}
          </button>
        </div>
        {showLayers ? <LayerPanel state={layers} metrics={metrics} /> : null}
        <DetailPanel
          card={detailCard}
          hasSelection={Boolean(selected)}
          onClear={clearSelection}
          onFocus={handleFocusSelection}
        />
        <TrackPanel
          vehicleLabel={selectedVehicleId ? (selected?.label ?? selectedVehicleId) : null}
          state={tracks}
          show={trackShow}
          onShowChange={setTrackShow}
          fraction={trackFraction}
          onFractionChange={setTrackFraction}
        />
      </div>
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
