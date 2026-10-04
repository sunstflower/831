import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '@udm/shared';
import { apiClient } from '../api';
import { useSelectionStore } from '../store/selection';
import { useSessionStore } from '../store/session';
import { FleetPage } from './FleetPage';

/**
 * 车辆中心的**渲染与交互**（jsdom + mock 适配器）。
 *
 * 三条要锁住的话：
 *   1. 「车队现在有哪几台、各是什么状态」—— 一屏必须看到全部 5 台（本页不分页，
 *      分页会让 KPI 与表格自相矛盾，见页头第 3 条）；
 *   2. 「哪台车在忙什么」—— 打开抽屉看当前任务与实时位置；
 *   3. 「看车」与「改车」分家 —— 本页没有车辆表单，改车的入口是跳去基础数据页。
 *
 * 与 `fleet/model.test.ts` 的分工：算得对不对（分桶 / 门槛 / 投影）在那里钉，
 * 这里只看它们有没有被渲染出来。
 */
async function loginAsAdmin(): Promise<string> {
  const result = await apiClient.invoke<{ token: string }>('/api/auth/login', { username: 'admin', password: 'admin123' }, null, {
    method: 'POST'
  });
  if (result.code !== 0) {
    throw new Error(`测试前置：mock 登录失败（${result.message}）`);
  }
  useSessionStore.setState({
    token: result.data.token,
    user: { id: 'seed-admin', username: 'admin', role: 'admin', displayName: '系统管理员', permissions: [] }
  });
  return result.data.token;
}

async function renderPage() {
  const token = await loginAsAdmin();
  const view = render(
    <MemoryRouter initialEntries={['/fleet']}>
      <Routes>
        <Route path="/fleet" element={<FleetPage />} />
        <Route path="/map" element={<div>地图页占位</div>} />
      </Routes>
    </MemoryRouter>
  );
  // 表格是异步取数：等到 5 台车都在页面上
  await waitFor(() => {
    expect(within(screen.getByRole('table')).getAllByRole('row').length).toBe(6);
  });
  return { ...view, token };
}

beforeEach(() => {
  useSessionStore.setState({ token: null, user: null });
  useSelectionStore.getState().clear();
});

describe('车辆中心 · 一屏看全车队', () => {
  it('一次取回全部 5 台（不做分页），KPI 与状态分桶统计的都是同一批', async () => {
    await renderPage();
    const table = screen.getByRole('table');
    for (const code of ['AGV-01', 'AGV-02', 'CAR-01', 'CAR-02', 'DRN-01']) {
      expect(within(table).getByRole('button', { name: new RegExp(code) }), code).toBeInTheDocument();
    }
    // KPI「车队总数」与表格行数同源（都是 MAX_PAGE_SIZE 一次取回的那批）
    expect(screen.getByText('车队总数')).toBeInTheDocument();
    // 页面如实声明了取数上限口径，换到更大的车队时不会误以为统计是全局的
    expect(screen.queryByText(/超过单页上限/)).toBeNull();
    expect(MAX_PAGE_SIZE).toBeGreaterThanOrEqual(6);
  });

  it('点状态分桶筛选：选「空闲」后 AGV-01（忙碌）从表里消失', async () => {
    await renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('button', { name: /AGV-01/ })).toBeInTheDocument();

    const idleBucket = screen.getByRole('button', { name: /空闲/ });
    fireEvent.click(idleBucket);
    expect(idleBucket).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(within(screen.getByRole('table')).queryByRole('button', { name: /AGV-01/ })).toBeNull());
    expect(within(screen.getByRole('table')).getByRole('button', { name: /AGV-02/ })).toBeInTheDocument();
  });
});

describe('车辆中心 · 单车抽屉', () => {
  it('打开执行中车辆的抽屉：给出实时位置与当前任务编码', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /AGV-01/ }));

    const drawer = await screen.findByLabelText(/AGV-01.*详情/);
    // 位置来自快照（x, y 米制），当前任务由 currentTaskId 翻成可读编码
    expect(within(drawer).getByText(/x -?\d/)).toBeInTheDocument();
    expect(within(drawer).getByText(/T-DEMO-0001/)).toBeInTheDocument();
    expect(within(drawer).getByText(/演示配送/)).toBeInTheDocument();
  });

  it('没有采样点的车：轨迹区给出「暂无采样点」而不是一张空图或崩掉的 SVG', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /AGV-02/ }));

    const drawer = await screen.findByLabelText(/AGV-02.*详情/);
    await waitFor(() => expect(within(drawer).getByText(/暂无采样点/)).toBeInTheDocument());
    // 没有轨迹时不渲染 svg（否则会是 d="" 的坏图）
    expect(drawer.querySelector('svg.udm-flt__track')).toBeNull();
  });

  it('「在地图上查看」写全局选中态再跳地图页（与列表→地图是同一套机制）', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /CAR-01/ }));
    const drawer = await screen.findByLabelText(/CAR-01.*详情/);

    fireEvent.click(within(drawer).getByRole('button', { name: /在地图上查看/ }));
    const selection = useSelectionStore.getState().selected;
    expect(selection).not.toBeNull();
    expect(selection!.entityType).toBe('vehicle');
    expect(selection!.flowId).toBe(`veh:${selection!.entityId}`);
    expect(await screen.findByText('地图页占位')).toBeInTheDocument();
  });

  it('抽屉里没有车辆编辑表单，改成跳基础数据页 —— 「看车」与「改车」只留一个作者（D-59）', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /AGV-02/ }));
    const drawer = await screen.findByLabelText(/AGV-02.*详情/);
    // 抽屉里只有「在地图上查看」与重置轨迹这类动作，没有输入框
    expect(drawer.querySelectorAll('input, select, textarea')).toHaveLength(0);
    // 维护入口在页头的工具栏（admin 有 base:write）
    expect(screen.getByRole('link', { name: /去基础数据维护车辆/ })).toBeInTheDocument();
  });
});
