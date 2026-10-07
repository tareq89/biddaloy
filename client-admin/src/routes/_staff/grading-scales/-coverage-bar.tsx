/**
 * 0-100% coverage bar under the band table — [20.3.1]. Colours each band
 * by its position in the list, renders any uncovered percent range in
 * red, and hatches (diagonal stripes, via a repeating CSS gradient — no
 * chart library needed for this) any range two bands both claim. This is
 * what makes a broken scale visible while typing, before the server's
 * own validation ever runs.
 *
 * [31.4.marks-4b] A titled card, grade letters under their ranges, an icon
 * on the status line, and colours that never reuse the gap red.
 */
import type { BandInput } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react';

export interface CoverageBarProps {
  bands: BandInput[];
}

interface Segment {
  from: number;
  to: number;
  kind: 'covered' | 'gap' | 'overlap';
}

// Pass bands cycle these. Never `chart-4`: it equals `destructive`, the gap red.
const PASS_COLORS = ['bg-chart-5', 'bg-chart-2', 'bg-chart-1', 'bg-chart-3'];
const FAIL_COLOR = 'bg-text-secondary';

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

type Owner = { band: BandInput; passIndex: number };

/** The band that owns point `p`: the first one whose range contains it. */
function ownerAt(bands: BandInput[], p: number): Owner | undefined {
  let passIndex = -1;
  for (const band of bands) {
    if (!band.is_fail) passIndex += 1;
    const lo = Math.min(band.percent_from, band.percent_to);
    const hi = Math.max(band.percent_from, band.percent_to);
    if (p >= lo && p <= hi) return { band, passIndex };
  }
  return undefined;
}

type OwnedSegment = Segment & { owner?: Owner | undefined };

/** Splits covered segments wherever the owning band changes, so two adjacent
 * bands are two segments (own colour and grade letter), not one merged run. */
function splitByOwner(bands: BandInput[], segments: Segment[]): OwnedSegment[] {
  const out: OwnedSegment[] = [];
  for (const seg of segments) {
    if (seg.kind !== 'covered') {
      out.push(seg);
      continue;
    }
    let current: OwnedSegment | undefined;
    for (let p = seg.from; p <= seg.to; p += 1) {
      const owner = ownerAt(bands, p);
      if (current && current.owner?.band === owner?.band) {
        current.to = p;
      } else {
        current = { from: p, to: p, kind: 'covered', owner };
        out.push(current);
      }
    }
  }
  return out;
}

export function CoverageBar({ bands }: CoverageBarProps) {
  const { t } = useTranslation('grading');
  const base = computeSegments(bands);
  const segments = splitByOwner(bands, base);
  const hasGaps = base.some((s) => s.kind === 'gap');
  const hasOverlaps = base.some((s) => s.kind === 'overlap');
  const complete = !hasGaps && !hasOverlaps;

  return (
    <section
      aria-labelledby="coverage-title"
      className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
    >
      <h2 id="coverage-title" className="text-h2">
        {t('coverageBar.title')}
      </h2>
      <div
        role="img"
        aria-label={t('coverageBar.label')}
        className="mt-4 flex h-4 w-full overflow-hidden rounded-md border border-border-subtle"
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
                    'repeating-linear-gradient(45deg, var(--color-destructive) 0, var(--color-destructive) 4px, var(--color-muted) 4px, var(--color-muted) 8px)',
                }}
              />
            );
          }
          const owner = segment.owner;
          const color = owner?.band.is_fail
            ? FAIL_COLOR
            : PASS_COLORS[(owner?.passIndex ?? 0) % PASS_COLORS.length];
          return (
            <div
              key={`${segment.from}-${index}`}
              data-testid="coverage-band"
              className={`h-full ${color}`}
              style={{ width }}
            />
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className="mt-1 flex w-full text-caption font-medium text-text-secondary"
      >
        {segments.map((segment, index) => (
          <span
            key={`${segment.from}-${index}`}
            className="min-w-0 truncate text-center"
            style={{ width: `${segment.to - segment.from + 1}%` }}
          >
            {segment.kind === 'covered' ? segment.owner?.band.grade : ''}
          </span>
        ))}
      </div>
      <p
        className={`mt-3 flex items-center gap-1.5 ${complete ? 'text-text-secondary' : 'text-destructive'}`}
      >
        {complete ? (
          <CircleCheckIcon aria-hidden="true" className="size-4 shrink-0 text-status-paid-fg" />
        ) : (
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span>
          {hasGaps && t('coverageBar.hasGaps')}
          {hasOverlaps && `${hasGaps ? ' ' : ''}${t('coverageBar.hasOverlaps')}`}
          {complete && t('coverageBar.complete')}
        </span>
      </p>
    </section>
  );
}
