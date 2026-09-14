import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES, fail, fromError, isFailure, ok } from './errors.js';

describe('api envelope helpers', () => {
  it('ok wraps data with code 0', () => {
    expect(ok({ a: 1 })).toEqual({ code: 0, message: 'success', data: { a: 1 } });
  });

  it('fail carries code/source/message from catalog', () => {
    const result = fail('TASK.STATE_CONFLICT', { currentStatus: 'finished' });
    expect(result.code).toBe('TASK.STATE_CONFLICT');
    expect(result.source).toBe('business');
    expect(result.detail).toEqual({ currentStatus: 'finished' });
    expect(isFailure(result)).toBe(true);
  });

  it('fromError maps DomainError and unknown errors', () => {
    expect(fromError(new DomainError('ALERT.NOT_FOUND', undefined, { alertId: 'x' }))).toMatchObject({
      code: 'ALERT.NOT_FOUND',
      source: 'business',
      detail: { alertId: 'x' }
    });
    expect(fromError(new Error('boom')).code).toBe('SYS.INTERNAL');
  });

  it('every catalog entry has source and httpStatus', () => {
    for (const [code, definition] of Object.entries(ERROR_CODES)) {
      expect(code).toMatch(/^[A-Z]+(\.[A-Z_]+)?$/);
      expect(definition.httpStatus).toBeGreaterThanOrEqual(200);
    }
  });
});
