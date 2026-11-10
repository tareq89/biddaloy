import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PublicSiteController } from './public-site.controller';

// Browsers reach /media/ straight through nginx, so a renamed school address must answer a real
// redirect (a Location header), not only the JSON body the site container reads (#3681).
function build(mediaFile: () => Promise<unknown>) {
  const site = { mediaFile: vi.fn(mediaFile) };
  const c = new PublicSiteController(site as never, {} as never, {} as never, {} as never);
  const res = { status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
  return { c, res, site };
}

describe('PublicSiteController media redirect', () => {
  it('a renamed school answers 301 with a Location on the new host, and the JSON body', async () => {
    const { c, res } = build(async () => ({ redirectTo: 'new.school.example' }));
    const out = await c.media('old.school.example', 'abc.webp', undefined, undefined, res as never);
    expect(res.status).toHaveBeenCalledWith(301);
    // Host comes only from the service's verified redirectTo; the key is URL-encoded.
    expect(res.setHeader).toHaveBeenCalledWith(
      'Location',
      'https://new.school.example/media/abc.webp',
    );
    expect(out).toEqual({ to: 'new.school.example' });
  });

  it('the key is URL-encoded so it cannot add a path or a header', async () => {
    const { c, res } = build(async () => ({ redirectTo: 'new.school.example' }));
    await c.media('old', 'a/b?c\r\nX: y', undefined, undefined, res as never);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Location',
      'https://new.school.example/media/a%2Fb%3Fc%0D%0AX%3A%20y',
    );
  });

  it('an unknown host is the one 404: no redirect status, no Location', async () => {
    const { c, res } = build(async () => {
      throw new NotFoundException();
    });
    await expect(
      c.media('nope', 'abc.webp', undefined, undefined, res as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalledWith('Location', expect.anything());
  });
});
