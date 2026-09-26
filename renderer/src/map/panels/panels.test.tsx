import '../../test/dom-stubs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { buildMockOverview } from '../../api/mock-data';
import { computeMetrics } from '../model/metrics';
import { buildDetailCard } from '../model/detail';
import { useLayerVisibility } from '../hooks/useLayerVisibility';
import { DetailPanel } from './DetailPanel';
import { LayerPanel } from './LayerPanel';
import { MetricsBar } from './MetricsBar';

/** 图层面板需要一个 hook 实例；用一个极简包装组件提供。 */
function LayerPanelHarness() {
  const state = useLayerVisibility();
  return <LayerPanel state={state} metrics={computeMetrics(buildMockOverview())} />;
}

describe('LayerPanel', () => {
  it('渲染三个分组与全部图层', () => {
    render(<LayerPanelHarness />);
    for (const group of ['路网', '设施', '配送']) {
      expect(screen.getByText(group)).toBeInTheDocument();
    }
    // 图层名 + 计数说明都渲染出来了
    expect(screen.getByText('路网边')).toBeInTheDocument();
    expect(screen.getByText('车辆')).toBeInTheDocument();
  });

  it('车辆层标记为「常显」且复选框被禁用（不可关闭）', () => {
    render(<LayerPanelHarness />);
    const vehicleBox = screen.getByRole('checkbox', { name: /车辆/ }) as HTMLInputElement;
    expect(vehicleBox.disabled).toBe(true);
    expect(vehicleBox.checked).toBe(true);
  });

  it('提供三个快速视图按钮', () => {
    render(<LayerPanelHarness />);
    expect(screen.getByRole('button', { name: '全部' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '只看配送' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '只看路网' })).toBeInTheDocument();
  });

  it('显示未处理告警等关键计数', () => {
    render(<LayerPanelHarness />);
    expect(screen.getByText('未处理告警')).toBeInTheDocument();
    expect(screen.getByText('低电车辆')).toBeInTheDocument();
  });
});

describe('DetailPanel', () => {
  it('无选中时给出引导文案，而不是空白卡片', () => {
    render(<DetailPanel card={null} hasSelection={false} onClear={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByText(/未选中任何对象/)).toBeInTheDocument();
  });

  it('有选中但无详情可展示时，明确说明原因', () => {
    render(<DetailPanel card={null} hasSelection onClear={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByText(/没有可展示的详情/)).toBeInTheDocument();
  });

  it('渲染选中车辆的全部字段与关联告警', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 'v',
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    render(<DetailPanel card={card} hasSelection onClear={vi.fn()} onFocus={vi.fn()} />);
    expect(screen.getByText('AGV-01')).toBeInTheDocument();
    expect(screen.getByText('执行中')).toBeInTheDocument();
    expect(screen.getByText('T-DEMO-0001')).toBeInTheDocument();
    expect(screen.getByText('无关联告警')).toBeInTheDocument();
  });

  it('聚焦与取消按钮各自触发回调', async () => {
    const onFocus = vi.fn();
    const onClear = vi.fn();
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 'v',
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    render(<DetailPanel card={card} hasSelection onClear={onClear} onFocus={onFocus} />);
    screen.getByRole('button', { name: '聚焦到该对象' }).click();
    screen.getByRole('button', { name: '取消选中' }).click();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('MetricsBar', () => {
  it('展示车辆数、执行中任务数与未处理告警数', () => {
    const metrics = computeMetrics(buildMockOverview());
    render(<MetricsBar metrics={metrics} lastEventSeq={7} zoom={1.25} />);
    expect(screen.getByText('车辆')).toBeInTheDocument();
    expect(screen.getByText('执行中')).toBeInTheDocument();
    expect(screen.getByText('未处理告警')).toBeInTheDocument();
    // 缩放百分比与事件序号都要能从条上读到
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(screen.getByText(/事件 7/)).toBeInTheDocument();
  });

  it('告警为 0 时不给数字加危险色（避免常态报警）', () => {
    const metrics = computeMetrics(buildMockOverview());
    const { container } = render(
      <MetricsBar metrics={{ ...metrics, newAlerts: 0 }} lastEventSeq={0} zoom={1} />
    );
    expect(container.querySelector('.udm-metric.is-danger')).toBeNull();
  });
});
