import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 仓库级**文档不变量**。
 *
 * 为什么放在 `tests/` 而不是某个 workspace：这些约束的对象是**仓库本身**
 * （根目录与 `docs/` 的 Markdown），不属于 `shared` / `desktop` / `renderer` 任何一个包。
 *
 * 为什么必须做成断言：下面每一条**都已经写在 `AGENTS.md` 里**，却都曾被违反过，
 * 而且违反时**没有任何东西会报错**——
 *   - 「每份文档要有『文档边界』行」是明文禁令 → `ISS-044` 发现 `docs/api.md`（当时刚被改过）
 *     与 `docs/requirement-raw.md` 都没有；
 *   - 「写源码路径前先确认它存在」同样是明文规则 → `ISS-047` 的嵌套 zustand 路径就是错的；
 *   - 「索引锚点可用」→ `ISS-038` 的 37 条索引链接**全部点不动**，而源码里看不出任何异常。
 * 共同点：**规则只靠人记，于是会在「顺手改一下」时被跳过**。本文件把它们变成一次红灯。
 */

const ROOT = resolve(import.meta.dirname, '..');

/**
 * 有意保留的「不存在的路径」——**只能出现在历史更正记录里**。
 *
 * 它们记录的是「曾经写错过什么」，删掉就丢掉了教训（`AGENTS.md` 明令已解决的条目不得删除）。
 * 每个条目都必须写明为什么留；**已存在的路径不得留在白名单里**（另有一条断言强制）。
 */
const ALLOWED_ABSENT: Record<string, string> = {
  'desktop/db/seed.ts': 'ISS-032 更正表里的「改前」写法（缺 `src/`）；同一行的右列即正确路径',
  'shared/i18n/dispatch.ts': 'ISS-032 的记录：该文件「从未存在」，文案实际内联在 `renderer/src/pages/`'
};

/** 需要遵守「文档边界」行的全部文档：根目录与 `docs/` 下的 Markdown。 */
function markdownFiles(): string[] {
  return [
    ...readdirSync(ROOT).filter((name) => name.endsWith('.md')),
    ...readdirSync(join(ROOT, 'docs'))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join('docs', name))
  ].sort();
}

function read(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

/** 去掉围栏代码块：块内的示例不该被当成真实声明或真实路径。 */
function stripFences(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

const files = markdownFiles();

describe('文档 · 结构不变量', () => {
  it('每份文档都声明了「文档边界」（AGENTS.md 的明文禁令）', () => {
    // 护栏自检：清单为空说明目录结构变了，那时本断言会「全过」—— 那比漏报更糟
    expect(files.length).toBeGreaterThan(10);
    const missing = files.filter((file) => !read(file).includes('文档边界'));
    expect(missing).toEqual([]);
  });

  it('文档里提到的**完全限定**源码路径都真实存在', () => {
    // 只查「以顶层目录名开头 + 带扩展名」的路径。
    // 为什么不查裸文件名（`seed.ts` / `theme.css`）：它们在上下文里指向已确立的全路径，
    // 要求逐个存在会产生上百个误报 —— **满屏误报的护栏等于没有护栏**（D-39 的同一教训）。
    const pattern = /`((?:shared|desktop|renderer|docs|tests)\/[A-Za-z0-9_./@-]+\.(?:ts|tsx|css|sql|json|md|cjs|html))`/g;
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of stripFences(read(file)).matchAll(pattern)) {
        const path = match[1] ?? '';
        if (!existsSync(join(ROOT, path)) && !(path in ALLOWED_ABSENT)) {
          offenders.push(`${file}: ${path}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('白名单里的路径一旦真的出现，就必须从白名单移走（否则它会掩盖新问题）', () => {
    for (const path of Object.keys(ALLOWED_ABSENT)) {
      expect(existsSync(join(ROOT, path)), `${path} 已存在，请从 ALLOWED_ABSENT 删除`).toBe(false);
    }
  });

  it('`docs/issues.md` 的索引、锚点与明细一一对应（ISS-038 的回归护栏）', () => {
    const text = read('docs/issues.md');
    const anchors = new Set([...text.matchAll(/<a id="(iss\d+)"/g)].map((m) => m[1] ?? ''));
    const refs = new Set([...text.matchAll(/\(#(iss\d+)\)/g)].map((m) => m[1] ?? ''));
    const details = new Set([...text.matchAll(/^####\s+ISS-(\d+)/gm)].map((m) => `iss${m[1]}`));

    expect(anchors.size, '一条明细都没有，说明正则或文件结构变了').toBeGreaterThan(10);
    expect([...refs].filter((ref) => !anchors.has(ref)), '索引指向了不存在的锚点').toEqual([]);
    expect([...anchors].filter((anchor) => !refs.has(anchor)), '有锚点但索引没链它').toEqual([]);
    expect([...anchors].filter((anchor) => !details.has(anchor)), '有锚点但没有对应明细').toEqual([]);
    expect([...details].filter((detail) => !anchors.has(detail)), '有明细但没有锚点').toEqual([]);
  });

  it('「文档事实单一来源」的指派表仍包含关键事实（SSOT 不能被悄悄删空）', () => {
    // D-34 的载体就是 `docs/api.md` §0 那张表；它一旦被删或改小，其余文档就只能靠自觉
    const text = read('docs/api.md');
    expect(text).toContain('文档事实单一来源');
    for (const fact of ['错误码目录', '数据表 DDL', '问题 / 风险 / 待决', '设计决策编号']) {
      expect(text, `§0 指派表缺少「${fact}」这一行`).toContain(fact);
    }
  });

  it('`docs/issues.md` 的三处计数互相对齐（§0 分布 · 索引表 · 明细段）', () => {
    /*
     * 起因（ISS-057）：§0 写着「共 53 条」，严重度分布却是 5+32+15=52 —— 少 1，而没人发现。
     * 同族问题还有 ISS-033（主修正未传播）与 ISS-045（导航项数写成 6）：**数字靠手抄**。
     * 本文件同时维护三处数字（§0 的严重度分布、§0 的状态分布、每条的索引行），
     * 因此这里把「三处必须一致」变成一次红灯。
     *
     * 为什么在这条与 ISS-057 的「遗留」里才补：先修数据、再上护栏 —— 顺序反了会得到
     * 一条长期发红的用例，而长期红的护栏会被当成噪音跳过（D-39 的教训）。
     */
    const text = read('docs/issues.md');

    // 1) 明细段：每条 ISS 的严重度与状态
    const blocks = text.split(/^####\s+ISS-(\d+)/m).slice(1);
    const detail = new Map<string, { severity: string; status: string }>();
    for (let index = 0; index < blocks.length; index += 2) {
      const id = blocks[index] ?? '';
      const body = blocks[index + 1] ?? '';
      const severity = /\|\s*严重度\s*\|\s*`([^`]+)`/.exec(body)?.[1];
      const status = /\|\s*状态\s*\|\s*`([^`]+)`/.exec(body)?.[1];
      expect(severity, `ISS-${id} 缺少严重度`).toBeDefined();
      expect(status, `ISS-${id} 缺少状态`).toBeDefined();
      detail.set(id.padStart(3, '0'), { severity: severity!.trim(), status: status!.split('（')[0]!.trim() });
    }
    // 护栏自检：明细段解析不出东西时，下面每条断言都会「全过」
    expect(detail.size, '没解析到任何 ISS 明细，正则或文件结构变了').toBeGreaterThan(10);

    const tally = (pick: (value: { severity: string; status: string }) => string) => {
      const counts = new Map<string, number>();
      for (const value of detail.values()) {
        const key = pick(value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    };
    const bySeverity = tally((value) => value.severity);
    const byStatus = tally((value) => value.status);

    // 2) §0 的分布表：形如 `| \`P1\` | 5 | ...`
    const section0 = text.slice(text.indexOf('## 0. 总览'), text.indexOf('### 0.1'));
    const declaredSeverity = new Map<string, number>();
    const declaredStatus = new Map<string, number>();
    for (const line of section0.split('\n')) {
      const cells = line.split('|').map((cell) => cell.trim());
      if (cells.length < 4) {
        continue;
      }
      const label = /^`([^`]+)`$/.exec(cells[1] ?? '')?.[1];
      const count = Number(cells[2]);
      if (!label || !Number.isInteger(count)) {
        continue;
      }
      (label.startsWith('P') ? declaredSeverity : declaredStatus).set(label, count);
    }
    expect([...declaredSeverity.keys()].length, '§0 没解析到严重度分布表').toBeGreaterThan(0);

    const total = /当前共\s*\*\*(\d+)\*\*\s*条/.exec(section0)?.[1];
    expect(Number(total), '§0 的总条数与明细段条数不一致').toBe(detail.size);
    expect(Object.fromEntries(declaredSeverity), '§0 的严重度分布与明细段不一致').toEqual(
      Object.fromEntries(bySeverity)
    );
    expect(Object.fromEntries(declaredStatus), '§0 的状态分布与明细段不一致').toEqual(Object.fromEntries(byStatus));
    // 两个维度的合计都必须等于总数 —— ISS-057 的直接护栏
    expect([...bySeverity.values()].reduce((a, b) => a + b, 0)).toBe(detail.size);
    expect([...byStatus.values()].reduce((a, b) => a + b, 0)).toBe(detail.size);

    // 3) 索引表：条数、编号、严重度、状态都要与明细段逐行对上
    const indexRows = [...text.matchAll(/^\|\s*\[`ISS-(\d+)`\]\(#iss\d+\)\s*\|\s*`([^`]+)`\s*\|[^|]*\|\s*([^|]*)\|\s*`([^`]+)`\s*\|/gm)];
    expect(indexRows.length, '索引表条数与明细段不一致').toBe(detail.size);
    // 编号统一补齐到三位再比：索引表写的是 `ISS-054`，明细段反查用的键是补零后的 `054`
    expect(new Set(indexRows.map((row) => (row[1] ?? '').padStart(3, '0')))).toEqual(new Set(detail.keys()));
    for (const row of indexRows) {
      const id = (row[1] ?? '').padStart(3, '0');
      const entry = detail.get(id);
      expect(entry, `索引表里的 ISS-${row[1]} 没有对应明细`).toBeDefined();
      expect(row[2], `ISS-${row[1]} 的严重度：索引表与明细段不一致`).toBe(entry!.severity);
      expect((row[4] ?? '').split('（')[0]!.trim(), `ISS-${row[1]} 的状态：索引表与明细段不一致`).toBe(entry!.status);
    }
  });

  it('已实现的每个 IPC 路由都能在 `docs/api.md` 里查到（**单向**断言，不求反向）', () => {
    /*
     * 为什么只做单向（代码 → 文档）：
     * `docs/api.md` §3 列的是**完整契约**，包含大量尚未实现的规划接口（M3-M10）。
     * 若反过来要求「文档里每个路径都必须已实现」，会得到几十条误报 ——
     * 而满屏误报的护栏等于没有护栏（D-39 的教训，`ISS-044` 的同类推论）。
     *
     * 这个方向则永远为真且必须为真：代码里能调到的路径，文档里必须能查到。
     * 它拦的是一个真实会发生的疏忽 —— 加接口时只写代码不写契约（`ISS-002` 就是
     * 「`API.ROUTE_NOT_FOUND` 已实现但未登记」）。
     */
    const apiSource = read('desktop/src/ipc/api.ts');
    // 字符集必须含 `:`（路径参数）—— 少了它，`/api/sites/:id` 这类新路径**匹配不上**，
    // 于是断言「零条未登记」全过。这不是假设：加写接口时就真的这么漏了一轮，
    // 是本文件下面那条元护栏的对偶情形（那条只保证「字面量都在 path: 里」，
    // 保不了「path: 都被正则扫到」）。
    const routePattern = /path:\s*'(\/api\/[A-Za-z0-9_/{}:-]+)'/g;
    const paths = [...apiSource.matchAll(routePattern)].map((match) => match[1] ?? '');
    // 契约文档里写作 `/api/sites/{id}`，代码里写作 `/api/sites/:id` —— 比对前统一成前者
    const asDocPath = (path: string) => path.replace(/:(\w+)/g, '{$1}');
    // 护栏自检：路由改成正则扫不到的写法时，这里会「零条全过」—— 比漏报更糟
    expect(paths.length, '没扫到任何路由，正则或文件结构变了').toBeGreaterThanOrEqual(24);

    const apiDoc = read('docs/api.md');
    const undocumented = paths.filter((path) => !apiDoc.includes(asDocPath(path)));
    expect(undocumented).toEqual([]);
  });

  it('每个已实现的接口路径都以 `path:` 常量出现，而不是散在字符串里（保证上一条能扫到）', () => {
    // 这条是上一条的**元护栏**：若有人写成 `route('get' + '/api/x')` 之类，
    // 上一条会静默漏掉它。这里只要求「api.ts 里出现的 /api/ 字面量都在 path: 里」。
    const apiSource = read('desktop/src/ipc/api.ts');
    const literalPattern = /'(\/api\/[A-Za-z0-9_/{}:-]+)'/g;
    const literals = new Set([...apiSource.matchAll(literalPattern)].map((match) => match[1] ?? ''));
    const registered = new Set(
      [...apiSource.matchAll(/path:\s*'(\/api\/[A-Za-z0-9_/{}:-]+)'/g)].map((match) => match[1] ?? '')
    );
    expect([...literals].filter((path) => !registered.has(path))).toEqual([]);
  });
});
