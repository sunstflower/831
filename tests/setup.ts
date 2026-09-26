/**
 * Vitest 全局 setup。
 *
 * 分三部分：
 * 1. jest-dom 断言扩展（`ToBeInTheDocument` 等），所有环境可用；
 * 2. **仅 renderer 需要**的 DOM stub —— 见 `renderer/src/test/dom-stubs.ts`。
 *    放在那里（而非这里全局注入）是为了不给 node 环境的 desktop 测试引入多余的浏览器 API。
 * 3. 每个用例后卸载 React 树（见下）。
 */
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

/**
 * 卸载挂载过的 React 树。
 *
 * 为什么必须显式写：`@testing-library/react` 的**自动** cleanup 只在
 * `globals: true` 时通过全局 `afterEach` 注册；本项目 `vitest.config.ts` 未开启 globals，
 * 因此自动清理不会生效 —— 结果是同一个文件里后一个用例会**看到前一个用例留下的 DOM**，
 * 表现为「`getByText` 找到多个元素」这类与被测组件无关的失败。
 *
 * 用「有 document 才加载」的条件动态导入，避免给 node 环境的 desktop 测试
 * 平白加载 `@testing-library/react`（它依赖 DOM）。
 */
afterEach(async () => {
  if (typeof document !== 'undefined') {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
  }
});
