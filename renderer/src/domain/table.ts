/**
 * 列表页**表格模型**的公共类型与列工厂（M2 与 M3 共用）。
 *
 * 为什么抽出来：两个列表页的列定义逐字同构 ——「某列绑哪个字段、数字右对齐、
 * `null` 显示成什么」。抄一份的后果不是样式不一致，而是**口径不一致**：
 * 一处的空值显示 `—`、另一处显示空白，看起来就像后者的数据坏了。
 *
 * 列工厂的 `key: keyof T & string` 是**编译期检查**：字段改名时列定义会跟着报错，
 * 不会出现「表格引用了不存在的字段 → 每行都显示 `—`」这种静默错误。
 * 复合列（如「起点 → 终点」「x, y」）请挑一个真实字段作 key，把渲染写在 `cell` 里 ——
 * key 只用于 React 的列表 key 与调试，不参与取值。
 */
import type { ReactNode } from 'react';

export interface Column<T = unknown> {
  key: string;
  label: string;
  /** 数字列右对齐：位数不同时不右对齐就没法竖着比大小。 */
  align?: 'right';
  /**
   * 取值函数。
   *
   * 刻意写成**方法语法**（`cell(row: T)`）而不是属性语法（`cell: (row: T) => …`）：
   * 方法参数按双变（bivariant）检查，于是「按具体行类型定义的列」
   * （如 `Column<SiteListItem>`）能直接放进「行类型是联合类型」的列表里
   * （如 `Column<BaseDataRow>[]`），不需要 `as` 断言把类型检查关掉。
   * 换成属性语法会立刻出现一批「参数类型不兼容」，而正确的修法不是加断言。
   */
  cell(row: T): ReactNode;
}

/** `null` / `undefined` / 空串显示成 `—`（空白在表里看起来像渲染坏了，`design.md` §7.2 第 6 条）。 */
export function text(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return String(value);
}

/** 列工厂，见文件头。 */
export function column<T>(
  key: keyof T & string,
  label: string,
  options: { align?: 'right'; cell?: (row: T) => ReactNode } = {}
): Column<T> {
  return {
    key,
    label,
    align: options.align,
    cell(row: T): ReactNode {
      return options.cell ? options.cell(row) : text(row[key] as string | number | null);
    }
  };
}
