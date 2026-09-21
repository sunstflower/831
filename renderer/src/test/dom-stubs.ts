/**
 * React Flow 在 jsdom 下所需的 DOM stub。
 *
 * jsdom 未实现 `ResizeObserver`，而 React Flow 依赖它测量节点尺寸；
 * 缺失时会直接抛 `ReferenceError: ResizeObserver is not defined`（实测）。
 *
 * 用法：在渲染层测试文件的**顶部**（早于 `@xyflow/react` 的导入）引入本模块：
 * ```ts
 * import '../test/dom-stubs';
 * ```
 * 这样 `npm test`（node 环境）不会被无谓地注入浏览器 API。
 */

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const globalRef = globalThis as unknown as Record<string, unknown>;

if (typeof globalRef.ResizeObserver === 'undefined') {
  globalRef.ResizeObserver = ResizeObserverStub;
}

if (typeof globalRef.matchMedia === 'undefined') {
  globalRef.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  });
}

export {};
