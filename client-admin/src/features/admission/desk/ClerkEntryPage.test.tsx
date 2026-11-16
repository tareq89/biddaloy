import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ClerkEntryPage } from './ClerkEntryPage';

afterEach(async () => {
  await cleanupTestState();
});

const ROUND = {
  id: 'r1',
  title: 'Class 1',
  status: 'OPEN',
  fee_amount_paisa: 50000,
  fee_pay_methods: ['BKASH'],
  required_document_types: ['PHOTO'],
  form_fields: ['name', 'dob', 'gender', 'guardian_name', 'guardian_phone', 'quota_disabled'],
};

function setup(round: Record<string, unknown> = ROUND, warnings?: string[]) {
  // jsdom's File is not undici's, so the multipart body is read as raw text.
  const sent: { body?: string; key?: string | null } = {};
  server.use(
    http.get('/api/v1/admission-intakes', () => HttpResponse.json([round])),
    http.get('/api/v1/admission-intakes/r1', () => HttpResponse.json(round)),
    http.post('/api/v1/admission/applicants', async ({ request }) => {
      sent.body = await request.text();
      sent.key = request.headers.get('Idempotency-Key');
      return HttpResponse.json(
        { reference_number: 'ADM-77', status: 'FEE_PENDING', ...(warnings ? { warnings } : {}) },
        { status: 201 },
      );
    }),
  );
  renderWithRouter(createRootRoute({ component: ClerkEntryPage }), {
    initialEntries: ['/?round=r1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return sent;
}

async function fill() {
  await userEvent.type(await screen.findByLabelText(/Applicant name/), 'Karim');
  await userEvent.type(screen.getByLabelText(/Date of birth/), '2020-01-02');
  await userEvent.click(screen.getByRole('combobox', { name: /Gender/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Boy' }));
  await userEvent.type(screen.getByLabelText(/Guardian's name/), 'Rahim');
  await userEvent.type(screen.getByLabelText(/Guardian's phone/), '01712345678');
}

async function fee() {
  await userEvent.click(screen.getByRole('combobox', { name: /Sent by/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'bKash' }));
  await userEvent.type(screen.getByLabelText(/Payment reference/), 'TX1');
  await userEvent.upload(
    screen.getByLabelText(/Proof of payment/),
    new File(['x'], 'p.png', { type: 'image/png' }),
  );
}

describe('ClerkEntryPage', () => {
  it('draws the boxes the round ticked, plus the fee part for a fee round', async () => {
    setup();
    expect(await screen.findByLabelText(/Applicant name/)).toBeTruthy();
    expect(screen.getByLabelText(/Disabled/)).toBeTruthy();
    expect(screen.queryByLabelText(/Religion/)).toBeNull();
    expect(screen.getByLabelText(/Proof of payment/)).toBeTruthy();
  });

  it('hides the fee part when the round takes no fee', async () => {
    setup({ ...ROUND, fee_amount_paisa: null });
    await screen.findByLabelText(/Applicant name/);
    expect(screen.queryByLabelText(/Proof of payment/)).toBeNull();
  });

  it('shows required errors and sends nothing', async () => {
    const sent = setup();
    await screen.findByLabelText(/Applicant name/);
    await userEvent.click(screen.getByRole('button', { name: 'Save application' }));
    expect((await screen.findAllByText('This box must be filled.')).length).toBeGreaterThan(0);
    expect(sent.body).toBeUndefined();
  });

  it('Ctrl+Enter sends multipart with the right keys and an Idempotency-Key', async () => {
    const sent = setup();
    await fill();
    await fee();
    await userEvent.upload(
      screen.getByLabelText('Photo'),
      new File(['y'], 'k.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByLabelText(/Disabled/));
    await userEvent.type(screen.getByLabelText(/Payment reference/), '{Control>}{Enter}{/Control}');
    await waitFor(() => expect(sent.body).toBeDefined());
    const part = (name: string) =>
      new RegExp(
        `name="${name}"(?:; filename="[^"]*")?\\r\\n(?:[^\\r\\n]+\\r\\n)*\\r\\n([^\\r\\n]*)`,
      ).exec(sent.body!)?.[1];
    expect(part('intake_id')).toBe('r1');
    expect(part('applicant_name')).toBe('Karim');
    expect(part('date_of_birth')).toBe('2020-01-02');
    expect(part('gender')).toBe('MALE');
    expect(part('guardian_phone')).toBe('01712345678');
    expect(JSON.parse(part('extra_fields')!)).toEqual({ quota_disabled: true });
    expect(part('fee_method')).toBe('BKASH');
    expect(sent.body).toContain('name="fee_proof"; filename=');
    expect(sent.body).toContain('name="photo"; filename=');
    expect(sent.key).toBeTruthy();
    expect(await screen.findByText(/ADM-77/)).toBeTruthy();
    expect(screen.queryByText(/used before/)).toBeNull();
  });

  it('REFERENCE_SEEN shows a yellow note', async () => {
    setup(ROUND, ['REFERENCE_SEEN']);
    await fill();
    await fee();
    await userEvent.upload(
      screen.getByLabelText('Photo'),
      new File(['y'], 'k.png', { type: 'image/png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save application' }));
    expect(await screen.findByText(/used before/)).toBeTruthy();
  });

  it('has no "Add documents later" option: the server needs the required documents', async () => {
    setup();
    await fill();
    expect(screen.queryByLabelText('Add documents later')).toBeNull();
    expect(screen.getByLabelText('Photo')).toBeTruthy();
  });

  it('shows a round-loading failure with a retry button', async () => {
    server.use(
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([ROUND])),
      http.get('/api/v1/admission-intakes/r1', () => new HttpResponse(null, { status: 500 })),
    );
    renderWithRouter(createRootRoute({ component: ClerkEntryPage }), {
      initialEntries: ['/?round=r1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('ClerkEntryPage round switch', () => {
  it('starts the fee method over when the round changes', async () => {
    const other = { ...ROUND, id: 'r2', title: 'Class 2' };
    server.use(
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([ROUND, other])),
      http.get('/api/v1/admission-intakes/r1', () => HttpResponse.json(ROUND)),
      http.get('/api/v1/admission-intakes/r2', () => HttpResponse.json(other)),
    );
    renderWithRouter(createRootRoute({ component: ClerkEntryPage }), {
      initialEntries: ['/?round=r1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await screen.findByLabelText(/Applicant name/);
    await userEvent.click(screen.getByRole('combobox', { name: /Sent by/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'bKash' }));
    expect(screen.getByRole('combobox', { name: /Sent by/ }).textContent).toContain('bKash');
    await userEvent.click(screen.getByRole('combobox', { name: 'Admission round' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Class 2' }));
    await expect
      .poll(() => screen.getByRole('combobox', { name: /Sent by/ }).textContent)
      .not.toContain('bKash');
  });
});

describe('glossary: words the bn clerk and fee screens never say [Epic 71]', () => {
  const NEVER = [
    'ইনটেক',
    'ভেরিফিকেশন',
    'কনফার্ম',
    'রিজেক্ট',
    'অ্যাপ্রুভ',
    'পাইপলাইন',
    'ওয়ার্কফ্লো',
  ];
  const root = resolve(__dirname, '../../../../../ui/src/i18n/locales/bn');
  it('admission-desk.json has none', () => {
    const text = readFileSync(resolve(root, 'admission-desk.json'), 'utf8');
    expect(NEVER.filter((w) => text.includes(w))).toEqual([]);
  });
});
