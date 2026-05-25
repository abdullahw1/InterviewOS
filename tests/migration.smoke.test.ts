/**
 * Migration smoke test for `20260525002400_project_drills_foundation`.
 *
 * Validates Requirements 19.1 and 19.2:
 *   - 19.1: When the new schema is first applied, a Project row is backfilled
 *           for every distinct legacy ProjectSummary.repoName (excluding the
 *           legacy parent-folder artifact).
 *   - 19.2: Any ProjectChunk row whose repoName equals 'all-defendai-repos'
 *           is deleted (and the matching ProjectSummary is also dropped).
 *
 * Strategy
 * --------
 * 1. Connect to TEST_DATABASE_URL (preferred) or DATABASE_URL.
 * 2. If neither is set or the database / pgvector is unreachable, skip the
 *    test cleanly so CI in environments without Postgres+pgvector does not
 *    fail.
 * 3. Create a dedicated Postgres schema and replay the legacy migrations
 *    (`init` through `convert_embeddings_to_pgvector`) inside it. This
 *    isolates the test from any real data and lets us seed the
 *    pre-migration shape exactly.
 * 4. Insert a User and three ProjectSummary rows including the legacy
 *    `all-defendai-repos` row, plus ProjectChunk rows for each.
 * 5. Snapshot row counts pre-migration.
 * 6. Apply `project_drills_foundation/migration.sql` to the same schema.
 * 7. Snapshot row counts post-migration and assert:
 *      - the legacy `all-defendai-repos` row is gone from ProjectSummary
 *        and ProjectChunk;
 *      - at least one Project row exists per remaining ProjectSummary.repoName
 *        for the seeded user;
 *      - a MigrationLog row named `project_drills_foundation` was recorded
 *        with the expected counts.
 * 8. Drop the schema in afterAll.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const CONNECTION_STRING =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || '';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');

// Migrations that produced the legacy schema we want to migrate FROM.
const LEGACY_MIGRATIONS = [
  '20260224222116_init',
  '20260224234948_add_live_interview_and_projects',
  '20260430223921_add_new_models_and_fields',
  '20260430224000_convert_embeddings_to_pgvector',
];

// The migration under test.
const TARGET_MIGRATION = '20260525002400_project_drills_foundation';

const LEGACY_REPO_NAME = 'all-defendai-repos';

function readMigrationSql(name: string): string {
  return fs.readFileSync(
    path.join(MIGRATIONS_DIR, name, 'migration.sql'),
    'utf8',
  );
}

async function withSearchPath<T>(
  client: PoolClient,
  schema: string,
  fn: () => Promise<T>,
): Promise<T> {
  // search_path must include public so that the pgvector type, gen_random_uuid,
  // etc. are resolvable from within the per-test schema.
  await client.query(`SET search_path TO "${schema}", public`);
  return await fn();
}

let pool: Pool | null = null;
let testSchema = '';
let setupSucceeded = false;
let skipReason: string | null = CONNECTION_STRING
  ? null
  : 'DATABASE_URL / TEST_DATABASE_URL not set';

beforeAll(async () => {
  if (!CONNECTION_STRING) return;

  pool = new Pool({
    connectionString: CONNECTION_STRING,
    // Keep the test connection pool small; everything runs sequentially.
    max: 2,
    // Fail fast if the DB is not reachable so we skip rather than hang.
    connectionTimeoutMillis: 5_000,
  });

  // Probe the database. If anything below throws, we skip the test.
  try {
    await pool.query('SELECT 1');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    // pgcrypto provides gen_random_uuid on older Postgres; harmless on PG13+.
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch (err) {
    skipReason = `Database probe failed: ${(err as Error).message}`;
    await pool.end().catch(() => {});
    pool = null;
    return;
  }

  testSchema = `iv_migr_test_${crypto.randomBytes(4).toString('hex')}`;

  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA "${testSchema}"`);
    // Replay the pre-foundation migrations inside the test schema so we have
    // a faithful legacy state to migrate from.
    for (const migration of LEGACY_MIGRATIONS) {
      const sql = readMigrationSql(migration);
      await withSearchPath(client, testSchema, async () => {
        await client.query(sql);
      });
    }
    setupSucceeded = true;
  } catch (err) {
    skipReason = `Replaying legacy migrations failed: ${(err as Error).message}`;
    // Best-effort cleanup so subsequent runs aren't blocked.
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    } catch {
      /* ignore */
    }
  } finally {
    client.release();
  }
});

afterAll(async () => {
  if (pool && testSchema) {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    } catch {
      /* ignore cleanup errors */
    }
  }
  if (pool) {
    await pool.end().catch(() => {});
  }
});

describe('project_drills_foundation migration', () => {
  it('backfills Projects from legacy ProjectSummary rows and removes the all-defendai-repos artifact', async (ctx) => {
    if (!CONNECTION_STRING || !pool) {
      console.warn(
        `[migration smoke] skipping — ${skipReason ?? 'database not configured'}`,
      );
      ctx.skip();
      return;
    }

    if (!setupSucceeded) {
      console.warn(
        `[migration smoke] skipping — ${skipReason ?? 'legacy migration replay did not complete'}`,
      );
      ctx.skip();
      return;
    }

    const client = await pool.connect();
    try {
      await withSearchPath(client, testSchema, async () => {
        // ------------------------------------------------------------------
        // Seed the legacy state.
        // ------------------------------------------------------------------
        const userId = `user_${crypto.randomBytes(4).toString('hex')}`;
        await client.query(
          `INSERT INTO "User" ("id", "email", "passwordHash", "updatedAt")
           VALUES ($1, $2, $3, NOW())`,
          [userId, `migration-smoke-${userId}@test.local`, 'hash'],
        );

        // Two real-looking repos plus the legacy parent-folder artifact.
        const summaries = [
          {
            id: 'sum_io',
            repoName: 'InterviewOS',
            repoPath: '/tmp/InterviewOS',
            description: 'Project A',
          },
          {
            id: 'sum_da',
            repoName: 'DefendAI-Backend',
            repoPath: '/tmp/DefendAI-Backend',
            description: 'Project B',
          },
          {
            id: 'sum_legacy',
            repoName: LEGACY_REPO_NAME,
            repoPath: '/tmp/all-defendai-repos',
            description: 'Legacy parent-folder artifact',
          },
        ];

        for (const s of summaries) {
          await client.query(
            `INSERT INTO "ProjectSummary"
              ("id", "repoName", "repoPath", "description", "techStack", "highlights", "updatedAt")
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())`,
            [
              s.id,
              s.repoName,
              s.repoPath,
              s.description,
              '["typescript"]',
              '["highlight"]',
            ],
          );
        }

        // Two chunks per repo, including the legacy artifact.
        const chunkRows: Array<[string, string, string, string, number, string]> = [
          ['chunk_io_1', 'InterviewOS', '/tmp/InterviewOS', 'src/index.ts', 0, 'export const a = 1;'],
          ['chunk_io_2', 'InterviewOS', '/tmp/InterviewOS', 'src/index.ts', 1, 'export const b = 2;'],
          ['chunk_da_1', 'DefendAI-Backend', '/tmp/DefendAI-Backend', 'app/main.py', 0, 'print("hi")'],
          ['chunk_da_2', 'DefendAI-Backend', '/tmp/DefendAI-Backend', 'app/main.py', 1, 'print("bye")'],
          ['chunk_legacy_1', LEGACY_REPO_NAME, '/tmp/all-defendai-repos', 'README.md', 0, 'legacy 1'],
          ['chunk_legacy_2', LEGACY_REPO_NAME, '/tmp/all-defendai-repos', 'README.md', 1, 'legacy 2'],
        ];
        for (const row of chunkRows) {
          await client.query(
            `INSERT INTO "ProjectChunk"
              ("id", "repoName", "repoPath", "filePath", "chunkIndex", "content")
             VALUES ($1, $2, $3, $4, $5, $6)`,
            row,
          );
        }

        // ------------------------------------------------------------------
        // Pre-migration snapshot.
        // ------------------------------------------------------------------
        const pre = await snapshotCounts(client);

        expect(pre.projectSummary).toBe(3);
        expect(pre.projectChunk).toBe(6);
        expect(pre.legacySummary).toBe(1);
        expect(pre.legacyChunks).toBe(2);
        // Project table doesn't exist yet; project count is reported as null
        // by snapshotCounts when the relation is missing.
        expect(pre.project).toBeNull();

        // ------------------------------------------------------------------
        // Apply the target migration.
        // ------------------------------------------------------------------
        const migrationSql = readMigrationSql(TARGET_MIGRATION);
        await client.query(migrationSql);

        // ------------------------------------------------------------------
        // Post-migration snapshot.
        // ------------------------------------------------------------------
        const post = await snapshotCounts(client);

        // 19.2 — legacy artifact rows are gone.
        expect(post.legacySummary).toBe(0);
        expect(post.legacyChunks).toBe(0);
        expect(post.projectSummary).toBe(2);
        expect(post.projectChunk).toBe(4);

        // 19.1 — at least one Project per remaining ProjectSummary.repoName.
        const remainingRepoNamesRes = await client.query<{ repoName: string }>(
          `SELECT "repoName" FROM "ProjectSummary" ORDER BY "repoName"`,
        );
        const remainingRepoNames = remainingRepoNamesRes.rows.map(
          (r) => r.repoName,
        );
        expect(remainingRepoNames).toEqual(
          ['DefendAI-Backend', 'InterviewOS'].sort(),
        );
        expect(remainingRepoNames).not.toContain(LEGACY_REPO_NAME);

        for (const repoName of remainingRepoNames) {
          const { rows } = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM "Project"
             WHERE "userId" = $1 AND "repoName" = $2`,
            [userId, repoName],
          );
          expect(Number(rows[0].count)).toBeGreaterThanOrEqual(1);
        }

        // No Project row exists for the legacy artifact.
        const { rows: legacyProjectRows } = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM "Project" WHERE "repoName" = $1`,
          [LEGACY_REPO_NAME],
        );
        expect(Number(legacyProjectRows[0].count)).toBe(0);

        // Each remaining ProjectSummary is linked to its Project via projectId.
        const linkRes = await client.query<{
          repoName: string;
          projectId: string | null;
          projectRepoName: string | null;
        }>(
          `SELECT ps."repoName" AS "repoName",
                  ps."projectId" AS "projectId",
                  p."repoName"   AS "projectRepoName"
           FROM "ProjectSummary" ps
           LEFT JOIN "Project" p ON p."id" = ps."projectId"
           ORDER BY ps."repoName"`,
        );
        for (const row of linkRes.rows) {
          expect(row.projectId).not.toBeNull();
          expect(row.projectRepoName).toBe(row.repoName);
        }

        // Each remaining ProjectChunk is linked to its Project via projectId.
        const orphanChunks = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM "ProjectChunk"
           WHERE "projectId" IS NULL`,
        );
        expect(Number(orphanChunks.rows[0].count)).toBe(0);

        // MigrationLog row exists with the expected counts.
        const logRes = await client.query<{ payload: Record<string, unknown> }>(
          `SELECT "payload" FROM "MigrationLog" WHERE "name" = $1`,
          ['project_drills_foundation'],
        );
        expect(logRes.rowCount).toBe(1);
        const payload = logRes.rows[0].payload;
        expect(payload.createdProjects).toBe(2);
        expect(payload.deletedChunks).toBe(2);
        expect(payload.deletedSummaries).toBe(1);
        expect(payload.backfillUserId).toBe(userId);
      });
    } finally {
      client.release();
    }
  });
});

interface CountsSnapshot {
  project: number | null;
  projectSummary: number;
  projectChunk: number;
  legacySummary: number;
  legacyChunks: number;
}

async function snapshotCounts(client: PoolClient): Promise<CountsSnapshot> {
  // The Project table only exists after the target migration runs, so we
  // tolerate "relation does not exist" pre-migration and report null.
  let project: number | null = null;
  try {
    const res = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "Project"`,
    );
    project = Number(res.rows[0].count);
  } catch (err) {
    if (!/does not exist/i.test((err as Error).message)) throw err;
  }

  const summaryRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "ProjectSummary"`,
  );
  const chunkRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "ProjectChunk"`,
  );
  const legacySummaryRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "ProjectSummary" WHERE "repoName" = $1`,
    [LEGACY_REPO_NAME],
  );
  const legacyChunksRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM "ProjectChunk" WHERE "repoName" = $1`,
    [LEGACY_REPO_NAME],
  );

  return {
    project,
    projectSummary: Number(summaryRes.rows[0].count),
    projectChunk: Number(chunkRes.rows[0].count),
    legacySummary: Number(legacySummaryRes.rows[0].count),
    legacyChunks: Number(legacyChunksRes.rows[0].count),
  };
}
