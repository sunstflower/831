/**
 * 系统设置写（M10，`docs/api.md` §3.10）。
 *
 * ## 校验为什么按 schema 走、而不是逐键写 if
 *
 * `SETTINGS_SCHEMA`（`shared/src/constants.ts`）是键目录的**唯一作者**，
 * 它同时被三处消费：主进程校验、渲染层渲染表单、Mock 适配器。
 * 在这里逐键写 `if (key === 'task.timeoutToleranceS')`，就等于给同一份知识
 * 开第二个作者 —— 新增一个设置项时，前端会出现输入框而主进程把它当未知键拒绝（或反之）。
 *
 * ## 为什么用 `PATCH` + `updates` 而不是整体覆盖
 *
 * 整体覆盖会让「两个页面各改一个键」变成后提交者覆盖前者，而 PATCH 的语义
 * 是「只改我提到的这些键」，这是设置页最自然的形态。
 *
 * ## 部分失败怎么办
 *
 * **全部校验通过才写**：一批里有一个键非法，整批拒绝并逐字段报错。
 * 半批生效会让使用者看到「有的改了有的没改」，而界面无从知道哪一半生效了。
 */
import {
  DomainError,
  SETTINGS_SCHEMA,
  validateSettingValue,
  type SettingSchemaItem,
  type SettingsUpdateResult
} from '@udm/shared';
import { tx, type Db } from '../../db/index.js';
import { getSettings, parseSettingsValues, upsertSetting } from '../../db/repositories/settings.repo.js';
import { writeAudit } from '../../services/audit.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { invalid } from '../base/validate.js';

/**
 * 单键校验的**实现只有一份**，在 `@udm/shared` 的 `settings-rules.ts`。
 *
 * 这里再导出一次是为了让调用点（以及单测）能从本模块拿到它，
 * 而**不是**在这里维护第二份判据 —— Mock 适配器读的是同一份。
 */
export { validateSettingValue };

export function updateSettings(ctx: CrudContext, updates: Record<string, unknown>): SettingsUpdateResult {
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw invalid({ updates: '至少要给出一个设置项' });
  }
  const fields: Record<string, string> = {};
  const resolved = new Map<string, SettingSchemaItem>();
  for (const key of keys) {
    const item = SETTINGS_SCHEMA.find((candidate) => candidate.key === key);
    if (!item) {
      // 未知键单独给一个错误码：它和「值非法」是两类问题，
      // 前者多半是拼错了键名（前端 bug 或手写请求）
      throw new DomainError('SETTINGS.KEY_NOT_FOUND', undefined, { key, known: SETTINGS_SCHEMA.map((entry) => entry.key) });
    }
    const reason = validateSettingValue(item, updates[key]);
    if (reason) {
      fields[key] = reason;
      continue;
    }
    resolved.set(key, item);
  }
  if (Object.keys(fields).length > 0) {
    throw invalid(fields);
  }

  return tx(ctx.db, () => {
    const before = parseSettingsValues(getSettings(ctx.db));
    const updatedKeys: string[] = [];
    for (const [key, item] of resolved) {
      const value = updates[key];
      // 「写回默认值」也只是一次普通写入，不做等同性短路：
      // 短路会让 updatedKeys 缺少这一项，而使用者操作的正是它
      upsertSetting(ctx.db, key, value, ctx.actor?.actorId ?? 'system');
      updatedKeys.push(key);
      void item;
    }
    const values = parseSettingsValues(getSettings(ctx.db));
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'settings',
      action: 'update',
      objectType: 'settings',
      objectId: updatedKeys.join(','),
      before: Object.fromEntries(updatedKeys.map((key) => [key, before[key]])),
      after: Object.fromEntries(updatedKeys.map((key) => [key, values[key]]))
    });
    return { values, updatedKeys };
  });
}
