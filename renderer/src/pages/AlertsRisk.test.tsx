import '../test/dom-stubs';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  render(
    <MemoryRouter>
      <AlertsPage />
    </MemoryRouter>
  );
  return login.code === 0 ? login.data.token : null;
}

describe('告警中心 · 任务风险预检', () => {
  it('列出「未派发」缺口：每一条待派任务都在清单里，并指向调度中心', async () => {
    const token = await renderAs('monitor', 'monitor123');
    const panel = await screen.findByRole('region', { name: '任务风险预检' });
    expect(panel).toBeInTheDocument();

    /*
     * 待派任务的**编码与条数都从任务列表接口读**，不在用例里硬编码 ——
     * 种子扩容（6 → 12）时，硬编码的那一份会以「用例红了」的形态出现，
     * 看起来像功能坏了，实际只是夹具过时。
     */
    const page = await apiClient.invoke<{ records: Array<{ code: string }> }>(
      '/api/tasks',
      { status: 'pending', pageSize: 100 },
      token
    );
    expect(page.code).toBe(0);
    const codes = page.code === 0 ? page.data.records.map((record) => record.code) : [];
    expect(codes.length).toBeGreaterThan(1); // 护栏：读不到任务时下面的循环会「全过」

    // 首屏最该看到的缺口：一条都不该漏
    await waitFor(() => expect(panel).toHaveTextContent('未派发'));
    for (const code of codes) {
      expect(panel, code).toHaveTextContent(code);
    }
    // 结论行说清有几条、去哪儿处理
    expect(panel).toHaveTextContent(new RegExp(`其中 ${codes.length} 条完全没有安排车辆`));
    expect(screen.getByRole('link', { name: '去调度中心派发' })).toBeInTheDocument();
  });

  /*
   * `ISS-096` 的回归：一条派发都没应用时，面板**不能**出现「派发冲突」那一节 ——
   * 使用者正是在这里读出了「我没派发，凭什么说有冲突」。
   * 待派 / 过期那一节则必须照常出现（它们与有没有派发无关）。
   */
  it('一条派发都没应用时，只有「待派与超时缺口」一节，不出现「派发冲突」', async () => {
    await renderAs('monitor', 'monitor123');
    const panel = await screen.findByRole('region', { name: '任务风险预检' });
    await waitFor(() => expect(panel).toHaveTextContent('未派发'));

    expect(within(panel).getByRole('heading', { name: '待派与超时缺口' })).toBeInTheDocument();
    // 判据落在**节标题**上：正文里有意提到这一节的名字（解释它为什么是空的），
    // 用「整段文本不含这个词」会把那段解释也算成失败
    expect(within(panel).queryByRole('heading', { name: '派发冲突与执行风险' })).toBeNull();
    // 面板要写清「为什么这一节是空的」——否则下次还是会被读成 bug
    expect(panel).toHaveTextContent(/还没派发就必然是空的/);
  });

  it('预检区块明确写着「不是告警、不能认领」—— 否则使用者会去找认领按钮', async () => {
    await renderAs('monitor', 'monitor123');
    const panel = await screen.findByRole('region', { name: '任务风险预检' });
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
