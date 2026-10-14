import * as ui from '@biddaloy/ui';
import { describe, expect, it } from 'vitest';

// Fails when a dashboard kit component is added without being exported.
const KIT = [
  'WidgetCard',
  'StatTile',
  'Sparkline',
  'Meter',
  'BriefingLine',
  'BriefingChip',
  'ChartTableToggle',
  'LineChart',
  'ColumnChart',
  'StackedBar',
] as const;

describe('dashboard kit barrel', () => {
  it.each(KIT)('%s is exported from @biddaloy/ui', (name) => {
    expect(typeof ui[name]).toBe('function');
  });
});
