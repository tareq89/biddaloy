import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { revenueWindow } from './revenue-month';

describe('revenueWindow', () => {
  it('starts and ends at Dhaka midnight (UTC+6)', () => {
    const w = revenueWindow('2026-03');
    expect(w.start.toISOString()).toBe('2026-02-28T18:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-31T18:00:00.000Z');
  });
  it('December rolls into January of the next year', () => {
    const w = revenueWindow('2026-12');
    expect(w.start.toISOString()).toBe('2026-11-30T18:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });
  it('January starts at the previous December evening UTC', () => {
    expect(revenueWindow('2027-01').start.toISOString()).toBe('2026-12-31T18:00:00.000Z');
  });
  it('defaults to the current month', () => {
    expect(revenueWindow().month).toMatch(/^\d{4}-\d{2}$/);
  });
  it('rejects month 13', () => {
    expect(() => revenueWindow('2026-13')).toThrow(BadRequestException);
  });
  it('rejects month 00', () => {
    expect(() => revenueWindow('2026-00')).toThrow(BadRequestException);
  });
  it('rejects one-digit month', () => {
    expect(() => revenueWindow('2026-1')).toThrow(BadRequestException);
  });
  it('rejects two-digit year', () => {
    expect(() => revenueWindow('26-01')).toThrow(BadRequestException);
  });
  it('rejects a full date', () => {
    expect(() => revenueWindow('2026-01-01')).toThrow(BadRequestException);
  });
  it('rejects empty', () => {
    expect(() => revenueWindow('')).toThrow(BadRequestException);
  });
  it('rejects leading space', () => {
    expect(() => revenueWindow(' 2026-01')).toThrow(BadRequestException);
  });
  it('rejects letters', () => {
    expect(() => revenueWindow('abcd-ef')).toThrow(BadRequestException);
  });
});
