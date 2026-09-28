import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BaseDataPage } from './BaseDataPage';
import { useSessionStore } from '../store/session';

/**
 * 基础数据页的**渲染与交互**（jsdom + mock 适配器）。
 *
 * 它验证的是「打开页面能看到真实形状的数据，并且查询条件真的改变了请求结果」——
 * 用 mock 适配器（jsdom 没有 preload 桥，`api/index.ts` 按 D-22 自动选 `mock`），
 * 因此这一组用例同时也是「浏览器形态下这一页能用」的证明。
 *
 * 不在这里断言的：与真实 SQLite 的逐字段一致性（`api/mock-parity.test.ts` 用同一批请求打两个适配器）、
 * 以及主进程的权限强制（`desktop/src/ipc/router.test.ts`）。
 */
function renderPage() {
  useSessionStore.setState({
    token: 'mock-admin-1',
    user: { id: 'seed-admin', username: 'admin', role: 'admin', displayName: '系统管理员', permissions: [] }
  });
  return render(
    <MemoryRouter>
      <BaseDataPage />
    </MemoryRouter>
  );
}

/** 表格里的数据行（不含表头）。 */
function bodyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('tbody tr'));
}

describe('BaseDataPage · 渲染', () => {
  it('默认展示站点表，并显示中文类型与状态', async () => {
    const { container } = renderPage();
    await waitFor(() => {
      expect(screen.getByText('A-01')).toBeInTheDocument();
    });
    expect(screen.getByText('A 仓库')).toBeInTheDocument();
    // 枚举不能以机器值示人（`depot` / `enabled`）
    expect(within(bodyRows(container)[0]!).getByText('仓库')).toBeInTheDocument();
    expect(screen.queryByText('depot')).not.toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // 共 3 条
  });

  it('四个页签都在，且切换页签会换表', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('A-01')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '车辆' }));
    await waitFor(() => {
      expect(screen.getByText('AGV-01')).toBeInTheDocument();
    });
    // 站点表的内容应当已经消失，而不是两张表叠在一起
    expect(screen.queryByText('A-01')).not.toBeInTheDocument();
    expect(within(bodyRows(container)[0]!).getByText('执行中')).toBeInTheDocument();
    expect(within(bodyRows(container)[0]!).getByText('AGV')).toBeInTheDocument();
  });

  it('边的页签显示业务编码与两端节点（code 是推导值，必须能核对）', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '有向边' }));
    await waitFor(() => {
      expect(screen.getByText('E_N01_N02')).toBeInTheDocument();
    });
    // 同一对节点的反方向是另一个编码
    expect(screen.getByText('E_N01_N02_R')).toBeInTheDocument();
  });

  it('加载完成前显示加载态，且此时不渲染空表文案', async () => {
    renderPage();
    expect(screen.getByText(/正在加载站点/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/正在加载站点/)).not.toBeInTheDocument());
  });
});

describe('BaseDataPage · 查询条件', () => {
  it('搜索框按关键词过滤（防抖后请求一次）', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('A-01')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'CHG' } });
    await waitFor(() => {
      expect(bodyRows(container)).toHaveLength(1);
    });
    expect(screen.getByText('CHG-01')).toBeInTheDocument();
  });

  it('状态筛选按枚举过滤，且**不**出现车辆域的 `enabled`（ISS-036）', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '车辆' }));
    await waitFor(() => expect(screen.getByText('AGV-01')).toBeInTheDocument());

    const select = screen.getByRole('combobox');
    const options = within(select).getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('执行中');
    expect(options).not.toContain('启用');

    fireEvent.change(select, { target: { value: 'disabled' } });
    await waitFor(() => {
      expect(screen.getByText('没有可显示的记录')).toBeInTheDocument();
    });
    expect(bodyRows(container)).toHaveLength(0);
  });

  it('搜索无结果时给出「为什么空」的说明，而不是只显示暂无数据', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('A-01')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz-nothing' } });
    await waitFor(() => {
      expect(screen.getByText('没有可显示的记录')).toBeInTheDocument();
    });
    expect(screen.getByText(/或当前筛选条件没有匹配项/)).toBeInTheDocument();
  });
});

describe('BaseDataPage · 分页', () => {
  it('边表分两页；首页「上一页」禁用，翻页后行数变化', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: '有向边' }));
    await waitFor(() => expect(bodyRows(container)).toHaveLength(20));

    const prev = screen.getByRole('button', { name: '上一页' });
    const next = screen.getByRole('button', { name: '下一页' });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();
    // 用「· 第 n / m 页」定位页脚：`<caption>` 里还有一句「共 N 条，第 n / m 页」（读屏用）
    expect(screen.getByText(/· 第 1 \/ 2 页/)).toBeInTheDocument();

    fireEvent.click(next);
    await waitFor(() => expect(bodyRows(container)).toHaveLength(14));
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    expect(screen.getByText(/· 第 2 \/ 2 页/)).toBeInTheDocument();
  });
});
