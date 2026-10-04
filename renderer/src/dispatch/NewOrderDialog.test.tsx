import '../test/dom-stubs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api';
import { useSessionStore } from '../store/session';
import { NewOrderDialog, type NewOrderResult } from './NewOrderDialog';

/**
 * 调度中心的「新建订单」弹层（Req-M4-8，jsdom + mock 适配器）。
 *
 * 这一层只做三件事：复用 M3 表单、固定 `submit: true`、把新任务交给调用方。
 * 因此用例也只锁这三件事 —— 字段清单与校验口径是 `task/form.ts` 与
 * `shared/src/task-rules.ts` 的职责（它们各有自己的用例），在这里再断言一遍
 * 只会得到两份会各自漂移的测试。
 *
 * 「不发请求」用 spy 直接数 `POST /api/tasks` 的次数：只看「没有成功提示」
 * 无法区分「没发请求」与「发了但失败了」—— 而客户端预校验的全部价值就是前者。
 */
async function loginAsAdmin(): Promise<string> {
  const result = await apiClient.invoke<{ token: string }>('/api/auth/login', { username: 'admin', password: 'admin123' }, null, {
    method: 'POST'
  });
  if (result.code !== 0) {
    throw new Error(`测试前置：mock 登录失败（${result.message}）`);
  }
  useSessionStore.setState({
    token: result.data.token,
    user: { id: 'seed-admin', username: 'admin', role: 'admin', displayName: '系统管理员', permissions: [] }
  });
  return result.data.token;
}

const SITE_OPTIONS = [
  { value: 'seed-site-DEPOT', label: 'DEPOT · 配送中心' },
  { value: 'seed-site-ST01', label: 'ST01 · 教学楼' }
];

function renderDialog(onCreated: (task: NewOrderResult) => void) {
  return render(
    <NewOrderDialog
      token={useSessionStore.getState().token}
      siteOptions={SITE_OPTIONS}
      templateOptions={[{ value: 'seed-tpl-std', label: 'TPL-STD · 标准配送' }]}
      onCreated={onCreated}
      onClose={() => undefined}
    />
  );
}

/** 表单里服务端/客户端会标红的必填字段（`emptyMeans: 'invalid'` 的那几个）。 */
const REQUIRED_FIELDS = ['标题', '载重 (kg)', '起点站点', '终点站点'] as const;

function fill(field: string, value: string) {
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(field), { target: { value } });
}

/**
 * 数一数 `POST /api/tasks` 发了几次。
 *
 * 参数类型写得比 `ReturnType<typeof vi.spyOn>` 宽：`apiClient.invoke` 是泛型函数，
 * `vi.spyOn` 推断出的重载签名与 spy 自身的三元组类型对不上（实测 TS2345），
 * 而这里只用到 `mock.calls` 一个字段 —— 收窄成结构类型反而更准。
 */
function postCount(spy: { mock: { calls: unknown[][] } }): number {
  return spy.mock.calls.filter((call) => {
    const [path, , , options] = call as [string, unknown, unknown, { method?: string } | undefined];
    return path === '/api/tasks' && options?.method === 'POST';
  }).length;
}

beforeEach(() => {
  useSessionStore.setState({ token: null, user: null });
  vi.restoreAllMocks();
});

describe('调度中心 · 新建订单弹层', () => {
  it('必填为空时就地拦住：四个字段各标一条红字，且**一个请求都不发**', async () => {
    const onCreated = vi.fn();
    await loginAsAdmin();
    renderDialog(onCreated);
    const spy = vi.spyOn(apiClient, 'invoke');

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建并提交' }));

    const dialog = screen.getByRole('dialog');
    const errors = within(dialog).getAllByRole('alert').map((node) => node.textContent);
    expect(errors).toHaveLength(REQUIRED_FIELDS.length);
    expect(errors.every((text) => text === '必填')).toBe(true);
    for (const field of REQUIRED_FIELDS) {
      expect(within(dialog).getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    }
    // 弹层不关（错误必须留在原地），也没有回调
    expect(dialog).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(postCount(spy)).toBe(0);
  });

  it('提交成功：任务**直接是待派发**（不是草稿），并把新任务交给调用方', async () => {
    const created: NewOrderResult[] = [];
    await loginAsAdmin();
    renderDialog((task) => created.push(task));

    fill('标题', '临时加单：西区食堂 → 图书馆');
    fill('载重 (kg)', '88');
    fill('起点站点', 'seed-site-DEPOT');
    fill('终点站点', 'seed-site-ST01');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建并提交' }));

    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.code).toMatch(/^T\d/);
    expect(created[0]!.title).toBe('临时加单：西区食堂 → 图书馆');

    // 直接查服务端：状态必须是 pending —— 这就是「固定 submit: true」的证据
    const detail = await apiClient.invoke<{ status: string; title: string }>(
      `/api/tasks/${created[0]!.id}`,
      {},
      useSessionStore.getState().token
    );
    if (detail.code !== 0) {
      throw new Error(`读取刚创建的任务失败：${detail.message}`);
    }
    expect(detail.data.status).toBe('pending');
  });

  it('服务端业务校验失败（载重超上限）：原因留在弹层内，不关窗、不回调、输入不丢', async () => {
    const onCreated = vi.fn();
    await loginAsAdmin();
    renderDialog(onCreated);

    fill('标题', '超载单');
    fill('载重 (kg)', '99999');
    fill('起点站点', 'seed-site-DEPOT');
    fill('终点站点', 'seed-site-ST01');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建并提交' }));

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).getAllByRole('alert').length).toBeGreaterThan(0));
    expect(within(dialog).getByLabelText('载重 (kg)')).toHaveAttribute('aria-invalid', 'true');
    // 已经填过的标题不会被清掉（否则使用者要重填整张表才知道是哪一项超了）
    expect(within(dialog).getByLabelText('标题')).toHaveValue('超载单');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
