/**
 * 任务起终点：`from`/`to` 用**形状**区分（圆形/方形），不只靠颜色（兼顾色觉障碍）；
 * 带悬停/选中时显示的中文标签与进度提示。
 *
 * 与站点节点重合：任务起终点就落在站点上，若两者都画大图标会互相遮挡。
 * 因此本节点做小（22×22）且默认半透明，hover/选中时才实心 —— 保证站点仍可点选。
 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { TaskEndpointData } from './types';
import { TASK_STATUS_LABEL, labelOf } from '../../domain/labels';

function TaskEndpointNodeImpl({ data, selected }: NodeProps & { data: TaskEndpointData }) {
  const isFrom = data.role === 'from';
  const statusLabel = labelOf(TASK_STATUS_LABEL, data.status);
  const title = [
    `${data.code ?? ''} ${isFrom ? '起点' : '终点'}`,
    statusLabel,
    `进度 ${Math.round(data.progress * 100)}%`
  ].join(' · ');
  return (
    <div
      className={['udm-node-endpoint', `role-${data.role}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
    >
      <span aria-hidden="true">{isFrom ? '起' : '终'}</span>
      {data.peerCode ? (
        // 起点指向终点、终点回指起点：悬停即可读出「这批货从哪到哪」
        <span className="udm-node-endpoint__tip">{isFrom ? `→ ${data.peerCode}` : `← ${data.peerCode}`}</span>
      ) : null}
      <CenterHandles />
    </div>
  );
}

export const TaskEndpointNode = memo(TaskEndpointNodeImpl);
