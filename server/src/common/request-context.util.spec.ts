import type { Request } from 'express';
import { resolveRequestId } from './request-context.util';

const req = (id?: unknown) =>
  ({ headers: id === undefined ? {} : { 'x-request-id': id } }) as unknown as Request;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('keeps a short plain id', () => {
    expect(resolveRequestId(req('req-1_ABC'))).toBe('req-1_ABC');
  });
  it('keeps an id of exactly 64 characters', () => {
    const id = 'a'.repeat(64);
    expect(resolveRequestId(req(id))).toBe(id);
  });
  it('replaces an id longer than 64 characters', () => {
    const id = 'a'.repeat(65);
    const out = resolveRequestId(req(id));
    expect(out).not.toBe(id);
    expect(out).toMatch(UUID);
  });
  it.each(['abc\ninjected', 'has space', 'a;b'])('replaces %j', (id) => {
    expect(resolveRequestId(req(id))).toMatch(UUID);
  });
  it('mints a UUID when empty or missing', () => {
    expect(resolveRequestId(req(''))).toMatch(UUID);
    expect(resolveRequestId(req())).toMatch(UUID);
  });
});
