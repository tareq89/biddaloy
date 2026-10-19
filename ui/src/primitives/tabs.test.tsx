import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

describe('TabsContent', () => {
  it('is a tab stop with a visible keyboard focus ring and merges className', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a" className="extra">
          Body
        </TabsContent>
      </Tabs>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('tabindex')).toBe('0');
    expect(panel.className).toContain('focus-visible:ring-2');
    expect(panel.className).toContain('focus-visible:ring-ring');
    expect(panel.className).toContain('extra');
  });
});
