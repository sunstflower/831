/** 站点：按 `type` 区分外形/颜色，带告警角标。 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { SiteNodeData } from './types';

const SITE_LABEL: Record<string, string> = {
  depot: '仓',
  dock: '台',
  charging: '充',
  gate: '闸',
  other: '站'
};

function SiteNodeImpl({ data, selected }: NodeProps & { data: SiteNodeData }) {
  const alertCount = data.alerts?.length ?? 0;
  return (
    <div
      className={['udm-node-site', `type-${data.siteType}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={`${data.name ?? data.code}（${data.siteType}）`}
    >
      <span className="udm-node-site__glyph">{SITE_LABEL[data.siteType] ?? '站'}</span>
      {alertCount > 0 ? <span className="udm-node-alert-badge">{alertCount}</span> : null}
      <CenterHandles />
    </div>
  );
}

export const SiteNode = memo(SiteNodeImpl);
