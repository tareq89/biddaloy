import { render, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_EN } from '../../i18n/region-config';
import { RegionConfigProvider } from '../../i18n/region-config-provider';

import { A4Document } from './a4-document';
import type { IssuerSnapshot } from './issuer-header';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

function renderDoc(props: Partial<React.ComponentProps<typeof A4Document>> = {}) {
  return render(
    <RegionConfigProvider value={REGION_BD_EN}>
      <A4Document issuer={ISSUER} title="Seat plan" {...props}>
        <p>body</p>
      </A4Document>
    </RegionConfigProvider>,
  );
}

describe('A4Document', () => {
  it('renders issuer, title, subtitle and children', () => {
    renderDoc({ subtitle: 'Class 8' });
    expect(screen.getByText('Ananta High School')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Seat plan' })).toBeTruthy();
    expect(screen.getByText('Class 8')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
  });

  it('renders one signature line per label, none when omitted', () => {
    const { container, unmount } = renderDoc({ signatures: ['Class teacher', 'Head'] });
    expect(container.querySelectorAll('[data-slot="a4-signature"]')).toHaveLength(2);
    unmount();
    const again = renderDoc();
    expect(again.container.querySelectorAll('[data-slot="a4-signature"]')).toHaveLength(0);
  });

  it('landscape uses the 297mm width, portrait 210mm; print height fits inside 10mm margins', () => {
    const { container, unmount } = renderDoc({ orientation: 'landscape' });
    const land = container.querySelector('[data-slot="a4-document"]')?.className;
    expect(land).toContain('max-w-[297mm]');
    expect(land).toContain('print:min-h-[189mm]');
    unmount();
    const port = renderDoc().container.querySelector('[data-slot="a4-document"]')?.className;
    expect(port).toContain('max-w-[210mm]');
    expect(port).toContain('print:min-h-[276mm]');
    expect(port).toContain('print:last:break-after-auto');
  });

  it('injects no style element', () => {
    const { container } = renderDoc();
    expect(container.querySelector('style')).toBeNull();
  });
});
