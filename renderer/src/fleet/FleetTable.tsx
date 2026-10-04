/**
 * 车辆中心的**车队表格**（纯展示）。
 *
 * 与 `pages/FleetPage.tsx` 的分工：本文件只管「一行怎么画」，取数与筛选在页面里、
 * 纯换算在 `fleet/model.ts`。这样表格可以脱离请求单独渲染（用例与 Gallery 都受益）。
 *
 * 操作列**只有一个动作**「详情」：编辑与启停属于 `base:write`，入口跳转到基础数据页
 * （D-59）—— 在本页复制一套车辆表单会得到第二个字段清单作者。
 */
import { column, text, type Column } from '../domain/table';
import { badgeToneClass, toneClass } from '../domain/tone';
import { IconRefresh, IconVehicle } from '../components/icons';
import { batteryToneOf, type FleetRow } from './model';

/** 列定义（`key` 是真实字段名，字段改名时这里会编译报错）。 */
export const FLEET_COLUMNS: Column<FleetRow>[] = [
  column('code', '车辆'),
  column('typeLabel', '型号'),
  column('statusLabel', '状态'),
  column('loadText', '载重'),
  column('battery', '电量', { align: 'right' }),
  column('speedText', '速度', { align: 'right' }),
  column('positionText', '位置 (x, y)', { align: 'right' }),
  column('taskCode', '当前任务'),
  column('heartbeatText', '心跳')
];

interface FleetTableProps {
  rows: FleetRow[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onOpen: (row: FleetRow) => void;
  onRetry: () => void;
}

export function FleetTable({ rows, loading, error, selectedId, onOpen, onRetry }: FleetTableProps) {
  if (error) {
    return (
      <div className="udm-alert" role="alert">
        <span>车队列表读取失败：{error}</span>
        <button type="button" className="udm-btn udm-btn--ghost" onClick={onRetry}>
          <IconRefresh size={14} /> 重试
        </button>
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div className="udm-empty" role="status">
        <span className="udm-spinner" aria-hidden="true" />
        <p className="udm-empty__title">正在读取车队…</p>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="udm-empty">
        <div className="udm-empty__icon">
          <IconVehicle />
        </div>
        <p className="udm-empty__title">没有匹配的车辆</p>
        <p className="udm-empty__hint">换个关键词或状态再试；新增车辆在基础数据页的「车辆」页签。</p>
      </div>
    );
  }

  return (
    <div className="udm-table__wrap">
      <table className="udm-table udm-flt__table">
        <thead>
          <tr>
            {FLEET_COLUMNS.map((column) => (
              <th key={column.key} className={column.align === 'right' ? 'udm-table__num' : undefined}>
                {column.label}
              </th>
            ))}
            <th className="udm-table__actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.id === selectedId ? 'is-selected' : undefined}>
              {FLEET_COLUMNS.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'udm-table__num' : undefined}>
                  {column.key === 'code' ? (
                    <button type="button" className="udm-linklike" onClick={() => onOpen(row)}>
                      {row.code} · {row.name}
                    </button>
                  ) : column.key === 'statusLabel' ? (
                    <span className={badgeToneClass(row.statusTone)}>{row.statusLabel}</span>
                  ) : column.key === 'battery' ? (
                    <span className="udm-flt__battery">
                      <span
                        className={`udm-progress ${toneClass(batteryToneOf(row.battery), 'udm-progress--')}`}
                        aria-hidden="true"
                      >
                        <span className="udm-progress__fill" style={{ width: `${Math.min(100, Math.max(0, row.battery))}%` }} />
                      </span>
                      <span className="udm-table__num">{row.battery.toFixed(0)}%</span>
                    </span>
                  ) : column.key === 'heartbeatText' ? (
                    <span className={row.online ? undefined : 'udm-flt__offline'}>
                      {text(row.heartbeatText) === '—' ? '无心跳' : text(row.heartbeatText)}
                    </span>
                  ) : (
                    column.cell(row)
                  )}
                </td>
              ))}
              <td className="udm-table__actions">
                <div className="udm-list__row-actions">
                  <button type="button" className="udm-btn udm-btn--ghost" onClick={() => onOpen(row)}>
                    详情
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {loading ? <p className="udm-list__hint">更新中…</p> : null}
    </div>
  );
}
