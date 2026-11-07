import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorageService } from '@nestjs/throttler';
import { afterEach, describe, expect, it } from 'vitest';
import { MINUTE, UserThrottle, UserThrottleGuard } from './user-throttle.js';

class Routes {
  @UserThrottle({ limit: 3, ttl: MINUTE })
  upload() {}
  open() {}
}

const storage = new ThrottlerStorageService();
const guard = new UserThrottleGuard(new Reflector(), storage);

function ctx(handler: keyof Routes, userId: number | null) {
  const headers: Record<string, string> = {};
  const context = {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({
      getRequest: () => ({ auth: userId == null ? undefined : { user: { id: userId } } }),
      getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
    }),
  } as unknown as ExecutionContext;
  return { context, headers };
}

describe('UserThrottleGuard', () => {
  afterEach(() => storage.onApplicationShutdown());

  it('allows the limit, then refuses with Retry-After', async () => {
    for (let i = 0; i < 3; i++) expect(await guard.canActivate(ctx('upload', 1).context)).toBe(true);
    const { context, headers } = ctx('upload', 1);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ThrottlerException);
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
  });

  it('counts each person separately', async () => {
    for (let i = 0; i < 3; i++) await guard.canActivate(ctx('upload', 2).context);
    expect(await guard.canActivate(ctx('upload', 3).context)).toBe(true);
  });

  it('leaves routes without a limit, and signed-out requests, alone', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await guard.canActivate(ctx('open', 4).context)).toBe(true);
      expect(await guard.canActivate(ctx('upload', null).context)).toBe(true);
    }
  });
});
