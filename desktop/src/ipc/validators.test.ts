import { DomainError } from '@udm/shared';
import { describe, expect, it } from 'vitest';
import { VEHICLE_STATUSES } from '@udm/shared';
import { optionalEnumFilter, optionalString, requireString } from './validators.js';

/**
 * 传输层校验的测试。
 *
 * 断言两件事：**返回值直接用**（不去空白，保持调用方拿到的就是提交内容）、
 * 以及**失败时错误里带得出是哪个字段**——后者是给人看的：登录失败时
 * 前端要把错误挂到具体输入框上，只说「校验失败」等于没说。
 */
describe('requireString', () => {
  it('返回原值（不去空白），空判定只用于校验', () => {
    expect(requireString({ username: ' admin ' }, 'username')).toBe(' admin ');
  });

  it('缺失 / 空串 / 纯空白 / 非字符串都抛 VALIDATION.FAILED', () => {
    for (const bad of [undefined, '', '   ', 42, null, {}, []]) {
      expect(() => requireString({ field: bad }, 'field'), JSON.stringify(bad)).toThrow(DomainError);
    }
  });

  it('错误里带出具体字段名与原因（供前端定位到输入框）', () => {
    try {
      requireString({}, 'password');
      expect.unreachable('应当抛出');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      const domainError = error as DomainError;
      expect(domainError.code).toBe('VALIDATION.FAILED');
      expect(domainError.detail?.fields).toEqual({ password: '必填且需为非空字符串' });
    }
  });

  it('多个字段各自独立判定（一个字段合法不影响另一个字段报错）', () => {
    const payload = { username: 'admin', password: '' };
    expect(requireString(payload, 'username')).toBe('admin');
    expect(() => requireString(payload, 'password')).toThrow(DomainError);
  });
});

/**
 * 列表接口的**筛选**参数。
 *
 * 与分页参数（`paging.test.ts`）的口径**故意相反**：那边是宽进，这边是严出。
 * 判据是「参数错了以后，使用者看到的还是不是他以为的那份数据」（见函数注释）。
 * 这一组用例就是把这个判据钉住 —— 它很容易在「顺手改成容错」时被破坏。
 */
describe('optionalEnumFilter', () => {
  it('缺席 / 空串 / null 都视为未给筛选', () => {
    expect(optionalEnumFilter({}, 'status', VEHICLE_STATUSES)).toBeUndefined();
    expect(optionalEnumFilter({ status: '' }, 'status', VEHICLE_STATUSES)).toBeUndefined();
    expect(optionalEnumFilter({ status: null }, 'status', VEHICLE_STATUSES)).toBeUndefined();
  });

  it('合法取值原样返回', () => {
    expect(optionalEnumFilter({ status: 'busy' }, 'status', VEHICLE_STATUSES)).toBe('busy');
  });

  it('非法取值抛 VALIDATION.FAILED，并在错误里列出全部合法取值', () => {
    try {
      optionalEnumFilter({ status: 'enabled' }, 'status', VEHICLE_STATUSES);
      expect.unreachable('应当抛出');
    } catch (error) {
      const domainError = error as DomainError;
      expect(domainError.code).toBe('VALIDATION.FAILED');
      // 车辆域没有 `enabled`（ISS-036 踩过的坑）：错误信息必须直接告诉调用方可选值
      expect(String(domainError.detail?.fields && (domainError.detail.fields as Record<string, string>).status)).toContain(
        'idle'
      );
    }
  });

  it('非字符串（数字 / 布尔）同样按非法处理，不静默转型', () => {
    for (const bad of [1, true, {}]) {
      expect(() => optionalEnumFilter({ status: bad }, 'status', VEHICLE_STATUSES)).toThrow(DomainError);
    }
  });
});

describe('optionalString', () => {
  it('去空白；空白串视为未给筛选', () => {
    expect(optionalString({ code: '  E_n01_n02  ' }, 'code')).toBe('E_n01_n02');
    expect(optionalString({ code: '   ' }, 'code')).toBeUndefined();
    expect(optionalString({}, 'code')).toBeUndefined();
  });

  it('非字符串返回 undefined 而不是抛错：它没有「合法取值集」可校验', () => {
    // 与 optionalEnumFilter 的差别在此：查不到就是查不到，`?code=E_n99_n98` 返回空列表是正确答案
    expect(optionalString({ code: 42 }, 'code')).toBeUndefined();
  });
});
