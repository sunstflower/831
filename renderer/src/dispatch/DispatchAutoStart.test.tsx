import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';
import { DispatchConsole } from './DispatchConsole';

/**
 * 「派发后立即开跑」的**端到端**（Req-M4-9 / D-58，jsdom + mock 适配器）。
 *
 * ## 为什么单独一个文件
 *
 * mock 适配器是**内存库**：这里的用例会真的把 6 条待派任务派出去并让车开跑，
 * 之后同一文件里的「读 seed 初始形态」用例就再也对不上了。`DispatchConsole.test.tsx`
 * 的文件头已记过这条教训（写测试与读测试分开文件），这里沿用同一条切法。
 *
 * ## 这一条要证明的三件事
 *
 *   1. 开关**默认随权限**打开（admin 有 `execution:start`）——「应用后车就跑」是默认行为；
 *   2. apply 之后渲染层确实**逐单**调了 `POST /api/execution/tasks/{id}/start`；
 *   3. 回执把这两步合成一句话，并同屏给出本批次的冲突 / 超时预检（Req-M4-10）。
 *
 * 汇总文案的分支（部分失败 / 全跳过）在 `applyFlow.test.ts` 里逐条钉住，
 * 这里只验证默认路径真的接通了。
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

/** 全选候选 → 选「全部（对比）」→ 预览，等到对比表出现。 */
async function previewAll() {
  const toggle = await screen.findByRole('button', { name: /^(全选|清空)$/ });
  if (toggle.textContent === '全选') {
    fireEvent.click(toggle);
  }
  fireEvent.click(screen.getByRole('radio', { name: /全部（对比）/ }));
  fireEvent.click(screen.getByRole('button', { name: '预览派发' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: '策略对比' })).toBeInTheDocument(), { timeout: 20000 });
}

beforeEach(() => {
  useSessionStore.setState({ token: null, user: null });
});

describe('调度台 · 派发即开跑（D-58 端到端）', () => {
  it('开关默认打开；应用后逐单开跑，回执给出「N 单已开始执行」并显示本批次预检', async () => {
    await renderConsole();
    await previewAll();

    // admin 有 execution:start → 开关出现且默认勾选（没有该权限的角色看不到这个开关）
    expect(screen.getByLabelText(/派发后立即开跑/)).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /^应用这 \d+ 条派发$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确认应用派发/ }));

    // 回执一句话同时说清「派发了多少」与「其中多少已经在跑」——
    // 只报前者会让人以为没开跑的那几单也上路了
    expect(await screen.findByText(/已派发 \d+ 单.*\d+ 单已开始执行/, undefined, { timeout: 20000 })).toBeInTheDocument();

    // 同屏的冲突 / 超时预检（Req-M4-10）：判定来自服务端，这里只断言区块在、且已经出结论
    const risk = await screen.findByLabelText('本批次预检');
    await waitFor(() => expect(risk).not.toHaveTextContent('正在扫描'), { timeout: 10000 });
  }, 40000);
});
