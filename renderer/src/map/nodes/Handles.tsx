/**
 * 居中 handle。
 *
 * **为什么必须显式写 handle**：实测证实 React Flow **不会**自动选择「距离最近的一对 handle」
 * ——若节点声明了多个 handle 而边不指定 `sourceHandle`/`targetHandle`，边会取声明顺序里的第一个，
 * 导致连线贴到节点顶边而非最近的一侧。
 *
 * 这里采用「单 handle 居中」方案（`docs/module-M6-map.md` §5.2 方案 A）：
 * 把唯一的 target/source 压到节点中心，连线即从中心出发，视觉上贴合路网几何，
 * 且不必为每条边计算方向。
 */
import { Handle, Position, type HandleProps } from '@xyflow/react';

const centered: HandleProps['style'] = {
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  opacity: 0,
  pointerEvents: 'none'
};

export function CenterHandles({ connectable = false }: { connectable?: boolean }) {
  return (
    <>
      <Handle type="target" position={Position.Top} style={centered} isConnectable={connectable} />
      <Handle type="source" position={Position.Bottom} style={centered} isConnectable={connectable} />
    </>
  );
}
