/** 路网节点：小圆点，禁用态变灰。 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { MapNodeData } from './types';
import type { NodeProps } from '@xyflow/react';

function NetNodeImpl({ data, selected }: NodeProps & { data: MapNodeData }) {
  const disabled = data.status === 'disabled';
  return (
    <div
      className={['udm-node-net', disabled ? 'is-disabled' : '', selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={`${data.code}${disabled ? '（已禁用）' : ''}`}
    >
      <CenterHandles />
    </div>
  );
}

export const NetNode = memo(NetNodeImpl);
