import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TasksPage } from './TasksPage';
import { useSessionStore } from '../store/session';
import { apiClient } from '../api';

/**
 * 任务页的**读取与渲染**（jsdom + mock 适配器）。
 *
 * 写操作单独一个文件（`TasksPage.write.test.tsx`）：mock 适配器是内存库，
 * 写测试会真的改数据，与「读 seed 初始形态」的断言放在一起会互相污染。
 *
 * 这里断言的是**页面行为**：列表显示什么、筛选发给主进程什么、
 * 哪个角色看到哪些按钮。载荷口径在 `task/model.test.ts` 与 `task/form.test.ts`，
 * 状态机与副作用在 `task/actions.test.ts` 与 `desktop/.../task.service.test.ts`。
 */
async function renderPage(role: 'admin' | 'dispatcher' | 'monitor' = 'admin') {
  // **必须真的登录**：mock 的会话表只认识登录后发出的 token，随手编一个会得到 AUTH.REQUIRED
  const password = role === 'monitor' ? 'monitor123' : role === 'dispatcher' ? 'dispatcher123' : 'admin123';
  const login = await apiClient.invoke<{ token: string }>('/api/auth/login', { username: role, password }, null, { method: 'POST' });
  expect(login.code, '测试前置：登录失败').toBe(0);
  useSessionStore.setState({
    token: login.code === 0 ? login.data.token : null,
    user: { id: `seed-${role}`, username: role, role, displayName: role, permissions: [] }
  });
  return render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>
  );
}

/** 等 seed 的演示任务出现（`T-DEMO-0001`，状态 running）。 */
async function loaded() {
  await waitFor(() => expect(screen.getByText('T-DEMO-0001')).toBeInTheDocument());
}

function rowOf(text: string): HTMLElement {
  const cell = screen.getByText(text);
  const row = cell.closest('tr');
  expect(row, `找不到包含「${text}」的数据行`).not.toBeNull();
  return row as HTMLElement;
}

describe('TasksPage · 列表', () => {
  it('默认展示任务列表：中文状态、中文优先级、起终点与进度', async () => {
    await renderPage();
    await loaded();

    const row = rowOf('T-DEMO-0001');
    expect(within(row).getByText('执行中')).toBeInTheDocument();
    expect(within(row).getByText('普通')).toBeInTheDocument();
    expect(within(row).getByText('配送中心 → 北苑学生宿舍 演示配送')).toBeInTheDocument();
    expect(within(row).getByText('AGV-01')).toBeInTheDocument();
    expect(within(row).getByText('42%')).toBeInTheDocument();
    // 无时间窗的任务说「不限时段」，而不是显示成破折号（那是数据缺失的样子）
    expect(within(row).getByText('不限时段')).toBeInTheDocument();
  });

  it('加载完成后不再显示「正在加载」', async () => {
    await renderPage();
    await loaded();
    expect(screen.queryByText(/正在加载任务/)).not.toBeInTheDocument();
  });

  it('筛选条件的说明写清楚了「进行中」包含哪些状态，且用的是状态列里的同一套称呼', async () => {
    await renderPage();
    await loaded();
    // 文案由 `TASK_STATUS_LABEL` 拼出，因此这里的期望值也用标签本身写 ——
    // 一旦有人把状态的叫法改了（如「待派」→「待派发」），两边会同时变，不会留下两个说法
    const text = ['draft', 'pending', 'assigned', 'running', 'paused']
      .map((status) => ({ draft: '草稿', pending: '待派', assigned: '已派发', running: '执行中', paused: '已暂停' })[status])
      .join(' / ');
    expect(screen.getByText(new RegExp(text.replace(/ \/ /g, ' / ')))).toBeInTheDocument();
  });
});

describe('TasksPage · 筛选', () => {
  it('搜索框按关键词过滤（防抖后请求一次）', async () => {
    await renderPage();
    await loaded();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'T-DEMO' } });
    await waitFor(() => expect(screen.getByText('T-DEMO-0001')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在的任务' } });
    await waitFor(() => expect(screen.getByText('没有可显示的任务')).toBeInTheDocument(), { timeout: 2000 });
    // 空态要解释「为什么空」，而不是只显示「暂无数据」
    expect(screen.getByText(/先新建草稿，再提交进候选池/)).toBeInTheDocument();
  });

  it('状态筛选默认「全部状态」，切到终态后演示任务被筛掉', async () => {
    await renderPage();
    await loaded();

    const statusSelect = screen.getByLabelText('按状态筛选');
    expect(statusSelect).toHaveValue('');
    // 「进行中（未结束）」是一个逗号组合 —— running 在其中，任务应当仍在
    fireEvent.change(statusSelect, { target: { value: 'draft,pending,assigned,running,paused' } });
    await waitFor(() => expect(screen.getByText('T-DEMO-0001')).toBeInTheDocument());

    fireEvent.change(statusSelect, { target: { value: 'finished' } });
    await waitFor(() => expect(screen.getByText('没有可显示的任务')).toBeInTheDocument());
  });

  it('车辆下拉来自基础数据（可选到 seed 的车）', async () => {
    await renderPage();
    await loaded();
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('按执行车辆筛选'))
          .getAllByRole('option')
          .some((option) => (option as HTMLOptionElement).textContent?.includes('AGV-01'))
      ).toBe(true)
    );
  });
});

describe('TasksPage · 权限', () => {
  it('monitor（只读）看不到操作列与「新建任务」按钮', async () => {
    await renderPage('monitor');
    await loaded();

    expect(screen.queryByRole('button', { name: '新建任务' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '操作' })).not.toBeInTheDocument();
    // 状态操作按钮同样不渲染 —— 一个点不动的按钮比没有按钮更糟
    expect(screen.queryByRole('button', { name: '暂停' })).not.toBeInTheDocument();
    expect(screen.getByText(/需要 task:write 权限/)).toBeInTheDocument();
  });

  it('dispatcher 能操作任务（有 task:write）', async () => {
    await renderPage('dispatcher');
    await loaded();
    expect(screen.getByRole('button', { name: '新建任务' })).toBeInTheDocument();
    expect(within(rowOf('T-DEMO-0001')).getByRole('button', { name: '暂停' })).toBeInTheDocument();
  });

  it('操作按钮按状态渲染：running 有暂停 / 取消 / 重派，没有「提交」', async () => {
    await renderPage();
    await loaded();
    const row = rowOf('T-DEMO-0001');
    expect(within(row).getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '取消任务' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '重派' })).toBeInTheDocument();
    // 已派发/执行中的任务不能直接编辑（要改就走重派），因此没有「编辑」
    expect(within(row).queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '提交' })).not.toBeInTheDocument();
  });
});

describe('TasksPage · 详情', () => {
  it('点任务编码打开详情：含当前计划、最近操作等列表上没有的信息', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'T-DEMO-0001' }));
    const dialog = await screen.findByRole('dialog', { name: '任务详情' });
    await waitFor(() => expect(within(dialog).getByText('当前计划')).toBeInTheDocument());
    expect(within(dialog).getByText('关联告警（0）')).toBeInTheDocument();
    expect(within(dialog).getByText('最近操作')).toBeInTheDocument();
    // 货物一行是「100 kg · 演示货物」，因此用正则匹配而不是整串相等
    expect(within(dialog).getByText(/演示货物/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '任务详情' })).not.toBeInTheDocument();
  });
});
