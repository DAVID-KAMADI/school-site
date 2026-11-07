import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerStorage } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthedRequest } from './decorators.js';

const USER_LIMITS = 'user_limits';

export interface UserLimit {
  /** Most requests allowed in the window. */
  limit: number;
  /** Window length in milliseconds. */
  ttl: number;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Limits how often one signed-in person may call this route, whatever network they are on.
 * Counting per person instead of per address matters for applicants: many apply from cyber cafés and
 * campus Wi-Fi, where a per-address limit would block everyone behind the same connection.
 * Every window must allow the request (e.g. 5 a minute *and* 40 a day).
 */
export const UserThrottle = (...limits: UserLimit[]) =>
  SetMetadata(USER_LIMITS, limits);

/**
 * Global guard, after the sign-in and permission guards: applies @UserThrottle limits to the signed-in user.
 * Runs before interceptors, so an upload over the limit is refused before the file is received.
 * Shares the throttler's storage, so limits reset when the API restarts (as the address-based ones do).
 */
@Injectable()
export class UserThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const limits = this.reflector.getAllAndOverride<UserLimit[] | undefined>(
      USER_LIMITS,
      [ctx.getHandler(), ctx.getClass()],
    );
    const http = ctx.switchToHttp();
    const userId = http.getRequest<AuthedRequest>().auth?.user.id;
    if (!limits?.length || userId == null) return true;
    const route = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    for (const { limit, ttl } of limits) {
      const name = `user-${ttl}`;
      // No block period: a sliding window, and refused attempts do not count.
      const { isBlocked, timeToBlockExpire } = await this.storage.increment(
        `${name}:${route}:${userId}`,
        ttl,
        limit,
        0,
        name,
      );
      if (isBlocked) {
        http
          .getResponse<Response>()
          .setHeader('Retry-After', String(Math.max(1, timeToBlockExpire)));
        throw new ThrottlerException(
          'You are doing that too often. Please wait a little and try again.',
        );
      }
    }
    return true;
  }
}
