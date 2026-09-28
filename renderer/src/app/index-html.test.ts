import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `renderer/index.html` 的一致性护栏。
 *
 * 这个文件在**任何 CSS / JS 之前**被解析，因此它只能写「字面量」：
 * 图标色值读不到 CSS 变量，`color-scheme` 也来不及由样式表决定。
 * 字面量一旦漂离主题，就成了**第三套色值**（`theme.css` 与 `palette.ts` 之后），
 * 而 favicon 与主题对不上是**没人会报错**的那类问题 —— 只能靠断言。
 *
 * 与 `map/model/palette.test.ts` 同一思路：把「不许漂移」写成一次测试失败。
 */
function resolve(...candidates: string[]): string {
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`未找到文件，已尝试：\n${candidates.join('\n')}`);
  }
  return found;
}

/**
 * 定位仓库里的文件。
 *
 * 与 `palette.test.ts` 同样的理由：本套件跑在 jsdom 环境下 `import.meta.url` 不是 `file:`
 * scheme，`new URL(..., import.meta.url)` 会抛错，因此从 `process.cwd()` 逐层尝试，
 * 兼容「从仓库根跑」与「从 renderer/ 跑」两种姿势。
 */
const indexHtml = readFileSync(
  resolve(join(process.cwd(), 'renderer/index.html'), join(process.cwd(), 'index.html')),
  'utf8'
);
const themeCss = readFileSync(
  resolve(join(process.cwd(), 'renderer/src/styles/theme.css'), join(process.cwd(), 'src/styles/theme.css')),
  'utf8'
);

/** 归一化为小写 6 位十六进制，容忍 `#FFF` 的写法。 */
function normalize(hex: string): string {
  const lower = hex.toLowerCase();
  return /^#[0-9a-f]{3}$/.test(lower)
    ? `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
    : lower;
}

/** `theme.css` 里登记过的全部色值。 */
const themeColors = new Set([...themeCss.matchAll(/#[0-9a-fA-F]{3,6}\b/g)].map((m) => normalize(m[0])));

/** `index.html` 里内联图标的 SVG 源码。 */
function faviconSvg(): string {
  const match = /rel="icon"[\s\S]{0,200}?href="([^"]+)"/.exec(indexHtml);
  expect(match, 'index.html 里找不到 <link rel="icon">').not.toBeNull();
  const href = match?.[1] ?? '';
  expect(href.startsWith('data:image/svg+xml,')).toBe(true);
  return decodeURIComponent(href.replace(/^data:image\/svg\+xml,/, ''));
}

describe('renderer/index.html · 首屏声明', () => {
  it('声明了内联 data: 图标（否则浏览器形态会去请求 /favicon.ico 拿 404）', () => {
    expect(faviconSvg()).toContain('<svg');
  });

  it('图标里的每个色值都已在 theme.css 登记（不新增第三套色值）', () => {
    const used = [...faviconSvg().matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => normalize(m[0]));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((hex) => !themeColors.has(hex))).toEqual([]);
  });

  it('在样式表到达之前就声明深色与主题色（避免冷启动先闪一帧白）', () => {
    expect(indexHtml).toMatch(/<meta name="color-scheme" content="dark"/);
    expect(indexHtml).toMatch(/<meta name="theme-color" content="#0f172a"/);
    // theme-color 也必须取自 theme.css 的 --udm-bg，而不是另写一个近似的深色
    expect(themeColors.has('#0f172a')).toBe(true);
  });
});
