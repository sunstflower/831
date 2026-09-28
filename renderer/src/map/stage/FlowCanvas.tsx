/**
 * `<ReactFlow>` 装配层。
 *
 * 直接体现的四条实测约束（`docs/module-M6-map.md` §2.3 / §5.2 / §9 / §11.5）：
 * 1. `nodeTypes` / `edgeTypes` 取自模块级常量，绝不内联；
 * 2. 地图是只读视图：`nodesDraggable=false`、`nodesConnectable=false`，避免多余手势与命中测试；
 * 3. 缩放范围需显式放宽（默认 0.5–2 对 4×3 网格太小）；
 * 4. `Controls` / `MiniMap` 自带**浅色**默认主题 —— 这里用官方的 `colorMode="dark"`
 *    切换 `@xyflow/react/dist/style.css` 里那套 `--xy-*-default` 深色变量，
 *    不再手写覆盖（手写覆盖曾在升级后失效，见 §11.5.4）。
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type Viewport
} from '@xyflow/react';
import { nodeTypes } from '../nodes';
import { edgeTypes } from '../edges';
import { MINIMAP_NODE_COLORS, MINIMAP_FALLBACK_COLOR } from '../model/palette';

export interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: NodeMouseHandler;
  onNodeDoubleClick?: NodeMouseHandler;
  onPaneClick?: () => void;
  /** 视口变化（用于显示缩放百分比）；节流由调用方决定。 */
  onViewportChange?: (viewport: Viewport) => void;
  /** 画布左上角的自定义工具条（指标/操作）。 */
  topLeftPanel?: React.ReactNode;
  /** 画布左下角的提示（如「低缩放已隐藏标签」）。 */
  bottomLeftPanel?: React.ReactNode;
  /**
   * 画布坐标系里的装饰层（轨迹折线等）。
   *
   * 必须渲染在 `<ReactFlow>` **内部**：`ViewportPortal` 靠 React Flow 的上下文
   * 拿到视口变换，放在外面会抛错。它是纯装饰（`pointer-events: none`），
   * 不参与命中与图结构。
   */
  decorations?: React.ReactNode;
}

export function FlowCanvas({
  nodes,
  edges,
  onNodeClick,
  onNodeDoubleClick,
  onPaneClick,
  onViewportChange,
  topLeftPanel,
  bottomLeftPanel,
  decorations
}: FlowCanvasProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode="dark"
      fitView
      fitViewOptions={{ padding: 0.22, maxZoom: 1.6 }}
      minZoom={0.1}
      maxZoom={4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onPaneClick={onPaneClick}
      onViewportChange={onViewportChange}
      /*
       * 中文无障碍文案。React Flow 默认是全英文朗读模板
       * （`defaultAriaLabelConfig`），本项目界面为中文，读屏用户会听到中英混排。
       * 这里覆盖全部 9 条文案 —— 该配置是 Partial 合并，漏掉的键会保留英文默认值。
       */
      ariaLabelConfig={{
        'node.a11yDescription.default': '按回车或空格选中节点。',
        'node.a11yDescription.keyboardDisabled': '按回车或空格选中节点，随后可用方向键移动。',
        'edge.a11yDescription.default': '按回车或空格选中连线。',
        'controls.ariaLabel': '画布控件',
        'controls.zoomIn.ariaLabel': '放大',
        'controls.zoomOut.ariaLabel': '缩小',
        'controls.fitView.ariaLabel': '适配视图',
        'controls.interactive.ariaLabel': '切换交互',
        'minimap.ariaLabel': '缩略图',
        'handle.ariaLabel': '连接点'
      }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#243044" />
      {/* 装饰层放在最前面：它必须被节点/边盖住，不能反过来遮住业务对象 */}
      {decorations}
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        pannable
        zoomable
        position="bottom-left"
        nodeStrokeWidth={2}
        nodeColor={(node) => MINIMAP_NODE_COLORS[String(node.type)] ?? MINIMAP_FALLBACK_COLOR}
        ariaLabel="路网缩略图"
      />
      {topLeftPanel ? <Panel position="top-left">{topLeftPanel}</Panel> : null}
      {bottomLeftPanel ? <Panel position="bottom-center">{bottomLeftPanel}</Panel> : null}
    </ReactFlow>
  );
}
