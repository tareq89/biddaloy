import { describe, it, expect } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { HealthNotesInterceptor } from './health-notes.interceptor';

const run = (role: string | undefined, body: unknown) =>
  lastValueFrom(
    new HealthNotesInterceptor().intercept(
      {
        switchToHttp: () => ({
          getRequest: () => ({ currentTenant: role ? { role } : undefined }),
        }),
      } as never,
      { handle: () => of(body) },
    ),
  );

const embeds = () => ({
  data: [{ id: 'i1', student: { id: 's1', health_notes: 'asthma' } }],
  seat: { students: [{ health_notes: 'x' }] },
});

describe('HealthNotesInterceptor (D14)', () => {
  it.each(['ACCOUNTANT', 'PARENT', 'STUDENT'])(
    'strips health_notes for %s anywhere in the body',
    async (role) => {
      expect(JSON.stringify(await run(role, embeds()))).not.toContain('health_notes');
    },
  );
  it('strips it when there is no tenant context', async () => {
    expect(JSON.stringify(await run(undefined, embeds()))).not.toContain('health_notes');
  });
  it.each(['ADMIN', 'TEACHER'])('keeps it for %s', async (role) => {
    expect(JSON.stringify(await run(role, embeds()))).toContain('health_notes');
  });
  it('leaves a Buffer body alone', async () => {
    const b = Buffer.from('a');
    expect(await run('ACCOUNTANT', b)).toBe(b);
  });
});
