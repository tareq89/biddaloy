import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IssuerHeader, type IssuerSnapshot } from './issuer-header';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road',
  phone: '+8801712345678',
  email: 'info@example.com',
  registration_id: 'EIIN-123456',
  logo_key: 'tenants/school-1/logo/abc.png',
};

describe('IssuerHeader', () => {
  it('renders the logo when logo_key and logoUrl are both present', () => {
    render(<IssuerHeader issuer={ISSUER} logoUrl="/schools/school-1/logo?v=abc" />);
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('renders no image when logo_key is null', () => {
    render(<IssuerHeader issuer={{ ...ISSUER, logo_key: null }} logoUrl={null} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders no image when logoUrl is not supplied even though logo_key is set', () => {
    render(<IssuerHeader issuer={ISSUER} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('hides the image on load error (removed logo, 404)', () => {
    render(<IssuerHeader issuer={ISSUER} logoUrl="/schools/school-1/logo?v=stale" />);
    const img = screen.getByRole('img');
    img.dispatchEvent(new Event('error'));
    expect(img.style.display).toBe('none');
  });

  it('shows the English name first by default', () => {
    render(<IssuerHeader issuer={ISSUER} />);
    expect(screen.getByText('Ananta High School')).toBeTruthy();
    expect(screen.getByText('অনন্ত উচ্চ বিদ্যালয়')).toBeTruthy();
    const primary = screen.getByText('Ananta High School');
    const secondary = screen.getByText('অনন্ত উচ্চ বিদ্যালয়');
    expect(
      primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows the Bengali name first when activeLanguage is bn', () => {
    render(<IssuerHeader issuer={ISSUER} activeLanguage="bn" />);
    const primary = screen.getByText('অনন্ত উচ্চ বিদ্যালয়');
    const secondary = screen.getByText('Ananta High School');
    expect(
      primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows only the English name when name_bn is null, even with activeLanguage bn', () => {
    render(<IssuerHeader issuer={{ ...ISSUER, name_bn: null }} activeLanguage="bn" />);
    expect(screen.getByText('Ananta High School')).toBeTruthy();
    expect(screen.queryByText('অনন্ত উচ্চ বিদ্যালয়')).toBeNull();
  });

  it('renders address, phone, email and registration_id when present', () => {
    render(<IssuerHeader issuer={ISSUER} />);
    expect(screen.getByText('123 Green Road')).toBeTruthy();
    expect(screen.getByText('+8801712345678')).toBeTruthy();
    expect(screen.getByText('info@example.com')).toBeTruthy();
    expect(screen.getByText('EIIN: EIIN-123456')).toBeTruthy();
  });

  it('renders cleanly with every optional field null', () => {
    render(
      <IssuerHeader
        issuer={{
          name: 'Minimal School',
          name_bn: null,
          address: null,
          phone: null,
          email: null,
          registration_id: null,
          logo_key: null,
        }}
      />,
    );
    expect(screen.getByText('Minimal School')).toBeTruthy();
  });
});
