import { describe, expect, it } from 'vitest';
import { PERMISSIONS, hasPermission, permissionsOf, ROLE_PERMISSIONS } from './enums.js';

describe('role permissions', () => {
  it('admin owns every permission', () => {
    expect(ROLE_PERMISSIONS.admin).toHaveLength(PERMISSIONS.length);
    for (const permission of PERMISSIONS) {
      expect(hasPermission('admin', permission)).toBe(true);
    }
  });

  it('dispatcher cannot manage users or write settings', () => {
    expect(hasPermission('dispatcher', 'user:manage')).toBe(false);
    expect(hasPermission('dispatcher', 'settings:write')).toBe(false);
    expect(hasPermission('dispatcher', 'dispatch:apply')).toBe(true);
  });

  it('monitor is read-only plus alert acknowledgement', () => {
    expect(hasPermission('monitor', 'alert:ack')).toBe(true);
    expect(hasPermission('monitor', 'task:write')).toBe(false);
    expect(hasPermission('monitor', 'dispatch:preview')).toBe(false);
  });

  it('permissionsOf returns a copy', () => {
    const copy = permissionsOf('monitor');
    copy.push('user:manage');
    expect(hasPermission('monitor', 'user:manage')).toBe(false);
  });
});
