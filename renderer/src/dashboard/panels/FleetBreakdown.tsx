/**
 * 车队状态分布：一条堆叠条 + 明细列表。
 *
 * 为什么两者都要：堆叠条回答「整体运力被什么占着」（一眼看出比例），
 * 列表回答「每类到底几台」（比例看不准的是绝对数）。只给其中一个，
 * 使用者就要么数不清、要么感受不到结构。
 *
 * 0 台的状态**仍然列出**并置灰：不显示会让人以为「这个状态不存在」，
 * 而它其实是「当前没有车处于该状态」——后者才是事实。
 */
import { toneClass, type FleetBucket } from '../model/summary';

export interface FleetBreakdownProps {
  buckets: FleetBucket[];
  total: number;
}

export function FleetBreakdown({ buckets, total }: FleetBreakdownProps) {
  return (
    <>
      <div className="udm-fleet__bar" role="img" aria-label={`车队共 ${total} 台，按状态分布`}>
        {buckets
          .filter((bucket) => bucket.count > 0)
          .map((bucket) => (
            <span
              key={bucket.status}
              className={`udm-fleet__seg ${toneClass(bucket.tone, 'udm-fleet__seg--')}`}
              style={{ flexGrow: bucket.count }}
              title={`${bucket.label} ${bucket.count} 台`}
            />
          ))}
      </div>

      <ul className="udm-fleet__list">
        {buckets.map((bucket) => (
          <li key={bucket.status} className={bucket.count === 0 ? 'is-zero' : undefined}>
            <span className={`udm-dot ${toneClass(bucket.tone)}`} aria-hidden="true" />
            <span className="udm-fleet__name">{bucket.label}</span>
            {!bucket.schedulable ? (
              // 离线 / 故障 / 停用为什么重要：它们**不进调度候选集**（Req-M2-7），
              // 直接标在行内，省掉一次「为什么这台车没被派单」的追问
              <span className="udm-fleet__note">不参与调度</span>
            ) : null}
            <span className="udm-fleet__count">{bucket.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
