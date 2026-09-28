/**
 * 边的**业务编码**约定（`AGENTS.md` D-35 / `docs/data-interfaces.md` §4.3）。
 *
 * ## 为什么单独一个文件
 *
 * 同一条约定有**三个**使用方，而且分属三个进程/包：
 *   1. 主进程读取层（`desktop/src/db/repositories/graph.repo.ts`）要把 code 拼进查询结果；
 *   2. 浏览器 Mock（`renderer/src/api/mock-data.ts`）要在没有 SQLite 时给出同一个字符串；
 *   3. 将来迁移 `0002_data_import.sql` 的回填要按同一规则写入 `edges.code` 列。
 *
 * 如果各处自己拼字符串，Mock 与真实库会「形状相同、内容不同」——
 * 这正是本项目已经踩过一次的事故（D-27：`seed-n-N1` vs `seed-n01`，
 * 浏览器一切正常、切到 Electron 后选中态与事件匹配静默失效）。
 * 因此约定只在这里写一次，`graph.repo.ts` 的 SQL 也**不再自己拼**：
 * 它调用 `parseEdgeCode` 把「按 code 查」翻译成「两端节点 code 等于哪两个值」。
 *
 * ## 约定
 *
 * - 取两端节点 code 的**字典序**，小的一侧为「正向」：`E_<小>_<大>`；
 * - 反方向加后缀：`E_<小>_<大>_R`。
 *
 * 与真实样本一致（样本把 45 条无向通道写成 `E_N00_N10` + `E_N00_N10_R` 成对）。
 * **已知限制**：若某条边的正向在源文件里恰好是字典序较大的一侧，推导结果会与之相反。
 * 这不是靠猜能规避的 —— D-35 的 `edges.code` 列落地后 code 即权威值，本文件只留给
 * 「尚未落库的边」与 Mock 使用。
 */

/** 正向 code 前缀，也是「这看起来是不是一个边 code」的判据。 */
const PREFIX = 'E_';
/** 反向边后缀。 */
const REVERSE_SUFFIX = '_R';

/**
 * 由两端节点 code 推导边的 code。
 *
 * 传入顺序无关（内部会排序）：`deriveEdgeCode('N10','N00')` 与
 * `deriveEdgeCode('N00','N10')` 都得到 `E_N00_N10`。
 */
export function deriveEdgeCode(fromCode: string, toCode: string): string {
  const [small, large] = fromCode <= toCode ? [fromCode, toCode] : [toCode, fromCode];
  const base = `${PREFIX}${small}_${large}`;
  return fromCode === small ? base : `${base}${REVERSE_SUFFIX}`;
}

export interface ParsedEdgeCode {
  /** 正向那一侧的节点 code（字典序较小者）。 */
  smallCode: string;
  /** 反向那一侧的节点 code（字典序较大者）。 */
  largeCode: string;
  /** 该 code 是否表示「从小指向大」的反方向。 */
  reversed: boolean;
}

/**
 * 把边 code 解析回「两端节点 code + 方向」。
 *
 * 用途是让 SQL 不必复述命名规则：`graph.repo.ts` 拿到两端 code 后
 * 只需写成 `((f.code = ? AND t.code = ?) OR (f.code = ? AND t.code = ?))`。
 *
 * 无法解析时返回 `null`（**不抛错**）：调用方是「按 code 查询」，
 * 一个格式不对的 code 与一个查不到的 code 应当有相同的结果 —— 空列表。
 * 若在这里抛错，`GET /api/edges?code=瞎填的` 会返回 400 而不是空结果，
 * 而使用者只是想确认「库里有没有这条边」。
 */
export function parseEdgeCode(code: string): ParsedEdgeCode | null {
  if (!code.startsWith(PREFIX)) {
    return null;
  }
  const reversed = code.endsWith(REVERSE_SUFFIX);
  const body = reversed ? code.slice(PREFIX.length, -REVERSE_SUFFIX.length) : code.slice(PREFIX.length);
  const separator = body.indexOf('_');
  // 节点 code 本身可能含 `_`，因此以**第一个**下划线切分，而不是 split 后取两段
  if (separator <= 0 || separator === body.length - 1) {
    return null;
  }
  const smallCode = body.slice(0, separator);
  const largeCode = body.slice(separator + 1);
  // 反向边（含 `_R`）的 code 里，字典序较小者仍写在前 —— 与 deriveEdgeCode 对称。
  // 一段 `E_B_A_R`（B > A）不合法：那应当写成 `E_A_B_R`
  if (smallCode > largeCode) {
    return null;
  }
  return { smallCode, largeCode, reversed };
}
