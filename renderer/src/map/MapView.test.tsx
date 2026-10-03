import '../test/dom-stubs';
import { render, waitFor } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { FlowCanvas } from './stage/FlowCanvas';
import { toFlow } from './model/toFlow';
import { buildMockOverview } from '../api/mock-data';

/**
 * jsdom 下的渲染断言。
 *
 * 已知限制（实测）：jsdom 不做布局，节点的 `measured` 尺寸为 0，
 * 因此**边**不会被 React Flow 渲染（它依赖两端节点的实际尺寸算几何）。
 * 所以：
 * - 节点数量在 jsdom 可断言；
 * - 边数量用 `toFlow` 的纯函数断言（见 `model/toFlow.test.ts`），
 *   完整渲染由 Electron 冒烟覆盖（`docs/module-M6-map.md` §10.2 M6-S1）。
 *
 * 同理，等待信号也不用 `findByText`：同一个车牌/编号会同时出现在节点正文、
 * `title` 与标签层，文本查询命中多个元素会直接抛错；节点计数更稳定。
 * 也不能断言「节点可见」——React Flow 在拿到 `measured` 之前会给节点
 * 加 `visibility: hidden`。
 */
/** 画布上的节点总数：路网 + 站点 + 车辆 + 每条任务的两个端点。 */
function expectedNodeCount(overview: ReturnType<typeof buildMockOverview>): number {
  return overview.nodes.length + overview.sites.length + overview.vehicles.length + overview.tasks.length * 2;
}

async function waitForNodes(container: HTMLElement, expected: number) {
  await waitFor(() => {
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(expected);
  });
}

function renderCanvas(overview = buildMockOverview()) {
  const { nodes, edges } = toFlow(overview);
  return render(
    <div style={{ width: 1000, height: 700 }}>
      <ReactFlowProvider>
        <FlowCanvas nodes={nodes} edges={edges} />
      </ReactFlowProvider>
    </div>
  );
}

describe('FlowCanvas · jsdom 渲染', () => {
  it('挂载后渲染出全部节点（路网 + 站点 + 车辆 + 任务端点，逐类与快照对齐）', async () => {
    const overview = buildMockOverview();
    const { container } = renderCanvas(overview);
    await waitForNodes(container, expectedNodeCount(overview));
    expect(container.querySelectorAll('.react-flow__node-net')).toHaveLength(overview.nodes.length);
    expect(container.querySelectorAll('.react-flow__node-site')).toHaveLength(overview.sites.length);
    expect(container.querySelectorAll('.react-flow__node-vehicle')).toHaveLength(overview.vehicles.length);
    // 每条上图的任务各两个端点（起 / 终）—— 快照里有几条任务，就画几个端点
    expect(container.querySelectorAll('.react-flow__node-taskEndpoint')).toHaveLength(overview.tasks.length * 2);
  });

  it('渲染出图层容器与控件（Background / Controls / MiniMap）', async () => {
    const overview = buildMockOverview();
    const { container } = renderCanvas(overview);
    await waitForNodes(container, expectedNodeCount(overview));
    expect(container.querySelector('.react-flow__viewport')).not.toBeNull();
    expect(container.querySelector('.react-flow__edgelabel-renderer')).not.toBeNull();
    expect(container.querySelector('.react-flow__controls')).not.toBeNull();
    expect(container.querySelector('.react-flow__minimap')).not.toBeNull();
  });

  it('路线高亮标签会渲染到独立的标签层', async () => {
    const overview = buildMockOverview();
    const { container } = renderCanvas(overview);
    await waitForNodes(container, expectedNodeCount(overview));
    // 标签由 EdgeLabelRenderer 渲染；jsdom 下边本身不渲染，但标签层容器存在
    expect(container.querySelector('.react-flow__edgelabel-renderer')).not.toBeNull();
  });

  it('空图渲染成空画布而非抛错（空态文案由 MapView 负责）', () => {
    const { container } = renderCanvas({
      nodes: [], edges: [], sites: [], vehicles: [], tasks: [], routes: [], alerts: [], eventSeq: 0
    });
    expect(container.querySelectorAll('.react-flow__node')).toHaveLength(0);
  });

  it('节点类型注册表是模块级常量（避免内联对象导致全量重挂载）', async () => {
    const { nodeTypes } = await import('./nodes');
    const { edgeTypes } = await import('./edges');
    expect(Object.keys(nodeTypes).sort()).toEqual(['net', 'orderEndpoint', 'site', 'taskEndpoint', 'vehicle']);
    expect(Object.keys(edgeTypes).sort()).toEqual(['net', 'route']);
    // 同一引用（而非每次新建对象）
    const again = await import('./nodes');
    expect(again.nodeTypes).toBe(nodeTypes);
  });
});
