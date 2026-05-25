/**
 * Ownership and budget helpers shared by every drill/index endpoint.
 *
 * - `requireUser` returns the authenticated session user or throws an
 *   HttpError(401). Designed to be caught by route handlers and turned
 *   into a JSON response via `httpErrorResponse`.
 * - `assertProjectsOwnedBy` blocks any request that references a
 *   `Project` that does not belong to the current user.
 * - `getBudgetCaps` resolves the per-drill, per-day, and per-month spend
 *   ceilings from env, falling back to the documented defaults.
 *
 * See `.kiro/specs/project-interview-drills/design.md`
 * (Components > Server modules > `src/lib/access.ts`).
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * HTTP-shaped error that route handlers can convert to a NextResponse via
 * `httpErrorResponse`. Throw from helpers like `requireUser` and
 * `assertProjectsOwnedBy` instead of returning ad-hoc responses so callers
 * keep a single try/catch path.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

/**
 * Convert a thrown error into a JSON `NextResponse` when it is an
 * `HttpError`. Returns `null` for any other error so the caller can fall
 * back to its generic 500 handler.
 *
 * Usage:
 *   try {
 *     const user = await requireUser();
 *     ...
 *   } catch (err) {
 *     const httpResponse = httpErrorResponse(err);
 *     if (httpResponse) return httpResponse;
 *     throw err;
 *   }
 */
export function httpErrorResponse(error: unknown): NextResponse | null {
  if (isHttpError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export type SessionUser = {
  id: string;
  email: string;
};

/**
 * Resolve the authenticated user for the current request.
 *
 * The codebase uses NextAuth with the JWT session strategy, so the request
 * argument is unused at runtime. It is accepted to keep the surface
 * compatible with the per-task contract and to leave room for future
 * request-scoped checks (CSRF, header parsing, etc.).
 *
 * @throws {HttpError} 401 when the request is unauthenticated.
 */
export async function requireUser(_req?: NextRequest): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new HttpError(401, 'Unauthorized');
  }
  return {
    id: session.user.id,
    email: session.user.email,
  };
}

/**
 * Verify every supplied `Project.id` is owned by `userId`.
 *
 * Used by every endpoint that reads or mutates Projects, Drills, or
 * derived data (Cheatsheets, DrillQuestions). Empty input is a no-op so
 * callers can pass through unfiltered config payloads safely.
 *
 * @throws {HttpError} 403 when at least one project is missing or owned by
 *   a different user. The error message intentionally avoids leaking
 *   which specific id failed.
 */
export async function assertProjectsOwnedBy(
  userId: string,
  projectIds: readonly string[]
): Promise<void> {
  if (projectIds.length === 0) {
    return;
  }
  const uniqueIds = Array.from(new Set(projectIds));
  const owned = await prisma.project.findMany({
    where: { id: { in: uniqueIds }, userId },
    select: { id: true },
  });
  if (owned.length !== uniqueIds.length) {
    throw new HttpError(403, 'One or more projects do not belong to the current user');
  }
}

export type BudgetCaps = {
  /** Per-call ceiling. The orchestrator terminates a Vapi call at this many minutes. */
  maxDrillVapiMinutes: number;
  /** Daily Vapi minute ceiling across all calls for the user. */
  maxDailyVapiMinutes: number;
  /** Calendar-month spend ceiling across Vapi + OpenAI for drills. */
  maxMonthlyDrillCostUsd: number;
  /** Indexer halts a single Project at this much spend. */
  maxIndexCostUsdPerRepo: number;
  /** Text-drill engine ends the drill once combined LLM spend exceeds this. */
  maxTextDrillCostUsd: number;
};

/**
 * Defaults documented in
 * `.kiro/specs/project-interview-drills/tasks.md` ("Notes" section) and
 * `requirements.md` (Requirement 12). Override per environment via env.
 */
export const DEFAULT_BUDGET_CAPS: BudgetCaps = {
  maxDrillVapiMinutes: 20,
  maxDailyVapiMinutes: 60,
  maxMonthlyDrillCostUsd: 25.0,
  maxIndexCostUsdPerRepo: 0.1,
  maxTextDrillCostUsd: 0.5,
};

function parseNonNegativeNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === '') return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

/**
 * Read the budget caps from env, falling back to `DEFAULT_BUDGET_CAPS`.
 *
 * Invalid values (non-numeric, negative, NaN, Infinity) silently fall
 * back to the default so a typo cannot disable a cap.
 */
export function getBudgetCaps(): BudgetCaps {
  return {
    maxDrillVapiMinutes: parseNonNegativeNumber(
      process.env.MAX_DRILL_VAPI_MINUTES,
      DEFAULT_BUDGET_CAPS.maxDrillVapiMinutes
    ),
    maxDailyVapiMinutes: parseNonNegativeNumber(
      process.env.MAX_DAILY_VAPI_MINUTES,
      DEFAULT_BUDGET_CAPS.maxDailyVapiMinutes
    ),
    maxMonthlyDrillCostUsd: parseNonNegativeNumber(
      process.env.MAX_MONTHLY_DRILL_COST_USD,
      DEFAULT_BUDGET_CAPS.maxMonthlyDrillCostUsd
    ),
    maxIndexCostUsdPerRepo: parseNonNegativeNumber(
      process.env.MAX_INDEX_COST_USD_PER_REPO,
      DEFAULT_BUDGET_CAPS.maxIndexCostUsdPerRepo
    ),
    maxTextDrillCostUsd: parseNonNegativeNumber(
      process.env.MAX_TEXT_DRILL_COST_USD,
      DEFAULT_BUDGET_CAPS.maxTextDrillCostUsd
    ),
  };
}
