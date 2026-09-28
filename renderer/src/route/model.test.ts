import { describe, expect, it } from 'vitest';
import type { NodeListItem, RouteCompareResponse, RoutePlan } from '@udm/shared';
import {
  EMPTY_ROUTE_QUERY,
  buildPlanPayload,
  compareRowsOf,
  compareVerdict,
  nodeChainOf,
  nodeOptionsOf,
  parseViaInput,
  routeFactsOf,
  type RouteQuery
} from './model';

/**
 * 路径规划表单/展示模型（`renderer/src/route/model.ts`）。
 *
 * 这些用例守的是**输入解析**与**展示口径**两件事，而它们都属于「错了也不报错」的那一类：
 *   - 途经点写了不存在的编码却被静默丢弃 → 使用者以为走了那条路，实际没有；
 *   - 里程/耗时的小数位在两处不一致 → 看起来像两个不同的数字（`domain/format.ts` 的口径）。
 * 因此这里逐条断言解析结果与格式化后的字符串本身，而不是「有个值就算过」。
 */
function node(index: number, status: NodeListItem['status'] = 'enabled'): NodeListItem {
  const code = `N${String(index).padStart(2, '0')}`;
  return {
    id: `seed-n${String(index).padStart(2, '0')}`,
    code,
    name: `园区节点 ${index}`,
    x: index * 10,
    y: 0,
    status,
    remark: null
  };
}

const NODES: NodeListItem[] = [node(1), node(2), node(5), node(12)];

const QUERY: RouteQuery = {
  fromNodeId: 'seed-n01',
  toNodeId: 'seed-n12',
  viaText: 'N05',
  vehicleType: 'agv',
  algorithm: 'aStar'
};

function plan(patch: Partial<RoutePlan> = {}): RoutePlan {
  return {
    fromNodeId: 'seed-n01',
    toNodeId: 'seed-n12',
    viaNodeIds: [],
    nodeIds: ['seed-n01', 'seed-n02', 'seed-n12'],
    edgeIds: ['e1', 'e2'],
    distanceM: 100,
    durationS: 200 / 3,
    algorithm: 'aStar',
    costDetail: { travelS: 200 / 3 },
    warnings: [],
    ...patch
  };
}

describe('route/model · 选项', () => {
  it('节点选项是「编码 · 名称」，已停用节点保留但标记为不可选', () => {
    const options = nodeOptionsOf([node(1), node(2, 'disabled')]);
    expect(options[0]).toEqual({ value: 'seed-n01', label: 'N01 · 园区节点 1', code: 'N01', disabled: false });
    // 停用节点不隐藏：它确实存在（归基础数据管），隐藏会让人以为编码敲错了
    expect(options[1]!.disabled).toBe(true);
  });
});

describe('route/model · 途经点解析', () => {
  it('接受节点编码，大小写不敏感，逗号与空白都能分隔', () => {
    expect(parseViaInput('N02, n05', NODES)).toEqual({ ids: ['seed-n02', 'seed-n05'], unknown: [] });
    expect(parseViaInput('N02、N05', NODES)).toEqual({ ids: ['seed-n02', 'seed-n05'], unknown: [] });
    expect(parseViaInput('  N02   N05  ', NODES)).toEqual({ ids: ['seed-n02', 'seed-n05'], unknown: [] });
  });

  it('也接受节点 id（从接口响应/日志里复制过来时用得上）', () => {
    expect(parseViaInput('seed-n05', NODES)).toEqual({ ids: ['seed-n05'], unknown: [] });
  });

  it('保持顺序，并去掉重复项（重复经过同一节点只留第一次）', () => {
    expect(parseViaInput('N05, N02, N05', NODES).ids).toEqual(['seed-n05', 'seed-n02']);
  });

  it('认不出来的词**全部报出来**，而不是静默丢弃', () => {
    expect(parseViaInput('N02, N99, XX', NODES)).toEqual({ ids: ['seed-n02'], unknown: ['N99', 'XX'] });
  });

  it('空文本 = 不限制途经点', () => {
    expect(parseViaInput('   ', NODES)).toEqual({ ids: [], unknown: [] });
  });
});

describe('route/model · 载荷构造', () => {
  it('起终点缺失时逐字段报错，且不给载荷', () => {
    const built = buildPlanPayload(EMPTY_ROUTE_QUERY, NODES);
    expect(built.payload).toBeNull();
    expect(Object.keys(built.fields).sort()).toEqual(['fromNodeId', 'toNodeId']);
  });

  it('正常输入构造出的载荷与契约字段一致（含空数组的途经点）', () => {
    const built = buildPlanPayload({ ...QUERY, viaText: '' }, NODES);
    expect(built.fields).toEqual({});
    expect(built.payload).toEqual({
      fromNodeId: 'seed-n01',
      toNodeId: 'seed-n12',
      viaNodeIds: [],
      vehicleType: 'agv',
      algorithm: 'aStar'
    });
  });

  it('途经点解析成内部 id 后放进载荷', () => {
    const built = buildPlanPayload(QUERY, NODES);
    expect(built.payload?.['viaNodeIds']).toEqual(['seed-n05']);
  });

  it('途经点认不出来时**不构造载荷**（宁可不发请求，也不要静默改路线）', () => {
    const built = buildPlanPayload({ ...QUERY, viaText: 'N99' }, NODES);
    expect(built.payload).toBeNull();
    expect(built.fields['viaText']).toContain('N99');
  });
});

describe('route/model · 展示口径', () => {
  it('摘要里的数值格式统一（里程一位小数、耗时由 format 决定）', () => {
    const facts = routeFactsOf(plan({ distanceM: 100.25 }));
    expect(facts.map((fact) => `${fact.label}=${fact.value}`)).toEqual([
      '里程=100.3 m',
      '预计耗时=66.7 s',
      '经停节点=3 个',
      '经过边=2 条',
      '算法=A*（默认，快）'
    ]);
  });

  it('dijkstra 的算法文案与 aStar 不同（对比表要能分辨两行）', () => {
    expect(routeFactsOf(plan({ algorithm: 'dijkstra' }))[4]!.value).toContain('基线');
  });

  it('节点链用编码而不是内部 id', () => {
    expect(nodeChainOf(plan(), NODES)).toEqual(['N01', 'N02', 'N12']);
    // 不在节点表里的 id 原样显示：宁可显示一个陌生 id，也不要显示空白让人以为丢了节点
    expect(nodeChainOf(plan({ nodeIds: ['seed-n01', 'ghost'] }), NODES)).toEqual(['N01', 'ghost']);
  });

  it('对比表按响应顺序出两行，算法名翻成中文', () => {
    const response: RouteCompareResponse = {
      results: [
        { algorithm: 'aStar', route: plan(), elapsedMs: 3 },
        { algorithm: 'dijkstra', route: plan({ durationS: 66.6666 }), elapsedMs: 12 }
      ],
      consistent: true,
      difference: { distanceM: 0, durationS: 0 }
    };
    const rows = compareRowsOf(response);
    expect(rows.map((row) => row.label)).toEqual(['A*（默认，快）', 'Dijkstra（基线，可对照）']);
    expect(rows[0]).toMatchObject({ distanceM: '100 m', durationS: '66.7 s', elapsedMs: '3 ms', nodeCount: 3 });
  });

  it('对比结论：一致是成功提示，不一致是缺陷提示（不是「两种方案各有取舍」）', () => {
    const consistent: RouteCompareResponse = { results: [], consistent: true, difference: { distanceM: 0, durationS: 0 } };
    expect(compareVerdict(consistent)).toEqual({ tone: 'ok', text: '两个算法结果一致：里程与耗时完全相同' });
    const inconsistent: RouteCompareResponse = {
      results: [],
      consistent: false,
      difference: { distanceM: 20, durationS: 13.3 }
    };
    const verdict = compareVerdict(inconsistent);
    expect(verdict.tone).toBe('danger');
    expect(verdict.text).toContain('20 m');
    expect(verdict.text).toContain('已记入审计');
  });
});
