import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AlertsPage } from './AlertsPage';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';

/**
 * 告警中心的**批量处置**（jsdom + mock 适配器）。
 *
 * 单独一个文件：本条用例会真的把演示告警从 `new` 推到 `acknowledged`，
 * 而 `mock` 是内存库 —— 与 `OpsPages.test.tsx` 的读用例放一起会互相污染
 * （那里断言的是「`new` 只能认领」，跑在这里之后就永远是假的了）。
 * 同一条纪律见 `BaseDataPage.write.test.tsx` 的文件头。
 */
async function renderAs(role: 'admin' | 'monitor' = 'monitor') {
  const login = await apiClient.invoke<{ token: string }>(
    '/api/auth/login',
    { username: role, password: role === 'admin' ? 'admin123' : 'monitor123' },
    null,
    { method: 'POST' }
  );
  expect(login.code, '测试前置：登录失败').toBe(0);
  useSessionStore.setState({
    token: login.code === 0 ? login.data.token : null,
    user: { id: `seed-${role}`, username: role, role, displayName: role, permissions: [] }
  });
  return render(
    <MemoryRouter>
      <AlertsPage />
    </MemoryRouter>
  );
}

describe('告警中心 · 批量认领', () => {
  it('monitor（有 alert:ack）一键认领本页待确认告警：真的落了状态，不只是弹了条提示', async () => {
    await renderAs('monitor');

    const batch = await screen.findByRole('button', { name: /批量认领本页待确认（1）/ });
    expect(batch).toBeEnabled();
    // 按钮自己说清它会做什么（逐条打认领接口），不给一个猜不出后果的「批量处理」
    expect(batch).toHaveAttribute('title', expect.stringContaining('共 1 条'));

    fireEvent.click(batch);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已认领 1 条告警。'));

    // 状态真的变了：列表上出现「已确认」，且不再有待确认可认领
    await waitFor(() => expect(screen.getAllByText('已确认').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('button', { name: /批量认领/ })).toBeDisabled());

    // 用接口回读一次：确认这不是「只改了前端文案」
    const listed = await apiClient.invoke<{ records: Array<{ status: string; ackBy: string | null }> }>(
      '/api/alerts',
      { page: 1, pageSize: 20 },
      useSessionStore.getState().token
    );
    expect(listed.code).toBe(0);
    if (listed.code === 0) {
      expect(listed.data.records[0]).toMatchObject({ status: 'acknowledged' });
      expect(listed.data.records[0]!.ackBy).not.toBeNull();
    }
  });

  it('已终结的告警不再参与批量认领：本页没有待确认时按钮直接禁用并说明原因', async () => {
    // 上一条用例已把演示告警认领掉；再点一次不该产生任何请求
    await renderAs('monitor');
    const batch = await screen.findByRole('button', { name: /批量认领/ });
    await waitFor(() => expect(batch).toBeDisabled());
    expect(batch).toHaveAttribute('title', '本页没有待确认的告警');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
