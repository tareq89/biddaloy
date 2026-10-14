import type { NextFunction, Request, Response } from 'express';

/** D27: keeps the public demo out of search indexes. main.ts mounts it only when DEMO_MODE=true. */
export function demoNoindex(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
}
