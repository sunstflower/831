/**
 * 调度中心（`design.md` §7.1 `/dispatch`）：**M4 调度台 + M5 路径规划**。
 *
 * ## 为什么 M5 也在这一页
 *
 * `design.md` §7.1 的页面清单里没有「路径规划」这一页 —— 路线是这个页面的输出之一
 * （`/dispatch` 的主能力写的是「预览 / 策略对比 / 应用 / 手动指派 / 日志」），
 * 而 M5 的两个接口（`plan` / `compare`）本身就是「先算出来看看」的动作。
 * 另开一页会与设计清单不一致（D-34：需求条目的唯一作者是 `design.md`）。
 *
 * ## 两块的先后关系（页面里最重要的一句话）
 *
 * 上半部分（调度台）是**会改数据**的：应用派发会写 `dispatch_plans` / `routes`
 * 并把车辆置为 `reserved`。下半部分（路径规划）是**只读**的试算，不落库。
 * 因此区块顺序是「先调度、后试算」，并在规划区的说明里写明：
 * 任务实际使用的路线要等「应用派发」才会写进 `routes` 表 ——
 * 否则使用者会以为规划出来的路线就是任务会走的路线。
 */
import { IconDispatch, IconInfo } from '../components/icons';
import { DispatchConsole } from '../dispatch/DispatchConsole';
import { RoutePlanner } from '../route/RoutePlanner';
import '../dispatch/style/dispatch.css';
import '../route/style/route.css';

export function DispatchPage() {
  return (
    <div className="udm-page">
      <div className="udm-planned__head">
        <IconDispatch className="udm-card__icon" />
        <h2 className="udm-card__title">调度中心</h2>
        <span className="udm-badge udm-badge--ok">策略预览 · 应用派发可用</span>
        <span className="udm-badge udm-badge--info">路径规划可用</span>
      </div>
      <p className="udm-page__lead">
        勾选待派任务 → 预览策略（贪心 / 匈牙利，或一次对比两者）→ 应用派发。也可对已派发任务手动指派或回收重算；
        每一步都会写调度日志。
      </p>

      <section className="udm-card" aria-label="调度台">
        <header className="udm-card__head">
          <h3 className="udm-card__title">调度台</h3>
          <span className="udm-card__aside">
            M4 · <code>/api/dispatch/preview</code> · <code>/api/dispatch/apply</code> ·{' '}
            <code>/api/dispatch/logs</code>
          </span>
        </header>
        <div className="udm-card__body">
          <DispatchConsole />
        </div>
      </section>

      <section className="udm-card" aria-label="路径规划">
        <header className="udm-card__head">
          <h3 className="udm-card__title">路径规划（试算）</h3>
          <span className="udm-card__aside">
            M5 · <code>/api/routes/plan</code> · <code>/api/routes/compare</code>
          </span>
        </header>
        <div className="udm-card__body">
          <div className="udm-list__note" role="note">
            <IconInfo />
            <span>
              规划只预览、不落库：任务实际使用的路线在<strong>应用派发</strong>时写入 <code>routes</code> 表
              （上半部分的操作）。这里适合先验证「这条路走不走得通、要多久」，再回到上面应用。
            </span>
          </div>
          <RoutePlanner />
        </div>
      </section>
    </div>
  );
}
