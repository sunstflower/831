import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TASK_STATUS_TONE, badgeToneClass, toneClass, type Tone } from './tone';

const TONES: Tone[] = ['ok', 'warn', 'danger', 'info', 'dim'];

/**
 * 色调映射的单测。
 *
 * 这里补的是 `styles/classnames.test.ts` 的一个**盲区**：那道护栏只扫 `className="…"`
 * 字面量，而色调类名是由 `toneClass` 在运行时拼出来的 —— 拼错了它看不见。
 * 实测（2026-09-26）：徽标传了 `'udm-badge'`，拼出 `udm-badge-ok`（CSS 里是
 * `udm-badge--ok`），于是工作台的任务徽标一直显示成基础款中性色，**任何测试都不红**。
 * 因此这里的断言直接对着 CSS 文件核验「拼出来的类名真的存在」。
 */
const uiCss = readFileSync(join(process.cwd(), 'renderer/src/styles/ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const dashboardCss = readFileSync(join(process.cwd(), 'renderer/src/dashboard/style/dashboard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('toneClass', () => {
  it('前缀原样拼接（含分隔符），不做任何猜测', () => {
    // 默认前缀带单横线：`.tone-ok`
    expect(toneClass('danger')).toBe('tone-danger');
    // BEM 双横线：`.udm-progress--ok` / `.udm-badge--ok`
    expect(toneClass('ok', 'udm-progress--')).toBe('udm-progress--ok');
    // 传一个不带分隔符的前缀会得到 CSS 里不存在的类名 —— 这是调用方的错，函数不改写它
    expect(toneClass('ok', 'udm-badge')).toBe('udm-badgeok');
  });
});

describe('badgeToneClass', () => {
  it('除 dim 外都给出 CSS 里真实存在的修饰类', () => {
    for (const tone of TONES) {
      const className = badgeToneClass(tone);
      if (tone === 'dim') {
        continue;
      }
      expect(uiCss, `ui.css 缺少 .${className}`).toContain(`.${className} `);
    }
  });

  it('dim 不加修饰类：基础款本身就是中性色，CSS 里也没有 .udm-badge--dim', () => {
    expect(badgeToneClass('dim')).toBe('udm-badge');
    expect(uiCss).not.toContain('.udm-badge--dim ');
  });

  it('进度条的 tone 修饰类同样都能在 CSS 里找到（info/dim 有意退回基础填充色）', () => {
    for (const tone of TONES) {
      if (tone === 'info' || tone === 'dim') {
        continue;
      }
      expect(uiCss, `ui.css 缺少 .udm-progress--${tone}`).toContain(`.udm-progress--${tone} `);
    }
  });

  it('车队分布条的修饰类在 dashboard.css 里都能找到（拼错分隔符就会全部失效）', () => {
    for (const tone of TONES) {
      expect(dashboardCss, `dashboard.css 缺少 .udm-fleet__seg--${tone}`).toContain(`.udm-fleet__seg--${tone} `);
    }
  });
});

describe('任务状态映射', () => {
  it('每个状态都有色调，且终态是中性色（不能整列都在报警）', () => {
    expect(Object.keys(TASK_STATUS_TONE).sort()).toEqual([
      'assigned',
      'cancelled',
      'draft',
      'failed',
      'finished',
      'paused',
      'pending',
      'running'
    ]);
    expect(TASK_STATUS_TONE.cancelled).toBe('dim');
    expect(TASK_STATUS_TONE.finished).toBe('dim');
    expect(TASK_STATUS_TONE.failed).toBe('danger');
    expect(TASK_STATUS_TONE.running).toBe('ok');
  });
});
