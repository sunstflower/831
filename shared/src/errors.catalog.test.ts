import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors.js';

/**
 * 错误码目录的**结构不变量**。
 *
 * 起因（ISS-001）：项目曾同时存在两套错误码目录（`shared/src/errors.ts` 与
 * `docs/data-interfaces.md` §8），两处**零重叠**，同一概念两个名字
 * （`GRAPH.EMPTY` vs `MAP.EMPTY_GRAPH`）。前端按 code 做文案映射，两套 key
 * 会直接打挂本地化。D-33 因此规定「全项目唯一登记处」。
 *
 * 本文件把该规定变成可执行断言：只要有人再写一套命名，测试立刻失败。
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const DOCS = ['docs/api.md', 'docs/data-interfaces.md'];

/** 文档里出现的所有 `XXX.YYY` 形态 token。 */
function codesInDoc(relativePath: string): Set<string> {
  const text = readFileSync(resolve(ROOT, relativePath), 'utf8');
  // 代码块内的示例（如 mock 数据）也要算进来：它们同样会泄漏到前端。
  return new Set(text.match(/\b[A-Z][A-Z0-9]{1,15}\.[A-Z][A-Z0-9_]{1,40}\b/g) ?? []);
}

const declared = new Set(Object.keys(ERROR_CODES));

/**
 * 文档中允许出现、但**故意不是** code 的 token。
 *
 * 三条速记前缀：§8 的「分维度速查」用它们指代一组 code，正文已声明「不作为 code 使用」。
 * 两条废弃码：只能出现在「已废弃，不要使用」的说明里；本文件另有断言确保它们不会被登记。
 */
const DOC_ONLY_TOKENS = new Set([
  'IMPORT.ENCODING_',
  'IMPORT.SCHEMA_VERSION_',
  'IMPORT.MAPPING_',
  'ORDER.REGION_',
  'VEHICLE.HOME_NODE_NOT_FOUND',
  'VEHICLE.HOME_NODE_ISOLATED',
  'XXX.YYY'
]);

describe('错误码目录 · 结构不变量', () => {
  it('code 形如 `域.原因`，域与原因均 UPPER_SNAKE', () => {
    for (const code of declared) {
      expect(code, `${code} 不符合 域.原因 命名`).toMatch(/^[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*$/);
      // 原因段不得再分级（禁止 ORDER.TIMEWINDOW.INVALID 这类三段式）
      expect(code.split('.')).toHaveLength(2);
    }
  });

  it('每条都有 source 与 httpStatus，severity 仅在导入域出现', () => {
    for (const [code, definition] of Object.entries(ERROR_CODES)) {
      expect(definition.source, code).toMatch(/^(auth|validation|business|system)$/);
      expect(definition.httpStatus, code).toBeGreaterThanOrEqual(200);
      expect(definition.message.trim().length, code).toBeGreaterThan(0);
      const isImportDomain = /^(IMPORT|ORDER|MAP|VEHICLE|ALGO|SCENARIO|ROUTE|GRAPH)\./.test(code);
      if (!isImportDomain) {
        expect(definition.severity, `${code} 属运行时域，不应带 severity`).toBeUndefined();
      }
    }
  });

  it('同一个 code 不会既是 error 又是 warning（severity 是调用点属性，不是 code 身份）', () => {
    const seen = new Map<string, string>();
    for (const [code, definition] of Object.entries(ERROR_CODES)) {
      if (!definition.severity) continue;
      // 断言同一 code 在目录里只出现一次，且 severity 唯一
      expect(seen.has(code), `${code} 被登记了两次`).toBe(false);
      seen.set(code, definition.severity);
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  it('文档中出现的每个 code 都已登记（唯一登记处，D-33）', () => {
    for (const doc of DOCS) {
      const stray = [...codesInDoc(doc)].filter(
        (code) => !declared.has(code) && !DOC_ONLY_TOKENS.has(code)
      );
      expect(stray, `${doc} 中未登记的错误码`).toEqual([]);
    }
  });

  it('导入域的四类文件各有 code，且不含历史废弃码', () => {
    const importDomains = ['IMPORT', 'ORDER', 'MAP', 'VEHICLE', 'ALGO'];
    for (const domain of importDomains) {
      expect([...declared].some((code) => code.startsWith(`${domain}.`)), domain).toBe(true);
    }
    // 站点改为边绑定后，「起始节点」概念已由 sites.onEdgeCode + 泊位承担
    for (const retired of ['VEHICLE.HOME_NODE_NOT_FOUND', 'VEHICLE.HOME_NODE_ISOLATED']) {
      expect(declared.has(retired), `${retired} 应已废弃，不得重新登记`).toBe(false);
    }
  });
});
