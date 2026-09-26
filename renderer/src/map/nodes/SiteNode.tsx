/**
 * 站点：按 `type` 区分外形/配色 + 中文标注。
 *
 * 站点是**业务上最重要的静止元素**（仓库/月台），原先只有一个 30×30 的方块 + 一个汉字，
 * 使用者无法知道它是哪个仓库。现在补一个**始终可见的标签**（`A-01 A 仓库`），
 * 并在缩放极小时由 CSS 自动省略（`@container`/媒体查询做不了画布缩放，故用 `zoom` 门限的
 * 替代方案：标签默认显示，`is-compact` 时隐藏 —— 见 `useZoomLevel`）。
 */
import { memo } from 'react';
import { CenterHandles } from './Handles';
import type { NodeProps } from '@xyflow/react';
import type { SiteNodeData } from './types';
import { SITE_TYPE_LABEL, labelOf } from '../../domain/labels';

const SITE_GLYPH: Record<string, string> = {
  depot: '仓',
  dock: '台',
  charging: '充',
  gate: '闸',
  other: '站'
};

function SiteNodeImpl({ data, selected }: NodeProps & { data: SiteNodeData }) {
  const alertCount = data.alerts?.length ?? 0;
  const typeLabel = labelOf(SITE_TYPE_LABEL, data.siteType);
  const name = data.name ?? data.code;
  const title = [name, typeLabel, data.nodeCode ? `挂靠 ${data.nodeCode}` : '未挂靠路网节点'].join(' · ');
  return (
    <div
      className={['udm-node-site', `type-${data.siteType}`, selected ? 'is-selected' : ''].filter(Boolean).join(' ')}
      title={title}
      aria-label={title}
    >
      <span className="udm-node-site__glyph" aria-hidden="true">{SITE_GLYPH[data.siteType] ?? '站'}</span>
      <span className="udm-node-site__label">
        <span className="udm-node-site__code">{data.code}</span>
        <span className="udm-node-site__name">{name}</span>
      </span>
      {alertCount > 0 ? (
        <span className="udm-node-alert-badge" title={`${alertCount} 条未处理告警`}>
          {alertCount}
        </span>
      ) : null}
      <CenterHandles />
    </div>
  );
}

export const SiteNode = memo(SiteNodeImpl);
