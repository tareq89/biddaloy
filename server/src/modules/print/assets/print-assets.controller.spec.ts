import { describe, it, expect } from 'vitest';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PrintAssetsController } from './print-assets.controller';

/**
 * Runs the real RolesGuard + PermissionsGuard against each route's real
 * decorator metadata. (Tenant header resolution itself is ContextGuard's job
 * and is covered by its own specs; here we assert it is in the chain and that
 * a missing tenant context is refused.)
 */
const reflector = new Reflector();
const roles = new RolesGuard(reflector);
const perms = new PermissionsGuard(reflector);
const proto = PrintAssetsController.prototype as unknown as Record<string, () => void>;

function ctx(handler: string, role: string | null): ExecutionContext {
  return {
    getHandler: () => proto[handler],
    getClass: () => PrintAssetsController,
    switchToHttp: () => ({
      getRequest: () => ({ currentTenant: role ? { id: 't', role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function allowed(handler: string, role: string | null): boolean {
  try {
    return roles.canActivate(ctx(handler, role)) && perms.canActivate(ctx(handler, role));
  } catch (e) {
    if (e instanceof UnauthorizedException || e instanceof ForbiddenException) return false;
    throw e;
  }
}

describe('PrintAssetsController guards', () => {
  it('runs ContextGuard (X-Tenant-ID resolution) before the role and permission guards', () => {
    const guards = Reflect.getMetadata('__guards__', PrintAssetsController) as unknown[];
    expect(guards.slice(1)).toEqual([ContextGuard, RolesGuard, PermissionsGuard]);
  });

  it.each(['upload', 'list', 'file', 'archive'])('%s refuses a missing tenant context', (h) => {
    expect(allowed(h, null)).toBe(false);
  });

  // Writes: ADMIN only (PRINT_TEMPLATE_MANAGE).
  it.each(['upload', 'archive'])(
    '%s allows ADMIN, denies ACCOUNTANT/TEACHER/PARENT/STUDENT',
    (h) => {
      expect(allowed(h, UserRole.ADMIN)).toBe(true);
      for (const r of [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT]) {
        expect(allowed(h, r)).toBe(false);
      }
    },
  );

  // Reads: DOCUMENT_PRINT holders — ADMIN and ACCOUNTANT (front office).
  it.each(['list', 'file'])(
    '%s allows ADMIN and ACCOUNTANT, denies TEACHER/PARENT/STUDENT',
    (h) => {
      expect(allowed(h, UserRole.ADMIN)).toBe(true);
      expect(allowed(h, UserRole.ACCOUNTANT)).toBe(true);
      for (const r of [UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT]) {
        expect(allowed(h, r)).toBe(false);
      }
    },
  );

  it('declares the intended permission on every route', () => {
    const perm = (h: string) => Reflect.getMetadata('permissions', proto[h]!);
    expect(perm('upload')).toEqual([Permission.PRINT_TEMPLATE_MANAGE]);
    expect(perm('archive')).toEqual([Permission.PRINT_TEMPLATE_MANAGE]);
    expect(perm('list')).toEqual([Permission.DOCUMENT_PRINT]);
    expect(perm('file')).toEqual([Permission.DOCUMENT_PRINT]);
  });

  it('file response carries immutable private caching, nosniff and a locked-down CSP', () => {
    const headers = Reflect.getMetadata('__headers__', proto.file!) as {
      name: string;
      value: string;
    }[];
    const get = (n: string) => headers.find((h) => h.name === n)?.value;
    expect(get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(get('X-Content-Type-Options')).toBe('nosniff');
    expect(get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });
});
