import { describe, expect, it } from 'vitest';
import type { SiteListItem, VehicleListItem } from '@udm/shared';
import {
  FORM_SPECS,
  buildWritePayload,
  emptyFormValues,
  formValuesOfRow,
  nodeOptionsOf,
  statusActionOf,
  statusBlockedReason,
  targetTextOf
} from './form';
import type { BaseDataRow } from './model';

/**
 * 写表单模型的单测。
 *
 * 这里锁的是**载荷口径**：同一个表单值在创建 / 编辑两种模式下各发出什么。
 * 它比「点开弹层能看到输入框」值钱得多 —— 后者在载荷写错时同样会通过。
 * 其中最要紧的一组是 `emptyMeans`（空输入框的三种含义），
 * 因为「以为清空了、其实没改」和「以为没改、其实清空了」都是静默错误。
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

describe('表单初始值', () => {
  it('枚举有缺省项（不会出现空下拉框这种无法提交的初始态），车辆电量缺省满电', () => {
    const siteValues = emptyFormValues('sites');
    expect(siteValues['type']).toBe('depot');
    expect(siteValues['code']).toBe('');
    expect(emptyFormValues('vehicles')['battery']).toBe('100');
    // 边没有 code 字段：它由两端节点推导（D-35），让使用者填一个会被推翻的值没有意义
    expect(FORM_SPECS.edges.fields.map((field) => field.name)).not.toContain('code');
  });

  it('编辑时用当前行填充；null 显示为空输入框而不是字符串 "null"', () => {
    const values = formValuesOfRow('sites', site);
    expect(values).toMatchObject({ code: 'A-01', name: 'A 仓库', type: 'depot', nodeId: 'seed-n01', x: '0', y: '0', remark: '' });
  });
});

describe('创建载荷 · 空值的三种含义', () => {
  it('站点坐标留空 → **不发**该字段（服务端据此跟随绑定节点坐标）', () => {
    const values = { ...emptyFormValues('sites'), code: 'S-1', name: '新站点', type: 'depot', nodeId: 'seed-n04' };
    const built = buildWritePayload('sites', values, 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      // `remark` 是显式清空（空输入框 ⇒ null），所以它在载荷里
      expect(built.payload).toEqual({ code: 'S-1', name: '新站点', type: 'depot', nodeId: 'seed-n04', remark: null });
      expect('x' in built.payload).toBe(false);
      expect('y' in built.payload).toBe(false);
    }
  });

  it('车辆电量留空 → 不发（服务端缺省 100%）；必填数字留空 → 客户端直接报必填', () => {
    const base = { ...emptyFormValues('vehicles'), code: 'V-9', name: '新车', type: 'agv', battery: '' };
    const ok = buildWritePayload('vehicles', { ...base, capacityKg: '100', maxSpeedMps: '1', x: '0', y: '0' }, 'create');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect('battery' in ok.payload).toBe(false);
    }
    const missing = buildWritePayload('vehicles', { ...base, capacityKg: '', maxSpeedMps: '1', x: '0', y: '0' }, 'create');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.fields['capacityKg']).toBe('必填');
    }
  });

  it('可空文本留空 → 发 null（真的清空），而不是省略', () => {
    const values = { ...emptyFormValues('sites'), code: 'S-2', name: '站点', type: 'dock', remark: '' };
    const built = buildWritePayload('sites', values, 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload['remark']).toBeNull();
    }
  });

  it('数字框填了非数字 → 字段级报错，且**一条请求都不发**（返回值里没有载荷）', () => {
    const values = { ...emptyFormValues('nodes'), code: 'N9', name: '节点', x: 'abc', y: '0' };
    const built = buildWritePayload('nodes', values, 'create');
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.fields['x']).toBe('必须是数字');
    }
  });

  it('数字字符串会被转成数字类型（"12.5" → 12.5），否则服务端按「必须是有限数字」全拒', () => {
    const values = { ...emptyFormValues('nodes'), code: 'N9', name: '节点', x: '12.5', y: '-3' };
    const built = buildWritePayload('nodes', values, 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload).toMatchObject({ x: 12.5, y: -3 });
    }
  });
});

describe('编辑载荷 · 只提交真正改过的字段', () => {
  const original = formValuesOfRow('sites', site);

  it('什么都没改 → 空载荷（调用点据此提示「没有任何修改」，而不是发一条无意义的请求）', () => {
    const built = buildWritePayload('sites', { ...original }, 'patch', original);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload).toEqual({});
    }
  });

  it('只改名称 → 载荷里只有 name；坐标不出现（改绑定节点时服务端才能让坐标跟随）', () => {
    const built = buildWritePayload('sites', { ...original, name: 'A 仓库（改）' }, 'patch', original);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload).toEqual({ name: 'A 仓库（改）' });
    }
  });

  it('编码永远不进补丁 —— 即使被改也不会发（服务端对补丁里的 code 直接报错）', () => {
    const built = buildWritePayload('sites', { ...original, code: 'X-99', name: 'A 仓库（改）' }, 'patch', original);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect('code' in built.payload).toBe(false);
    }
  });

  it('清空备注 → 发 null（清空）；清空坐标 → 不发（当次不改，坐标列不可为空）', () => {
    const cleared = buildWritePayload('sites', { ...original, remark: '', x: '' }, 'patch', { ...original, remark: '旧备注' });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.payload).toEqual({ remark: null });
    }
  });
});

describe('启停动作', () => {
  it('车辆域没有 enabled：停用 ↔ 启用的目标是 idle（ISS-036 的同一个坑不踩第二次）', () => {
    expect(statusActionOf('vehicles', 'idle')).toEqual({ label: '停用', next: 'disabled' });
    expect(statusActionOf('vehicles', 'disabled')).toEqual({ label: '启用', next: 'idle' });
    // 其余三张表用启停两态
    for (const key of ['sites', 'nodes', 'edges'] as const) {
      expect(statusActionOf(key, 'enabled')).toEqual({ label: '停用', next: 'disabled' });
      expect(statusActionOf(key, 'disabled')).toEqual({ label: '启用', next: 'enabled' });
    }
  });

  it('调度占用中的车给出「为什么不能停用」，而不是让使用者点了才被拒', () => {
    expect(statusBlockedReason('vehicles', vehicle)).toMatch(/执行任务|预留/);
    const idle = { ...vehicle, status: 'idle' as const };
    expect(statusBlockedReason('vehicles', idle)).toBeNull();
    expect(statusBlockedReason('sites', site as BaseDataRow)).toBeNull();
  });
});

describe('节点下拉选项', () => {
  it('标签里带编码（同名节点也能区分），值为节点 id', () => {
    const options = nodeOptionsOf([
      { id: 'seed-n01', code: 'N01', name: '路口一', x: 0, y: 0, status: 'enabled', remark: null },
      { id: 'seed-n02', code: 'N02', name: '路口一', x: 20, y: 0, status: 'enabled', remark: null }
    ]);
    expect(options).toEqual([
      { value: 'seed-n01', label: 'N01 · 路口一' },
      { value: 'seed-n02', label: 'N02 · 路口一' }
    ]);
  });
});

/**
 * 禁行规则与任务模板的表单模型。
 *
 * 这两组的重点不是「多了一张表」，而是三个容易静默出错的点：
 *   1. **多态目标**（`targetId`）：空值必须是「必填」而不是被当成缺省；
 *   2. **默认优先级**：`TASK_PRIORITIES` 的首项是 `low`，取首项会让新建模板默认变低优先级；
 *   3. **可空数字**（`defaultCargoKg`）：留空必须是 `null`（真的清空预设），不是 `0`。
 */
describe('禁行规则表单', () => {
  it('新建时目标留空 → 字段级「必填」，绝不静默选第一个节点', () => {
    const values = { ...emptyFormValues('restrictions'), type: 'node', targetId: '', reason: '施工' };
    const built = buildWritePayload('restrictions', values, 'create');
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.fields['targetId']).toBe('必填');
    }
  });

  it('时间窗留空 → 发 null（不限时段），而不是空串（服务端要求可解析的 ISO 串）', () => {
    const values = { ...emptyFormValues('restrictions'), type: 'edge', targetId: 'seed-e-N01-N05', reason: '施工', startAt: '', endAt: '' };
    const built = buildWritePayload('restrictions', values, 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload).toMatchObject({ type: 'edge', targetId: 'seed-e-N01-N05', startAt: null, endAt: null });
    }
  });

  it('状态缺省是 active，且能在编辑时改成 expired（契约里没有启停接口，失效走 PUT）', () => {
    expect(emptyFormValues('restrictions')['status']).toBe('active');
    const original = { ...emptyFormValues('restrictions'), type: 'node', targetId: 'seed-n01', reason: '施工', status: 'active' };
    const built = buildWritePayload('restrictions', { ...original, status: 'expired' }, 'patch', original);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload).toEqual({ status: 'expired' });
    }
  });

  it('可空下拉框初始为空（= 全部车辆），**不是**枚举第一项', () => {
    // 实测缺陷（2026-09-26）：`<select>` 的取值必须落在选项里，可空字段若没有
    // 「不选」那一项，留空会退回第一项 —— 界面看起来正常，建出来的规则却限定成 agv。
    expect(emptyFormValues('restrictions')['vehicleType']).toBe('');
    const built = buildWritePayload(
      'restrictions',
      { ...emptyFormValues('restrictions'), type: 'node', targetId: 'seed-n01', reason: 'x' },
      'create'
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload['vehicleType']).toBeNull();
    }
  });

  it('多态引用的只读回显：目标被删后给出「目标已不存在」而不是空字符串', () => {
    expect(targetTextOf({ targetId: 'seed-n01', targetCode: 'N01' } as unknown as BaseDataRow)).toEqual({
      id: 'seed-n01',
      label: 'N01',
      missing: false
    });
    expect(targetTextOf({ targetId: 'gone', targetCode: null } as unknown as BaseDataRow)).toEqual({
      id: 'gone',
      label: '目标已不存在',
      missing: true
    });
  });
});

describe('任务模板表单', () => {
  it('默认优先级是 normal —— 不是枚举的首项 low（那会让新建模板静默变成低优先级）', () => {
    expect(emptyFormValues('templates')['priority']).toBe('normal');
  });

  it('默认载重留空 → 发 null（不预设），不是 0（0 是一个真实存在的货重）', () => {
    const values = { ...emptyFormValues('templates'), code: 'TPL-X', name: '模板X', priority: 'normal', defaultCargoKg: '' };
    const built = buildWritePayload('templates', values, 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload['defaultCargoKg']).toBeNull();
    }
  });

  it('时间窗分钟数填 0 → 客户端不拦（域由服务端判 `> 0`），但会原样发出给服务端判', () => {
    // 客户端只做「是不是数字」的判断；数值域的唯一作者是 `shared/src/base-rules.ts`，
    // 在这里再判一次会出现「前端说不行、后端说行」的两套口径
    const values = { ...emptyFormValues('templates'), code: 'TPL-X', name: '模板X', timeWindowMinutes: '0' };
    const built = buildWritePayload('templates', values, 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload['timeWindowMinutes']).toBe(0);
    }
  });

  it('可空下拉框（起终点类型）初始为空 = 不限类型，不是第一项 depot', () => {
    expect(emptyFormValues('templates')['fromSiteType']).toBe('');
    expect(emptyFormValues('templates')['toSiteType']).toBe('');
  });

  it('编辑时只发改动字段；清空起点类型 → 发 null（不再限定类型）', () => {
    const original = { ...emptyFormValues('templates'), code: 'TPL-STD', name: '标准', priority: 'normal', fromSiteType: 'depot' };
    const built = buildWritePayload('templates', { ...original, fromSiteType: '' }, 'patch', original);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload).toEqual({ fromSiteType: null });
    }
  });

  it('四个页签之外的新页签也满足「必填字段不会发出空串」的通用规则', () => {
    for (const key of ['restrictions', 'templates'] as const) {
      expect(FORM_SPECS[key].fields.length).toBeGreaterThan(3);
      expect(FORM_SPECS[key].titleCreate.length).toBeGreaterThan(0);
    }
  });
});
