/**
 * 系统设置的单键校验（M10）。
 *
 * ## 为什么在 `shared` 而不是主进程
 *
 * 判据有三个使用方：主进程的设置服务（`domain/settings/settings.service.ts`）、
 * 浏览器 Mock 适配器，以及将来可能的导入校验。若主进程写一份、Mock 再写一份，
 * 同一份 `SETTINGS_SCHEMA` 会被两套代码解释 —— 而「浏览器里能存 500ms、
 * Electron 里被拒」这种问题排查起来要横跨两个进程。
 *
 * 这与 `task-state.ts` / `alert-state.ts` 是同一条原则：**每个判据只有一个作者**（D-34）。
 *
 * ## 为什么按 `type` 分支而不是逐键写 if
 *
 * `SETTINGS_SCHEMA` 是键目录的唯一作者（`constants.ts`）；逐键写 if 等于给同一份知识
 * 开第二个作者，新增设置项时两边必然有一处漏改。
 */
import type { SettingSchemaItem } from './types.js';

/** 单键校验：返回原因（`null` = 合法）。 */
export function validateSettingValue(item: SettingSchemaItem, value: unknown): string | null {
  switch (item.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '必须是有限数字';
      }
      if (item.min !== undefined && value < item.min) {
        return `不能小于 ${item.min}`;
      }
      if (item.max !== undefined && value > item.max) {
        return `不能大于 ${item.max}`;
      }
      return null;
    }
    case 'select': {
      if (typeof value !== 'string') {
        return '必须是字符串';
      }
      if (item.options && !item.options.includes(value)) {
        return `取值必须是 ${item.options.join(' / ')} 之一`;
      }
      return null;
    }
    case 'boolean': {
      return typeof value === 'boolean' ? null : '必须是布尔值';
    }
    default: {
      // `text` 没有天然上界，这里给一个防手滑的长度上限（超长值通常是粘贴事故）
      if (typeof value !== 'string') {
        return '必须是字符串';
      }
      return value.length > 1000 ? '长度不能超过 1000' : null;
    }
  }
}
