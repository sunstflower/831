import { describe, expect, it } from 'vitest';
import { ROUTE_MAX_VIA_NODES, validateRouteInput } from './route-rules.js';

/**
 * 路径规划入参校验的用例。
 *
 * 这里的每一条都对应一个「不校验就会以奇怪的方式失败」的场景：
 * 缺车种会让耗时按错误的速度算、via 传字符串会让搜索逐字符遍历、
 * 途经点过多会让一次预览变成上千次最短路。
 */

const base = { fromNodeId: 'n1', toNodeId: 'n2', vehicleType: 'agv' };

describe('route-rules · 必填与枚举', () => {
  it('起终点必填', () => {
    const result = validateRouteInput({ vehicleType: 'agv' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields['fromNodeId']).toBe('必填');
    expect(result.fields['toNodeId']).toBe('必填');
  });

  it('车种必填（它决定耗时，不能给一个「看起来能用」的默认值）', () => {
    const result = validateRouteInput({ fromNodeId: 'n1', toNodeId: 'n2' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields['vehicleType']).toBe('必填');
  });

  it('车种取值必须是枚举成员', () => {
    const result = validateRouteInput({ ...base, vehicleType: 'robot' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields['vehicleType']).toContain('agv');
  });

  it('algorithm 缺省为 aStar；取值非法时报错', () => {
    const ok = validateRouteInput(base);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.algorithm).toBe('aStar');

    const bad = validateRouteInput({ ...base, algorithm: 'floyd' });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.fields['algorithm']).toContain('aStar');
  });

  it('字段长度上限与 base-rules 一致（64）', () => {
    const result = validateRouteInput({ ...base, fromNodeId: 'x'.repeat(65) });
    expect(result.ok).toBe(false);
  });
});

describe('route-rules · viaNodeIds', () => {
  it('缺省与空数组都等价于「不限制途经点」', () => {
    for (const input of [base, { ...base, viaNodeIds: [] }]) {
      const result = validateRouteInput(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.viaNodeIds).toEqual([]);
    }
  });

  it('只接受数组：逗号分隔的字符串不是数组（节点 id 里可能含逗号）', () => {
    const result = validateRouteInput({ ...base, viaNodeIds: 'n3,n4' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields['viaNodeIds']).toBe('必须是节点 id 数组');
  });

  it('逐项 trim，元素必须是节点 id', () => {
    const ok = validateRouteInput({ ...base, viaNodeIds: [' n3 '] });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.viaNodeIds).toEqual(['n3']);

    const bad = validateRouteInput({ ...base, viaNodeIds: ['n3', 42] });
    expect(bad.ok).toBe(false);
  });

  it('途经点个数超过上限被拒（成本护栏）', () => {
    const many = Array.from({ length: ROUTE_MAX_VIA_NODES + 1 }, (_, index) => `n${index}`);
    const result = validateRouteInput({ ...base, viaNodeIds: many });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields['viaNodeIds']).toContain(String(ROUTE_MAX_VIA_NODES));
  });
});
