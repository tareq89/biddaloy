import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { SchoolNotesController } from './school-notes.controller';
import { SchoolNotesService } from './school-notes.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const NOTE = '22222222-2222-4222-8222-222222222222';
const BASE = `/platform/schools/${SCHOOL}/notes`;

describe('SchoolNotesController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { list: vi.fn(), add: vi.fn(), remove: vi.fn() };
  const http = () => supertest(app.getHttpServer());

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.list.mockResolvedValue([]);
    svc.add.mockResolvedValue({ id: NOTE });
    svc.remove.mockResolvedValue(undefined);
    const mod = await Test.createTestingModule({
      controllers: [SchoolNotesController],
      providers: [{ provide: SchoolNotesService, useValue: svc }],
    })
      // The real cockpit-jwt strategy answers 401 for no token, a school-app token
      // (aud biddaloy:access) and an `imp` token; the stub stands for all three.
      .overrideGuard(AuthGuard('cockpit-jwt'))
      .useValue({
        canActivate: (c: ExecutionContext) => {
          if (!authed) throw new UnauthorizedException();
          c.switchToHttp().getRequest().user = { sub: 'owner-1' };
          return true;
        },
      })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('no usable cockpit token is 401 on every verb and nothing runs', async () => {
    authed = false;
    await http().get(BASE).expect(401);
    await http().post(BASE).send({ text: 'x' }).expect(401);
    await http().delete(`${BASE}/${NOTE}`).expect(401);
    expect(svc.list).not.toHaveBeenCalled();
    expect(svc.add).not.toHaveBeenCalled();
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('a non-UUID school id or note id is 400', async () => {
    await http().get('/platform/schools/nope/notes').expect(400);
    await http().post('/platform/schools/nope/notes').send({ text: 'x' }).expect(400);
    await http().delete(`/platform/schools/nope/notes/${NOTE}`).expect(400);
    await http().delete(`${BASE}/nope`).expect(400);
    expect(svc.remove).not.toHaveBeenCalled();
  });

  it('limit above 100, below 1 or non-numeric is 400; 100 passes', async () => {
    await http().get(`${BASE}?limit=101`).expect(400);
    await http().get(`${BASE}?limit=0`).expect(400);
    await http().get(`${BASE}?limit=abc`).expect(400);
    const ok = await http().get(`${BASE}?limit=100`).expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(svc.list).toHaveBeenCalledWith(SCHOOL, 100);
  });

  it('empty, whitespace-only, missing, non-string and 2001-char text is 400', async () => {
    const bad = [{ text: '' }, { text: '   \n\t' }, {}, { text: 5 }, { text: 'a'.repeat(2001) }];
    for (const body of bad) await http().post(BASE).send(body).expect(400);
    expect(svc.add).not.toHaveBeenCalled();
  });

  it('2000-char text passes and arrives trimmed, author from the token', async () => {
    await http()
      .post(BASE)
      .send({ text: 'a'.repeat(2000) })
      .expect(201);
    await http().post(BASE).send({ text: '  hello  ' }).expect(201);
    expect(svc.add).toHaveBeenLastCalledWith(SCHOOL, 'hello', 'owner-1', expect.any(Object));
  });

  it('delete is 204 and passes school, note and owner', async () => {
    await http().delete(`${BASE}/${NOTE}`).expect(204);
    expect(svc.remove).toHaveBeenCalledWith(SCHOOL, NOTE, 'owner-1', expect.any(Object));
  });
});
