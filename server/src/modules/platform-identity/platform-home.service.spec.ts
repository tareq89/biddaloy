import { describe, it, expect, vi } from 'vitest';
import { PlatformHomeService } from './platform-home.service';

describe('PlatformHomeService.id', () => {
  it('caches a hit but never a miss', async () => {
    const findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'school-1' });
    const ds = { getRepository: () => ({ findOne }) };
    const svc = new PlatformHomeService(ds as never);

    expect(await svc.id()).toBeUndefined();
    expect(await svc.id()).toBe('school-1');
    expect(await svc.id()).toBe('school-1');
    expect(findOne).toHaveBeenCalledTimes(2); // miss, hit, then served from cache
  });
});
