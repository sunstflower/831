/**
 * 订单起终点：`confidence` 低时高亮提示需人工复核；
 * `pathStatus === 'route_unavailable'` 用虚线边框表示「地区已匹配但无路网路径」。
 * 未匹配地区的订单**不会出现在数据里**（不伪造坐标，见 `docs/order-data-map-design.md` §5）。
 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { OrderEndpointData } from './types';

function OrderEndpointNodeImpl({ data, selected }: NodeProps & { data: OrderEndpointData }) {
  const lowConfidence = data.confidence !== null && data.confidence < 0.8;
  return (
    <div
      className={[
        'udm-node-order',
        `role-${data.role}`,
        lowConfidence ? 'is-low-confidence' : '',
        data.pathStatus === 'route_unavailable' ? 'is-route-unavailable' : '',
        selected ? 'is-selected' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      title={`订单 ${data.entityId} ${data.role === 'from' ? '起点' : '终点'}${lowConfidence ? '（匹配置信度低）' : ''}`}
    >
      <span className="udm-node-order__glyph">{data.role === 'from' ? '取' : '送'}</span>
      <CenterHandles />
    </div>
  );
}

export const OrderEndpointNode = memo(OrderEndpointNodeImpl);
