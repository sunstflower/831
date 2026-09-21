/** 任务起终点：`from`/`to` 两种样式，用形状区分（不只靠颜色，兼顾色觉障碍）。 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { TaskEndpointData } from './types';

function TaskEndpointNodeImpl({ data, selected }: NodeProps & { data: TaskEndpointData }) {
  return (
    <div
      className={['udm-node-endpoint', `role-${data.role}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={`${data.code} ${data.role === 'from' ? '起点' : '终点'} · ${data.status}`}
    >
      <span className="udm-node-endpoint__glyph">{data.role === 'from' ? '起' : '终'}</span>
      <CenterHandles />
    </div>
  );
}

export const TaskEndpointNode = memo(TaskEndpointNodeImpl);
