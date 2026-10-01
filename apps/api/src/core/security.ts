import { createHmac, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '@paragon/shared';
import { env } from '../config/env.js';
import { AuthenticationError } from './errors.js';

// ---- Passwords (argon2id, OWASP-recommended parameters) --------------------------------------
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/** Used to spend comparable time when the user does not exist (prevents user enumeration by timing). */
let dummyHash: Promise<string> | null = null;
export async function verifyDummyPassword(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(await dummyHash, plain);
}

// ---- Access tokens (JWT, HS256) --------------------------------------------------------------
const ISSUER = 'paragon-api';
const AUDIENCE = 'paragon-web';

export interface AccessTokenClaims {
  sub: string;
  /** users.token_version at issue time; a mismatch invalidates the token. */
  tv: number;
}

export function signAccessToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ tv: tokenVersion } satisfies Omit<AccessTokenClaims, 'sub'>, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.tv !== 'number') {
      throw new AuthenticationError('Invalid token', ERROR_CODES.TOKEN_INVALID);
    }
    return { sub: payload.sub, tv: payload.tv };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Access token expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    if (err instanceof AuthenticationError) throw err;
    throw new AuthenticationError('Invalid token', ERROR_CODES.TOKEN_INVALID);
  }
}

// ---- Refresh tokens (opaque, stored only as HMAC) --------------------------------------------
export const REFRESH_COOKIE = 'paragon_rt';
export const REFRESH_COOKIE_PATH = '/api/auth';

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export function refreshCookieOptions(maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
}
