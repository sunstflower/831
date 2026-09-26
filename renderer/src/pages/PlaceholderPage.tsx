/**
 * 未实现模块的说明页。
 *
 * 为什么不做成一页「敬请期待」：使用者点进来是想知道**这页将来能干什么**。
 * 空白页与四个字的空话都答不了这个问题，反而会被误读成「加载失败」（ISS-010 记录的正是
 * 「把工作台与地图的可用误当成系统可用」）。因此这里如实给出三件事：
 *   1. 模块编号（照此回查 `design.md` §4 的需求条目）；
 *   2. 计划能力，逐条带 `Req-*` 编号（编号是引用，需求原文只在 `design.md` 里）；
 *   3. 依赖的接口与权限点（`docs/api.md`），让人知道「开工要动哪些地方」。
 */
import { Link } from 'react-router-dom';
import { PLANNED_MODULES } from '../app/modules';
import { IconCheck, IconInfo, IconShield } from '../components/icons';

export interface PlaceholderPageProps {
  /** `PLANNED_MODULES` 的键（与路由同名）。 */
  moduleKey: string;
  /** 兜底标题：模块未登记时使用，保证页面永远有可读文字。 */
  title: string;
}

export function PlaceholderPage({ moduleKey, title }: PlaceholderPageProps) {
  const meta = PLANNED_MODULES[moduleKey];

  if (!meta) {
    // 未登记模块：显式说明「没有登记」，而不是渲染半张空卡
    return (
      <div className="udm-page">
        <div className="udm-planned__head">
          <h2 className="udm-card__title">{title}</h2>
        </div>
        <p className="udm-page__lead">
          该模块尚未实现，且未在 <code>renderer/src/app/modules.ts</code> 登记计划能力。
        </p>
      </div>
    );
  }

  return (
    <div className="udm-page">
      <div className="udm-planned__head">
        <span className="udm-planned__id">{meta.id}</span>
        <h2 className="udm-card__title">{meta.title}</h2>
        <span className="udm-badge udm-badge--warn">未实现</span>
      </div>
      <p className="udm-page__lead">{meta.goal}</p>

      <div className="udm-planned__grid">
        <section className="udm-card" aria-label="计划能力">
          <header className="udm-card__head">
            <IconCheck className="udm-card__icon" />
            <h3 className="udm-card__title">计划能力</h3>
            <span className="udm-card__aside">需求条目见 design.md §4</span>
          </header>
          <div className="udm-card__body">
            <ul className="udm-planned__caps">
              {meta.capabilities.map((capability) => (
                <li key={capability.requirement}>
                  <span className="udm-planned__req">{capability.requirement}</span>
                  <span>{capability.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="udm-card" aria-label="依赖契约">
          <header className="udm-card__head">
            <IconShield className="udm-card__icon" />
            <h3 className="udm-card__title">依赖契约</h3>
          </header>
          <div className="udm-card__body">
            <dl className="udm-kv udm-kv--flush">
              <div>
                <dt>接口</dt>
                <dd>
                  {meta.interfaces.map((path) => (
                    <code key={path} className="udm-planned__iface">
                      {path}
                    </code>
                  ))}
                </dd>
              </div>
              <div>
                <dt>权限点</dt>
                <dd>
                  {meta.permissions.map((permission) => (
                    <code key={permission} className="udm-planned__iface">
                      {permission}
                    </code>
                  ))}
                </dd>
              </div>
            </dl>
            <p className="udm-sources__note">
              <IconInfo size={12} /> 契约与需求若与本文案不一致，以 <code>design.md</code> 与{' '}
              <code>docs/api.md</code> 为准。
            </p>
          </div>
        </section>
      </div>

      <p className="udm-page__lead">
        目前可用的是 <Link to="/">监控工作台</Link> 与 <Link to="/map">地图</Link>；
        其余入口都在按依赖顺序推进中。
      </p>
    </div>
  );
}
