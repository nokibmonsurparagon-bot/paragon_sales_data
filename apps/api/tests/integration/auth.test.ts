import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/core/db.js';
import { DEV_PASSWORD } from '../../prisma/seed-data.js';
import { api, bearer, resetDb, USERS } from '../helpers.js';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  const c = cookies?.find((x) => x.startsWith('paragon_rt='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
}

describe('authentication', () => {
  beforeAll(resetDb);

  it('logs in and returns permissions + HttpOnly refresh cookie', async () => {
    const res = await api().post('/api/auth/login').send({ email: USERS.sa, password: DEV_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, requestId: expect.any(String) });
    expect(res.body.data.user.permissions).toContain('SALES_ADMIN_APPROVE');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('paragon_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects bad credentials with a generic message and audits it', async () => {
    const res = await api().post('/api/auth/login').send({ email: USERS.ff1, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const unknown = await api().post('/api/auth/login').send({ email: 'nobody@paragon.local', password: 'x' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(res.body.error.message);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBeGreaterThanOrEqual(2);
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await api().post('/api/auth/login').send({ email: USERS.ff2, password: 'wrong' });
    const res = await api().post('/api/auth/login').send({ email: USERS.ff2, password: DEV_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    await prisma.user.update({ where: { email: USERS.ff2 }, data: { lockedUntil: null, failedLoginCount: 0 } });
  });

  it('validates input', async () => {
    const res = await api().post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('requires a token and rejects garbage tokens', async () => {
    expect((await api().get('/api/auth/me')).status).toBe(401);
    const res = await api().get('/api/auth/me').set(bearer('abc.def.ghi'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const login = await api().post('/api/auth/login').send({ email: USERS.accountant, password: DEV_PASSWORD });
    const first = refreshCookie(login);

    // CSRF header is mandatory on cookie-authenticated endpoints
    expect((await api().post('/api/auth/refresh').set('Cookie', first)).status).toBe(403);

    const r1 = await api().post('/api/auth/refresh').set('Cookie', first).set(CSRF);
    expect(r1.status).toBe(200);
    const second = refreshCookie(r1);
    expect(second).not.toBe(first);
    expect((await api().get('/api/auth/me').set(bearer(r1.body.data.accessToken))).status).toBe(200);

    // Reusing the first token revokes the whole family, including the second token.
    const reuse = await api().post('/api/auth/refresh').set('Cookie', first).set(CSRF);
    expect(reuse.status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', second).set(CSRF)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'TOKEN_REUSE_DETECTED' } })).toBeGreaterThanOrEqual(1);
  });

  it('logout revokes the session', async () => {
    const login = await api().post('/api/auth/login').send({ email: USERS.treasury, password: DEV_PASSWORD });
    const cookie = refreshCookie(login);
    expect((await api().post('/api/auth/logout').set('Cookie', cookie).set(CSRF)).status).toBe(200);
    expect((await api().post('/api/auth/refresh').set('Cookie', cookie).set(CSRF)).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'LOGOUT' } })).toBe(1);
  });

  it('disabling a user invalidates existing access tokens immediately', async () => {
    const ffLogin = await api().post('/api/auth/login').send({ email: USERS.ff2, password: DEV_PASSWORD });
    const token = ffLogin.body.data.accessToken;
    const adminLogin = await api().post('/api/auth/login').send({ email: USERS.admin, password: DEV_PASSWORD });
    const ff2 = await prisma.user.findUniqueOrThrow({ where: { email: USERS.ff2 } });
    const res = await api().patch(`/api/users/${ff2.id}`).set(bearer(adminLogin.body.data.accessToken)).send({ status: 'DISABLED' });
    expect(res.status).toBe(200);
    expect((await api().get('/api/auth/me').set(bearer(token))).status).toBe(401);
    await api().patch(`/api/users/${ff2.id}`).set(bearer(adminLogin.body.data.accessToken)).send({ status: 'ACTIVE' });
  });

  it('forces a password change for admin-issued passwords', async () => {
    const adminLogin = await api().post('/api/auth/login').send({ email: USERS.admin, password: DEV_PASSWORD });
    const adminToken = adminLogin.body.data.accessToken;
    const role = await prisma.role.findUniqueOrThrow({ where: { code: 'FIELD_FORCE' } });
    const created = await api()
      .post('/api/users')
      .set(bearer(adminToken))
      .send({ email: 'New.User@Paragon.local', fullName: 'New User', password: 'TempPass123', roleIds: [role.id] });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe('new.user@paragon.local');

    const l = await api().post('/api/auth/login').send({ email: 'new.user@paragon.local', password: 'TempPass123' });
    expect(l.body.data.user.mustChangePassword).toBe(true);
    const blocked = await api().get('/api/transactions').set(bearer(l.body.data.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await api()
      .post('/api/auth/change-password')
      .set(bearer(l.body.data.accessToken))
      .send({ currentPassword: 'TempPass123', newPassword: 'BrandNewPass456' });
    expect(changed.status).toBe(200);
    expect((await api().get('/api/transactions').set(bearer(changed.body.data.accessToken))).status).toBe(200);
  });
});
