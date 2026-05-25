-- Add Vapi-specific fields to CostRecord for 6.4 cost tracking
ALTER TABLE "CostRecord" ADD COLUMN IF NOT EXISTS "vapiCallId" TEXT;
ALTER TABLE "CostRecord" ADD COLUMN IF NOT EXISTS "callDurationSeconds" INTEGER;
ALTER TABLE "CostRecord" ADD COLUMN IF NOT EXISTS "vapiMinutes" DOUBLE PRECISION;

-- Indexes for time-windowed cost queries (6.4)
CREATE INDEX IF NOT EXISTS "CostRecord_feature_idx" ON "CostRecord"("feature");
CREATE INDEX IF NOT EXISTS "CostRecord_createdAt_idx" ON "CostRecord"("createdAt");
