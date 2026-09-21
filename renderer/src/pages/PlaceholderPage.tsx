/**
 * 占位页：用于尚未实现的模块。
 * 明确写出「未实现」与对应模块编号，避免空白页被误读为加载失败。
 */
export function PlaceholderPage({ title, module, note }: { title: string; module: string; note?: string }) {
  return (
    <div className="udm-placeholder">
      <h2>{title}</h2>
      <p>
        该模块（<code>{module}</code>）尚未实现。
      </p>
      {note ? <p>{note}</p> : null}
    </div>
  );
}
