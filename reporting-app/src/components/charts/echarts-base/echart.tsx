import { useEffect, useRef } from 'react';
import {
  ensureEchartsRegistered,
  echarts,
  type EChartsOption,
} from './register-echarts';

type Props = {
  option: EChartsOption;
  height: number;
  /** Accessible label; the tile frame also offers a "view as table" fallback. */
  ariaLabel: string;
};

/**
 * A minimal ECharts wrapper — deliberately NOT echarts-for-react.
 *
 * It owns exactly the lifecycle ECharts needs and nothing more: init once, re-apply options
 * with notMerge so a changed spec fully replaces the old chart, resize with the container,
 * and dispose on unmount. All the charting logic lives in each renderer's pure `buildOption`,
 * so this component stays trivial and never needs testing against a canvas.
 */
const EChart = ({ option, height, ariaLabel }: Props) => {
  const container = useRef<HTMLDivElement | null>(null);
  const instance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    ensureEchartsRegistered();
    if (!container.current) return undefined;

    instance.current = echarts.init(container.current, undefined, {
      renderer: 'canvas',
    });

    const observer = new ResizeObserver(() => instance.current?.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    // notMerge: a new spec must not leave stale series behind. lazyUpdate: batch into a frame.
    instance.current?.setOption(
      option as Parameters<echarts.ECharts['setOption']>[0],
      {
        notMerge: true,
        lazyUpdate: true,
      }
    );
  }, [option]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', height: `${height}px` }}
    />
  );
};
EChart.displayName = 'EChart';

export default EChart;
