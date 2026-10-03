import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';
import { DispatchPage } from './DispatchPage';

/**
 * 调度中心页（M5 路径规划部分）的**渲染与交互**。
 *
 * 用 mock 适配器（jsdom 没有 preload 桥，`api/index.ts` 按 D-22 自动选 `mock`），
 * 因此这一组用例同时是「浏览器形态下这一页能用」的证明。
 *
 * ⚠️ 这里必须先**真的登录一次**再设会话：mock 的写路径（`POST /api/routes/plan`）会
 * 校验会话与 `route:plan` 权限，随手写一个假 token 会得到 `AUTH.REQUIRED`。
 * 这一点与读路径不同（mock 的读路径不校验会话，见 `docs/issues.md` 的登记）。
 */
/** 先登录，再把会话写进 store —— 顺序不能反（写路径需要会话里真的有这个 token）。 */
async function loginAsAdmin(): Promise<string> {
  const result = await apiClient.invoke<{ token: string; user: unknown }>('/api/auth/login', {
    username: 'admin',
    password: 'admin123'
  }, null, { method: 'POST' });
  if (result.code !== 0) {
    throw new Error('mock 登录失败，无法进行写路径用例');
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
    <MemoryRouter>
      <DispatchPage />
    </MemoryRouter>
  );
  // 节点下拉要先加载出来，否则选不到起点（`usePagedList` 是异步的）
  await waitFor(() => {
    expect(within(screen.getByLabelText('起点节点')).getAllByRole('option').length).toBeGreaterThan(1);
  });
  return { ...view, token };
}

function planRoute(from: string, to: string, via = '') {
  fireEvent.change(screen.getByLabelText('起点节点'), { target: { value: from } });
  fireEvent.change(screen.getByLabelText('终点节点'), { target: { value: to } });
  if (via) {
    fireEvent.change(screen.getByLabelText('途经点（可选）'), { target: { value: via } });
  }
  fireEvent.click(screen.getByRole('button', { name: '规划路线' }));
}

describe('DispatchPage · 路径规划', () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null });
  });

  it('两块都在页面上，且注明「规划不落库」（否则会让人以为规划结果就是任务实际路线）', async () => {
    await renderPage();
    // M4 调度台与 M5 路径规划同时存在；徽标如实标注各自可用范围
    expect(screen.getByLabelText('调度台')).toBeInTheDocument();
    expect(screen.getByLabelText('路径规划')).toBeInTheDocument();
    expect(screen.getByText('策略预览 · 应用派发可用')).toBeInTheDocument();
    expect(screen.getByText('路径规划可用')).toBeInTheDocument();
    // 页面里必须有一句话说明「规划只预览、不落库，路线在应用派发时才写入」
    expect(screen.getByText(/任务实际使用的路线在/)).toBeInTheDocument();
  });

  it('未选起终点就规划 → 逐字段提示，且不发请求（不显示结果）', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: '规划路线' }));
    expect(await screen.findByText('请选择起点节点')).toBeInTheDocument();
    expect(screen.getByText('请选择终点节点')).toBeInTheDocument();
    expect(screen.getByText('还没有规划结果')).toBeInTheDocument();
  });

  it('规划 N01 → N12：显示摘要、节点链与「无需提醒」', async () => {
    await renderPage();
    planRoute('seed-n-N01', 'seed-n-N12');
    await waitFor(() => {
      expect(screen.getByText('300 m')).toBeInTheDocument();
    });
    // 摘要里的五项（里程 / 耗时 / 节点数 / 边数 / 算法）
    expect(screen.getByText('200 s')).toBeInTheDocument();
    expect(screen.getByText('3 个')).toBeInTheDocument();
    expect(screen.getByText('2 条')).toBeInTheDocument();
    // 节点链用编码示人，并且首尾是选中的那两个
    const chain = screen.getByLabelText('经过的节点');
    expect(chain.textContent).toContain('N01');
    expect(chain.textContent).toContain('N12');
    expect(chain.textContent).not.toContain('seed-n-N01');
    // 这条路两段都是主路、weight=1 → 没有慢速段/绕行警告
    expect(screen.getByText(/没有需要提醒的地方/)).toBeInTheDocument();
  });

  it('带途经点时节点链里出现该节点', async () => {
    await renderPage();
    planRoute('seed-n-N01', 'seed-n-N12', 'N22');
    await waitFor(() => {
      expect(screen.getByText(/没有需要提醒的地方|限速|绕行/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText('经过的节点').textContent).toContain('N22');
  });

  it('途经点写了不存在的编码 → 明确报出哪个词认不出来，而不是静默丢掉', async () => {
    await renderPage();
    planRoute('seed-n-N01', 'seed-n-N12', 'N99');
    expect(await screen.findByText(/N99/)).toBeInTheDocument();
    expect(screen.getByText('还没有规划结果')).toBeInTheDocument();
  });

  it('参数不合法时**清掉上一次的结果**：旧路线不能被读成这次的答案', async () => {
    await renderPage();
    planRoute('seed-n-N01', 'seed-n-N12');
    await waitFor(() => expect(screen.getByLabelText('经过的节点')).toBeInTheDocument());
    // 改成一个认不出的途经点再规划 → 结果区必须回到空态
    fireEvent.change(screen.getByLabelText('途经点（可选）'), { target: { value: 'N99' } });
    fireEvent.click(screen.getByRole('button', { name: '规划路线' }));
    await waitFor(() => expect(screen.getByText('还没有规划结果')).toBeInTheDocument());
    expect(screen.queryByLabelText('经过的节点')).not.toBeInTheDocument();
  });

  it('对比两个算法：表格两行 + 一致结论', async () => {
    const { container } = await renderPage();
    planRoute('seed-n-N01', 'seed-n-N12');
    // 先等上一条请求结束：进行中时两个按钮都是 disabled（防重复提交），
    // 抢着点会「什么都没发生」，而那种失败在断言层面表现得像功能坏了
    await waitFor(() => expect(screen.getByText('300 m')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '对比 A* / Dijkstra' }));
    await waitFor(() => {
      expect(screen.getByText('两个算法结果一致：里程与耗时完全相同')).toBeInTheDocument();
    });
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('A*');
    expect(rows[1]!.textContent).toContain('Dijkstra');
    // 两行的里程都必须是格式化后的「300 m」，而不是 300 或 300.0
    expect(rows[0]!.textContent).toContain('300 m');
  });
});
