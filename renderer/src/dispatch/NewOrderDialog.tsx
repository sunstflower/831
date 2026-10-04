/**
 * 调度中心的「新建订单」弹层（Req-M4-8）。
 *
 * ## 为什么是**复用**而不是新写一个表单
 *
 * 任务字段、校验顺序、时间窗的成对规则、`datetime-local` ↔ ISO 的转换，
 * 全部已有唯一作者：`task/form.ts` + `shared/src/task-rules.ts`（M3 已落地）。
 * 在调度中心再写一份「新建订单」表单，就会得到两套字段清单与两种错误文案 ——
 * 而它们会在某次加字段时静默分叉（D-34）。因此这里只做三件事：
 *
 *   1. 复用 `TASK_FORM` 的字段定义与 `EntityFormDialog` 的排版；
 *   2. 提交时固定 `submit: true`（**创建即入待派队列**，这是本入口的意义）；
 *   3. 成功后把新任务交给调用方（刷新候选池 + 自动勾选）。
 *
 * ## 为什么不像任务管理页那样支持存草稿
 *
 * 草稿不进候选池、也就不能在本页被派发 —— 从调度中心建一个「派不出去的订单」没有意义。
 * 需要暂存草稿的使用者去任务管理页建（那里的入口保留着两种模式）。
 */
import { useState } from 'react';
import type { TaskDetail } from '@udm/shared';
import { EntityFormDialog } from '../base/EntityFormDialog';
import { useApiWrite } from '../api/useApiWrite';
import { buildTaskPayload, emptyTaskForm, TASK_FORM } from '../task/form';
import type { FormField, FormValues } from '../domain/form';

export interface NewOrderResult {
  id: string;
  code: string;
  title: string;
}

interface NewOrderDialogProps {
  token: string | null;
  /** 起终点候选（与候选池同源，由调用方一次性取好，避免同一个下拉出现两份来源）。 */
  siteOptions: Array<{ value: string; label: string }>;
  /** 模板候选（模板只在创建时提供默认值）。 */
  templateOptions: Array<{ value: string; label: string }>;
  onCreated: (task: NewOrderResult) => void;
  onClose: () => void;
}

export function NewOrderDialog({ token, siteOptions, templateOptions, onCreated, onClose }: NewOrderDialogProps) {
  const [values, setValues] = useState<FormValues>(() => emptyTaskForm());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const write = useApiWrite(token);

  const fields: FormField[] = TASK_FORM.fields.map((field) =>
    field.name === 'templateId' ? { ...field, options: templateOptions } : field
  );

  function onChange(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    // 改动一个字段就清掉它自己的红字：留着会让人以为改了也没用
    setErrors((current) => (current[name] ? { ...current, [name]: '' } : current));
  }

  async function submit() {
    const built = buildTaskPayload(values, 'create');
    if (!built.ok) {
      setErrors(built.fields);
      setFormError(null);
      return;
    }
    setErrors({});
    const outcome = await write.run(
      '/api/tasks',
      'POST',
      // `submit: true`：创建与提交在服务端**同一个事务**里完成（`task.service.ts`），
      // 不会出现「建了草稿但提交失败」的中间态
      { ...built.payload, submit: true },
      '已新建订单并进入待派队列'
    );
    if (outcome.ok) {
      setFormError(null);
      const created = outcome.data as TaskDetail;
      onCreated({ id: created.id, code: created.code, title: created.title });
      return;
    }
    setErrors(outcome.fields);
    setFormError(outcome.formError);
  }

  return (
    <EntityFormDialog
      title="新建订单（直接进入待派队列）"
      fields={fields}
      values={values}
      errors={errors}
      formError={formError}
      busy={write.busy}
      submitLabel="创建并提交"
      editing={false}
      candidates={{ site: siteOptions }}
      targetOptions={{ node: [], edge: [] }}
      onChange={onChange}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  );
}
