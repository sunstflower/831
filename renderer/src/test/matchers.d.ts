/**
 * 让 TypeScript 认识 jest-dom 的断言扩展（`toBeInTheDocument` / `toHaveTextContent` 等）。
 *
 * 运行时由 `tests/setup.ts` 的 `import '@testing-library/jest-dom/vitest'` 引入；
 * 但**类型**不会自动跟着 setup 走 —— TypeScript 只认程序里出现过的模块声明。
 * 缺了它，`renderer` 的测试文件会报
 * `Property 'toBeInTheDocument' does not exist on type 'Assertion<HTMLElement>'`。
 *
 * 这里只做「把声明拉进类型程序」这一件事，不含任何运行时代码。
 */
import '@testing-library/jest-dom/vitest';
