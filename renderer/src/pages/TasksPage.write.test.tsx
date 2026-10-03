import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TasksPage } from './TasksPage';
import { useSessionStore } from '../store/session';
import { apiClient } from '../api';

/**
 * 任务页的**写操作**（jsdom + mock 适配器）。
 *
 * 与 `TasksPage.test.tsx` 分开一个文件：mock 适配器是内存库，这些用例会真的
 * 建任务、暂停、取消、删除；而读测试断言的是 seed 的初始形态。混在一起时
 * 用例顺序一变就会互相污染 —— 那种失败看起来像「功能坏了」，排查成本远高于拆文件。
 *
 * 这里断言**端到端行为**（点得动、拦得住、改完看得见、副作用真的发生了），
 * 不是渲染细节：载荷口径在 `task/form.test.ts`，状态机在 `shared` 与领域层用例里。
 */
async function renderPage(role: 'admin' | 'monitor' = 'admin') {
  const login = await apiClient.invoke<{ token: string }>('/api/auth/login', {
    username: role,
    password: role === 'admin' ? 'admin123' : 'monitor123'
  }, null, { method: 'POST' });
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

async function loaded() {
  await waitFor(() => expect(screen.getByText('T-DEMO-0001')).toBeInTheDocument());
}

/**
 * 用展示编码换内部 id（接口按 id 操作，而界面上只显示编码）。
 *
 * 这本身也说明了一件事：使用者手上的「任务标识」是编码，而接口要的是 id ——
 * 页面内部一直持有 id（列表行数据里就有），因此这个转换只发生在测试里。
 */
async function idOf(code: string): Promise<string> {
  const result = await apiClient.invoke<{ records: Array<{ id: string; code: string }> }>(
    '/api/tasks',
    { keyword: code, page: 1, pageSize: 20 },
    useSessionStore.getState().token
  );
  expect(result.code, `测试前置：查不到任务 ${code}`).toBe(0);
  const found = result.code === 0 ? result.data.records.find((row) => row.code === code) : undefined;
  expect(found, `测试前置：列表里没有 ${code}`).toBeDefined();
  return found!.id;
}

function rowOf(text: string): HTMLElement {
  const cell = screen.getByText(text);
  const row = cell.closest('tr');
  expect(row, `找不到包含「${text}」的数据行`).not.toBeNull();
  return row as HTMLElement;
}

/** 建一条草稿任务并等它出现在列表里，返回它的编码。 */
async function createDraft(title: string): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: title } });
  fireEvent.change(within(dialog).getByLabelText('载重 (kg)'), { target: { value: '88' } });
  // 起终点的候选项是异步拉来的：`<select>` 的 value 在选项还不存在时会被丢弃
  for (const [label, code] of [
    ['起点站点', 'DEPOT'],
    ['终点站点', 'ST01']
  ] as const) {
    const select = within(dialog).getByLabelText(label);
    await waitFor(() =>
      expect(
        within(select).getAllByRole('option').some((option) => (option as HTMLOptionElement).textContent?.includes(code))
      ).toBe(true)
    );
    const option = within(select)
      .getAllByRole('option')
      .find((item) => (item as HTMLOptionElement).textContent?.includes(code)) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });
  }
  fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已新建任务（草稿）'));
  await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
  const row = rowOf(title);
  return within(row).getAllByRole('cell')[0]!.textContent ?? '';
}

describe('TasksPage · 新建', () => {
  it('必填为空时在客户端就拦住：字段下标红、弹层不关、不发请求', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => expect(within(dialog).getByLabelText('标题')).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByLabelText('标题')).toBeRequired();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('起终点相同被拦下，且原因挂在**终点**字段上', async () => {
    await renderPage();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '同站任务' } });
    fireEvent.change(within(dialog).getByLabelText('载重 (kg)'), { target: { value: '10' } });

    for (const label of ['起点站点', '终点站点'] as const) {
      const select = within(dialog).getByLabelText(label);
      await waitFor(() =>
        expect(
          within(select).getAllByRole('option').some((option) => (option as HTMLOptionElement).textContent?.includes('DEPOT'))
        ).toBe(true)
      );
      const option = within(select)
        .getAllByRole('option')
        .find((item) => (item as HTMLOptionElement).textContent?.includes('DEPOT')) as HTMLOptionElement;
      fireEvent.change(select, { target: { value: option.value } });
    }
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => expect(within(dialog).getByText('起点与终点不能是同一个站点')).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('新建是草稿：状态为「草稿」，可编辑、可提交，没有「暂停」', async () => {
    await renderPage();
    await loaded();
    const code = await createDraft('新建的草稿任务');

    const row = rowOf(code);
    expect(within(row).getByText('草稿')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '提交' })).toBeInTheDocument();
    // 草稿唯一允许的删除方式就是物理删除
    expect(within(row).getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '暂停' })).not.toBeInTheDocument();
  });

  it('编辑草稿：改标题后列表与详情同步', async () => {
    await renderPage();
    await loaded();
    const code = await createDraft('待改标题的任务');

    fireEvent.click(within(rowOf(code)).getByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('标题'), { target: { value: '改好的标题' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存任务修改'));
    await waitFor(() => expect(screen.getByText('改好的标题')).toBeInTheDocument());
  });
});

describe('TasksPage · 状态流转', () => {
  it('提交草稿：状态变「待派发」，提示里带上「从什么变成什么」', async () => {
    await renderPage();
    await loaded();
    const code = await createDraft('准备提交的任务');

    fireEvent.click(within(rowOf(code)).getByRole('button', { name: '提交' }));

    // 「待派」是 `TASK_STATUS_LABEL` 里的叫法，与状态列显示的一字不差
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('草稿 → 待派'));
    await waitFor(() => expect(within(rowOf(code)).getByText('待派')).toBeInTheDocument());
  });

  it('暂停必须写原因：不填时提交按钮禁用，填了才放行', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(within(rowOf('T-DEMO-0001')).getByRole('button', { name: '暂停' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/车辆原地等待/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: '确认暂停' });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', '请先填写原因');

    fireEvent.change(within(dialog).getByLabelText('原因'), { target: { value: '现场临时停电' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('执行中 → 已暂停'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // 暂停原因要能被看见：详情里的「暂停原因」是复盘时唯一的线索
    fireEvent.click(screen.getByRole('button', { name: 'T-DEMO-0001' }));
    const detail = await screen.findByRole('dialog', { name: '任务详情' });
    await waitFor(() => expect(within(detail).getByText('现场临时停电')).toBeInTheDocument());
    fireEvent.click(within(detail).getByRole('button', { name: '关闭' }));

    // 恢复执行，把这个用例对 demo 任务的改动**还原**：
    // mock 的内存表在整个文件里共用，不还原就会让后面「点取消」的用例找不到按钮
    fireEvent.click(within(rowOf('T-DEMO-0001')).getByRole('button', { name: '继续' }));
    await waitFor(() => expect(within(rowOf('T-DEMO-0001')).getByText('执行中')).toBeInTheDocument());
  });

  it('取消运行中的任务：二次确认 + 原因，取消后车辆被回收（回到空闲）', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(within(rowOf('T-DEMO-0001')).getByRole('button', { name: '取消任务' }));
    const dialog = screen.getByRole('alertdialog');
    // 副作用必须写在确认层里：取消不只是改个状态
    expect(within(dialog).getByText(/回收车辆/)).toBeInTheDocument();
    expect(within(dialog).getByText(/superseded|已作废/)).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('原因'), { target: { value: '客户临时取消' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认取消任务' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('执行中 → 已取消'));
    await waitFor(() => expect(within(rowOf('T-DEMO-0001')).getByText('已取消')).toBeInTheDocument());
    // 取消后不该再把车辆显示成自己的
    expect(within(rowOf('T-DEMO-0001')).getByText('—')).toBeInTheDocument();

    // 车辆回到空闲：查基础数据里的车辆清单（这是取消的**真实副作用**，不只是状态列变化）
    const vehicles = await apiClient.invoke<{ records: Array<{ code: string; status: string }> }>(
      '/api/vehicles',
      { page: 1, pageSize: 50 },
      useSessionStore.getState().token
    );
    expect(vehicles.code).toBe(0);
    if (vehicles.code === 0) {
      expect(vehicles.data.records.find((vehicle) => vehicle.code === 'AGV-01')?.status).toBe('idle');
    }
  });

  it('删除草稿要二次确认：确认后行消失（物理删除）', async () => {
    await renderPage();
    await loaded();
    const code = await createDraft('准备删掉的草稿');

    fireEvent.click(within(rowOf(code)).getByRole('button', { name: '删除' }));
    const dialog = screen.getByRole('alertdialog');
    // 删除没有原因可写，但要说清不可撤销
    expect(within(dialog).queryByLabelText('原因')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/不可撤销/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已删除草稿'));
    await waitFor(() => expect(screen.queryByText(code)).not.toBeInTheDocument());
  });

  it('确认层里失败时留在层内报错，不关层也不丢输入（状态冲突）', async () => {
    await renderPage();
    await loaded();
    const code = await createDraft('会被抢先提交的草稿');

    // 打开删除确认层，然后在确认之前**绕过界面**把这条草稿提交掉：
    // 这正是「两个人同时操作同一条任务」的真实形态，服务端会以状态冲突拒绝删除。
    fireEvent.click(within(rowOf(code)).getByRole('button', { name: '删除' }));
    const dialog = screen.getByRole('alertdialog');

    const raced = await apiClient.invoke(
      `/api/tasks/${await idOf(code)}/submit`,
      {},
      useSessionStore.getState().token,
      { method: 'POST' }
    );
    expect(raced.code, '测试前置：抢先提交应当成功').toBe(0);

    fireEvent.click(within(dialog).getByRole('button', { name: '确认删除' }));

    // 失败留在层内：关掉它再在页头报错，使用者会失去「刚才那一下」的上下文
    // 失败原因来自状态机本身（「当前状态 pending 不能执行 delete…」）：
    // 它比一句「操作失败」有用得多 —— 说清了当前状态与允许的状态
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/不能执行 delete/));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    // 确认层里要能看出点的是哪一条（文案是「编码 · 标题」，因此用正则匹配）
    expect(within(dialog).getByText(new RegExp(code))).toBeInTheDocument();
    // 列表也同步到「待派」：这次刷新来自失败后的手动刷新，而不是把失败当成功
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('TasksPage · 权限', () => {
  it('monitor 即使能打开页面也发不出写请求（前端不渲染入口，主进程也拦）', async () => {
    await renderPage('monitor');
    await loaded();
    const result = await apiClient.invoke(
      '/api/tasks',
      { title: '不该建得出来', cargoKg: 1, fromSiteId: 'x', toSiteId: 'y' },
      useSessionStore.getState().token,
      { method: 'POST' }
    );
    expect(result.code).not.toBe(0);
    // 与主进程同一份错误目录（`shared/src/errors.ts`）：不是 mock 自造的 code
    expect(result.code).toBe('AUTH.FORBIDDEN');
  });
});
