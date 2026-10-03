import '../../test/dom-stubs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import type { EdgeProps } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { NetEdge } from './NetEdge';
import { RouteEdge } from './RouteEdge';
import type { NetEdgeData, RouteEdgeData } from '../nodes/types';

/**
 * 「样式类真的落在 `<path>` 上」的回归护栏。
 *
 * ## 为什么必须有这份测试
 *
 * React Flow 把边的 `className` 拼到**外层 `<g>`**，而 `map.css` 里所有路网/路线
 * 的样式选择器写的都是 `.react-flow__edge-path.udm-edge-net.is-slow` 这类
 * 「放在 path 上」的形式。两边不一致时：
 *
 * - 页面不报错、控制台不报错、`toFlow` 的单测也不报错（它断言的是模型里的 `className`）；
 * - 唯一的症状是**某条样式从来没生效过**。
 *
 * 实测事故：`is-muted`（有路线时路网变淡）与 `is-slow`（橙色慢边，本轮新增）
 * 都只落在 `<g>` 上，CSS 一条都没匹配到；慢边在画布上从未变过色，
 * 直到用 Electron 读 `getComputedStyle(path).stroke` 才发现。
 *
 * 因此这里做两件事：
 * 1. 逐条断言组件把标志类写进了 `<path>`；
 * 2. 从 `map.css` **反向**提取所有 `.react-flow__edge-path.udm-edge-*.<标志>` 选择器，
 *    断言它们都能被本目录的组件产出 —— 新加一条 CSS 规则却忘了改组件时会直接红。
 */

function netPath(data: Partial<NetEdgeData>) {
  const full: NetEdgeData = {
    lengthM: 100,
    speedLimitMps: 5,
    disabled: false,
    travelSeconds: 20,
    weight: 1,
    muted: false,
    kind: '可通行',
    fromCode: 'N00',
    toCode: 'N10',
    ...data
  };
  const props = { id: 'e-1', sourceX: 0, sourceY: 0, targetX: 10, targetY: 10, data: full } as unknown as EdgeProps;
  const { container } = render(
    <svg>
      <NetEdge {...props} />
    </svg>
  );
  return container.querySelector('path.react-flow__edge-path');
}

function routePath(superseded: boolean) {
  const full: RouteEdgeData = {
    routeId: 'r-1',
    taskId: null,
    vehicleId: null,
    superseded,
    seq: 0,
    total: 3,
    lengthM: 120
  };
  const props = { id: 'r-1-0', sourceX: 0, sourceY: 0, targetX: 10, targetY: 10, data: full } as unknown as EdgeProps;
  const { container } = render(
    <svg>
      <RouteEdge {...props} />
    </svg>
  );
  return container.querySelector('path.react-flow__edge-path');
}

const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('NetEdge / RouteEdge · 视觉标志类必须落在 <path> 上', () => {
  it('畅通边：只有底类，不带任何标志', () => {
    const classes = classesOf(netPath({}));
    expect(classes).toContain('udm-edge-net');
    expect(classes).not.toContain('is-slow');
    expect(classes).not.toContain('is-muted');
    expect(classes).not.toContain('is-disabled');
  });

  it('weight > 1 → is-slow（橙色点线）；权重缺省视为畅通', () => {
    expect(classesOf(netPath({ weight: 2.2 }))).toContain('is-slow');
    expect(classesOf(netPath({ weight: 1 }))).not.toContain('is-slow');
  });

  it('muted → is-muted；disabled → is-disabled；三者可同时存在', () => {
    expect(classesOf(netPath({ muted: true }))).toContain('is-muted');
    const all = classesOf(netPath({ muted: true, disabled: true, weight: 1.6 }));
    expect(all).toEqual(expect.arrayContaining(['is-muted', 'is-disabled', 'is-slow']));
  });

  it('路线边：生效 → is-active，被取代 → is-superseded', () => {
    expect(classesOf(routePath(false))).toContain('is-active');
    expect(classesOf(routePath(true))).toContain('is-superseded');
  });

  it('map.css 里的每个 path 选择器都能被组件产出（反向护栏）', () => {
    // vitest 从仓库根运行（`npm test`），故用 cwd 定位这份 CSS
    const css = readFileSync(resolve(process.cwd(), 'renderer/src/map/style/map.css'), 'utf8');
    const selectors = [...css.matchAll(/\.react-flow__edge-path\.(udm-edge-(?:net|route))\.([a-z-]+)/g)];
    expect(selectors.length).toBeGreaterThan(0);

    const producible = new Set([
      ...classesOf(netPath({})),
      ...classesOf(netPath({ muted: true, disabled: true, weight: 2 })),
      ...classesOf(routePath(false)),
      ...classesOf(routePath(true))
    ]);
    for (const [, , flag] of selectors) {
      expect(producible, `map.css 选择了 .${flag}，但没有任何组件把它写到 <path> 上`).toContain(flag);
    }
  });
});
