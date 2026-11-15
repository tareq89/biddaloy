import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Permission, roleHasPermission } from '@biddaloy/shared';

// Any depth (a depth cap would let a deeply nested health_notes through); `seen` makes cycles safe.
function strip(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const v of value) strip(v, seen);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  // Plain objects and class instances only: Buffers, Dates and streams pass untouched.
  if (
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    typeof (value as any).pipe === 'function'
  ) {
    return;
  }
  if (proto === null || typeof proto === 'object') {
    delete (value as { health_notes?: unknown }).health_notes;
    for (const v of Object.values(value)) strip(v, seen);
  }
}

/**
 * Decision D14 (#1218): `health_notes` reaches only callers holding STUDENT_RECORDS_READ.
 * One global net over every JSON response, so a new route that embeds a student (invoice,
 * seat plan, program enrolment, family portal, ...) can never leak it. `redactHealthNotes`
 * on the student routes stays as the first line.
 */
@Injectable()
export class HealthNotesInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const role = context.switchToHttp().getRequest<{ currentTenant?: { role?: string } }>()
      .currentTenant?.role;
    if (role && roleHasPermission(role, Permission.STUDENT_RECORDS_READ)) return next.handle();
    return next.handle().pipe(
      map((body) => {
        strip(body, new WeakSet());
        return body;
      }),
    );
  }
}
