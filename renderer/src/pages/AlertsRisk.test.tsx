import '../test/dom-stubs';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AlertsPage } from './AlertsPage';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';

/**
 * 告警中心的**风险预检与派发区块**（jsdom + mock 适配器）。
 *
 * 单独一个文件的原因与 `AlertsBatch.test.tsx` 相同：这里读到的「当前派发」
 * 是 mock 内存库的快照，而与写入类用例放一起会被它们改掉。
 *
 * 用例只断言**用户能看见的结论**：有没有列出冲突 / 超时、派发是不是按车辆分组，
 * 而不是去比一段文案 —— 文案改一个字不该让用例变红。
 */
async function renderAs(username: 'admin' | 'dispatcher' | 'monitor', password: string) {
  const login = await apiClient.invoke<{ token: string }>(
    '/api/auth/login',
    { username, password },
    null,
    { method: 'POST' }
  );
  expect(login.code, '测试前置：登录失败').toBe(0);
  useSessionStore.setState({
    token: login.code === 0 ? login.data.token : null,
    user: { id: `seed-${username}`, username, role: username, displayName: username, permissions: [] }
  });
  return render(
    <MemoryRouter>
      <AlertsPage />
    </MemoryRouter>
  );
}

describe('告警中心 · 任务风险预检', () => {
  it('列出「未派发」缺口：6 条待派任务都在清单里，并指向调度中心', async () => {
    await renderAs('monitor', 'monitor123');
    const panel = await screen.findByRole('region', { name: '任务冲突与超时预检' });
    expect(panel).toBeInTheDocument();

    // 种子数据的 6 条待派任务一条都不该漏（这是首屏最该看到的缺口）
    await waitFor(() => expect(panel).toHaveTextContent('未派发'));
    for (const code of ['T-DEMO-0002', 'T-DEMO-0003', 'T-DEMO-0004', 'T-DEMO-0005', 'T-DEMO-0006', 'T-DEMO-0007']) {
      expect(panel, code).toHaveTextContent(code);
    }
    // 结论行说清有几条、去哪儿处理
    expect(panel).toHaveTextContent(/还有 6 条待派发任务没有安排车辆/);
    expect(screen.getByRole('link', { name: '去调度中心派发' })).toBeInTheDocument();
  });

  it('预检区块明确写着「不是告警、不能认领」—— 否则使用者会去找认领按钮', async () => {
    await renderAs('monitor', 'monitor123');
    const panel = await screen.findByRole('region', { name: '任务冲突与超时预检' });
    await waitFor(() => expect(panel).toHaveTextContent('未派发'));
    // 区块内**没有**任何一个告警操作按钮
    expect(panel.querySelectorAll('button').length).toBe(0);
  });
});

describe('告警中心 · 任务分配派发区块', () => {
  it('按车辆分组列出已生效派发，并标出「接力」', async () => {
    await renderAs('monitor', 'monitor123');
    const panel = await screen.findByRole('region', { name: '任务分配派发' });
    // seed 的演示执行任务挂在 AGV-01 上（它有路线但没有 dispatch_plans 行，
    // 走的是「按 routes.task_id 回退」那条两级查法 —— 见 risk.service.ts）
    await waitFor(() => expect(panel).toHaveTextContent('AGV-01'));
    expect(panel).toHaveTextContent('单趟');
    expect(screen.getByRole('link', { name: '在地图上看' })).toBeInTheDocument();
  });
});
