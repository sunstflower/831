import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@udm/shared';
import { describe, expect, it } from 'vitest';
import { parsePagination } from './paging.js';

/**
 * 分页参数解析的**容错口径**测试（ISS-015 抽取时的依据）。
 *
 * 这些用例的价值不在「函数算得对」，而在于**把隐性约定写下来**：
 * 原先内联在 `api.ts` 里时，「非法页码会怎样」只存在于那一行的三元表达式里，
 * 没有调用点之外的人知道，也没有任何东西阻止它在下一个接口里被写成另一种口径。
 */
describe('parsePagination · 默认值', () => {
  it('载荷为空时给出第 1 页与默认页长', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE, keyword: undefined });
  });
});

describe('parsePagination · page', () => {
  it('接受合法页码', () => {
    expect(parsePagination({ page: 3 }).page).toBe(3);
  });

  it('小数向下取整（2.7 表示第 2 页）', () => {
    expect(parsePagination({ page: 2.7 }).page).toBe(2);
  });

  it('非法值一律回落到第 1 页，而不是报错', () => {
    // 分页是「展示偏好」：为 `?page=abc` 返回 400 会让使用者看到与操作无关的错误页
    for (const bad of ['abc', '', 0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      expect(parsePagination({ page: bad }).page, `page=${JSON.stringify(bad)}`).toBe(1);
    }
  });
});

describe('parsePagination · pageSize', () => {
  it('超过上限时夹取到 MAX_PAGE_SIZE（防止一次拉全表）', () => {
    expect(parsePagination({ pageSize: MAX_PAGE_SIZE + 500 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('非法值回落到默认页长', () => {
    for (const bad of ['abc', 0, -1, Number.NaN]) {
      expect(parsePagination({ pageSize: bad }).pageSize, `pageSize=${JSON.stringify(bad)}`).toBe(
        DEFAULT_PAGE_SIZE
      );
    }
  });

  it('恰好等于上限时保留（边界不夹取）', () => {
    expect(parsePagination({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);
  });
});

describe('parsePagination · keyword', () => {
  it('去掉首尾空白', () => {
    expect(parsePagination({ keyword: '  AGV-01  ' }).keyword).toBe('AGV-01');
  });

  it('空串 / 纯空白 / 非字符串都视为「没给筛选」', () => {
    // 搜索框清空后前端常提交 `keyword: ''`；透传到 SQL 的 `LIKE '%%'` 会退化成全表扫描
    for (const bad of ['', '   ', 123, null, undefined, {}]) {
      expect(parsePagination({ keyword: bad }).keyword, `keyword=${JSON.stringify(bad)}`).toBeUndefined();
    }
  });
});
