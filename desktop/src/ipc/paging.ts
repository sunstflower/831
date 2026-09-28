import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@udm/shared';

/** 分页查询参数：`keyword` 仅在请求里给了非空字符串时出现。 */
export interface PageQuery {
  page: number;
  pageSize: number;
  keyword?: string;
}

/**
 * 从请求载荷里解析分页参数。
 *
 * **为什么单独一份**（`docs/issues.md` ISS-015）：这段逻辑原先内联在 `ipc/api.ts` 里，
 * 随接口数量增长会被复制到每个列表接口，而「非法值怎么办」的口径一旦分叉
 * （有的接口夹取、有的接口报错），前端就得为每个列表写不同的兜底。
 * 抽出来还有第二个好处：它是**纯函数**，可以脱离 Router 与数据库直接测。
 *
 * 容错口径（**宽进**，不报错）：分页参数是「展示偏好」而不是业务数据，
 * 为 `?page=abc` 返回 400 会让使用者看到一个与其操作意图无关的错误页。
 * 因此一律**回落到合法默认值**，而不是抛错：
 *   - 非数字 / `NaN` / 负数 / 0 → 用默认值；
 *   - 小数 → 向下取整（`2.7` 表示第 2 页）；
 *   - 超过 `MAX_PAGE_SIZE` → 夹取到上限（防止一次拉全表）。
 *
 * 注意 `keyword` 的**空串当没给**：搜索框清空后前端通常会提交 `keyword: ''`，
 * 若把空串透传到 SQL 的 `LIKE '%%'` 会退化成全表扫描，语义上也等于「无筛选」。
 */
export function parsePagination(payload: Record<string, unknown>): PageQuery {
  const rawPage = Number(payload.page ?? 1);
  const rawSize = Number(payload.pageSize ?? DEFAULT_PAGE_SIZE);

  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const keyword =
    typeof payload.keyword === 'string' && payload.keyword.trim() ? payload.keyword.trim() : undefined;

  return { page, pageSize, keyword };
}
