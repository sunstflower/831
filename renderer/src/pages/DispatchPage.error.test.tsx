import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';
import { DispatchPage } from './DispatchPage';

/**
 * 调度中心页的**失败形态**（M5 路径规划）。
 *
 * 为什么单独一个文件：本组用例要先往 Mock 的内存表里**建禁行规则**把一条路封掉，
 * 而 `apiClient` 是模块级单例、Mock 的数据在一次页面会话内持续存在 ——
 * 与「读取用例」放同一个文件时，先跑的用例会因为后跑的用例建的规则而结果变化
 * （`mock-parity.test.ts` 的文件头也记了同一条纪律：写用例与读用例必须分文件）。
 */
async function loginAsAdmin() {
  const result = await apiClient.invoke<{ token: string }>('/api/auth/login', {
    username: 'admin',
    password: 'admin123'
  }, null, { method: 'POST' });
  if (result.code !== 0) {
    throw new Error('mock 登录失败');
  }
  useSessionStore.setState({
    token: result.data.token,
    user: { id: 'seed-admin', username: 'admin', role: 'admin', displayName: '系统管理员', permissions: [] }
  });
  return result.data.token;
}

/** 封住 n04 的四条邻边（n04 还在图里，但谁也到不了）——用真实写接口建规则，不直接改内存。 */
async function blockNode04(token: string) {
  for (const edgeId of ['seed-e-N03-N04', 'seed-e-N04-N03', 'seed-e-N04-N08', 'seed-e-N08-N04']) {
    const created = await apiClient.invoke('/api/restrictions', { type: 'edge', targetId: edgeId, reason: '失败形态用例' }, token, {
      method: 'POST'
    });
    expect(created.code, edgeId).toBe(0);
  }
}

describe('DispatchPage · 规划失败形态', () => {
  it('两点不连通 → 结果显示错误码文案与具体原因，而不是空白', async () => {
    const token = await loginAsAdmin();
    await blockNode04(token);
    render(
      <MemoryRouter>
        <DispatchPage />
      </MemoryRouter>
    );
    await waitFor(() => {
      expect(within(screen.getByLabelText('起点节点')).getAllByRole('option').length).toBeGreaterThan(1);
    });
    fireEvent.change(screen.getByLabelText('起点节点'), { target: { value: 'seed-n01' } });
    fireEvent.change(screen.getByLabelText('终点节点'), { target: { value: 'seed-n04' } });
    fireEvent.click(screen.getByRole('button', { name: '规划路线' }));

    const alert = await screen.findByRole('alert');
    // 目录文案（这类失败是什么）+ 内核给出的具体说明（这次为什么失败）都要出现
    expect(alert.textContent).toContain('起点与终点之间不存在可行路径');
    expect(alert.textContent).toContain('seed-n01');
    // 失败时不能同时显示一份「成功的结果摘要」
    expect(screen.queryByLabelText('经过的节点')).not.toBeInTheDocument();
  });
});
