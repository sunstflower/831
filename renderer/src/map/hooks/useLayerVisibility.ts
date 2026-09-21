/** 图层开关（页面态，不落库）。默认全开；不可关闭的图层忽略切换请求。 */
import { useCallback, useState } from 'react';
import { DEFAULT_VISIBILITY, LAYERS, type LayerKey } from '../model/layers';

const TOGGLEABLE = new Set(LAYERS.filter((layer) => layer.toggleable).map((layer) => layer.key));

export function useLayerVisibility() {
  const [visibility, setVisibility] = useState<Record<LayerKey, boolean>>({ ...DEFAULT_VISIBILITY });

  const toggle = useCallback((key: LayerKey) => {
    if (!TOGGLEABLE.has(key)) {
      return;
    }
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setAll = useCallback((value: boolean) => {
    setVisibility((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next) as LayerKey[]) {
        if (TOGGLEABLE.has(key)) {
          next[key] = value;
        }
      }
      return next;
    });
  }, []);

  return { visibility, toggle, setAll };
}
