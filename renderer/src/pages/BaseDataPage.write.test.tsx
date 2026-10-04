import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { BaseDataPage } from './BaseDataPage';
import { useSessionStore } from '../store/session';
import { apiClient } from '../api';
import type { InvokeOptions } from '../api/client';

/**
 * 基础数据页的**写操作**（jsdom + mock 适配器）。
 *
 * 与 `BaseDataPage.test.tsx` 分开一个文件，是因为 mock 适配器是**内存库**：
 * 写测试会真的改数据（新增站点、把 ST01 停用），而渲染/查询测试断言的是
 * 「seed 的初始形态」。两者共用一个文件时，用例顺序一变就会互相污染 ——
 * 那种失败看起来像是「功能坏了」，排查成本远高于拆成两个文件。
 *
 * 这里断言的是**端到端行为**（点得动、报得准、改完看得见），不是渲染细节：
 * 载荷口径在 `base/form.test.ts`，错误码一致性在 `api/mock-parity.test.ts`，
 * 主进程的权限强制在 `desktop/src/ipc/router.test.ts`。
 */
async function renderPage(role: 'admin' | 'monitor' = 'admin') {
  // **必须真的登录**：写接口在 Mock 侧也按 `base:write` 强制（`mock.ts`），
  // 而 token 只有登录后才会被 mock 的会话表认识。随手编一个 token 会得到
  // `AUTH.REQUIRED` —— 那种失败看起来像「写功能没实现」。
  const login = await apiClient.invoke<{ token: string }>('/api/auth/login', {
    username: role,
    password: role === 'admin' ? 'admin123' : 'monitor123'
  }, null, { method: 'POST' });
  expect(login.code, '测试前置：登录失败').toBe(0);
  useSessionStore.setState({
    token: login.code === 0 ? login.data.token : null,
    user: {
      id: `seed-${role}`,
      username: role,
      role,
      displayName: role === 'admin' ? '系统管理员' : '监控员',
      permissions: []
    }
  });
  return render(
    <MemoryRouter>
      <BaseDataPage />
    </MemoryRouter>
  );
}

async function loaded(code = 'DEPOT') {
  await waitFor(() => expect(screen.getByText(code)).toBeInTheDocument());
}

/**
 * 选一个节点。
 *
 * 节点清单是**异步**拉来的（弹层打开后发 `/api/nodes`），而 `<select>` 的 `value`
 * 在选项还不存在时会被浏览器**丢弃**（jsdom 同样如此）—— 于是「选了 N04」实际什么也没选。
 * 因此这里先等选项出现再改值：这正是使用者看不到的那段等待时间。
 */
async function pickNode(fieldLabel: string, nodeId: string) {
  const select = screen.getByLabelText(fieldLabel);
  await waitFor(() => {
    expect(within(select).getAllByRole('option').some((option) => (option as HTMLOptionElement).value === nodeId)).toBe(true);
  });
  fireEvent.change(select, { target: { value: nodeId } });
}

/** 切页签并等列表就绪。页签是按钮，用名字点即可。 */
async function openTab(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(screen.queryByText(/正在加载/)).not.toBeInTheDocument());
}

/** 某一行（按单元格文字定位整行）。 */
function rowOf(text: string): HTMLElement {
  const cell = screen.getByText(text);
  const row = cell.closest('tr');
  expect(row, `找不到包含「${text}」的数据行`).not.toBeNull();
  return row as HTMLElement;
}

describe('BaseDataPage · 新增', () => {
  it('新增站点：绑定节点后坐标留空 → 保存后坐标自动跟随该节点（服务端派生，不是客户端拼的）', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: '新增站点' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('编码'), { target: { value: 'W-09' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '北门站点' } });
    // seed 的 N44 在 (600, 600)（校园路网东南角）
    await pickNode('绑定节点', 'seed-n-N44');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已新增站点记录'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 用搜索把新行找出来（列表可能已经不只在第 1 页）
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'W-09' } });
    await waitFor(() => expect(screen.getByText('W-09')).toBeInTheDocument());
    const row = rowOf('W-09');
    expect(within(row).getByText('北门站点')).toBeInTheDocument();
    expect(within(row).getByText('600, 600')).toBeInTheDocument();
    expect(within(row).getByText('seed-n-N44')).toBeInTheDocument();
  });

  it('必填项为空时**在客户端就拦住**：字段下标红，且不发请求（没有成功提示）', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: '新增站点' }));
    fireEvent.change(screen.getByLabelText('编码'), { target: { value: 'W-10' } });
    // 名称留空
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveAttribute('aria-invalid', 'true'));
    // 原因挂在出错的那个框下面（`role="alert"`），而不是一条说不清哪错了的整表提示
    expect(screen.getByRole('alert')).toHaveTextContent('必填');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/已新增/)).not.toBeInTheDocument();
    // 输入框自身带 required 语义，读屏器也能得到这条信息
    expect(screen.getByLabelText('名称')).toBeRequired();
  });

  it('服务端业务错误（编码重复）显示为整表提示，弹层不关闭、输入不丢', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: '新增站点' }));
    fireEvent.change(screen.getByLabelText('编码'), { target: { value: 'DEPOT' } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '重复编码' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByText('编码已存在')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('编码')).toHaveValue('DEPOT');
  });
});

describe('BaseDataPage · 编辑', () => {
  it('编码在编辑态只读（服务端对补丁里的 code 直接报错，界面就不该让人改）', async () => {
    await renderPage();
    await loaded();
    fireEvent.click(within(rowOf('DEPOT')).getByRole('button', { name: '编辑' }));
    expect(screen.getByLabelText('编码')).toBeDisabled();
  });

  it('改绑定节点后坐标跟随新节点 —— 证明这次没把没动过的 x/y 一起提交', async () => {
    await renderPage();
    await loaded();
    // DEPOT 在 (300, -80)；改绑到 N00 (0, 0) 后坐标必须跟着它走
    fireEvent.click(within(rowOf('DEPOT')).getByRole('button', { name: '编辑' }));
    await pickNode('绑定节点', 'seed-n-N00');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存站点修改'));
    await waitFor(() => expect(within(rowOf('DEPOT')).getByText('0, 0')).toBeInTheDocument());
  });

  it('什么都没改就保存 → 明说「没有任何修改」，不发请求', async () => {
    await renderPage();
    await loaded();
    fireEvent.click(within(rowOf('DEPOT')).getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.getByText('没有任何修改')).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('BaseDataPage · 停用 / 启用', () => {
  it('站点可以停用再启用，状态列随之变化，且各留一条成功提示', async () => {
    await renderPage();
    await loaded();

    fireEvent.click(within(rowOf('ST01')).getByRole('button', { name: '停用' }));
    await waitFor(() => expect(within(rowOf('ST01')).getByText('已停用')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('已停用');

    fireEvent.click(within(rowOf('ST01')).getByRole('button', { name: '启用' }));
    await waitFor(() => expect(within(rowOf('ST01')).getByText('启用')).toBeInTheDocument());
  });

  it('运维标记（D-62）：空闲车可标记故障、再恢复可用，状态列随之变化', async () => {
    await renderPage();
    await loaded();
    await openTab('车辆');
    await waitFor(() => expect(screen.getByText('CAR-01')).toBeInTheDocument());

    fireEvent.click(within(rowOf('CAR-01')).getByRole('button', { name: '标记故障' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已标记故障'));
    await waitFor(() => expect(within(rowOf('CAR-01')).getByText('故障')).toBeInTheDocument());

    fireEvent.click(within(rowOf('CAR-01')).getByRole('button', { name: '恢复可用' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已恢复可用'));
    await waitFor(() => expect(within(rowOf('CAR-01')).getByText('空闲')).toBeInTheDocument());
  });

  it('执行中的车（AGV-01）没有「标记故障」按钮 —— 报障会让「故障车还在跑」', async () => {
    await renderPage();
    await loaded();
    await openTab('车辆');
    await waitFor(() => expect(screen.getByText('AGV-01')).toBeInTheDocument());

    expect(within(rowOf('AGV-01')).queryByRole('button', { name: '标记故障' })).not.toBeInTheDocument();
    // 已停用的车也没有：它已经有「启用」按钮了
    expect(within(rowOf('AGV-01')).queryByRole('button', { name: '恢复可用' })).not.toBeInTheDocument();
  });

  it('调度占用中的车不能停用：按钮直接禁用并说明原因（不让使用者点了才被拒）', async () => {
    await renderPage();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '车辆' }));
    await waitFor(() => expect(screen.getByText('AGV-01')).toBeInTheDocument());

    const busyButton = within(rowOf('AGV-01')).getByRole('button', { name: '停用' });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute('title', expect.stringContaining('执行任务'));
    // 空闲车照常可停用
    expect(within(rowOf('CAR-01')).getByRole('button', { name: '停用' })).toBeEnabled();
  });
});

describe('BaseDataPage · 新增车辆', () => {
  /**
   * 用户要的是「能加车、加完就能用」。这两个动作**必须一起证明**：
   * 只证明「列表里多了一行」，加出来的可能是一台永远派不出去的车
   * （没有落点 → 调度算不出空驶段），而界面上完全看不出来。
   */
  it('选所在节点、坐标留空 → 坐标跟随节点，且这台车马上能被派到任务', async () => {
    await renderPage();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '车辆' }));
    await waitFor(() => expect(screen.getByText('AGV-01')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增车辆' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('编码'), { target: { value: 'CAR-09' } });
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '加班车' } });
    fireEvent.change(within(dialog).getByLabelText('额定载重 (kg)'), { target: { value: '800' } });
    fireEvent.change(within(dialog).getByLabelText('最高速度 (m/s)'), { target: { value: '3' } });
    // 坐标两个框都留空：位置由所在节点决定（与站点表单同一口径）
    await pickNode('所在节点', 'seed-n-N13');
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已新增车辆记录'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'CAR-09' } });
    await waitFor(() => expect(screen.getByText('CAR-09')).toBeInTheDocument());
    // 车辆表没有坐标列（它显示的是「所在节点」），因此这里断言节点，
    // 坐标的正确性用接口回读证明（见下）—— 坐标是**服务端**按节点派生的，不是客户端拼的
    expect(within(rowOf('CAR-09')).getByText('seed-n-N13')).toBeInTheDocument();

    const token = useSessionStore.getState().token;
    const listed = await apiClient.invoke<{ records: Array<{ id: string; code: string; status: string; currentNodeId: string | null }> }>(
      '/api/vehicles',
      { keyword: 'CAR-09', page: 1, pageSize: 5 },
      token
    );
    expect(listed.code).toBe(0);
    const created = listed.code === 0 ? listed.data.records.find((item) => item.code === 'CAR-09') : undefined;
    expect(created).toMatchObject({ status: 'idle', currentNodeId: 'seed-n-N13' });

    // 真正的验收标准：这台车能被派到一条真实任务上（手动指派是最确定的证明方式）
    const pending = await apiClient.invoke<{ records: Array<{ id: string; code: string }> }>(
      '/api/tasks',
      { status: 'pending', page: 1, pageSize: 5 },
      token
    );
    expect(pending.code).toBe(0);
    const task = pending.code === 0 ? pending.data.records[0] : undefined;
    expect(task, '测试前置：需要有待派任务').toBeDefined();
    const dispatched = await apiClient.invoke(
      '/api/dispatch/manual-assign',
      { taskId: task!.id, vehicleId: created!.id, reason: '新车试派' },
      token,
      { method: 'POST' }
    );
    expect(dispatched.code, JSON.stringify(dispatched)).toBe(0);
  });

  it('既没选节点也没填坐标 → 客户端不拦，但服务端明确报必填（不静默落到原点）', async () => {
    await renderPage();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '车辆' }));
    await waitFor(() => expect(screen.getByText('AGV-01')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增车辆' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('编码'), { target: { value: 'CAR-10' } });
    fireEvent.change(within(dialog).getByLabelText('名称'), { target: { value: '无位置车' } });
    fireEvent.change(within(dialog).getByLabelText('额定载重 (kg)'), { target: { value: '800' } });
    fireEvent.change(within(dialog).getByLabelText('最高速度 (m/s)'), { target: { value: '3' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    // 报错挂在**坐标字段**上，且弹层不关（输入不丢）
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await waitFor(() => expect(within(dialog).getByLabelText('初始 x (m)')).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByLabelText('初始 y (m)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('BaseDataPage · 假成功防线', () => {
  /**
   * 实测事故（2026-09-26）：Electron 跑旧构建、`preload.cjs` 未转发 `method` 时，
   * `POST /api/sites` 会落到同路径的 `GET /api/sites` 上 —— 返回 `code: 0` 与一个列表，
   * 界面弹出「已新增站点记录」，而数据库里什么都没有。这条用例把这个响应**注入**进来，
   * 断言界面必须报错而不是报喜（它是「静默假成功」这一类问题的回归护栏）。
   */
  it('写请求收到列表信封（说明它被当成了读请求）时报错，绝不报成功', async () => {
    const { container } = await renderPage();
    await loaded();

    // 只替换这一个请求的响应，其余照旧走 mock
    const original = apiClient.invoke.bind(apiClient);
    apiClient.invoke = (async (
      path: string,
      payload?: Record<string, unknown>,
      token?: string | null,
      options?: InvokeOptions
    ) => {
      if (options?.method === 'POST' && path === '/api/sites') {
        return { code: 0, message: 'success', data: { records: [], total: 0, page: 1, pageSize: 20 } };
      }
      return original(path, payload, token, options);
    }) as typeof apiClient.invoke;

    try {
      fireEvent.click(screen.getByRole('button', { name: '新增站点' }));
      fireEvent.change(screen.getByLabelText('编码'), { target: { value: 'GHOST-1' } });
      fireEvent.change(screen.getByLabelText('名称'), { target: { value: '不该出现的站点' } });
      fireEvent.click(screen.getByRole('button', { name: '创建' }));

      await waitFor(() => expect(screen.getByText(/被当成了读请求/)).toBeInTheDocument());
      expect(screen.queryByText(/已新增/)).not.toBeInTheDocument();
      // 弹层不关：使用者能直接重试，输入不丢
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // 列表里也不该凭空多出一行
      expect(container.textContent).not.toContain('GHOST-1');
    } finally {
      apiClient.invoke = original as typeof apiClient.invoke;
    }
  });
});

describe('BaseDataPage · 禁行规则（唯一允许物理删除的实体）', () => {
  it('新增：把类型切成「有向边」后目标下拉换成边清单，保存后列表显示派生编码', async () => {
    await renderPage();
    await loaded();
    await openTab('禁行规则');
    // seed 自带两条「样本占道」规则（单车道被占 → 整条路不可通行），
    // 因此这里不能断言空态；先确认它们在列表里，再验证「新增」这条路径
    await waitFor(() => expect(screen.getByText('E_N12_N13')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '新增禁行规则' }));
    // 目标选择器是**多态**的：类型决定候选；切换类型时必须清掉旧目标（否则会提交
    // 「类型是 edge、id 是某个节点」这种必然被拒的组合）
    fireEvent.change(screen.getByLabelText('目标类型'), { target: { value: 'edge' } });
    await pickNode('目标', 'seed-e-E_N00_N10');
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '道路施工' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(screen.getByText(/已新增禁行规则记录/)).toBeInTheDocument());
    // `E_N00_N10` 是**派生**出来的目标编码（不是存下来的）—— 界面上必须看得到，
    // 否则使用者只看到一个 UUID，无法确认自己封的是哪条路
    await waitFor(() => expect(screen.getByText('E_N00_N10')).toBeInTheDocument());
    expect(within(rowOf('E_N00_N10')).getByText('有向边')).toBeInTheDocument();
    expect(within(rowOf('E_N00_N10')).getByText('不限时段')).toBeInTheDocument();
    expect(within(rowOf('E_N00_N10')).getByText('全部车辆')).toBeInTheDocument();
  });

  it('删除要二次确认；取消不动数据，确认后行真的消失', async () => {
    await renderPage();
    await loaded();
    await openTab('禁行规则');
    fireEvent.click(screen.getByRole('button', { name: '新增禁行规则' }));
    fireEvent.change(screen.getByLabelText('目标类型'), { target: { value: 'node' } });
    await pickNode('目标', 'seed-n-N00');
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '临时封路' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(screen.getByText('N00')).toBeInTheDocument());

    // 取消：确认层关闭、行还在
    fireEvent.click(within(rowOf('N00')).getByRole('button', { name: '删除' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('不可撤销');
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('N00')).toBeInTheDocument();

    // 确认：真删（物理删除）—— 行**消失**而不是变成「已失效」
    fireEvent.click(within(rowOf('N00')).getByRole('button', { name: '删除' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.getByText(/已删除/)).toBeInTheDocument());
    // 只断言「这一行没了」而不是「列表空了」：mock 是模块级内存库，
    // 同一文件里先前用例建过的规则仍在（断言空态会让这条用例与执行顺序绑死）
    await waitFor(() => expect(screen.queryByText('N00')).not.toBeInTheDocument());
    expect(screen.queryByText('临时封路')).not.toBeInTheDocument();
  });

  it('规则没有「停用」行内按钮：失效是带理由的编辑动作（改状态字段）', async () => {
    await renderPage();
    await loaded();
    await openTab('禁行规则');
    expect(screen.queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新增禁行规则' })).toBeInTheDocument();
  });
});

describe('BaseDataPage · 任务模板（没有状态、没有删除）', () => {
  it('模板页签不渲染状态下拉与启停 / 删除按钮，只有编辑', async () => {
    await renderPage();
    await loaded();
    await openTab('任务模板');
    await waitFor(() => expect(screen.getByText('TPL-STD')).toBeInTheDocument());

    // 模板没有状态列（DDL 里就没有），因此一个「全部状态」的下拉只会永远筛出空表
    expect(screen.queryByText('全部状态')).not.toBeInTheDocument();
    const row = rowOf('TPL-STD');
    expect(within(row).getByRole('button', { name: '编辑' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
    // 但模板可以新增（契约里有 POST）
    expect(screen.getByRole('button', { name: '新增任务模板' })).toBeInTheDocument();
  });

  it('新增模板时默认优先级是「普通」而不是枚举首项「低」', async () => {
    await renderPage();
    await loaded();
    await openTab('任务模板');
    fireEvent.click(screen.getByRole('button', { name: '新增任务模板' }));
    expect(screen.getByLabelText('默认优先级')).toHaveValue('normal');
  });
});

describe('BaseDataPage · 权限', () => {
  it('没有 base:write 的角色看不到任何写入口（按钮不渲染，而不是渲染出来再禁用）', async () => {
    await renderPage('monitor');
    await loaded();

    expect(screen.queryByRole('button', { name: /新增/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停用' })).not.toBeInTheDocument();
    expect(screen.getByText(/当前角色只能查询/)).toBeInTheDocument();
  });
});
