import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';
import { DispatchConsole } from './DispatchConsole';

/**
 * 调度中心的**新建订单入口**（Req-M4-8，jsdom + mock 适配器）。
 *
 * 单独一个文件的原因与 `DispatchAutoStart.test.tsx` 相同：mock 是内存库，
 * 这里的用例会真的建单（第二条还会派发），与「读 seed 初始形态」的用例放一起会互相污染。
 *
 * 断言的是使用者能看见的三件事：
 *   1. 建完单它会**进入待派候选池并自动被勾选**（不用再去几百条任务里找刚建的那条）；
 *   2. 本批次预检立刻把它列成「未派发」（这正是「新订单提交告警中心」这一环）；
 *   3. 紧接着再建单时，**上一批**的「在地图上查看 N 台车」必须消失 ——
 *      这条是 2026-10-03 Electron 走查发现的：两个动作的产物并排出现，
 *      新订单的提示看起来像「这一单已经派了 2 台车」（见 `docs/issues.md` ISS-090）。
 */
async function renderConsole() {
  const login = await apiClient.invoke<{ token: string }>(
    '/api/auth/login',
    { username: 'admin', password: 'admin123' },
    null,
    { method: 'POST' }
  );
  if (login.code !== 0) {
    throw new Error(`测试前置：mock 登录失败（${login.message}）`);
  }
  useSessionStore.setState({
    token: login.data.token,
    user: { id: 'seed-admin', username: 'admin', role: 'admin', displayName: '系统管理员', permissions: [] }
  });
  return render(
    <MemoryRouter>
      <DispatchConsole />
    </MemoryRouter>
  );
}

/** 打开「新建订单」弹层并填一条可提交的单。 */
async function fillNewOrder(title: string) {
  fireEvent.click(screen.getByRole('button', { name: '新建订单' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: title } });
  fireEvent.change(within(dialog).getByLabelText('载重 (kg)'), { target: { value: '60' } });
  for (const [label, id] of [
    ['起点站点', 'seed-site-DEPOT'],
    ['终点站点', 'seed-site-ST02']
  ] as const) {
    const select = within(dialog).getByLabelText(label);
    // 候选项是异步拉来的：选项还不存在时 change 会被丢弃，于是提交报「必填」
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1), { timeout: 10000 });
    fireEvent.change(select, { target: { value: id } });
  }
  fireEvent.click(within(dialog).getByRole('button', { name: '创建并提交' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 20000 });
  return dialog;
}

function selectedCandidateCodes(): string[] {
  return [...document.querySelectorAll('.udm-dispatch__candidate input:checked')]
    .map((input) => (input.closest('label')?.textContent ?? '').trim())
    .filter(Boolean);
}

beforeEach(() => {
  useSessionStore.setState({ token: null, user: null });
});

describe('调度中心 · 新建订单入口（主链路的起点）', () => {
  it('建完单就进入候选池并被自动勾选，同时本批次预检把它列成「未派发」', async () => {
    await renderConsole();
    await waitFor(() => expect(screen.getByRole('button', { name: '新建订单' })).toBeInTheDocument());

    await fillNewOrder('加单：西区食堂 → 图书馆');

    // 1. 提示说清它到哪去了（「待派队列」而不是含糊的「创建成功」）
    expect(screen.getByText(/已新建订单.*待派队列/)).toBeInTheDocument();
    // 2. 自动勾选：刚好一条，且就是刚建的那条
    const checked = selectedCandidateCodes();
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('加单：西区食堂 → 图书馆');
    // 3. 预检立刻给出结论（Req-M4-10 的第一个时点：创建后）
    const risk = await screen.findByLabelText('本批次预检');
    await waitFor(() => expect(risk).toHaveTextContent('未派发'), { timeout: 10000 });
    expect(risk).toHaveTextContent(/没有安排车辆/);
  }, 40000);

  it('派发后再建单：上一批的「在地图上查看 N 台车」不再挂着（走查发现的串味）', async () => {
    await renderConsole();
    const toggle = await screen.findByRole('button', { name: /^(全选|清空)$/ });
    if (toggle.textContent === '全选') {
      fireEvent.click(toggle);
    }
    fireEvent.click(screen.getByRole('radio', { name: /全部（对比）/ }));
    fireEvent.click(screen.getByRole('button', { name: '预览派发' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '策略对比' })).toBeInTheDocument(), { timeout: 20000 });

    fireEvent.click(screen.getByRole('button', { name: /^应用这 \d+ 条派发$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确认应用派发/ }));
    // 先确认这一批确实产生了那个按钮（否则下一条断言会因为「本来就没有」而假绿）
    expect(await screen.findByRole('button', { name: /在地图上查看这 \d+ 台车/ }, { timeout: 20000 })).toBeInTheDocument();

    await fillNewOrder('派发之后再建的一单');

    expect(screen.getByText(/已新建订单/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /在地图上查看这 \d+ 台车/ })).toBeNull();
  }, 40000);
});
