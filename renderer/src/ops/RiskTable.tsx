/**
 * 风险预检的**表格**（`PlanRiskItem[]` → 一张表）。
 *
 * ## 为什么单独抽出来
 *
 * 同一张表有两个使用场景：
 *   1. 告警中心的「任务风险预检」—— 全量、分两节（`ops/RiskPanels.tsx`，见 `ISS-096`）；
 *   2. 调度中心派发后的「本批次预检结论」—— 只列出本次派发涉及的任务。
 *
 * 抽出之前的形态是「调度中心自己再写一份 `<table>`」—— 而这两处的列、级别文案、
 * 建议动作宽度必须逐字一致，否则同一批风险在两个页面上看起来像两件事（D-34）。
 * 组件只接收**已经过滤好的**条目，过滤口径在调用方（`ops/model.ts` 的 `filterRiskReport`）。
 */
import type { PlanRiskItem } from '@udm/shared';
import { badgeToneClass } from '../domain/tone';
import { RISK_LEVEL_TONE, riskRowOf } from './model';
/*
 * 样式跟着组件走：本表被告警中心与调度中心两个页面使用。
 * 若让每个页面自己去 import 样式，就会漏掉「其中一个页面忘了 import →
 * 表格在那边没有边框」这类只在特定导航路径下才显形的问题。
 */
import './style/ops.css';

interface RiskTableProps {
  records: PlanRiskItem[];
}

export function RiskTable({ records }: RiskTableProps) {
  return (
    <div className="udm-table__wrap">
      <table className="udm-table udm-risk__table">
        <thead>
          <tr>
            <th>级别</th>
            <th>类型</th>
            <th>具体情况</th>
            <th>任务</th>
            <th>车辆</th>
            <th>建议动作</th>
          </tr>
        </thead>
        <tbody>
          {records.map((item, index) => {
            const row = riskRowOf(item);
            return (
              // 同一类风险可能对多条任务各报一条，键里带上任务与下标才唯一
              <tr key={`${row.kind}-${row.taskIds.join('-')}-${index}`}>
                <td>
                  <span className={badgeToneClass(RISK_LEVEL_TONE[row.level])}>
                    {row.level === 'critical' ? '必须处理' : row.level === 'warning' ? '需留意' : '提示'}
                  </span>
                </td>
                <td>{row.kindLabel}</td>
                <td className="udm-risk__message">{row.message}</td>
                <td>{row.tasks}</td>
                <td>{row.vehicles}</td>
                <td className="udm-risk__suggestion">{row.suggestion}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
