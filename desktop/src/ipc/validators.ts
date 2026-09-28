import { DomainError } from '@udm/shared';

/**
 * 请求载荷的**传输层**校验。
 *
 * 与领域层校验的分工（`docs/module-M2-base-data.md` §4）：
 *   - 本文件只判断「这个字段在请求里是否成形」（类型对不对、是不是空串），
 *     失败即 `VALIDATION.FAILED`，**不判断业务合法性**（编码是否重复、引用是否存在）；
 *   - 业务合法性属于领域服务（未来的 `desktop/src/domain/base/validate.ts`），
 *     那里才会返回 `SITE.CODE_DUPLICATE` 这类具体错误码。
 *
 * 这样分的理由：前者是**每个接口都一样**的样板，后者**逐字段各不相同**。
 * 混在一起会让「改一个字段的校验」必须读懂整个接口。
 *
 * 目前只抽了 `requireString`（现有接口实际用到的唯一一个）。
 * 其余原语（枚举、数值、布尔、坐标）**等 M2 的接口落地时再补** —— 先写没有调用点的校验函数，
 * 只会得到一批没人用过、也没被真实场景检验过的代码。
 */

/** 必填的非空字符串。`trim()` 后为空视为未提供（`'   '` 不是有效输入）。 */
export function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('VALIDATION.FAILED', undefined, {
      fields: { [field]: '必填且需为非空字符串' }
    });
  }
  return value;
}

/**
 * 可选的**枚举筛选**参数（列表接口的 `?status=` / `?type=` 一类）。
 *
 * 与分页参数的容错口径**故意相反**（`./paging.ts` 是宽进，这里是严出），判据是
 * 「参数错了以后，使用者看到的还是不是他以为的那份数据」：
 *
 *   - 分页参数（`page` / `pageSize`）只决定**看第几页**，值非法时回落默认，
 *     使用者看到的仍是同一份数据的前几页 —— 为一个 `?page=abc` 弹错误页没有意义；
 *   - 筛选参数决定**看到的是哪些数据**。若把 `?status=foo` 静默忽略，页面会显示**全量**结果，
 *     而使用者以为自己在看「已停用的车」—— 他会据此下结论（「没有停用车辆」），
 *     这属于本项目反复踩到的「不报错但是错的」。因此这里宁可报错。
 *
 * 缺席 / 空串一律视为「未给筛选」（与 `parsePagination` 对 `keyword` 的处理一致：
 * 前端清空下拉框时通常会提交 `status: ''`）。
 */
export function optionalEnumFilter<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T | undefined {
  const value = payload[field];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new DomainError('VALIDATION.FAILED', undefined, {
      fields: { [field]: `取值必须是 ${allowed.join(' / ')} 之一` }
    });
  }
  return value as T;
}

/**
 * 可选的**自由文本筛选**参数（`?code=` / `?fromNodeId=` 一类）。
 *
 * 与 `optionalEnumFilter` 的口径一致（缺席 / 空串 = 未给筛选），但不校验取值集合 ——
 * 它没有「合法取值集」可校验，而且**查不到就是查不到**：`?code=E_n99_n98` 返回空列表是
 * 正确答案，不是错误（与 `?status=foo` 不同，后者会让使用者误以为自己在按状态筛选）。
 */
export function optionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * **必填枚举**：值必须在集合内，否则 `VALIDATION.FAILED`。
 *
 * 与 `optionalEnumFilter` 的区别就是「缺席是否合法」：
 * 启停接口的 `status` 是**请求的实质**（没有它这个请求没有意义），
 * 而筛选参数缺席表示「不筛」。口径的分界仍是 D-40 的那条判据 ——
 * 参数错了以后，使用者看到的是不是他以为的那份结果。
 */
export function requireEnum<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T {
  const value = optionalEnumFilter(payload, field, allowed);
  if (value === undefined) {
    throw new DomainError('VALIDATION.FAILED', undefined, { fields: { [field]: '必填' } });
  }
  return value;
}
