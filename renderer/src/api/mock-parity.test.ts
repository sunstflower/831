import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ROLE_PERMISSIONS } from '@udm/shared';
import { createMockAdapter } from './mock';

/**
 * Mock 适配器与真实主进程的**错误码一致性**。
 *
 * 起因（ISS-001 附带发现）：mock 曾返回自造的 `AUTH.INVALID_CREDENTIALS`，
 * 而主进程返回 `AUTH.LOGIN_FAILED`。浏览器里看不出问题（页面只读 `message`），
 * 一旦切到 Electron，前端按 `code` 做的文案映射就静默失配。
 *
 * 契约（`docs/api.md` §1.1）：三层适配器行为必须一致，
 * **任何适配器都不得产生 `ERROR_CODES` 之外的 code**。
 */
const declared = new Set(Object.keys(ERROR_CODES));

describe('mock 适配器 · 错误码与目录一致', () => {
  it('未实现的路由返回已登记的 API.ROUTE_NOT_FOUND', async () => {
    const client = createMockAdapter();
    const result = await client.invoke('/api/not-implemented');
    expect(result.code).toBe('API.ROUTE_NOT_FOUND');
    expect(declared.has(result.code as string)).toBe(true);
  });

  it('登录失败返回主进程同款 AUTH.LOGIN_FAILED，而不是自造 code', async () => {
    const client = createMockAdapter();
    const result = await client.invoke('/api/auth/login', { username: 'admin', password: 'wrong' });
    expect(result.code).toBe('AUTH.LOGIN_FAILED');
    if (result.code !== 0) {
      // source 与兜底文案也必须来自目录，避免两处维护两份文案
      expect(result.source).toBe(ERROR_CODES['AUTH.LOGIN_FAILED'].source);
      expect(result.message).toBe(ERROR_CODES['AUTH.LOGIN_FAILED'].message);
    }
  });

  it('登录成功返回统一信封', async () => {
    const client = createMockAdapter();
    const result = await client.invoke('/api/auth/login', { username: 'admin', password: 'admin123' });
    expect(result.code).toBe(0);
  });

  it('登录返回的 permissions 与主进程口径一致（按角色派生，不是空数组）', async () => {
    // 起因（2026-09-25 实测）：mock 曾把三个账号的 permissions 一律写成 []，
    // 而主进程 `services/auth.ts` 用 `permissionsOf(row.role)`。
    // 界面若信任 `user.permissions`，两种形态会显示不同的权限数，且都不报错。
    const client = createMockAdapter();
    for (const [username, password, role] of [
      ['admin', 'admin123', 'admin'],
      ['dispatcher', 'dispatcher123', 'dispatcher'],
      ['monitor', 'monitor123', 'monitor']
    ] as const) {
      const result = await client.invoke('/api/auth/login', { username, password });
      expect(result.code).toBe(0);
      if (result.code === 0) {
        const user = (result.data as { user: { permissions: string[]; role: string } }).user;
        expect(user.role).toBe(role);
        expect(user.permissions.slice().sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
        expect(user.permissions.length).toBeGreaterThan(0);
      }
    }
  });
});
