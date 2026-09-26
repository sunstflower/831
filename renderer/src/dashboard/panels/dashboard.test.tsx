import '../../test/dom-stubs';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DashboardPage } from '../../pages/DashboardPage';
import { useSessionStore } from '../../store/session';
import { SEED_IDS } from '@udm/shared';

/**
 * 监控工作台的**渲染冒烟**（jsdom + mock 适配器）。
 *
 * 断言的是「这一屏必须出现的信息」：四个 KPI 的标题、三张卡片的标题、
 * 「未实现模块没有被说成已实现」的诚实说明。
 *
 * 已知限制（与 `MapView.test.tsx` 一致）：jsdom 不做布局，React Flow 不会渲染边，
 * 因此预览画布只断言容器存在，几何正确性由 Electron 冒烟与人工截图覆盖。
 */
function renderDashboard() {
  useSessionStore.setState({
    token: 'mock-admin-1',
    user: {
      id: 'seed-admin',
      username: 'admin',
      role: 'admin',
      displayName: '系统管理员',
      permissions: []
    }
  });
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
}

describe('DashboardPage · 渲染', () => {
  it('渲染四个 KPI 卡（口径说明与数字同屏）', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('可用车辆')).toBeInTheDocument();
    });
    expect(screen.getByText('执行中任务')).toBeInTheDocument();
    expect(screen.getByText('待确认告警')).toBeInTheDocument();
    expect(screen.getByText('车队平均电量')).toBeInTheDocument();
  });

  it('渲染车队 / 任务 / 告警三张卡片与地图预览、数据源', async () => {
    const { container } = renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('车队状态')).toBeInTheDocument();
    });
    expect(screen.getByText('任务执行')).toBeInTheDocument();
    // 「告警」既是卡片标题，也是 KPI 文案的一部分，用标题层级精确定位
    expect(screen.getByRole('heading', { name: '告警' })).toBeInTheDocument();
    expect(screen.getByText('实时地图预览')).toBeInTheDocument();
    expect(screen.getByText('数据源')).toBeInTheDocument();
    expect(container.querySelector('.react-flow')).not.toBeNull();
  });

  it('seed 的演示数据被正确翻译：任务起终点显示站点编码而非内部 id', async () => {
    const { container } = renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('T-DEMO-0001')).toBeInTheDocument();
    });
    // 站点编码同时出现在任务行与地图预览的节点上，因此**限定在任务列表里**断言，
    // 否则 `getByText` 会因命中多个元素而失败（与被测组件无关的失败最误导人）
    const taskList = container.querySelector('.udm-tasks');
    expect(taskList).not.toBeNull();
    expect(within(taskList as HTMLElement).getByText('A-01')).toBeInTheDocument();
    expect(within(taskList as HTMLElement).getByText('B-01')).toBeInTheDocument();
    // 内部 id 绝不该出现在界面文案里
    expect(screen.queryByText(SEED_IDS.siteDepotA)).toBeNull();
  });

  it('告警用中文类型名与级别，不把机器值印给使用者', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('车辆离线')).toBeInTheDocument();
    });
    expect(screen.queryByText('vehicle_offline')).toBeNull();
    expect(screen.getByText('警告')).toBeInTheDocument();
  });

  it('如实标注数据来源与「M7 未实现」，不把地图快照说成运行监控接口', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/M7 运行监控的专属接口/)).toBeInTheDocument();
    });
    expect(screen.getByText('GET /api/map/overview')).toBeInTheDocument();
  });
});
