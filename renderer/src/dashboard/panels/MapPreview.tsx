/**
 * 工作台里的地图预览（画布缩略版）。
 *
 * **复用**地图模块的同一套数据映射与节点/边组件（`model/toFlow` / `nodes` / `edges`），
 * 不另写一份「简化版渲染」—— 两套映射的口径迟早会分叉（例如预览里漏了任务端点图层，
 * 使用者就会以为地图上本来没有），这正是本项目反复出现的「同一事实多个作者」（D-34）。
 *
 * **刻意做成不可交互**（对齐官方案例里静态预览画布的做法）：
 * 1. 预览只有约 300px 高，滚动页面时若 `zoomOnScroll` 打开，鼠标滚轮会被画布吃掉，
 *    页面卡住不动 —— 这是嵌在长页面里的画布最常见的体验事故；
 * 2. 缩放/平移/选中的完整能力在独立的地图页里有，预览的职责只是「一眼看到现状」。
 *
 * `fitView` 用 React Flow 的**内置 prop**（而不是 `useReactFlow().fitView()` 手调）：
 * 内置 prop 会在节点尺寸测量完成后**再适配一次**，而手动调用只在挂载时执行一次 ——
 * 实测（2026-09-25）手调版本量到的节点尺寸还是 0，图被顶到画布左边缘且不会重试。
 * 地图页那处手调之所以能用，是因为它额外用 `useNodesInitialized()` 做了门控；
 * 预览这里直接交给内置机制，少一份需要维护的时序代码。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, type Node } from '@xyflow/react';
import type { MapOverview } from '../../api/types';
import { edgeTypes } from '../../map/edges';
import { LAYERS, DEFAULT_VISIBILITY } from '../../map/model/layers';
import { nodeTypes } from '../../map/nodes';
import { toFlow } from '../../map/model/toFlow';

export interface MapPreviewProps {
  overview: MapOverview;
}

function PreviewCanvas({ overview }: MapPreviewProps) {
  const { nodes, edges } = useMemo(() => toFlow(overview, DEFAULT_VISIBILITY), [overview]);

  return (
    <ReactFlow
      nodes={nodes as Node[]}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode="dark"
      fitView
      // `padding` 给节点卡片留边（卡片带外发光，贴边会被裁掉）；
      // `maxZoom` 压到 1.1：seed 只有 4×3 网格，不限高的话预览会放大到 2 倍以上，
      // 反而只能看到图中一个角（实测首帧就是这样）。
      fitViewOptions={{ padding: 0.18, maxZoom: 1.1 }}
      minZoom={0.3}
      maxZoom={1.1}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
      ariaLabelConfig={{ 'node.a11yDescription.default': '预览画布，不可交互。' }}
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#243044" />
    </ReactFlow>
  );
}

/** 图例：从**图层定义**派生（不另立一份清单），按配色去重后展示。 */
function previewLegend() {
  const seen = new Set<string>();
  return LAYERS.filter((layer) => {
    if (seen.has(layer.tone)) {
      return false;
    }
    seen.add(layer.tone);
    return true;
  });
}

export function MapPreview({ overview }: MapPreviewProps) {
  return (
    <div className="udm-preview">
      <div className="udm-preview__canvas">
        <ReactFlowProvider>
          <PreviewCanvas overview={overview} />
        </ReactFlowProvider>
      </div>
      <ul className="udm-preview__legend">
        {previewLegend().map((layer) => (
          <li key={layer.tone}>
            <span className={`udm-swatch udm-swatch--${layer.tone}`} aria-hidden="true" />
            {layer.label}
          </li>
        ))}
      </ul>
      <p className="udm-preview__note">
        预览不可交互（滚轮留在页面上滚动）。完整缩放、平移、图层开关与对象详情在
        <Link className="udm-card__more" to="/map">
          地图页
        </Link>
        。
      </p>
    </div>
  );
}
