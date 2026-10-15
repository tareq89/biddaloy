import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { findDenied } from './demo-deny-list';

export const DEMO_UPLOAD_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Global guard for the public demo. With `DEMO_MODE` unset it is a pass-through, so the
 * deployment behaves exactly as before. With it on, it (1) refuses the deny-listed routes with 403 `DEMO_DISABLED` (D23, D42), and
 * (2) refuses multipart uploads over 2 MB with 413 `DEMO_UPLOAD_LIMIT` (D24).
 */
@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config.get<string>('DEMO_MODE') !== 'true') return true;
    if (context.getType() !== 'http') return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    if (findDenied(request.method, request.path)) {
      throw new ForbiddenException({
        message: 'Disabled in the demo',
        details: { code: 'DEMO_DISABLED' },
      });
    }

    const contentLength = request.headers['content-length'];
    const isMultipart = (request.headers['content-type'] ?? '')
      .toLowerCase()
      .startsWith('multipart/form-data');
    // A multipart body with no Content-Length (chunked) can't be measured, so it is refused.
    if (isMultipart && (!contentLength || Number(contentLength) > DEMO_UPLOAD_LIMIT_BYTES)) {
      throw new PayloadTooLargeException({
        message: 'Uploads are limited to 2 MB in the demo',
        details: { code: 'DEMO_UPLOAD_LIMIT' },
      });
    }
    return true;
  }
}
