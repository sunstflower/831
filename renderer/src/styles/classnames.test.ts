import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CSS 归属与引用一致性护栏。
 *
 * 两条不变量：
 * 1. **JSX 里用到的类名必须在某个 CSS 文件里有定义**（下文详述）；
 * 2. **`theme.css` 只能放令牌，不能放类选择器**（D-36 的归属规则，见文件末尾的 describe）。
 *
 * 关于第 1 条：
 *
 * 为什么需要：`className="udm-foo"` 与 `.udm-foo { … }` 之间**没有任何静态关联** ——
 * 少写一处，代码照样通过 `tsc`、`vite build` 与所有既有测试，页面也不报错。
 * 唯一的症状是「这块样式没生效」，而它通常表现为**排版坏掉**（实测：`ISS-048`
 * 的占位页把四个权限点渲染成 `alert:readalert:ackalert:resolvealert:archive`）。
 * 而且这类缺陷**只在特定的数据形态下显形**：只有一个接口的模块看起来一切正常，
 * 列出多项时才是坏的 —— 因此人工逐页核对很容易漏。
 *
 * 判定范围刻意收窄到 `className` 属性，而不是全文搜 `udm-*`：后者会把
 * CSS 变量（`--udm-font-2xl`）、元素 `id`（`id="udm-user-menu"`）、`aria-controls`
 * 与注释里的引用全部误判为「类名」—— 一个满屏误报的护栏等于没有护栏。
 *
 * 动态类名（`` `udm-swatch udm-swatch--${tone}` ``）的**静态前缀**（`udm-swatch--`）
 * 不要求自身有定义，而是要求「存在以该前缀开头的已定义类」（如 `.udm-swatch--net`）。
 */
const RENDERER = join(process.cwd(), 'renderer/src');
const RENDERER_ALT = join(process.cwd(), 'src');

function resolveRendererRoot(): string {
  if (existsSync(RENDERER)) {
    return RENDERER;
  }
  if (existsSync(RENDERER_ALT)) {
    return RENDERER_ALT;
  }
  throw new Error(`未找到 renderer/src，已尝试：\n${RENDERER}\n${RENDERER_ALT}`);
}

const root = resolveRendererRoot();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);

/** 全部 CSS 里定义过的类名。 */
const defined = new Set<string>();
for (const file of files) {
  if (!file.endsWith('.css')) {
    continue;
  }
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of css.matchAll(/\.(udm-[A-Za-z0-9_-]+)/g)) {
    // `noUncheckedIndexedAccess` 下 `match[1]` 是 `string | undefined`；
    // 正则只有一个捕获组，用 `?? ''` 收窄比加非空断言更能表达「这里确实可能没有」
    defined.add(match[1] ?? '');
  }
}

/** 源码里 `className` 用到的 `udm-*` 类名（含动态前缀），按文件归组。 */
const used = new Map<string, Set<string>>();
for (const file of files) {
  if (!/\.tsx?$/.test(file) || /\.test\./.test(file)) {
    continue;
  }
  const source = readFileSync(file, 'utf8');
  const found = new Set<string>();

  for (const attr of source.matchAll(/className=(?:"([^"]*)"|\{([\s\S]*?)\})/g)) {
    const body = attr[1] ?? attr[2] ?? '';
    // 只取类名 token：`udm-` 开头，允许动态前缀（模板字面量在 `--` 处截断）
    for (const token of body.matchAll(/udm-[A-Za-z0-9_-]+/g)) {
      // 排除注释/变量引用残留（`--udm-x` 这种在 className 里不会出现，稳妥起见仍过滤）
      found.add(token[0]);
    }
  }
  if (found.size > 0) {
    used.set(relative(root, file), found);
  }
}

/** 某个 token 是否算「已定义」：自身已定义，或其前缀（`x--`）有对应的已定义类。 */
function isDefined(token: string): boolean {
  if (defined.has(token)) {
    return true;
  }
  if (token.endsWith('--')) {
    return [...defined].some((name) => name.startsWith(token));
  }
  return false;
}

describe('renders · className 与 CSS 定义一致', () => {
  it('扫到了 CSS 定义与 className 引用（护栏自身没有静默失效）', () => {
    // 若哪天重构了目录结构，本护栏会「扫到 0 个类名」而永远通过 —— 那是比漏报更糟的假绿
    expect(defined.size).toBeGreaterThan(50);
    expect(used.size).toBeGreaterThan(3);
  });

  it('每个 className 里的 udm-* 类名都有对应 CSS 定义', () => {
    const missing: string[] = [];
    for (const [file, tokens] of [...used].sort()) {
      for (const token of [...tokens].sort()) {
        if (!isDefined(token)) {
          missing.push(`${file}: ${token}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * 第二条不变量：`theme.css` 是**设计令牌**的唯一载体（D-36）。
 *
 * 它不该出现类选择器 —— 一旦出现，就说明有人把「基元」写进了「令牌」文件，
 * 于是「这个类该放哪」的答案从「被 2 处以上使用 → `ui.css`」退化成「谁先写就放哪」。
 * 实测两次踩到同一处：`ISS-046`（`.udm-sr-only`）与 `.udm-spinner`（被工作台与地图共用，
 * 却在 `theme.css` 里）—— 规则写下了，存量没人回头扫。
 *
 * 注意断言的是**普通类选择器**而非所有花括号：`:root`、`*`、`html`、`body`、`#root`
 * 这些基础选择器本来就属于「全局基础样式」，留在 `theme.css` 是正确的。
 */
describe('styles · theme.css 只放令牌', () => {
  // 用 `split(sep)` 判断而不写死 `/`：本文件在 macOS/Windows 上都要能跑
  const themeCssPath = files.find(
    (file) => file.split(sep).slice(-2).join(sep) === join('styles', 'theme.css')
  );
  const themeCss = themeCssPath ? readFileSync(themeCssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') : '';

  it('theme.css 存在且被读到（护栏没有因为路径变化而静默失效）', () => {
    expect(themeCssPath, '没找到 renderer/src/styles/theme.css').toBeDefined();
    expect(themeCss.length).toBeGreaterThan(500);
    // 令牌本该在这里：拿一个已知变量做自检
    expect(themeCss).toContain('--udm-bg');
  });

  it('不含类选择器（类选择器属于 ui.css 或模块样式表）', () => {
    const offenders = [...themeCss.matchAll(/^\s*(\.udm-[A-Za-z0-9_-]+)/gm)].map((match) => match[1] ?? '');
    expect([...new Set(offenders)]).toEqual([]);
  });
});
