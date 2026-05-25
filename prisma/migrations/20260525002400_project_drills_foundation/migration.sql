-- ============================================================================
-- project_drills_foundation
--
-- Schema additions for the Project Interview Drills feature plus a one-time
-- backfill that converts the legacy single-row "all-defendai-repos" indexing
-- artifact into per-repository Project rows. Schema additions and backfill
-- run in a single transactional migration so the system never sees a partial
-- state.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Link ProjectChunk and ProjectSummary to a per-repository Project row.
--    The columns are nullable for the migration window; a follow-up migration
--    can NOT NULL them once all data is verified.
--
--    IF NOT EXISTS keeps the migration safe in case prior dev work already
--    added these columns ahead of the migration tracker.
-- ----------------------------------------------------------------------------
ALTER TABLE "ProjectChunk"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;

ALTER TABLE "ProjectSummary"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- ----------------------------------------------------------------------------
-- 2. New tables
-- ----------------------------------------------------------------------------

-- Project
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "ingestionSource" TEXT NOT NULL,
    "repoPath" TEXT,
    "cloneUrl" TEXT,
    "defaultBranch" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "partialReason" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "lastIndexedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- GitHubConnection
CREATE TABLE "GitHubConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedAccessToken" BYTEA NOT NULL,
    "scope" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubConnection_pkey" PRIMARY KEY ("id")
);

-- QuestionBankEntry
CREATE TABLE "QuestionBankEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "modelAnswer" TEXT NOT NULL,
    "rubric" TEXT,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "difficultyTier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionBankEntry_pkey" PRIMARY KEY ("id")
);

-- ResumeProfile
CREATE TABLE "ResumeProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resumeText" TEXT,
    "linkedinUrl" TEXT,
    "linkedinHighlights" JSONB NOT NULL DEFAULT '[]',
    "parseError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeProfile_pkey" PRIMARY KEY ("id")
);

-- Drill
CREATE TABLE "Drill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "configJson" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "vapiCallId" TEXT,
    "recordingUrl" TEXT,
    "transcript" TEXT,
    "transcriptStatus" TEXT NOT NULL DEFAULT 'none',
    "overallScore" DOUBLE PRECISION,
    "weakAreas" JSONB NOT NULL DEFAULT '[]',
    "remediation" JSONB NOT NULL DEFAULT '[]',
    "voiceMetrics" JSONB,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Drill_pkey" PRIMARY KEY ("id")
);

-- DrillQuestion
CREATE TABLE "DrillQuestion" (
    "id" TEXT NOT NULL,
    "drillId" TEXT NOT NULL,
    "projectId" TEXT,
    "questionType" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "modelAnswer" TEXT,
    "filePaths" JSONB NOT NULL DEFAULT '[]',
    "userAnswer" TEXT,
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrillQuestion_pkey" PRIMARY KEY ("id")
);

-- Cheatsheet
CREATE TABLE "Cheatsheet" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cheatsheet_pkey" PRIMARY KEY ("id")
);

-- Streak
CREATE TABLE "Streak" (
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastDrillDate" TIMESTAMP(3),

    CONSTRAINT "Streak_pkey" PRIMARY KEY ("userId")
);

-- MigrationLog
CREATE TABLE "MigrationLog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationLog_pkey" PRIMARY KEY ("id")
);

-- ----------------------------------------------------------------------------
-- 3. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX "Project_userId_idx" ON "Project"("userId");
CREATE UNIQUE INDEX "Project_userId_repoName_key" ON "Project"("userId", "repoName");

CREATE UNIQUE INDEX "GitHubConnection_userId_key" ON "GitHubConnection"("userId");

CREATE INDEX "QuestionBankEntry_userId_idx" ON "QuestionBankEntry"("userId");
CREATE INDEX "QuestionBankEntry_userId_questionType_idx" ON "QuestionBankEntry"("userId", "questionType");

CREATE UNIQUE INDEX "ResumeProfile_userId_key" ON "ResumeProfile"("userId");

CREATE INDEX "Drill_userId_idx" ON "Drill"("userId");
CREATE INDEX "Drill_userId_createdAt_idx" ON "Drill"("userId", "createdAt");

CREATE INDEX "DrillQuestion_drillId_idx" ON "DrillQuestion"("drillId");
CREATE INDEX "DrillQuestion_projectId_idx" ON "DrillQuestion"("projectId");

CREATE INDEX "Cheatsheet_projectId_idx" ON "Cheatsheet"("projectId");

CREATE UNIQUE INDEX "MigrationLog_name_key" ON "MigrationLog"("name");

CREATE INDEX "ProjectChunk_projectId_idx" ON "ProjectChunk"("projectId");
CREATE UNIQUE INDEX "ProjectSummary_projectId_key" ON "ProjectSummary"("projectId");

-- ----------------------------------------------------------------------------
-- 4. Foreign keys
-- ----------------------------------------------------------------------------
ALTER TABLE "Project"
  ADD CONSTRAINT "Project_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectChunk"
  ADD CONSTRAINT "ProjectChunk_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectSummary"
  ADD CONSTRAINT "ProjectSummary_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GitHubConnection"
  ADD CONSTRAINT "GitHubConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuestionBankEntry"
  ADD CONSTRAINT "QuestionBankEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResumeProfile"
  ADD CONSTRAINT "ResumeProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Drill"
  ADD CONSTRAINT "Drill_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DrillQuestion"
  ADD CONSTRAINT "DrillQuestion_drillId_fkey"
  FOREIGN KEY ("drillId") REFERENCES "Drill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DrillQuestion"
  ADD CONSTRAINT "DrillQuestion_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Cheatsheet"
  ADD CONSTRAINT "Cheatsheet_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Streak"
  ADD CONSTRAINT "Streak_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 5. Backfill legacy ProjectSummary/ProjectChunk into per-Project rows and
--    clear the parent-folder ("all-defendai-repos") bug.
--
--    All legacy data was indexed under the single-user development account.
--    We assign every backfilled Project to the oldest existing User. If no
--    User exists yet we still delete the legacy "all-defendai-repos" rows
--    and record zero counts.
-- ============================================================================
DO $$
DECLARE
  v_user_id          TEXT;
  v_created_count    INT := 0;
  v_deleted_chunks   INT := 0;
  v_deleted_summary  INT := 0;
BEGIN
  SELECT "id"
  INTO v_user_id
  FROM "User"
  ORDER BY "createdAt" ASC
  LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    -- Insert one Project row per distinct ProjectSummary.repoName, skipping
    -- the legacy parent-folder artifact. Per-repo file counts are derived
    -- from existing ProjectChunk rows.
    WITH src AS (
      SELECT DISTINCT ON (ps."repoName")
        ps."repoName"  AS repo_name,
        ps."repoPath"  AS repo_path,
        ps."createdAt" AS created_at,
        ps."updatedAt" AS updated_at
      FROM "ProjectSummary" ps
      WHERE ps."repoName" <> 'all-defendai-repos'
      ORDER BY ps."repoName", ps."createdAt" DESC
    ),
    file_counts AS (
      SELECT pc."repoName" AS repo_name, COUNT(DISTINCT pc."filePath")::int AS file_count
      FROM "ProjectChunk" pc
      WHERE pc."repoName" <> 'all-defendai-repos'
      GROUP BY pc."repoName"
    ),
    inserted AS (
      INSERT INTO "Project" (
        "id", "userId", "repoName", "ingestionSource", "repoPath",
        "status", "fileCount", "lastIndexedAt", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid()::text,
        v_user_id,
        s.repo_name,
        'local_path',
        s.repo_path,
        'indexed',
        COALESCE(fc.file_count, 0),
        s.updated_at,
        s.created_at,
        s.updated_at
      FROM src s
      LEFT JOIN file_counts fc ON fc.repo_name = s.repo_name
      RETURNING "id"
    )
    SELECT COUNT(*)::int INTO v_created_count FROM inserted;

    -- Link existing ProjectSummary rows to their new Project.
    UPDATE "ProjectSummary" ps
    SET "projectId" = p."id"
    FROM "Project" p
    WHERE p."userId"   = v_user_id
      AND p."repoName" = ps."repoName"
      AND ps."projectId" IS NULL
      AND ps."repoName" <> 'all-defendai-repos';

    -- Link existing ProjectChunk rows to their new Project.
    UPDATE "ProjectChunk" pc
    SET "projectId" = p."id"
    FROM "Project" p
    WHERE p."userId"   = v_user_id
      AND p."repoName" = pc."repoName"
      AND pc."projectId" IS NULL
      AND pc."repoName" <> 'all-defendai-repos';
  END IF;

  -- Clear the legacy parent-folder bug regardless of whether a user exists.
  DELETE FROM "ProjectChunk" WHERE "repoName" = 'all-defendai-repos';
  GET DIAGNOSTICS v_deleted_chunks = ROW_COUNT;

  DELETE FROM "ProjectSummary" WHERE "repoName" = 'all-defendai-repos';
  GET DIAGNOSTICS v_deleted_summary = ROW_COUNT;

  -- Capture migration counts so the UI can render a one-time summary banner.
  -- ON CONFLICT keeps the migration idempotent if it ever re-runs.
  INSERT INTO "MigrationLog" ("id", "name", "payload", "createdAt")
  VALUES (
    gen_random_uuid()::text,
    'project_drills_foundation',
    jsonb_build_object(
      'createdProjects',     v_created_count,
      'deletedChunks',       v_deleted_chunks,
      'deletedSummaries',    v_deleted_summary,
      'backfillUserId',      v_user_id
    ),
    NOW()
  )
  ON CONFLICT ("name") DO NOTHING;
END $$;
