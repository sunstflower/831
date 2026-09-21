/**
 * Vitest 全局 setup。
 *
 * 分两部分：
 * 1. jest-dom 断言扩展（`ToBeInTheDocument` 等），所有环境可用；
 * 2. **仅 renderer 需要**的 DOM stub —— 见 `renderer/src/test/dom-stubs.ts`。
 *    放在这里（而非全局注入）是为了不给 node 环境的 desktop 测试引入多余的浏览器 API。
 */
import '@testing-library/jest-dom/vitest';
