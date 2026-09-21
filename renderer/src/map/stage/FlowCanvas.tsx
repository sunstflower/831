/**
 * `<ReactFlow>` 装配层。
 *
 * 三条实测约束直接体现在这里（`docs/module-M6-map.md` §2.3 / §5.2 / §9）：
 * 1. `nodeTypes` / `edgeTypes` 取自模块级常量，绝不内联；
 * 2. 地图是只读视图：`nodesDraggable=false`、`nodesConnectable=false`，避免多余手势与命中测试；
 * 3. 缩放范围需显式放宽（默认 0.5–2 对 4×3 网格太小）。
 */
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, type Node, type Edge, type NodeMouseHandler } from '@xyflow/react';
import { nodeTypes } from '../nodes';
import { edgeTypes } from '../edges';

/** 缩略图节点配色：按图层区分，与画布上的视觉语义保持一致。 */
const MINIMAP_NODE_COLORS: Record<string, string> = {
  net: '#64748b',
  site: '#a78bfa',
  vehicle: '#38bdf8',
  taskEndpoint: '#4ade80',
  orderEndpoint: '#fbbf24'
};

export interface FlowCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: NodeMouseHandler;
  onPaneClick?: () => void;
}

export function FlowCanvas({ nodes, edges, onNodeClick, onPaneClick }: FlowCanvasProps) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.25, maxZoom: 1.6 }}
      minZoom={0.1}
      maxZoom={4}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
      <Controls showInteractive={false} />
      {/* 深色主题变量：不传的话缩略图沿用浅色默认，在深色画布上是一块白方块 */}
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={2}
        bgColor="#1e293b"
        maskColor="rgba(15, 23, 42, 0.65)"
        maskStrokeColor="#38bdf8"
        nodeColor={(node) => MINIMAP_NODE_COLORS[String(node.type)] ?? '#64748b'}
      />
    </ReactFlow>
  );
}
