/**
 * 0-100% coverage bar under the band table — [20.3.1]. Colours each band
 * by its position in the list, renders any uncovered percent range in
 * red, and hatches (diagonal stripes, via a repeating CSS gradient — no
 * chart library needed for this) any range two bands both claim. This is
 * what makes a broken scale visible while typing, before the server's
 * own validation ever runs.
 */
import type { BandInput } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface CoverageBarProps {
  bands: BandInput[];
}

interface Segment {
  from: number;
  to: number;
  kind: 'covered' | 'gap' | 'overlap';
}

// One colour per band position, cycling — a scale rarely has more than
// ~8 bands, so this is plenty without hand-picking a palette per grade.
const BAND_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

/** Walks 0..100 one percentage point at a time and counts how many bands
 * claim each point — simple and correct for the table sizes this editor
 * ever holds (at most a few dozen bands), not a performance concern. */
export function computeSegments(bands: BandInput[]): Segment[] {
  const coverage = new Array<number>(101).fill(0);
  for (const band of bands) {
    const from = Math.max(0, Math.min(100, Math.round(band.percent_from)));
    const to = Math.max(0, Math.min(100, Math.round(band.percent_to)));
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    for (let p = lo; p <= hi; p += 1) coverage[p] = (coverage[p] ?? 0) + 1;
  }

  const segments: Segment[] = [];
  let current: Segment | undefined;
  for (let p = 0; p <= 100; p += 1) {
    const count = coverage[p] ?? 0;
    const kind: Segment['kind'] = count === 0 ? 'gap' : count > 1 ? 'overlap' : 'covered';
    if (current && current.kind === kind) {
      current.to = p;
    } else {
      current = { from: p, to: p, kind };
      segments.push(current);
    }
  }
  return segments;
}

export function CoverageBar({ bands }: CoverageBarProps) {
  const { t } = useTranslation('grading');
  const segments = computeSegments(bands);

  return (
    <div className="flex flex-col gap-1">
      <div
        role="img"
        aria-label={t('coverageBar.label')}
        className="flex h-4 w-full overflow-hidden rounded-md border border-border"
      >
        {segments.map((segment, index) => {
          const width = `${segment.to - segment.from + 1}%`;
          if (segment.kind === 'gap') {
            return (
              <div
                key={`${segment.from}-${index}`}
                data-testid="coverage-gap"
                className="h-full bg-destructive"
                style={{ width }}
              />
            );
          }
          if (segment.kind === 'overlap') {
            return (
              <div
                key={`${segment.from}-${index}`}
                data-testid="coverage-overlap"
                className="h-full"
                style={{
                  width,
                  backgroundImage:
                    'repeating-linear-gradient(45deg, var(--destructive) 0, var(--destructive) 4px, var(--muted) 4px, var(--muted) 8px)',
                }}
              />
            );
          }
          return (
            <div
              key={`${segment.from}-${index}`}
              data-testid="coverage-band"
              className={`h-full ${BAND_COLORS[index % BAND_COLORS.length]}`}
              style={{ width }}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {segments.some((s) => s.kind === 'gap') && t('coverageBar.hasGaps')}
        {segments.some((s) => s.kind === 'overlap') && ` ${t('coverageBar.hasOverlaps')}`}
        {segments.every((s) => s.kind === 'covered') && t('coverageBar.complete')}
      </p>
    </div>
  );
}
