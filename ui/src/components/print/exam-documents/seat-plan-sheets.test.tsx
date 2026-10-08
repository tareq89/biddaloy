import { render as rtlRender, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN } from '../../../i18n/region-config';
import { RegionConfigProvider } from '../../../i18n/region-config-provider';
import type { IssuerSnapshot } from '../issuer-header';

import {
  InvigilatorSheet,
  SeatListSheet,
  SeatStickerSheet,
  type RoomSitting,
} from './seat-plan-sheets';

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

const render = (ui: React.ReactElement, region = REGION_BD_EN) =>
  rtlRender(<RegionConfigProvider value={region}>{ui}</RegionConfigProvider>);

const room = (name: string, n: number): RoomSitting => ({
  room: name,
  sitting: 'Sun 18 Oct · Bangla',
  invigilator: 'Mr Karim',
  rows: Array.from({ length: n }, (_, i) => ({
    seat: String(i + 1),
    roll: i + 1,
    name: `Student ${i + 1}`,
    section: 'A',
  })),
});

const base = {
  issuer: ISSUER,
  examName: 'Half Yearly',
  className: 'Class 6',
  printedOn: 'Printed 8 Oct',
};
const LIST = {
  room: 'Room',
  seats: 'Seats {{first}}–{{last}}',
  seat: 'Seat',
  roll: 'Roll',
  name: 'Name',
  section: 'Section',
  fromSeatPlan: 'Made from the seat plan',
  pageOf: 'Page {{page}} / {{total}}',
};
const INV = {
  room: 'Room',
  seat: 'Seat',
  roll: 'Roll',
  name: 'Name',
  section: 'Section',
  present: 'Present',
  scriptNo: 'Script no.',
  signature: 'Signature',
  invigilator: 'Invigilator',
};

describe('SeatListSheet', () => {
  it('draws one A4 page per room, 40 rows as two tables of 20, with the seat range', async () => {
    const { container } = render(
      <SeatListSheet {...base} pages={[room('101', 40), room('102', 10)]} labels={LIST} />,
    );
    expect(container.querySelectorAll('[data-slot="a4-document"]')).toHaveLength(2);
    const first = container.querySelector('[data-slot="a4-document"]') as HTMLElement;
    const tables = first.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    expect(tables[0]!.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(tables[1]!.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(screen.getByText('Seats 1–40')).toBeTruthy();
    expect(screen.getByText('Page 2 / 2')).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it('splits a room over 70 seats onto a second sheet and counts sheets', async () => {
    const { container } = render(
      <SeatListSheet {...base} pages={[room('101', 100), room('102', 10)]} labels={LIST} />,
    );
    const docs = container.querySelectorAll('[data-slot="a4-document"]');
    expect(docs).toHaveLength(3);
    expect(docs[0]!.querySelectorAll('tbody tr')).toHaveLength(70);
    expect(screen.getByText('Seats 1–70')).toBeTruthy();
    expect(screen.getByText('Seats 71–100')).toBeTruthy();
    // Both halves of room 101 keep a unique heading.
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Half Yearly - Room 101 (Seats 1–70)',
      'Half Yearly - Room 101 (Seats 71–100)',
      'Half Yearly - Room 102',
    ]);
    expect(screen.getByText('Page 3 / 3')).toBeTruthy();
    expect(docs[0]!.querySelectorAll('tbody th[scope="row"]')).toHaveLength(70);
    await expect(container).toHaveNoViolations();
  });

  it('prints Bangla digits under a bn region', () => {
    render(<SeatListSheet {...base} pages={[room('101', 4)]} labels={LIST} />, REGION_BD_BN);
    expect(screen.getByText('Seats ১–৪')).toBeTruthy();
    expect(screen.getByText('Page ১ / ১')).toBeTruthy();
  });

  it('renders no style element', () => {
    const { container } = render(
      <SeatListSheet {...base} pages={[room('101', 4)]} labels={LIST} />,
    );
    expect(container.querySelector('style')).toBeNull();
  });
});

describe('InvigilatorSheet', () => {
  it('has three blank columns and one signature line', async () => {
    const { container } = render(
      <InvigilatorSheet {...base} pages={[room('101', 5)]} labels={INV} />,
    );
    expect(container.querySelectorAll('thead th')).toHaveLength(7);
    expect(container.querySelectorAll('tbody tr:first-child td:empty')).toHaveLength(3);
    const sigs = container.querySelectorAll('[data-slot="a4-signature"]');
    expect(sigs).toHaveLength(1);
    expect(sigs[0]!.textContent).toBe('Invigilator');
    expect(container.querySelector('style')).toBeNull();
    await expect(container).toHaveNoViolations();
  });
});

describe('SeatStickerSheet', () => {
  it('chunks 45 stickers into 21 + 21 + 3 pages with roll, name, room and seat', async () => {
    const stickers = Array.from({ length: 45 }, (_, i) => ({
      seat: String(i + 1),
      roll: i + 1,
      name: `Student ${i + 1}`,
      section: 'A',
      className: 'Class 6',
      room: '101',
    }));
    const { container } = render(
      <SeatStickerSheet
        issuer={ISSUER}
        stickers={stickers}
        labels={{ roll: 'Roll', room: 'Room', seat: 'Seat' }}
      />,
    );
    const pages = container.querySelectorAll('[data-slot="seat-sticker-page"]');
    expect([...pages].map((p) => p.querySelectorAll('[data-slot="seat-sticker"]').length)).toEqual([
      21, 21, 3,
    ]);
    expect(screen.getByText('Student 45')).toBeTruthy();
    expect(screen.getAllByText('Room 101 · Seat 45')).toHaveLength(1);
    expect(container.querySelector('style')).toBeNull();
    await expect(container).toHaveNoViolations();
  });

  it('rounds perPage to whole rows of 3, at most 7 rows', () => {
    const stickers = Array.from({ length: 30 }, (_, i) => ({
      seat: String(i + 1),
      roll: i + 1,
      name: `Student ${i + 1}`,
      section: 'A',
      room: '101',
    }));
    const counts = (perPage: number) => {
      const { container, unmount } = render(
        <SeatStickerSheet
          issuer={ISSUER}
          stickers={stickers}
          perPage={perPage}
          labels={{ roll: 'Roll', room: 'Room', seat: 'Seat' }}
        />,
      );
      const pages = container.querySelectorAll('[data-slot="seat-sticker-page"]');
      const out = [...pages].map((p) => p.querySelectorAll('[data-slot="seat-sticker"]').length);
      unmount();
      return out;
    };
    expect(counts(10)).toEqual([9, 9, 9, 3]);
    expect(counts(24)).toEqual([21, 9]);
    expect(counts(0)).toEqual(Array(10).fill(3));
  });
});
