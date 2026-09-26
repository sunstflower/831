import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MINIMAP_NODE_COLORS, PALETTE } from './palette';

/**
 * 配色一致性护栏。
 *
 * 为什么需要：`<MiniMap>` 的节点颜色必须以**字面量**传给 React Flow
 * （它把颜色写成 `<rect style={{fill}}>`，拿不到 CSS 类），
 * 而画布上其它元素用 `theme.css` 的变量上色。
 * 两处一旦漂移，缩略图与主画布就会显示不同的颜色，且**不会报任何错**。
 *
 * 这里直接把 `theme.css` 读进来比对，让漂移变成一次测试失败。
 */
/**
 * 定位 `theme.css`。
 *
 * 注意：本套件跑在 **jsdom** 环境（`vitest.config.ts` 的 `environmentMatchGlobs`），
 * 此时 `import.meta.url` 不是 `file:` scheme，`new URL(..., import.meta.url)` 会抛
 * 「The URL must be of scheme file」。因此改为从 `process.cwd()` 逐层向上找，
 * 兼容「从仓库根跑」与「从 renderer/ 跑」两种姿势。
 */
function resolveThemeCss(): string {
  const candidates = [
    join(process.cwd(), 'renderer/src/styles/theme.css'),
    join(process.cwd(), 'src/styles/theme.css')
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`未找到 theme.css，已尝试：\n${candidates.join('\n')}`);
  }
  return found;
}

const themeCss = readFileSync(resolveThemeCss(), 'utf8');

/** 从 CSS 里取出某个自定义属性的值。 */
function cssVar(name: string): string | null {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(themeCss);
  return match?.[1]?.trim() ?? null;
}

/** 归一化为小写十六进制，容忍 `#FFF` / `#ffffff` 的写法差异。 */
function normalize(value: string): string {
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

describe('palette · 与 theme.css 一致', () => {
  const pairs: Array<[keyof typeof PALETTE, string]> = [
    ['net', 'udm-canvas-net'],
    ['route', 'udm-canvas-route'],
    ['site', 'udm-canvas-site'],
    ['task', 'udm-canvas-task'],
    ['order', 'udm-canvas-order'],
    ['vehicle', 'udm-canvas-vehicle'],
    ['accent', 'udm-accent'],
    ['warn', 'udm-warn'],
    ['danger', 'udm-danger'],
    ['ok', 'udm-ok']
  ];

  it.each(pairs)('PALETTE.%s 与 --%s 相同', (key, cssName) => {
    const value = cssVar(cssName);
    expect(value, `theme.css 缺少 --${cssName}`).not.toBeNull();
    expect(normalize(PALETTE[key])).toBe(normalize(value as string));
  });

  it('缩略图配色全部来自 PALETTE（不出现游离色值）', () => {
    const allowed = new Set(Object.values(PALETTE).map(normalize));
    for (const [type, color] of Object.entries(MINIMAP_NODE_COLORS)) {
      expect(allowed.has(normalize(color)), `缩略图类型 ${type} 的颜色 ${color} 不在 PALETTE 中`).toBe(true);
    }
  });

  it('每个画布节点类型都在缩略图里有配色（新增图层忘记登记会在此失败）', async () => {
    const { nodeTypes } = await import('../nodes');
    const missing = Object.keys(nodeTypes).filter((type) => !(type in MINIMAP_NODE_COLORS));
    expect(missing).toEqual([]);
  });
});
