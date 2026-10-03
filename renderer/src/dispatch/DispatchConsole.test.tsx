import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiClient } from '../api';
import { useSelectionStore } from '../store/selection';
import { useSessionStore } from '../store/session';
import { DispatchConsole } from './DispatchConsole';

/**
 * 调度台的**渲染与交互**（jsdom + mock 适配器）。
 *
 * 这一组用例锁的是使用者真正要的那三句话能不能在屏幕上读出来：
 *   1. 「**哪个策略更好、差多少**」—— 对比表两行 + 差异行；
 *   2. 「**这一单走哪条线**」—— 派发明细里的路线段数与里程；
 *   3. 「**派完之后车在哪**」—— 应用成功后能一键去地图上看这批车。
 *
 * 判断本身（谁更优、接力怎么算）在 `model.test.ts` 里逐条钉住；
 * 这里只看它们**有没有被渲染出来**——算对了不显示等于没做。
 */
async function loginAs(username: 'admin' | 'dispatcher', password: string): Promise<string> {
  const result = await apiClient.invoke<{ token: string }>(
    '/api/auth/login',
    { username, password },
    null,
    { method: 'POST' }
  );
  if (result.code !== 0) {
    throw new Error(`mock 登录失败：${username}`);
  }
  useSessionStore.setState({
    token: result.data.token,
    user: { id: `seed-${username}`, username, role: username, displayName: username, permissions: [] }
  });
  return result.data.token;
}

async function renderConsole() {
  await loginAs('admin', 'admin123');
  useSelectionStore.getState().clear();
  return render(
    <MemoryRouter>
      <DispatchConsole />
    </MemoryRouter>
  );
}

/**
 * 按标题文本定位一个 `udm-dispatch__block`。
 *
 * 这些区块是 `<div>` + `<h3>`（不是 `<section aria-label>`），因此**不能用 `getByRole('region')`** ——
 * 写错时得到的是「超时」，而看起来像功能没做出来。定位到标题后再上溯到区块，
 * 等价于使用者「先看标题、再看那块里的表」。
 */
function block(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  return heading.closest('.udm-dispatch__block') as HTMLElement;
}

/** 全选候选 → 选「全部（对比）」→ 预览。返回后对比表应已渲染。 */
async function previewAll() {
  const toggle = await screen.findByRole('button', { name: /^(全选|清空)$/ });
  if (toggle.textContent === '全选') {
    fireEvent.click(toggle);
  }
  fireEvent.click(screen.getByRole('radio', { name: /全部（对比）/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览派发' }));
  // 预览要跑满 6 任务 × 5 车的 A*（jsdom 里比真实浏览器慢），给足时间
  await waitFor(() => expect(screen.getByRole('heading', { name: '策略对比' })).toBeInTheDocument(), {
    timeout: 20000
  });
}

beforeEach(async () => {
  // 每一条用例都从一个干净的会话开始；mock 是内存库，登录只是拿 token
  useSessionStore.setState({ token: null, user: null });
});

describe('调度台 · 策略对比（算法给出的分配差异）', () => {
  it('对比表两行，列出指派数 / 执行里程 / 行驶耗时 / 完成时刻 / 用车', async () => {
    await renderConsole();
    await previewAll();

    const table = within(block('策略对比')).getByRole('table');
    for (const header of ['策略', '指派 / 任务', '拒绝', '执行里程', '行驶耗时', '全部完成', '用车', '总代价']) {
      expect(within(table).getByRole('columnheader', { name: header }), header).toBeInTheDocument();
    }
    // 两个已实现的策略各一行（`genetic` 是二期预留，不在对比里）
    const body = within(table).getAllByRole('row');
    expect(body.length).toBeGreaterThanOrEqual(3); // 表头 + 贪心 + 匈牙利
    expect(within(table).getByRole('cell', { name: '贪心' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '匈牙利' })).toBeInTheDocument();
  });

  it('给出「差在哪」的一句话：谁少跑路 / 谁少花时间 / 谁先做完', async () => {
    await renderConsole();
    await previewAll();
    const panel = block('策略对比');
    await waitFor(() => expect(panel.querySelector('.udm-dispatch__diffs')).not.toBeNull(), { timeout: 5000 });
    expect(panel.querySelector('.udm-dispatch__diffs')!.textContent).toMatch(/更优的地方|没有一项优于/);
  });
});

describe('调度台 · 路线分配', () => {
  it('派发明细给出每一单的路线段数与里程（少了它，「路线分配」只能看合计）', async () => {
    await renderConsole();
    await previewAll();

    // 「派发明细」块里有两张表（计划表 + 拒绝原因表），要的是前者
    const detail = within(block('派发明细')).getAllByRole('table')[0]!;
    expect(within(detail).getByRole('columnheader', { name: '路线（载货段）' })).toBeInTheDocument();
    const body = within(detail).getAllByRole('row').slice(1);
    expect(body.length).toBeGreaterThan(0);
    // 每一行都得有「N 段 · M m」或「无路线」——不能是空单元格
    for (const row of body) {
      const cells = within(row).getAllByRole('cell');
      const route = cells[2]!.textContent ?? '';
      expect(route, `第 ${cells[0]!.textContent} 行的路线列`).toMatch(/(\d+ 段 · \d+ m)|无路线/);
    }
  });
});

describe('调度台 · 派发之后去看车', () => {
  it('应用成功后给出「在地图上查看这 N 台车」，点了选中这批的第一台车', async () => {
    await renderConsole();
    await previewAll();

    fireEvent.click(screen.getByRole('button', { name: /^应用这 \d+ 条派发$/ }));
    const confirm = await screen.findByRole('button', { name: /确认应用派发/ });
    fireEvent.click(confirm);

    // 用文案定位而不是 `getByRole('status')`：推荐语那一行也是 `role="status"`，
    // 按角色取会随渲染顺序命中另一个（失败信息则完全指不到真正的原因）
    await screen.findByText(/已派发 \d+ 单/, undefined, { timeout: 10000 });

    const toMap = await screen.findByRole('button', { name: /在地图上查看这 \d+ 台车/ });
    fireEvent.click(toMap);
    // 点了之后全局选中态里必须真的有一台车：地图页读的就是它（不是让使用者再找一次）
    const selection = useSelectionStore.getState().selected;
    expect(selection).not.toBeNull();
    expect(selection!.entityType).toBe('vehicle');
    expect(selection!.flowId).toBe(`veh:${selection!.entityId}`);
  }, 20000);
});
