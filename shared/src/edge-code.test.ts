import { describe, expect, it } from 'vitest';
import { deriveEdgeCode, parseEdgeCode } from './edge-code.js';

/**
 * 边编码约定的测试（D-35）。
 *
 * 这组用例同时是**与真实样本的对照**：样本里 `E_N00_N10` 与 `E_N00_N10_R` 成对出现
 * （`docs/data-interfaces.md` §4.3），下面的期望值直接取该形态。
 */
describe('deriveEdgeCode', () => {
  it('字典序较小的一侧为正向，反方向加 _R', () => {
    expect(deriveEdgeCode('N00', 'N10')).toBe('E_N00_N10');
    expect(deriveEdgeCode('N10', 'N00')).toBe('E_N00_N10_R');
  });

  it('传入顺序无关：交换两端只影响是否有 _R，不影响排序结果', () => {
    expect(deriveEdgeCode('N12', 'N01')).toBe('E_N01_N12_R');
    expect(deriveEdgeCode('N01', 'N12')).toBe('E_N01_N12');
  });

  it('两端 code 相同时退化为自身（自环在库里有 CHECK 拦，这里不制造第二个校验点）', () => {
    expect(deriveEdgeCode('N01', 'N01')).toBe('E_N01_N01');
  });
});

describe('parseEdgeCode', () => {
  it('往返一致：derive 出来的 code 都能 parse 回同样的两端与方向', () => {
    const cases: Array<[string, string]> = [
      ['N00', 'N10'],
      ['N10', 'N00'],
      ['N12', 'N01'],
      ['N01', 'N01']
    ];
    for (const [from, to] of cases) {
      const parsed = parseEdgeCode(deriveEdgeCode(from, to));
      expect(parsed, `${from}→${to}`).not.toBeNull();
      const [small, large] = from <= to ? [from, to] : [to, from];
      expect(parsed).toEqual({ smallCode: small, largeCode: large, reversed: from !== small });
    }
  });

  it('非边 code 一律返回 null，而不是抛错（调用方要的是「空结果」，不是 400）', () => {
    for (const bad of ['', 'N01', 'E_', 'E_N01', 'E__N01', 'E_N01_', 'X_N01_N02']) {
      expect(parseEdgeCode(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('拒绝「小的一侧写在后」的 code：E_N12_N01 不是合法写法', () => {
    // 若放行，`E_N12_N01` 与 `E_N01_N12_R` 会指向同一条边，同一个对象两个 code（D-33 同思路）
    expect(parseEdgeCode('E_N12_N01')).toBeNull();
    expect(parseEdgeCode('E_N12_N01_R')).toBeNull();
  });

  it('节点 code 自身含下划线时按第一个下划线切分', () => {
    expect(parseEdgeCode('E_A_B_C_D')).toEqual({ smallCode: 'A', largeCode: 'B_C_D', reversed: false });
  });
});
