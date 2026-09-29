/**
 * [38.4a] Rules tab list — #1120's own Tests list: rules render, a null
 * `class_id` shows "Whole school", an ACCOUNTANT without delete
 * permission sees no delete action, and the empty state.
 */
import type { FineRule } from '@biddaloy/ui/hooks';
import {
  academicYearFactory,
  cleanupTestState,
  renderWithProviders,
  server,
} from '@biddaloy/ui/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { RulesPanel } from './rules-panel';

function paginated<T>(rows: T[]) {
  return { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 };
}

const YEAR = academicYearFactory({ id: 'year-1', name: '2026-2027', is_current: true });

function fineRule(overrides: Partial<FineRule> = {}): FineRule {
  return {
    id: 'rule-1',
    academic_year_id: YEAR.id,
    trigger: 'ATTENDANCE_ABSENT',
    fee_structure_id: 'fee-1',
    fee_structure_name: 'Absence Fine',
    fee_structure_amount: 5000,
    class_id: null,
    class_name: null,
    free_per_period: 0,
    cap_per_period: null,
    conditions: {},
    is_active: true,
    created_by_user_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function referenceHandlers(rules: FineRule[]) {
  return [
    http.get('/api/v1/academic-years', () => HttpResponse.json(paginated([YEAR]))),
    http.get('/api/v1/fees/fine-rules', () => HttpResponse.json(rules)),
  ];
}

describe('fees/fines/-rules/rules-panel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists fine rules for the selected academic year', async () => {
    server.use(...referenceHandlers([fineRule({ id: 'rule-1', class_id: null })]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' });

    expect(await screen.findByText('Absence Fine — ৳৫০.০০')).toBeTruthy();
  });

  it('shows "Whole school" for a rule with a null class', async () => {
    server.use(...referenceHandlers([fineRule({ class_id: null, class_name: null })]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' });

    await waitFor(() => expect(screen.getAllByText('Whole school').length).toBeGreaterThan(0));
  });

  it('shows a class name when the rule is scoped to a class', async () => {
    server.use(
      ...referenceHandlers([
        fineRule({ id: 'rule-2', class_id: 'class-1', class_name: 'Class 6' }),
      ]),
    );
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' });

    expect(await screen.findByText('Class 6')).toBeTruthy();
  });

  it('hides the delete action for an ACCOUNTANT without FEE_STRUCTURE_DELETE', async () => {
    server.use(...referenceHandlers([fineRule()]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ACCOUNTANT', tenantId: 'tenant-1' });

    await screen.findByText('Absence Fine — ৳৫০.০০');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('renders the empty state when the year has no rules', async () => {
    server.use(...referenceHandlers([]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' });

    expect(
      await screen.findByText(
        'Add a rule to automatically fine students for absences or late arrivals.',
      ),
    ).toBeTruthy();
  });

  it('opens the create-rule dialog when "n" is pressed', async () => {
    server.use(...referenceHandlers([fineRule()]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' });

    await screen.findByText('Absence Fine — ৳৫০.০০');
    fireEvent.keyDown(document, { key: 'n' });

    expect(await screen.findByText('Add fine rule')).toBeTruthy();
  });

  it('does not open the create-rule dialog when "n" is pressed inside the academic-year picker', async () => {
    server.use(...referenceHandlers([fineRule()]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'ADMIN', tenantId: 'tenant-1' });

    await screen.findByText('Absence Fine — ৳৫০.০০');
    const picker = screen.getByRole('combobox', { name: 'Academic year' });
    picker.focus();
    fireEvent.keyDown(picker, { key: 'n' });

    expect(screen.queryByText('Add fine rule')).toBeNull();
  });

  it('shows no "Add rule" action in the empty state without FEE_STRUCTURE_CREATE', async () => {
    server.use(...referenceHandlers([]));
    renderWithProviders(<RulesPanel />, { locale: 'en', role: 'EXECUTIVE', tenantId: 'tenant-1' });

    await screen.findByText(
      'Add a rule to automatically fine students for absences or late arrivals.',
    );
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
  });
});
