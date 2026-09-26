/**
 * 图层开关（页面态，不落库）。默认全开；不可关闭的图层忽略切换请求。
 *
 * 由「6 个独立的 boolean」扩展为支持**预设**与**分组开关**：
 * 用户体验上，逐个点 6 个复选框去凑出「只看配送」是一次无谓的负担；
 * 分组开关则解决「我只想临时关掉整块路网」这种批量意图。
 */
import { useCallback, useMemo, useState } from 'react';
import {
  DEFAULT_VISIBILITY,
  LAYER_PRESETS,
  LAYERS,
  layersOfGroup,
  type LayerGroupKey,
  type LayerKey
} from '../model/layers';

const TOGGLEABLE = new Set(LAYERS.filter((layer) => layer.toggleable).map((layer) => layer.key));

export interface LayerVisibilityState {
  visibility: Record<LayerKey, boolean>;
  toggle: (key: LayerKey) => void;
  /** 分组内**可切换**的图层是否全部可见。 */
  isGroupVisible: (group: LayerGroupKey) => boolean;
  /** 分组内**可切换**的图层是否有任意一个可见（用于 indeterminate 态）。 */
  isGroupMixed: (group: LayerGroupKey) => boolean;
  toggleGroup: (group: LayerGroupKey) => void;
  applyPreset: (presetKey: string) => void;
  setAll: (value: boolean) => void;
}

export function useLayerVisibility(): LayerVisibilityState {
  const [visibility, setVisibility] = useState<Record<LayerKey, boolean>>({ ...DEFAULT_VISIBILITY });

  const setMany = useCallback((keys: LayerKey[], value: boolean) => {
    setVisibility((previous) => {
      const next = { ...previous };
      for (const key of keys) {
        if (TOGGLEABLE.has(key)) {
          next[key] = value;
        }
      }
      return next;
    });
  }, []);

  const toggle = useCallback((key: LayerKey) => {
    if (!TOGGLEABLE.has(key)) {
      return;
    }
    setVisibility((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  const toggleableOfGroup = useCallback(
    (group: LayerGroupKey): LayerKey[] => layersOfGroup(group).filter((layer) => layer.toggleable).map((layer) => layer.key),
    []
  );

  const isGroupVisible = useCallback(
    (group: LayerGroupKey) => {
      const keys = toggleableOfGroup(group);
      return keys.length > 0 && keys.every((key) => visibility[key]);
    },
    [toggleableOfGroup, visibility]
  );

  const isGroupMixed = useCallback(
    (group: LayerGroupKey) => {
      const keys = toggleableOfGroup(group);
      const on = keys.filter((key) => visibility[key]).length;
      return on > 0 && on < keys.length;
    },
    [toggleableOfGroup, visibility]
  );

  const toggleGroup = useCallback(
    (group: LayerGroupKey) => {
      // 三态语义：全亮 → 全灭；否则（含 indeterminate）→ 全亮
      const keys = toggleableOfGroup(group);
      const allOn = keys.length > 0 && keys.every((key) => visibility[key]);
      setMany(keys, !allOn);
    },
    [setMany, toggleableOfGroup, visibility]
  );

  const applyPreset = useCallback((presetKey: string) => {
    const preset = LAYER_PRESETS.find((item) => item.key === presetKey);
    if (!preset) {
      return;
    }
    // 预设可能把「不可切换」的图层设为 false（配置笔误）——这里强制兜底为可见
    const next = { ...preset.visibility };
    for (const layer of LAYERS) {
      if (!layer.toggleable) {
        next[layer.key] = true;
      }
    }
    setVisibility(next);
  }, []);

  const setAll = useCallback((value: boolean) => setMany([...TOGGLEABLE], value), [setMany]);

  return useMemo(
    () => ({ visibility, toggle, isGroupVisible, isGroupMixed, toggleGroup, applyPreset, setAll }),
    [visibility, toggle, isGroupVisible, isGroupMixed, toggleGroup, applyPreset, setAll]
  );
}
