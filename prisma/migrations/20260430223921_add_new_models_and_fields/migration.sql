-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN     "userId" TEXT NOT NULL,
ADD COLUMN     "vapiCallId" TEXT,
ADD COLUMN     "recordingUrl" TEXT,
ADD COLUMN     "callDuration" INTEGER;

-- CreateTable
CREATE TABLE "TeachBackSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "clarityScore" DOUBLE PRECISION NOT NULL,
    "accuracyScore" DOUBLE PRECISION NOT NULL,
    "depthScore" DOUBLE PRECISION NOT NULL,
    "communicationScore" DOUBLE PRECISION NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "feedback" JSONB NOT NULL,
    "vapiCallId" TEXT,
    "callDuration" INTEGER,
    "recordingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeachBackSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectQuizSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryNames" JSONB NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "weakAreas" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectQuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectQuizQuestion" (
    "id" TEXT NOT NULL,
    "quizSessionId" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "userAnswer" TEXT,
    "correctContext" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectQuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewSession_userId_idx" ON "InterviewSession"("userId");

-- CreateIndex
CREATE INDEX "TeachBackSession_userId_idx" ON "TeachBackSession"("userId");

-- CreateIndex
CREATE INDEX "ProjectQuizSession_userId_idx" ON "ProjectQuizSession"("userId");

-- CreateIndex
CREATE INDEX "ProjectQuizQuestion_quizSessionId_idx" ON "ProjectQuizQuestion"("quizSessionId");

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachBackSession" ADD CONSTRAINT "TeachBackSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectQuizSession" ADD CONSTRAINT "ProjectQuizSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectQuizQuestion" ADD CONSTRAINT "ProjectQuizQuestion_quizSessionId_fkey" FOREIGN KEY ("quizSessionId") REFERENCES "ProjectQuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
