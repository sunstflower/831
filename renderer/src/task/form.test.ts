import { describe, expect, it } from 'vitest';
import type { TaskListItem } from '@udm/shared';
import { TASK_FORM, buildTaskPayload, emptyTaskForm, taskFormValuesOf, toLocalInputValue, templateOptionsOf } from './form';

/**
 * 任务表单模型的单测。
 *
 * 锁的是**载荷口径**（空值怎么发、编辑只发改过的字段、时间怎么转换），
 * 而不是「弹层里能看到几个输入框」—— 后者在载荷写错时同样会通过。
 */
function valuesOf(overrides: Record<string, string> = {}) {
  return {
    ...emptyTaskForm(),
    title: 'A 仓 → B 仓 配送',
    cargoKg: '120',
    fromSiteId: 'site-a',
    toSiteId: 'site-b',
    ...overrides
  };
}

describe('初始值', () => {
  it('优先级缺省是「普通」（DDL 的 DEFAULT normal，不是枚举首项 low）', () => {
    expect(emptyTaskForm()['priority']).toBe('normal');
  });

  it('模板与时间窗初始为空：套模板与限时段都是可选动作', () => {
    const values = emptyTaskForm();
    expect(values['templateId']).toBe('');
    expect(values['timeWindowStart']).toBe('');
    expect(values['timeWindowEnd']).toBe('');
  });

  it('编辑时把 ISO 时间转成 datetime-local 的本地时间', () => {
    const row = {
      id: 't1',
      code: 'T-1',
      title: 'x',
      status: 'draft',
      priority: 'normal',
      cargoKg: 10,
      fromSiteId: 'a',
      toSiteId: 'b',
      fromSiteName: null,
      toSiteName: null,
      timeWindowStart: '2026-09-27T08:00:00.000Z',
      timeWindowEnd: null,
      assignedVehicleId: null,
      vehicleCode: null,
      progress: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: null
    } satisfies TaskListItem;
    const values = taskFormValuesOf(row);
    expect(values['timeWindowStart']).toBe(toLocalInputValue('2026-09-27T08:00:00.000Z'));
    expect(values['timeWindowEnd']).toBe('');
    expect(values['cargoKg']).toBe('10');
  });
});

describe('创建载荷', () => {
  it('必填 + 缺省：时间窗留空发 null（明确「不限时段」，而不是漏发字段）', () => {
    const built = buildTaskPayload(valuesOf(), 'create');
    expect(built).toEqual({
      ok: true,
      payload: {
        title: 'A 仓 → B 仓 配送',
        priority: 'normal',
        cargoKg: 120,
        // 可空列在创建时显式发 null：与「没这个字段」不同，它表达的是「这一项就是空的」
        cargoDesc: null,
        fromSiteId: 'site-a',
        toSiteId: 'site-b',
        timeWindowStart: null,
        timeWindowEnd: null
      }
    });
  });

  it('标题里去掉首尾空白，数字型字段转成数字', () => {
    const built = buildTaskPayload(valuesOf({ title: '  两仓转运  ', cargoKg: '99.5' }), 'create');
    expect(built).toEqual({
      ok: true,
      payload: {
        title: '两仓转运',
        priority: 'normal',
        cargoKg: 99.5,
        cargoDesc: null,
        fromSiteId: 'site-a',
        toSiteId: 'site-b',
        timeWindowStart: null,
        timeWindowEnd: null
      }
    });
  });

  it('时间窗转成 ISO 8601（输入框给的是本地时间）', () => {
    const built = buildTaskPayload(
      valuesOf({ timeWindowStart: '2026-09-27T08:00', timeWindowEnd: '2026-09-27T18:00' }),
      'create'
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload['timeWindowStart']).toBe(new Date('2026-09-27T08:00').toISOString());
      expect(built.payload['timeWindowEnd']).toBe(new Date('2026-09-27T18:00').toISOString());
    }
  });

  it('起终点相同 → 报在终点字段上（错误要指向该改的那个框）', () => {
    const built = buildTaskPayload(valuesOf({ toSiteId: 'site-a' }), 'create');
    expect(built).toEqual({ ok: false, fields: { toSiteId: '起点与终点不能是同一个站点' } });
  });

  it('时间窗只填一端 → 报在**空的那一个**字段上，而不是已填好的那个', () => {
    expect(buildTaskPayload(valuesOf({ timeWindowStart: '2026-09-27T08:00' }), 'create')).toEqual({
      ok: false,
      fields: { timeWindowEnd: '时间窗必须同时给出开始与结束（或都不给）' }
    });
    expect(buildTaskPayload(valuesOf({ timeWindowEnd: '2026-09-27T08:00' }), 'create')).toEqual({
      ok: false,
      fields: { timeWindowStart: '时间窗必须同时给出开始与结束（或都不给）' }
    });
  });

  it('必填缺失时逐字段给出原因（页面据此标红，而不是只弹一句「校验失败」）', () => {
    const built = buildTaskPayload({ ...emptyTaskForm() }, 'create');
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(Object.keys(built.fields).sort()).toEqual(['cargoKg', 'fromSiteId', 'title', 'toSiteId']);
    }
  });

  it('无效的时间输入直接拦下（不让它到服务端换一句「必须是 ISO 时间」）', () => {
    const built = buildTaskPayload(
      valuesOf({ timeWindowStart: '2026-09-27T08:00', timeWindowEnd: '不是时间' }),
      'create'
    );
    expect(built).toEqual({ ok: false, fields: { timeWindowEnd: '时间格式不正确' } });
  });

  it('模板可以留空（= 不使用模板），发出去的载荷里就没有 templateId', () => {
    const built = buildTaskPayload(valuesOf({ templateId: '' }), 'create');
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect('templateId' in built.payload).toBe(false);
    }
  });
});

describe('编辑载荷', () => {
  const original = valuesOf({ priority: 'high', cargoDesc: '冷藏托盘' });

  it('只发真正改过的字段（没改的一个都不带）', () => {
    const built = buildTaskPayload({ ...original, cargoKg: '150' }, 'patch', original);
    expect(built).toEqual({ ok: true, payload: { cargoKg: 150 } });
  });

  it('清空货物描述发 null（「清空」与「没改」是两件事）', () => {
    const built = buildTaskPayload({ ...original, cargoDesc: '' }, 'patch', original);
    expect(built).toEqual({ ok: true, payload: { cargoDesc: null } });
  });

  it('模板 ID 永远不发：它是创建时的一次性输入（服务端收到会直接报错）', () => {
    const built = buildTaskPayload({ ...original, templateId: 'tpl-1' }, 'patch', original);
    expect(built).toEqual({ ok: true, payload: {} });
  });

  it('清空时间窗发两个 null（这是「取消时段限制」唯一能表达的方式）', () => {
    const withWindow = valuesOf({ timeWindowStart: '2026-09-27T08:00', timeWindowEnd: '2026-09-27T18:00' });
    const built = buildTaskPayload({ ...withWindow, timeWindowStart: '', timeWindowEnd: '' }, 'patch', withWindow);
    expect(built).toEqual({ ok: true, payload: { timeWindowStart: null, timeWindowEnd: null } });
  });

  it('跨字段校验用当前值成对判断，因此「只清一端」会被当场拦下', () => {
    const withWindow = valuesOf({ timeWindowStart: '2026-09-27T08:00', timeWindowEnd: '2026-09-27T18:00' });
    const built = buildTaskPayload({ ...withWindow, timeWindowEnd: '' }, 'patch', withWindow);
    expect(built).toEqual({ ok: false, fields: { timeWindowEnd: '时间窗必须同时给出开始与结束（或都不给）' } });
  });
});

describe('模板候选项', () => {
  it('把模板的关键缺省值写进文案（省得逐个点开看）', () => {
    const options = templateOptionsOf([
      {
        id: 'tpl-1',
        code: 'TPL-STD',
        name: '标准配送',
        priority: 'normal',
        defaultCargoKg: 500,
        timeWindowMinutes: 120,
        fromSiteType: null,
        toSiteType: null,
        remark: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]);
    expect(options).toEqual([{ value: 'tpl-1', label: 'TPL-STD · 500 kg · 时间窗 120 分钟' }]);
  });

  it('字段清单里模板下拉的 options 是运行时填的，因此初始为空数组', () => {
    const field = TASK_FORM.fields.find((item) => item.name === 'templateId');
    expect(field?.options).toEqual([]);
    expect(field?.immutableOnEdit).toBe(true);
    expect(field?.emptyLabel).toBe('不使用模板');
  });
});
