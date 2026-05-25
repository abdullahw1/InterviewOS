/**
 * /drill/[id] — Post-drill report
 *
 * Renders all persisted grading fields, voice metrics, weak areas,
 * remediation file paths, and a Markdown export action.
 *
 * Validates: Requirements 11.8, 11.9
 */

import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DrillReportActions } from '@/components/DrillReportActions';

type PageProps = { params: Promise<{ id: string }> };

function scoreColor(score: number): string {
  if (score >= 4) return 'text-green-600 dark:text-green-400';
  if (score >= 2.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ended: 'Completed',
    ended_by_budget_guard: 'Ended (budget)',
    cost_capped: 'Cost capped',
    transcript_partial: 'Partial transcript',
    failed: 'Failed',
  };
  return map[status] ?? status;
}

export default async function DrillReportPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) notFound();

  const { id } = await params;

  const drill = await prisma.drill.findUnique({
    where: { id },
    include: {
      questions: {
        include: { project: { select: { id: true, repoName: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!drill || drill.userId !== session.user.id) notFound();

  const config = drill.configJson as Record<string, unknown>;
  const vm = drill.voiceMetrics as Record<string, number> | null;
  const weakAreas = Array.isArray(drill.weakAreas)
    ? (drill.weakAreas as Array<{ topic: string; filePaths: string[]; projectId?: string }>)
    : [];
  const remediation = Array.isArray(drill.remediation)
    ? (drill.remediation as string[])
    : [];

  const gradedQuestions = drill.questions.filter((q) => q.score !== null);
  const answeredQuestions = drill.questions.filter((q) => q.userAnswer);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Drill Report</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {drill.mode} drill &middot;{' '}
            {new Date(drill.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={drill.status === 'ended' ? 'default' : 'secondary'}>
            {statusLabel(drill.status)}
          </Badge>
          <DrillReportActions drillId={drill.id} drill={drill} questions={drill.questions} />
        </div>
      </div>

      {/* Overall score */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Overall Score</CardDescription>
          </CardHeader>
          <CardContent>
            <p className={`text-3xl font-bold ${drill.overallScore !== null ? scoreColor(drill.overallScore) : 'text-muted-foreground'}`}>
              {drill.overallScore !== null ? `${drill.overallScore}/5.0` : '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Questions</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {gradedQuestions.length}/{answeredQuestions.length}
            </p>
            <p className="text-xs text-muted-foreground">graded</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Mode</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">{drill.mode}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {String(config.difficultyTier ?? '—')}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cost</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">${drill.costUsd.toFixed(3)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Voice metrics (Voice drills only) */}
      {vm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Voice Quality Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Filler Word Rate</p>
                <p className={`text-lg font-semibold ${(vm.fillerWordRate ?? 0) > 10 ? 'text-amber-600' : 'text-green-600'}`}>
                  {(vm.fillerWordRate ?? 0).toFixed(1)}%
                </p>
              </div>
              {vm.paceWPM !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Pace</p>
                  <p className="text-lg font-semibold">{vm.paceWPM} WPM</p>
                </div>
              )}
              {vm.voiceShakinessScore !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Steadiness</p>
                  <p className={`text-lg font-semibold ${(vm.voiceShakinessScore ?? 1) < 0.3 ? 'text-green-600' : 'text-amber-600'}`}>
                    {Math.round((1 - (vm.voiceShakinessScore ?? 0)) * 100)}%
                  </p>
                </div>
              )}
              {vm.toneConsistencyScore !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Tone Consistency</p>
                  <p className={`text-lg font-semibold ${(vm.toneConsistencyScore ?? 0) > 0.6 ? 'text-green-600' : 'text-amber-600'}`}>
                    {Math.round((vm.toneConsistencyScore ?? 0) * 100)}%
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-question breakdown */}
      {drill.questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Question Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {drill.questions.map((q, i) => (
              <div key={q.id} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground">Q{i + 1}</span>
                    <Badge variant="outline" className="text-xs">
                      {q.questionType.replace(/_/g, ' ')}
                    </Badge>
                    {q.project && (
                      <Badge variant="secondary" className="text-xs">
                        {q.project.repoName}
                      </Badge>
                    )}
                  </div>
                  {q.score !== null && (
                    <span className={`font-mono font-semibold text-sm ${scoreColor(q.score)}`}>
                      {q.score}/5.0
                    </span>
                  )}
                </div>

                <p className="text-sm font-medium">{q.prompt}</p>

                {Array.isArray(q.filePaths) && (q.filePaths as string[]).length > 0 && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {(q.filePaths as string[]).join(' · ')}
                  </p>
                )}

                {q.userAnswer && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Your answer
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap bg-muted/40 rounded p-3">
                      {q.userAnswer}
                    </p>
                  </details>
                )}

                {q.feedback && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded p-3">
                    <p className="text-xs font-medium mb-1 text-blue-700 dark:text-blue-300">
                      Feedback
                    </p>
                    <p className="text-sm">{q.feedback}</p>
                  </div>
                )}

                {q.modelAnswer && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Model answer
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap bg-muted/40 rounded p-3">
                      {q.modelAnswer}
                    </p>
                  </details>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Weak areas */}
      {weakAreas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weak Areas</CardTitle>
            <CardDescription>Topics to focus on for improvement</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {weakAreas.map((area, i) => (
              <div key={i} className="border rounded-lg p-3">
                <p className="font-medium text-sm">{area.topic}</p>
                {area.filePaths.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {area.filePaths.map((fp) => (
                      <code
                        key={fp}
                        className="text-xs bg-muted px-2 py-0.5 rounded font-mono"
                      >
                        {fp}
                      </code>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Remediation */}
      {remediation.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended Files to Review</CardTitle>
            <CardDescription>Ranked by relevance to your weak areas</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {remediation.map((fp, i) => (
                <li key={fp} className="flex items-center gap-3">
                  <span className="text-muted-foreground text-sm w-5 text-right">{i + 1}.</span>
                  <code className="text-sm font-mono bg-muted px-2 py-1 rounded flex-1">
                    {fp}
                  </code>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
