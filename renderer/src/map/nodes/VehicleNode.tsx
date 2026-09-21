/**
 * 车辆：状态色环 + 电量角标 + 告警角标。
 * 车辆层不可关闭（`layers.ts`），且恒在最上层。
 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { VehicleNodeData } from './types';

function VehicleNodeImpl({ data, selected }: NodeProps & { data: VehicleNodeData }) {
  const alertCount = data.alerts?.length ?? 0;
  const lowBattery = data.battery <= 20;
  return (
    <div
      className={['udm-node-vehicle', `status-${data.status}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={`${data.code} · ${data.status} · 电量 ${Math.round(data.battery)}%`}
    >
      <span className="udm-node-vehicle__code">{data.code}</span>
      <span className={['udm-node-vehicle__battery', lowBattery ? 'is-low' : ''].filter(Boolean).join(' ')}>
        {Math.round(data.battery)}%
      </span>
      {alertCount > 0 ? <span className="udm-node-alert-badge">{alertCount}</span> : null}
      <CenterHandles />
    </div>
  );
}

export const VehicleNode = memo(VehicleNodeImpl);
