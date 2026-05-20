-- Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Convert ProjectChunk.embedding from JSON to vector(1536)
ALTER TABLE "ProjectChunk" ADD COLUMN "embedding_vec" vector(1536);

UPDATE "ProjectChunk"
SET "embedding_vec" = "embedding"::text::vector
WHERE "embedding" IS NOT NULL;

ALTER TABLE "ProjectChunk" DROP COLUMN "embedding";
ALTER TABLE "ProjectChunk" RENAME COLUMN "embedding_vec" TO "embedding";

-- Convert ProjectSummary.embedding from JSON to vector(1536)
ALTER TABLE "ProjectSummary" ADD COLUMN "embedding_vec" vector(1536);

UPDATE "ProjectSummary"
SET "embedding_vec" = "embedding"::text::vector
WHERE "embedding" IS NOT NULL;

ALTER TABLE "ProjectSummary" DROP COLUMN "embedding";
ALTER TABLE "ProjectSummary" RENAME COLUMN "embedding_vec" TO "embedding";

-- Create HNSW indexes for efficient approximate nearest neighbor search
CREATE INDEX "idx_project_chunk_embedding" ON "ProjectChunk" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "idx_project_summary_embedding" ON "ProjectSummary" USING hnsw ("embedding" vector_cosine_ops);
