import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AlertsPage } from './AlertsPage';
import { AuditPage } from './AuditPage';
import { SettingsPage } from './SettingsPage';
import { UsersPage } from './UsersPage';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';

/**
 * M1 / M8 / M9 / M10 四个页面的端到端行为（jsdom + mock 适配器）。
 *
 * ## 为什么四个页面放在一个文件里
 *
 * 它们共用一套「登录 → 渲染 → 断言」的前置（`renderAs`），而且 mock 是**内存库**：
 * 拆成四个文件并不会让它们互不干扰（同一个 mock 实例在同一进程里共享状态与顺序），
 * 反而要多写四份前置。真正需要隔离的是「有副作用的用例」，它们在本文件里按
 * 「先读后写」的顺序排列，每条用例的前置都重新登录一次。
 *
 * ## 断言的是行为而不是渲染细节
 *
 * 「按钮在不在、点了之后库里的值变没变、被拦住时说不说明原因」是这一层能测、
 * 也值得测的东西；文案与类名在别处已经由静态护栏盯着（`styles/classnames.test.ts`）。
 */
async function renderAs(username: 'admin' | 'monitor' | 'dispatcher') {
  const login = await apiClient.invoke<{ token: string }>(
    '/api/auth/login',
    { username, password: `${username}123` },
    null,
    { method: 'POST' }
  );
  expect(login.code, `测试前置：${username} 登录失败`).toBe(0);
  const role = username === 'admin' ? 'admin' : username;
  useSessionStore.setState({
    token: login.code === 0 ? login.data.token : null,
    user: { id: `seed-${username}`, username, role, displayName: username, permissions: [] }
  });
}

function renderPage(node: React.ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

/**
 * 点开列表里的第一条告警。
 *
 * 不能用 `getByText('车辆离线')`：同一个词同时出现在**筛选下拉的选项**与**表格行**里，
 * `getByText` 会因为命中多个元素直接抛错。按行（`tbody tr`）定位才是稳定的 ——
 * 这也顺便保证了「点的是数据行，不是筛选项」。
 */
/*
 * 定位必须**限定在告警列表那张表里**（不再是「文档里的第一张表」）。
 *
 * 2026-10-03：告警页顶部新增了「任务冲突与超时预检」区块，它也是一张 `<table>`。
 * 原来写 `document.querySelector('table')` 的夹具于是拿到了预检表，
 * 点它的行什么也不会发生 —— 失败信息是「找不到『建议下一步』」，
 * 与真正的原因（点到别的表上去了）毫无关系。
 * 教训与 ISS-081 同族：**夹具要锚在语义上**（`aria-label`），而不是锚在「第几个」。
 */
function alertTable(): HTMLElement {
  const card = screen.getByRole('region', { name: '告警列表' });
  return within(card).getByRole('table');
}

async function clickFirstAlertRow() {
  await waitFor(() =>
    expect(within(alertTable()).getAllByRole('row').length).toBeGreaterThan(1)
  );
  // 第 0 行是表头
  const row = within(alertTable()).getAllByRole('row')[1] as HTMLElement;
  fireEvent.click(row);
}

beforeEach(async () => {
  await renderAs('admin');
});

describe('告警中心（M8）', () => {
  it('列出 seed 的告警，并把机器值翻译成中文（不把 vehicle_offline 印给使用者）', async () => {
    renderPage(<AlertsPage />);
    await waitFor(() => expect(screen.getByText('车辆离线')).toBeInTheDocument());
    expect(screen.queryByText('vehicle_offline')).toBeNull();
    expect(screen.getByText(/DRN-01/)).toBeInTheDocument();
  });

  it('选中一条告警后给出「建议下一步」与当前状态允许的操作', async () => {
    renderPage(<AlertsPage />);
    await clickFirstAlertRow();
    await waitFor(() => expect(screen.getByText('建议下一步')).toBeInTheDocument());
    // `new` 状态只允许「认领」：按钮由 shared 的状态机派生，不是页面自己列的清单
    expect(screen.getByRole('button', { name: '认领' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '解决' })).toBeNull();
  });

  it('「解决」必须填处置结论：空着时按钮点不动，而不是提交后由服务端报错', async () => {
    renderPage(<AlertsPage />);
    await clickFirstAlertRow();
    await waitFor(() => expect(screen.getByRole('button', { name: '认领' })).toBeInTheDocument());

    // 先认领 → 进入 acknowledged，此时「解决」才出现
    fireEvent.click(screen.getByRole('button', { name: '认领' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '解决' })).toBeInTheDocument());
    const resolve = screen.getByRole('button', { name: '解决' });
    expect(resolve).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/已重启车辆/), { target: { value: '已重启执行器' } });
    expect(resolve).not.toBeDisabled();
    fireEvent.click(resolve);
    await waitFor(() => expect(screen.getByText(/已解决/)).toBeInTheDocument());
  });

  it('列表给出「停滞」时长（异常挂多久是唯一能排序的紧迫度信号），已终结的显示「—」', async () => {
    renderPage(<AlertsPage />);
    await waitFor(() => expect(screen.getByText('车辆离线')).toBeInTheDocument());
    // 表头必须在：这一列回答的是「这条挂了多久」，不是「这条什么时候建的」
    expect(screen.getByText('停滞')).toBeInTheDocument();
    // 上面那条用例已经把演示告警推到「已解决」→ 它不再有停滞时长
    const table = alertTable();
    await waitFor(() => expect(within(table).getByText('已解决')).toBeInTheDocument());
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('审计日志（M9）', () => {
  /*
   * 为什么每条用例都**自己先写一次**再断言，而不依赖前面用例留下的记录：
   * mock 适配器是内存库，`-t` 只跑这一条时它还是空的 —— 那种用例单跑红、
   * 全量绿（或反过来），是测试最不该有的性质。
   */
  it('写操作之后能在审计里查到那一条（留痕真的落库了，不是只发了个事件）', async () => {
    const patch = await apiClient.invoke(
      '/api/settings',
      { updates: { 'monitor.refreshIntervalMs': 1500 } },
      useSessionStore.getState().token,
      { method: 'PATCH' }
    );
    expect(patch.code, `测试前置：改设置失败（${patch.message}）`).toBe(0);

    renderPage(<AuditPage />);
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'traceId' })).toBeInTheDocument());
    expect(screen.getByRole('columnheader', { name: '模块 / 动作' })).toBeInTheDocument();
    // 模块名是机器值（`settings` / `update`），页面上按原样显示并加了等宽样式
    expect(screen.getByText('settings')).toBeInTheDocument();
    expect(screen.getByText('update')).toBeInTheDocument();
    // 结果列给中文徽标；一条记录里可能有多个徽标，因此只要求至少有一个
    expect(screen.getAllByText('成功').length).toBeGreaterThan(0);
  });

  it('导出按钮在有 audit:read 时出现（输出文件名与条数）', async () => {
    renderPage(<AuditPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /导出 CSV/ })).toBeInTheDocument());
  });

  it('monitor 没有 audit:read：导出入口不渲染，但读接口仍按契约放行', async () => {
    await renderAs('monitor');
    renderPage(<AuditPage />);
    await waitFor(() => expect(screen.getByText('记录')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /导出 CSV/ })).toBeNull();
  });
});

describe('系统设置（M10）', () => {
  it('表单按 SETTINGS_SCHEMA 动态渲染（键名与说明都来自 schema）', async () => {
    renderPage(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/全局参数/)).toBeInTheDocument());
    expect(screen.getByText('monitor.refreshIntervalMs')).toBeInTheDocument();
  });

  it('只提交真正改过的键：没改动时保存按钮是禁用的', async () => {
    renderPage(<SettingsPage />);
    await waitFor(() => expect(screen.getByText('monitor.refreshIntervalMs')).toBeInTheDocument());
    const save = screen.getByRole('button', { name: '保存改动' });
    expect(save).toBeDisabled();

    const input = screen.getByLabelText(/刷新/);
    fireEvent.change(input, { target: { value: '2000' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存改动' })).not.toBeDisabled());
    expect(screen.getByText(/1 项待保存/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存改动' }));
    await waitFor(() => expect(screen.getByText(/已保存 1 项/)).toBeInTheDocument());
  });

  it('monitor 是只读：输入框禁用且没有保存入口', async () => {
    await renderAs('monitor');
    renderPage(<SettingsPage />);
    await waitFor(() => expect(screen.getByText(/只读（需要 settings:write）/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '保存改动' })).toBeDisabled();
  });
});

describe('用户管理（M1）', () => {
  it('列出三个种子账号，并把自己标成「当前登录」', async () => {
    renderPage(<UsersPage />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getByText('dispatcher')).toBeInTheDocument();
    expect(screen.getByText('monitor')).toBeInTheDocument();
    expect(screen.getByText('（当前登录）')).toBeInTheDocument();
  });

  it('不能停用自己：按钮禁用且 title 说明原因（不是点了才失败）', async () => {
    renderPage(<UsersPage />);
    await waitFor(() => expect(screen.getByText('（当前登录）')).toBeInTheDocument());
    const selfRow = screen.getByText('（当前登录）').closest('tr') as HTMLElement;
    const disable = within(selfRow).getByRole('button', { name: '停用' });
    expect(disable).toBeDisabled();
    expect(disable.getAttribute('title')).toContain('不能禁用当前登录的账号');
  });

  it('monitor 看不到维护入口（账号列没有操作列）', async () => {
    await renderAs('monitor');
    renderPage(<UsersPage />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getByText(/只读（需要 user:manage）/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建账号' })).toBeNull();
  });

  it('改自己的密码不需要 user:manage（monitor 也能改）', async () => {
    await renderAs('monitor');
    renderPage(<UsersPage />);
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '修改我的密码' })).toBeInTheDocument();
  });
});
