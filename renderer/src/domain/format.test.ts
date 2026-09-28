import { describe, expect, it } from 'vitest';
import { formatDateTime, formatNumber, timeWindowText } from './format';

/**
 * 展示口径的回归测试。
 *
 * 这些函数被基础数据页与任务页共用（原先只在 `base/model.test.ts` 里覆盖），
 * 断的是**具体字符**而不是「不是空」：小数位、`起 / 至`、箭头方向都是口径的一部分，
 * 改掉其中一个不会让任何页面报错，只会让两张表看起来不是一套东西。
 */
describe('formatNumber', () => {
  it('整数原样、非整数保留一位小数（列宽不跳动）', () => {
    expect(formatNumber(20)).toBe('20');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(1.25)).toBe('1.3');
  });
});

describe('formatDateTime', () => {
  it('ISO → 「日期 时:分:秒」，毫秒与 Z 去掉、秒保留', () => {
    expect(formatDateTime('2026-09-27T08:00:00.000Z')).toBe('2026-09-27 08:00:00');
    expect(formatDateTime('2026-09-27T08:30:12Z')).toBe('2026-09-27 08:30:12');
  });

  it('空值返回空串（由调用点决定显示成什么，而不是在这里猜）', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });
});

describe('timeWindowText', () => {
  it('无时间窗说「不限时段」，而不是显示成破折号（那是数据缺失的样子）', () => {
    expect(timeWindowText(null, null)).toBe('不限时段');
  });

  it('只有一端时写明是哪一端', () => {
    expect(timeWindowText('2026-09-27T08:00:00.000Z', null)).toBe('2026-09-27 08:00:00 起');
    expect(timeWindowText(null, '2026-09-27T18:00:00.000Z')).toBe('至 2026-09-27 18:00:00');
  });

  it('两端都有时用箭头连成一列（左起点、右终点）', () => {
    expect(timeWindowText('2026-09-27T08:00:00.000Z', '2026-09-27T18:00:00.000Z')).toBe(
      '2026-09-27 08:00:00 → 2026-09-27 18:00:00'
    );
  });
});
