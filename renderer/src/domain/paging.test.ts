import { describe, expect, it } from 'vitest';
import { clampPage, pageCountOf } from './paging';

/** 分页换算（原先在 `base/model.test.ts` 里覆盖；两个模块共用后搬到实现旁边）。 */
describe('pageCountOf', () => {
  it('总数为 0 也算 1 页（否则分页器显示 0 / 0）', () => {
    expect(pageCountOf(0, 20)).toBe(1);
    expect(pageCountOf(1, 20)).toBe(1);
    expect(pageCountOf(20, 20)).toBe(1);
    expect(pageCountOf(21, 20)).toBe(2);
  });
});

describe('clampPage', () => {
  it('筛选后总数变小要把页码拉回来，而不是停在一张空表上', () => {
    expect(clampPage(3, 2, 20)).toBe(1);
    expect(clampPage(3, 45, 20)).toBe(3);
    expect(clampPage(9, 45, 20)).toBe(3);
    expect(clampPage(0, 45, 20)).toBe(1);
  });
});
