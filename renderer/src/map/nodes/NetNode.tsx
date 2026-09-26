/**
 * 路网节点：小圆点；禁用态变灰虚线，并在 hover 时显示编码。
 *
 * 路网节点数量最多（设计上限 2000），因此：
 * - 不渲染常驻文字标签（会在低缩放下糊成一团）；
 * - 编码放在 `title` 与 hover 浮标里，按需出现。
 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { MapNodeData } from './types';
import type { NodeProps } from '@xyflow/react';

function NetNodeImpl({ data, selected }: NodeProps & { data: MapNodeData }) {
  const disabled = data.status === 'disabled';
  const title = `${data.code ?? ''}${disabled ? '（已禁用）' : ''}`;
  return (
    <div
      className={['udm-node-net', disabled ? 'is-disabled' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
    >
      <span className="udm-node-net__hover">{data.code}</span>
      <CenterHandles />
    </div>
  );
}

export const NetNode = memo(NetNodeImpl);
