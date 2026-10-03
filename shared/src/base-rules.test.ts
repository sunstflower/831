import { describe, expect, it } from 'vitest';
import {
  FIELD_LIMITS,
  readEnum,
  readNumber,
  readText,
  validateEdgeInput,
  validateNodeInput,
  validateRestrictionInput,
  validateSiteInput,
  validateTemplateInput,
  validateVehicleInput,
  type FieldErrors
} from './base-rules.js';

/**
 * M2 字段规则（`shared/src/base-rules.ts`）。
 *
 * 这份文件是**主进程与 Mock 共用的同一份规则**，所以它必须自己先被测透：
 * 两边都调它，它错了就是两边一起错，而且错法一模一样 —— 逐字段比对也发现不了。
 */

describe('readText', () => {
  it('必填：缺失 / null / 空白串都报「必填」', () => {
    for (const value of [undefined, null, '', '   ']) {
      const result = readText(value === undefined ? {} : { name: value }, 'name', { required: true, maxLength: 10 });
      expect(result, `输入 ${JSON.stringify(value)} 应被拒绝`).toMatchObject({ ok: false });
    }
  });

  it('可选：缺失与空串都归一化为 null（而不是空字符串）', () => {
    expect(readText({}, 'remark', { required: false, maxLength: 10 })).toEqual({ ok: true, value: null });
    expect(readText({ remark: '  ' }, 'remark', { required: false, maxLength: 10 })).toEqual({ ok: true, value: null });
  });

  it('去除首尾空白后再判长度（" a " 算 1 个字符）', () => {
    expect(readText({ code: '  ab  ' }, 'code', { required: true, maxLength: 2 })).toEqual({ ok: true, value: 'ab' });
    // 先 trim 再判上限：否则「前后一堆空格」会把合法编码挤掉
    expect(readText({ code: ' abc ' }, 'code', { required: true, maxLength: 2 })).toMatchObject({ ok: false });
  });

  it('非字符串一律拒绝（数字编码不自动转成字符串）', () => {
    expect(readText({ code: 123 }, 'code', { required: true, maxLength: 32 })).toMatchObject({ ok: false });
  });

  it('把已有错误带进结果，多个字段的错误可以累积', () => {
    const fields: FieldErrors = { other: '已有的错误' };
    const result = readText({}, 'name', { required: true, maxLength: 10 }, fields);
    expect(result.ok === false && result.fields).toMatchObject({ other: '已有的错误', name: '必填' });
  });
});

describe('readNumber', () => {
  it('拒绝 NaN / Infinity / 字符串数字', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(readNumber({ x: value }, 'x', { required: true }), String(value)).toMatchObject({ ok: false });
    }
  });

  it('必填与可选的空值语义不同', () => {
    expect(readNumber({}, 'x', { required: true })).toMatchObject({ ok: false });
    expect(readNumber({}, 'x', { required: false })).toEqual({ ok: true, value: null });
    // 表单里清空数字输入框得到的是空串：可选时视为「没填」，而不是 0
    expect(readNumber({ x: '' }, 'x', { required: false })).toEqual({ ok: true, value: null });
  });

  it('下界是**含端点**的，且 0 与负数按 min 判定', () => {
    expect(readNumber({ v: 0 }, 'v', { required: true, min: 0 })).toEqual({ ok: true, value: 0 });
    expect(readNumber({ v: -1 }, 'v', { required: true, min: 0 })).toMatchObject({ ok: false });
    expect(readNumber({ v: 100 }, 'v', { required: true, max: 100 })).toEqual({ ok: true, value: 100 });
    expect(readNumber({ v: 100.5 }, 'v', { required: true, max: 100 })).toMatchObject({ ok: false });
  });

  it('integer 选项拒绝小数', () => {
    expect(readNumber({ v: 1.5 }, 'v', { required: true, integer: true })).toMatchObject({ ok: false });
    expect(readNumber({ v: 2 }, 'v', { required: true, integer: true })).toEqual({ ok: true, value: 2 });
  });
});

describe('readEnum', () => {
  it('只接受集合成员，且不做大小写归一化', () => {
    expect(readEnum({ t: 'agv' }, 't', ['agv', 'drone'] as const, { required: true })).toEqual({ ok: true, value: 'agv' });
    expect(readEnum({ t: 'AGV' }, 't', ['agv', 'drone'] as const, { required: true })).toMatchObject({ ok: false });
    expect(readEnum({ t: 'carrier' }, 't', ['agv', 'drone'] as const, { required: true })).toMatchObject({ ok: false });
  });

  it('错误文案里列出全部合法取值（前端可直接展示）', () => {
    const result = readEnum({ t: 'x' }, 't', ['agv', 'drone'] as const, { required: true });
    expect(result.ok === false && result.fields['t']).toContain('agv');
    expect(result.ok === false && result.fields['t']).toContain('drone');
  });
});

describe('validateSiteInput（创建）', () => {
  const valid = { code: 'A-01', name: 'A 仓库', type: 'depot', x: 10, y: 20 };

  it('合法输入归一化为内部形状', () => {
    expect(validateSiteInput(valid, 'create')).toEqual({
      ok: true,
      value: { code: 'A-01', name: 'A 仓库', type: 'depot', nodeId: null, x: 10, y: 20, remark: null }
    });
  });

  it('一次报出**所有**出错的字段，而不是只报第一个', () => {
    const result = validateSiteInput({ code: '', name: 'x'.repeat(FIELD_LIMITS.name + 1), type: 'nope' }, 'create');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fields).sort()).toEqual(['code', 'name', 'type']);
  });

  it('x / y 可以不填（后面由绑定节点或默认值兜底）', () => {
    const result = validateSiteInput({ code: 'A', name: 'A', type: 'depot' }, 'create');
    expect(result.ok === true && result.value).toMatchObject({ x: null, y: null });
  });

  it('NaN 坐标被拒绝（不是「当作没填」）', () => {
    const result = validateSiteInput({ ...valid, x: Number.NaN }, 'create');
    expect(result.ok).toBe(false);
  });
});

describe('validateSiteInput（更新）', () => {
  it('只交出**本次真的传了**的字段，不把旧值补进来', () => {
    const result = validateSiteInput({ name: '新名字' }, 'patch');
    expect(result).toEqual({ ok: true, value: { name: '新名字' } });
  });

  it('显式传 null 表示「清空该字段」（remark / nodeId）', () => {
    expect(validateSiteInput({ remark: null }, 'patch')).toEqual({ ok: true, value: { remark: null } });
  });

  it('传 code 直接报错，而不是静默忽略（D-19 同一条理由）', () => {
    const result = validateSiteInput({ code: 'B-01', name: 'x' }, 'patch');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['code']).toContain('不可修改');
    }
  });

  it('更新时不校验「必填」—— 只传一个字段也是合法的请求', () => {
    expect(validateSiteInput({ name: 'x' }, 'patch').ok).toBe(true);
    expect(validateSiteInput({}, 'patch')).toEqual({ ok: true, value: {} });
  });
});

describe('validateVehicleInput', () => {
  const valid = { code: 'V-1', name: '车一', type: 'agv', capacityKg: 500, maxSpeedMps: 1.5, x: 0, y: 0 };

  it('合法输入：battery 缺省为 100', () => {
    const result = validateVehicleInput(valid, 'create');
    expect(result.ok === true && result.value).toMatchObject({ battery: 100, remark: null });
  });

  it('battery 显式传 0 仍被接受（域是 [0,100]，0 是合法值）', () => {
    const result = validateVehicleInput({ ...valid, battery: 0 }, 'create');
    expect(result.ok === true && result.value).toMatchObject({ battery: 0 });
  });

  it('capacityKg / maxSpeedMps 必须为正数（0 不合法）', () => {
    expect(validateVehicleInput({ ...valid, capacityKg: 0 }, 'create').ok).toBe(false);
    expect(validateVehicleInput({ ...valid, maxSpeedMps: 0 }, 'create').ok).toBe(false);
    expect(validateVehicleInput({ ...valid, maxSpeedMps: -1 }, 'create').ok).toBe(false);
  });

  it('battery 超出 [0,100] 被拒', () => {
    expect(validateVehicleInput({ ...valid, battery: 101 }, 'create').ok).toBe(false);
    expect(validateVehicleInput({ ...valid, battery: -1 }, 'create').ok).toBe(false);
  });

  it('更新时不含 status（车辆状态另有专用接口）', () => {
    const result = validateVehicleInput({ name: 'x', status: 'busy' }, 'patch');
    expect(result.ok === true && result.value).toEqual({ name: 'x' });
  });
});

describe('validateNodeInput / validateEdgeInput', () => {
  it('节点：坐标为必填且必须是有限数字', () => {
    expect(validateNodeInput({ code: 'N1', name: 'N1', x: 1, y: 2 }, 'create').ok).toBe(true);
    expect(validateNodeInput({ code: 'N1', name: 'N1', x: 1 }, 'create').ok).toBe(false);
  });

  it('边：自环在**校验层**就被拦，不依赖 DDL 的 CHECK 兜底', () => {
    const result = validateEdgeInput({ fromNodeId: 'a', toNodeId: 'a' }, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['toNodeId']).toContain('同一个节点');
    }
  });

  it('边：更新时改成了自环也要拦（两段式的第二段）', () => {
    expect(validateEdgeInput({ fromNodeId: 'a', toNodeId: 'a' }, 'patch').ok).toBe(false);
    // 只改一端、另一端不变时无法在这一层判断 —— 那由领域层拿旧值补齐后再判
    expect(validateEdgeInput({ toNodeId: 'b' }, 'patch')).toEqual({ ok: true, value: { toNodeId: 'b' } });
  });

  it('边：lengthM / speedLimitMps 可选且必须为正数；code 可省略（缺省由两端节点推导）', () => {
    expect(validateEdgeInput({ fromNodeId: 'a', toNodeId: 'b' }, 'create')).toEqual({
      ok: true,
      value: { code: null, fromNodeId: 'a', toNodeId: 'b', lengthM: null, speedLimitMps: null, weight: 1, remark: null }
    });
    expect(validateEdgeInput({ fromNodeId: 'a', toNodeId: 'b', lengthM: 0 }, 'create').ok).toBe(false);
  });

  it('边：weight 下限是 1（不是「大于 0」）——小于 1 会让 A* 的启发式高估并静默给出非最优路线', () => {
    // 不填 = 畅通：与 DDL 的 DEFAULT 1、与 `RouteEdgeInput.weight` 的兜底同一口径
    const omitted = validateEdgeInput({ fromNodeId: 'a', toNodeId: 'b', weight: undefined }, 'create');
    expect(omitted.ok && omitted.value.weight).toBe(1);
    // 边界值 1 必须放行（「畅通」是一个合法取值，而不是「不填」的替代品）
    const one = validateEdgeInput({ fromNodeId: 'a', toNodeId: 'b', weight: 1 }, 'create');
    expect(one.ok && one.value.weight).toBe(1);
    // 4 倍慢可以，0.5 倍快不行 —— 后者超出模型的表达能力（权重只增不减）
    const heavy = validateEdgeInput({ fromNodeId: 'a', toNodeId: 'b', weight: 4 }, 'create');
    expect(heavy.ok && heavy.value.weight).toBe(4);
    const lighter = validateEdgeInput({ fromNodeId: 'a', toNodeId: 'b', weight: 0.5 }, 'create');
    expect(lighter.ok).toBe(false);
    if (!lighter.ok) {
      expect(lighter.fields['weight']).toMatch(/≥|大于|1/);
    }
  });

  it('边：更新时传 code 被拒（D-35：code 创建后不可改）', () => {
    const result = validateEdgeInput({ code: 'E_A_B', lengthM: 5 }, 'patch');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['code']).toContain('不可修改');
    }
  });
});

/**
 * 禁行规则的字段规则（§3.2.5）。
 *
 * 两条最要紧的：
 *   - 时间必须是**可解析的 ISO 串**，不是「随便一个非空字符串」——
 *     服务端的生效查询用字符串比较（`start_at <= :now`），
 *     放进去一个「明天上午」不会报错，但那条规则**永远不生效**且没人会发现；
 *   - 新建时不能带 `status`（`RestrictionCreate` 里没有这个字段）：
 *     停用是显式动作，不该在创建时就成立。
 */
describe('validateRestrictionInput', () => {
  const base = { type: 'node', targetId: 'seed-n01', reason: '道路施工' };

  it('必填：type / targetId / reason；可空：时间窗与适用车辆类型', () => {
    expect(validateRestrictionInput(base, 'create')).toEqual({
      ok: true,
      value: { type: 'node', targetId: 'seed-n01', reason: '道路施工', startAt: null, endAt: null, vehicleType: null }
    });
    const missing = validateRestrictionInput({}, 'create');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(Object.keys(missing.fields).sort()).toEqual(['reason', 'targetId', 'type']);
    }
  });

  it('时间必须是可解析的时间串（否则规则会静默永不生效）', () => {
    const bad = validateRestrictionInput({ ...base, startAt: '明天上午' }, 'create');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.fields['startAt']).toContain('可解析');
    }
    expect(validateRestrictionInput({ ...base, startAt: '2026-09-27T08:00:00.000Z' }, 'create').ok).toBe(true);
  });

  it('跨字段的「结束必须晚于开始」不在这里判（更新时需与库里的值配对，属服务层）', () => {
    // 这一层只判「能不能解析」，因此一个倒挂的时间窗在这里是**通过**的 ——
    // 断言这一点是为了防止有人「顺手」在这里补一条比较：补了之后，
    // 只传 endAt 的更新会拿不到 startAt，判出来的结论是错的（见 base-rules.ts 的注释）
    const inverted = validateRestrictionInput(
      { ...base, startAt: '2026-09-27T10:00:00.000Z', endAt: '2026-09-27T09:00:00.000Z' },
      'create'
    );
    expect(inverted.ok).toBe(true);
  });

  it('更新：只交出本次真的传了的字段；显式 null 表示清空（时间窗、适用车辆）', () => {
    expect(validateRestrictionInput({ endAt: null }, 'patch')).toEqual({ ok: true, value: { endAt: null } });
    expect(validateRestrictionInput({ status: 'expired' }, 'patch')).toEqual({ ok: true, value: { status: 'expired' } });
    expect(validateRestrictionInput({ status: 'paused' }, 'patch').ok).toBe(false);
    expect(validateRestrictionInput({}, 'patch')).toEqual({ ok: true, value: {} });
  });
});

/**
 * 任务模板的字段规则（§3.2.6）。
 *
 * `priority` 缺省为 `normal` 是这里的核心断言：DDL 的 `DEFAULT 'normal'` 与
 * 校验函数的缺省值必须一致，否则两边会写出不同优先级的模板，而它们都「合法」。
 */
describe('validateTemplateInput', () => {
  it('创建：编码与名称必填，其余可缺省；priority 缺省 normal（与 DDL 的 DEFAULT 一致）', () => {
    expect(validateTemplateInput({ code: 'TPL-1', name: '标准' }, 'create')).toEqual({
      ok: true,
      value: {
        code: 'TPL-1',
        name: '标准',
        priority: 'normal',
        defaultCargoKg: null,
        timeWindowMinutes: null,
        fromSiteType: null,
        toSiteType: null,
        remark: null
      }
    });
    const missing = validateTemplateInput({}, 'create');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(Object.keys(missing.fields).sort()).toEqual(['code', 'name']);
    }
  });

  it('数值域照抄 DDL 的 CHECK：载重 >= 0、时间窗必须是正整数', () => {
    expect(validateTemplateInput({ code: 'T', name: 'T', defaultCargoKg: -1 }, 'create').ok).toBe(false);
    expect(validateTemplateInput({ code: 'T', name: 'T', defaultCargoKg: 0 }, 'create').ok).toBe(true);
    expect(validateTemplateInput({ code: 'T', name: 'T', timeWindowMinutes: 0 }, 'create').ok).toBe(false);
    expect(validateTemplateInput({ code: 'T', name: 'T', timeWindowMinutes: 1.5 }, 'create').ok).toBe(false);
    expect(validateTemplateInput({ code: 'T', name: 'T', timeWindowMinutes: 30 }, 'create').ok).toBe(true);
  });

  it('更新：code 不可改；可空列传 null 表示清空（不再预设）', () => {
    const immutable = validateTemplateInput({ code: 'X' }, 'patch');
    expect(immutable.ok).toBe(false);
    if (!immutable.ok) {
      expect(immutable.fields['code']).toContain('不可修改');
    }
    expect(validateTemplateInput({ defaultCargoKg: null, toSiteType: null }, 'patch')).toEqual({
      ok: true,
      value: { defaultCargoKg: null, toSiteType: null }
    });
  });
});
