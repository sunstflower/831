import { describe, expect, it } from 'vitest';
import type { SiteListItem, VehicleListItem } from '@udm/shared';
import { BASE_DATA_TABS, EMPTY_QUERY, buildPayload, tabOf, type BaseDataRow } from './model';

/**
 * 表格模型的单测。
 *
 * 这里锁的是**显示口径**：同一条记录在不同列上显示成什么。它比组件测试更值钱 ——
 * 组件测试只能证明「屏幕上出现了某段文字」，而口径的回归（例如把 `busy` 显示成 `busy`
 * 而不是「执行中」）在组件测试里同样会通过，因为断言通常照着实现写。
 */
const site: SiteListItem = {
  id: 'seed-site-a',
  code: 'A-01',
  name: 'A 仓库',
  type: 'depot',
  status: 'enabled',
  nodeId: 'seed-n01',
  x: 0,
  y: 0,
  remark: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

const vehicle: VehicleListItem = {
  id: 'seed-veh-agv01',
  code: 'AGV-01',
  name: 'AGV 一号',
  type: 'agv',
  status: 'busy',
  capacityKg: 500,
  loadKg: 100,
  maxSpeedMps: 1.5,
  battery: 100,
  x: 0,
  y: 0,
  currentNodeId: 'seed-n01',
  online: true,
  lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
  remark: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
};

function cellText(tabKey: 'sites' | 'vehicles', columnKey: string, row: SiteListItem | VehicleListItem): unknown {
  const column = tabOf(tabKey).columns.find((item) => item.key === columnKey);
  expect(column, `列 ${columnKey} 不存在`).toBeDefined();
  return column!.cell(row);
}

describe('页签定义', () => {
  it('六个页签各对应一个已实现的接口路径', () => {
    expect(BASE_DATA_TABS.map((tab) => tab.key)).toEqual(['sites', 'vehicles', 'nodes', 'edges', 'restrictions', 'templates']);
    for (const tab of BASE_DATA_TABS) {
      expect(tab.path).toMatch(/^\/api\/(sites|vehicles|nodes|edges|restrictions|task-templates)$/);
      expect(tab.columns.length).toBeGreaterThan(0);
      expect(tab.emptyHint.length).toBeGreaterThan(0);
    }
  });

  it('禁行规则：有类型筛选、没有搜索框，且是唯一允许删除的页签', () => {
    const restrictions = tabOf('restrictions');
    // 规则的可读标识是派生出来的目标编码，按它模糊搜在语义上不成立（与边同理）
    expect(restrictions.search).toBeNull();
    expect(restrictions.typeOptions?.map((option) => option.value)).toEqual(['node', 'edge']);
    expect(restrictions.statusOptions.map((option) => option.value)).toEqual(['active', 'expired']);
    expect(restrictions.removable).toBe(true);
    // 没有启停按钮：失效是要写理由的编辑动作（改 status），不是一键切换
    expect(restrictions.statusToggle).toBe(false);
  });

  it('任务模板：没有状态维度就**不渲染**状态下拉，也没有启停与删除', () => {
    const templates = tabOf('templates');
    expect(templates.statusOptions).toEqual([]);
    expect(templates.statusToggle).toBe(false);
    expect(templates.removable).toBeFalsy();
    // 有搜索框（编码与名称），与站点/车辆同口径
    expect(templates.search?.field).toBe('keyword');
  });

  it('时间窗列区分「不限时段」与「只有一端」，不把两者都显示成破折号', () => {
    const column = tabOf('restrictions').columns.find((item) => item.key === 'startAt');
    expect(column).toBeDefined();
    const rule = (startAt: string | null, endAt: string | null) =>
      column!.cell({ startAt, endAt } as unknown as BaseDataRow) as string;
    expect(rule(null, null)).toBe('不限时段');
    expect(rule('2026-09-27T08:00:00.000Z', null)).toBe('2026-09-27 08:00:00 起');
    expect(rule(null, '2026-09-27T18:00:00.000Z')).toBe('至 2026-09-27 18:00:00');
    expect(rule('2026-09-27T08:00:00.000Z', '2026-09-27T18:00:00.000Z')).toBe('2026-09-27 08:00:00 → 2026-09-27 18:00:00');
  });

  it('目标编码列在目标被删后显式说明「已不存在」，而不是留一个破折号', () => {
    const column = tabOf('restrictions').columns.find((item) => item.key === 'targetCode');
    expect(column!.cell({ targetCode: null } as unknown as BaseDataRow)).toContain('目标已不存在');
    expect(column!.cell({ targetCode: 'E_N01_N05' } as unknown as BaseDataRow)).toBe('E_N01_N05');
  });

  it('车辆页签的状态选项**不含** enabled（该取值不存在于车辆枚举，ISS-036）', () => {
    const vehicles = tabOf('vehicles');
    expect(vehicles.statusOptions.map((option) => option.value)).not.toContain('enabled');
    expect(vehicles.statusOptions.map((option) => option.value)).toContain('disabled');
    // 其余三个表用的是启停两态
    for (const key of ['sites', 'nodes', 'edges'] as const) {
      expect(tabOf(key).statusOptions.map((option) => option.value)).toEqual(['enabled', 'disabled']);
    }
  });

  it('边的搜索框按 code 精确匹配，而不是 keyword（边没有可模糊匹配的名称）', () => {
    expect(tabOf('edges').search?.field).toBe('code');
    expect(tabOf('sites').search?.field).toBe('keyword');
  });

  it('pageSize 为空值以外的 key 由各自页签决定：未知 key 直接抛错而不是静默返回 undefined', () => {
    expect(() => tabOf('nope' as 'sites')).toThrow(/未登记/);
  });
});

describe('buildPayload', () => {
  it('空搜索 / 空筛选**不发字段**（主进程把空值当未给，见 D-40）', () => {
    expect(buildPayload(tabOf('sites'), EMPTY_QUERY)).toEqual({ page: 1, pageSize: 20 });
  });

  it('搜索值去空白后按页签的字段名发送', () => {
    const query = { ...EMPTY_QUERY, keyword: '  A-01  ', status: 'enabled' };
    expect(buildPayload(tabOf('sites'), query)).toEqual({ page: 1, pageSize: 20, keyword: 'A-01', status: 'enabled' });
    // 边用 code：同一个输入框在边页签上发给主进程的是 `code`
    expect(buildPayload(tabOf('edges'), query)).toEqual({ page: 1, pageSize: 20, code: 'A-01', status: 'enabled' });
  });

  it('纯空白的搜索不发送（避免提交 keyword="" 让主进程退化成全表扫描）', () => {
    expect(buildPayload(tabOf('sites'), { ...EMPTY_QUERY, keyword: '   ' })).toEqual({ page: 1, pageSize: 20 });
  });

  it('`type` 只在该页签有类型维度时才发（模板页签没有类型，别发一个主进程不认的筛选）', () => {
    const query = { ...EMPTY_QUERY, type: 'edge' };
    expect(buildPayload(tabOf('restrictions'), query)).toEqual({ page: 1, pageSize: 20, type: 'edge' });
    expect(buildPayload(tabOf('templates'), query)).toEqual({ page: 1, pageSize: 20 });
  });
});

describe('列显示口径', () => {
  it('枚举翻译成中文，而不是把机器值直接显示给使用者', () => {
    expect(cellText('sites', 'type', site)).toBe('仓库');
    expect(cellText('sites', 'status', site)).toBe('启用');
    expect(cellText('vehicles', 'status', vehicle)).toBe('执行中');
    expect(cellText('vehicles', 'type', vehicle)).toBe('AGV');
  });

  it('坐标合成为「x, y」米制一列', () => {
    expect(cellText('sites', 'x', { ...site, x: 20, y: 40 })).toBe('20, 40');
  });

  it('心跳显示为「在线 / 离线」，空值显示成「—」而不是空白', () => {
    expect(cellText('vehicles', 'online', vehicle)).toBe('在线');
    expect(cellText('vehicles', 'online', { ...vehicle, online: false })).toBe('离线');
    expect(cellText('sites', 'nodeId', { ...site, nodeId: null })).toBe('—');
  });

  it('数字列标记为右对齐（表格里数字不右对齐就没法竖着比）', () => {
    const numeric = tabOf('vehicles').columns.filter((column) => column.align === 'right').map((column) => column.key);
    expect(numeric).toEqual(['capacityKg', 'loadKg', 'maxSpeedMps', 'battery']);
  });
});
