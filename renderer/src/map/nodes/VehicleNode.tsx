/**
 * 车辆：状态色环 + 电量条 + 状态文字 + 告警角标。
 *
 * 设计取舍（可读性优先）：
 * 1. **写中文状态**，不只靠颜色 —— 原实现只有色环，用户必须记住 7 种颜色的含义；
 * 2. 电量用**进度条 + 数字**，低于阈值时整条变红；电量不确定时不画条（不假造）；
 * 3. 车头方向用一个小三角指示 `heading`（有则显示）；没有朝向数据时不显示，
 *    绝不用「猜一个方向」的方式让画面看起来更热闹；
 * 4. 车辆层常显且恒在最上层，因此本组件不做压暗（`toFlow` 也不给它 `is-dimmed`）。
 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { VehicleNodeData } from './types';
import { VEHICLE_STATUS_LABEL, labelOf } from '../../domain/labels';

/** 电量条宽度按 100% 归一，最小留 2px 让「快没电」仍是可见的一条而不是一个点。 */
function batteryWidth(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  return `${Math.max(2, clamped)}%`;
}

function VehicleNodeImpl({ data, selected }: NodeProps & { data: VehicleNodeData }) {
  const alertCount = data.alerts?.length ?? 0;
  const statusLabel = labelOf(VEHICLE_STATUS_LABEL, data.status);
  const title = [
    data.code,
    `状态 ${statusLabel}`,
    `电量 ${Math.round(data.battery)}%`,
    data.taskId ? '已挂任务' : '无任务'
  ].join(' · ');
  return (
    <div
      className={['udm-node-vehicle', `status-${data.status}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
    >
      <span className="udm-node-vehicle__glyph" aria-hidden="true" />
      <span className="udm-node-vehicle__body">
        <span className="udm-node-vehicle__code">{data.code}</span>
        <span className="udm-node-vehicle__status">{statusLabel}</span>
        <span className={['udm-node-vehicle__battery', data.lowBattery ? 'is-low' : ''].filter(Boolean).join(' ')}>
          <span className="udm-node-vehicle__battery-track">
            <span className="udm-node-vehicle__battery-fill" style={{ width: batteryWidth(data.battery) }} />
          </span>
          <span className="udm-node-vehicle__battery-value">{Math.round(data.battery)}%</span>
        </span>
      </span>
      {data.taskId ? <span className="udm-node-vehicle__task-dot" title="已挂任务" aria-hidden="true" /> : null}
      {alertCount > 0 ? (
        <span className="udm-node-alert-badge" title={`${alertCount} 条未处理告警`}>
          {alertCount}
        </span>
      ) : null}
      <CenterHandles />
    </div>
  );
}

export const VehicleNode = memo(VehicleNodeImpl);
