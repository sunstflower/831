/**
 * 调度中心（`design.md` §7.1 `/dispatch`）：**M4 调度台 + M5 路径规划试算**。
 *
 * ## 本轮的信息架构（Req-M4-8..10，见 `docs/module-M4b-order-flow.md` §5.4）
 *
 * 首屏只保留**主链路**：新建订单 → 待派候选池 → 策略 → 预览 → 应用派发 →（可选）立即开跑
 * → 本批次冲突预检。其余能力（手动指派、回收重算、调度日志、路径规划试算）收进
 * 默认折叠的「高级操作」—— 它们是**例外路径**，展开后的功能与接口调用完全不变。
 *
 * ## 为什么 M5 仍在这一页
 *
 * `design.md` §7.1 的页面清单里没有「路径规划」这一页 —— 路线是这个页面的输出之一，
 * 而 M5 的两个接口（`plan` / `compare`）本身就是「先算出来看看」的试算动作。
 * 它现在收在折叠区里：调度决定用哪条路线，试算只是动手前的验算。
 *
 * ## 应用之后会发生什么（本页最需要说清的一句话）
 *
 * 应用派发（`dispatch:apply`）只把任务推进到「已派发」、车辆置为 `reserved`；
 * 真正让车开跑的是 `execution:start`，两个动作的权限点不同（D-11）。
 * 本页把它们**组合**成一个带开关的流程（D-58）：勾选「派发后立即开跑」时，
 * 应用成功后由渲染层逐单调用 start，并把逐单结果（成功 / 失败原因）显式列出。
 * 因此这里不再写「车还没动，请去任务管理页开跑」那种说明 —— 那是开关关闭时的分支，
 * 由应用后的回执逐条告知。
 */
import { Link } from 'react-router-dom';
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
        <span className="udm-badge udm-badge--info">派发后可立即开跑</span>
      </div>
      <p className="udm-page__lead">
        新建订单 → 勾选待派任务 → 预览策略（贪心 / 匈牙利，或一次对比两者）→ 应用派发。
        每一步都会写调度日志；派发后同屏给出这一批的冲突与超时预检。
      </p>
      <p className="udm-list__note" role="note">
        <IconInfo />
        <span>
          「应用派发」只决定<strong>派给谁</strong>（<code>dispatch:apply</code>）；
          要让车真的跑起来，需要勾选派发明细旁的<strong>「派发后立即开跑」</strong>
          （<code>execution:start</code>，见 D-58）。没勾选或没有该权限时，
          去<Link to="/tasks">任务管理</Link>的操作列逐单「开始执行」。
        </span>
      </p>

      <section className="udm-card" aria-label="调度台">
        <header className="udm-card__head">
          <h3 className="udm-card__title">调度台</h3>
          <span className="udm-card__aside">
            M4 · <code>/api/dispatch/preview</code> · <code>/api/dispatch/apply</code> ·{' '}
            <code>/api/execution/tasks/*/start</code>
          </span>
        </header>
        <div className="udm-card__body">
          <DispatchConsole />
        </div>
      </section>

      {/*
        路径规划默认收起（见文件头）：它是「动手前的验算」，不是每次派发都会走的一步。
        折叠区里的说明照旧强调「规划只预览、不落库」，避免被读成「任务会走这条路」。
      */}
      <details className="udm-dispatch__advanced">
        <summary className="udm-dispatch__advanced-summary">高级操作：路径规划（试算，不落库）</summary>
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
                （上面的操作）。这里适合先验证「这条路走不走得通、要多久」，再回到上面应用。
              </span>
            </div>
            <RoutePlanner />
          </div>
        </section>
      </details>
    </div>
  );
}
