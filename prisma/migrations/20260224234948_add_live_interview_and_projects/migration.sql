/*
  Warnings:

  - You are about to drop the column `question` on the `InterviewSession` table. All the data in the column will be lost.
  - Added the required column `repoName` to the `ProjectChunk` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "InterviewSession" DROP COLUMN "question",
ADD COLUMN     "company" TEXT NOT NULL DEFAULT 'Unknown',
ADD COLUMN     "difficulty" TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN     "duration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "improvementAreas" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "skillScores" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "suggestions" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ProjectChunk" ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "repoName" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "InterviewQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "aiResponse" TEXT,
    "userResponse" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "feedback" TEXT NOT NULL,
    "timeSpent" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSummary" (
    "id" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "repoPath" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "techStack" JSONB NOT NULL,
    "highlights" JSONB NOT NULL,
    "embedding" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewQuestion_sessionId_idx" ON "InterviewQuestion"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSummary_repoName_key" ON "ProjectSummary"("repoName");

-- CreateIndex
CREATE INDEX "ProjectChunk_repoName_idx" ON "ProjectChunk"("repoName");

-- AddForeignKey
ALTER TABLE "InterviewQuestion" ADD CONSTRAINT "InterviewQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InterviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
