import { describe, expect, it, vi, afterEach } from 'vitest';

/**
 * 适配器默认选择。
 *
 * 针对一个真实陷阱：打包后的 Electron 用 `loadFile` 加载渲染层产物，构建时通常不带
 * `.env`，于是 `VITE_API_ADAPTER` 为 undefined。若默认落到 `mock`，
 * 桌面端会**静默显示假数据**（不读 SQLite、不报错），属于最难排查的一类问题。
 * 因此默认值必须按「有没有 preload 桥」判定。这里锁死该行为。
 */
async function loadAdapterKind(withBridge: boolean): Promise<string> {
  vi.resetModules();
  if (withBridge) {
    (globalThis as { window?: unknown }).window = { dispatchApi: { invoke: () => {}, on: () => () => {} } };
  } else {
    (globalThis as { window?: unknown }).window = {};
  }
  const mod = await import('./index');
  return mod.adapterKind;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('apiClient · 适配器默认选择', () => {
  it('浏览器（无 preload 桥）默认 mock', async () => {
    expect(await loadAdapterKind(false)).toBe('mock');
  });

  it('Electron（有 preload 桥）默认 ipc，绝不静默用 mock', async () => {
    expect(await loadAdapterKind(true)).toBe('ipc');
  });
});
