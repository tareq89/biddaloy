import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { findDenied } from './demo-deny-list';

export const DEMO_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Global guard for the public demo. With `DEMO_MODE` unset it is a pass-through, so the
 * deployment behaves exactly as before. With it on, it (1) marks every response noindex (D27),
 * (2) refuses the deny-listed routes with 403 `DEMO_DISABLED` (D23, D42), and
 * (3) refuses multipart uploads over 2 MB with 413 `DEMO_UPLOAD_LIMIT` (D24).
 */
@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('DEMO_MODE') !== 'true') return true;
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    http.getResponse<Response>().setHeader('X-Robots-Tag', 'noindex, nofollow');

    if (findDenied(request.method, request.path)) {
      throw new ForbiddenException({
        message: 'Disabled in the demo',
        details: { code: 'DEMO_DISABLED' },
      });
    }

    const contentLength = Number(request.headers['content-length'] ?? 0);
    const isMultipart = (request.headers['content-type'] ?? '').startsWith('multipart/form-data');
    if (isMultipart && contentLength > DEMO_UPLOAD_LIMIT_BYTES) {
      throw new PayloadTooLargeException({
        message: 'Uploads are limited to 2 MB in the demo',
        details: { code: 'DEMO_UPLOAD_LIMIT' },
      });
    }
    return true;
  }
}
