import { describe, expect, it } from 'vitest';
import { taskEndpointError, taskWindowError, validateTaskInput } from './task-rules.js';

/**
 * M3 字段规则的单测（`docs/api.md` §3.3.3 / §3.3.5）。
 *
 * 重点在**创建与编辑两种模式下发出的载荷不同**：编辑只发改动过的字段
 * （否则「只改标题」的请求会把时间窗一并覆盖成旧值，而使用者以为自己没动它）。
 */
const VALID = {
  title: 'A 仓 → B 仓',
  cargoKg: 100,
  fromSiteId: 'seed-site-a',
  toSiteId: 'seed-site-b'
};

describe('validateTaskInput（创建）', () => {
  it('最小合法输入：优先级缺省为 normal（不是枚举首项 low）', () => {
    const result = validateTaskInput(VALID, 'create');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value).toMatchObject({
        title: 'A 仓 → B 仓',
        cargoKg: 100,
        priority: 'normal',
        templateId: null,
        cargoDesc: null,
        timeWindowStart: null,
        timeWindowEnd: null
      });
    }
  });

  it('必填字段缺失：一次报全，而不是只报第一个', () => {
    const result = validateTaskInput({}, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields).sort()).toEqual(['cargoKg', 'fromSiteId', 'title', 'toSiteId']);
    }
  });

  it('起终点相同 → 报在 toSiteId 上（DDL 的 CHECK 不应当成为第一道关卡）', () => {
    const result = validateTaskInput({ ...VALID, toSiteId: VALID.fromSiteId }, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['toSiteId']).toContain('同一个站点');
    }
  });

  it('时间窗：倒置与「只给一端」都拒绝，成对且有序则通过', () => {
    const inverted = validateTaskInput(
      { ...VALID, timeWindowStart: '2026-09-27T10:00:00.000Z', timeWindowEnd: '2026-09-27T09:00:00.000Z' },
      'create'
    );
    expect(inverted.ok).toBe(false);

    const half = validateTaskInput({ ...VALID, timeWindowStart: '2026-09-27T10:00:00.000Z' }, 'create');
    expect(half.ok).toBe(false);
    if (!half.ok) {
      expect(half.fields['timeWindowEnd']).toContain('同时给出');
    }

    const ok = validateTaskInput(
      { ...VALID, timeWindowStart: '2026-09-27T10:00:00.000Z', timeWindowEnd: '2026-09-27T11:00:00.000Z' },
      'create'
    );
    expect(ok.ok).toBe(true);
  });

  it('载重：负数与超上限拒绝；0 允许（空车转运是合法业务）', () => {
    expect(validateTaskInput({ ...VALID, cargoKg: -1 }, 'create').ok).toBe(false);
    expect(validateTaskInput({ ...VALID, cargoKg: 20001 }, 'create').ok).toBe(false);
    expect(validateTaskInput({ ...VALID, cargoKg: 0 }, 'create').ok).toBe(true);
  });

  it('时间不是 ISO 串时拒绝（字符串比较下「明天上午」会让窗口永远算不出来）', () => {
    const result = validateTaskInput({ ...VALID, timeWindowStart: '明天上午', timeWindowEnd: '2026-09-27T11:00:00.000Z' }, 'create');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['timeWindowStart']).toContain('可解析的时间');
    }
  });
});

describe('validateTaskInput（编辑）', () => {
  it('只交出本次真的传了的字段', () => {
    const result = validateTaskInput({ title: '改个标题' }, 'patch');
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value).toEqual({ title: '改个标题' });
    }
  });

  it('可空列：显式 null 才是清空；缺席表示这次没动它', () => {
    const cleared = validateTaskInput({ timeWindowEnd: null, cargoDesc: null }, 'patch');
    expect(cleared.ok).toBe(true);
    if (cleared.ok) {
      expect(cleared.value).toEqual({ timeWindowEnd: null, cargoDesc: null });
    }

    const untouched = validateTaskInput({ title: '只改标题' }, 'patch');
    if (untouched.ok) {
      expect('timeWindowEnd' in untouched.value).toBe(false);
      expect('cargoDesc' in untouched.value).toBe(false);
    }
  });

  it('编辑不允许改模板：显式传了就报错，而不是静默忽略', () => {
    const result = validateTaskInput({ templateId: 'seed-tpl-std' }, 'patch');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['templateId']).toContain('创建时');
    }
  });

  it('单个字段非法时仍然返回字段级原因', () => {
    const result = validateTaskInput({ cargoKg: '100' }, 'patch');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fields['cargoKg']).toContain('有限数字');
    }
  });

  it('跨字段判定在编辑模式下交给服务层，但**共用同一份比较逻辑**', () => {
    // 只传一端时这里必须放行（另一端要用库里的旧值），否则一次「只改开始时间」的请求会被误拒
    expect(validateTaskInput({ timeWindowStart: '2026-09-27T10:00:00.000Z' }, 'patch').ok).toBe(true);
    // 而真正的判据是下面这两个纯函数 —— 服务层调的就是它们
    expect(taskWindowError('2026-09-27T11:00:00.000Z', '2026-09-27T10:00:00.000Z')).toContain('晚于');
    expect(taskWindowError(null, null)).toBeNull();
    expect(taskEndpointError('a', 'a')).toContain('同一个站点');
    expect(taskEndpointError('a', 'b')).toBeNull();
  });
});
