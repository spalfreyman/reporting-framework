import { useIntl } from 'react-intl';
import Stamp from '@commercetools-uikit/stamp';
import { computeDelta, formatDelta, type Delta } from './format-metric';
import type { Cell } from '../../types/reporting';

type Props = {
  metricId: string;
  current: Cell;
  previous: Cell;
};

const TONE: Record<Delta['tone'], 'positive' | 'critical' | 'information'> = {
  positive: 'positive',
  negative: 'critical',
  neutral: 'information',
};

/** Arrow glyphs so direction survives greyscale printing and colour-blind viewers. */
const ARROW: Record<Delta['tone'], string> = {
  positive: '',
  negative: '',
  neutral: '',
};

/**
 * The change against the comparison period.
 *
 * Tone reflects whether the movement is GOOD, not whether it is up: a rising return rate
 * renders red. Direction is also carried by an arrow and a sign, never by colour alone.
 */
const DeltaBadge = ({ metricId, current, previous }: Props) => {
  const intl = useIntl();
  const delta = computeDelta(metricId, current, previous);

  if (delta.relative === null) return null;

  const direction =
    delta.absolute === null || delta.absolute === 0
      ? ''
      : delta.absolute > 0
      ? '↑'
      : '↓';

  return (
    <Stamp tone={TONE[delta.tone]} isCondensed>
      {`${direction} ${formatDelta(intl, delta)}${ARROW[delta.tone]}`}
    </Stamp>
  );
};
DeltaBadge.displayName = 'DeltaBadge';

export default DeltaBadge;
