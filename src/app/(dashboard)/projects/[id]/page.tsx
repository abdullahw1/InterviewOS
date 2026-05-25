/**
 * /projects/[id] — Project detail + longitudinal weak-area view
 *
 * Aggregates weak areas across every Drill that targeted this Project,
 * letting the user see recurring knowledge gaps over time.
 *
 * Validates: Requirements 11.9
 */

import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import Link from 'next/link';

import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type PageProps = { params: Promise<{ id: string }> };

type WeakArea = { topic: string; filePaths: string[]; projectId?: string };

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'indexed') return 'default';
  if (status === 'partial_indexed') return 'secondary';
  if (status === 'failed') return 'destructive';
  return 'outline';
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) notFound();

  const { id } = await params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      summary: {
        select: { description: true, techStack: true, highlights: true },
      },
    },
  });

  if (!project || project.userId !== session.user.id) notFound();

  // Drills that have at least one question targeting this project
  const drills = await prisma.drill.findMany({
    where: {
      userId: session.user.id,
      questions: { some: { projectId: id } },
      status: { in: ['ended', 'ended_by_budget_guard', 'cost_capped'] },
    },
    include: {
      questions: {
        where: { projectId: id },
        select: { score: true, questionType: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  // Aggregate weak areas across all drills targeting this project
  const allWeakAreas = drills.flatMap((d) => {
    const areas = Array.isArray(d.weakAreas)
      ? (d.weakAreas as WeakArea[]).filter(
          (wa) => !wa.projectId || wa.projectId === id,
        )
      : [];
    return areas;
  });

  // Count topic frequency
  const topicFrequency = new Map<string, { count: number; filePaths: Set<string> }>();
  for (const wa of allWeakAreas) {
    const existing = topicFrequency.get(wa.topic) ?? { count: 0, filePaths: new Set() };
    existing.count += 1;
    for (const fp of wa.filePaths ?? []) existing.filePaths.add(fp);
    topicFrequency.set(wa.topic, existing);
  }

  const aggregatedWeakAreas = [...topicFrequency.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([topic, { count, filePaths }]) => ({
      topic,
      count,
      filePaths: [...filePaths],
    }));

  const techStack = Array.isArray(project.summary?.techStack)
    ? (project.summary.techStack as string[])
    : [];
  const highlights = Array.isArray(project.summary?.highlights)
    ? (project.summary.highlights as string[])
    : [];

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Back */}
      <div>
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="mb-2">
            ← Back to Projects
          </Button>
        </Link>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold">{project.repoName}</h1>
            <p className="text-muted-foreground text-sm">
              {project.ingestionSource} &middot;{' '}
              {project.fileCount} files indexed
            </p>
          </div>
          <Badge variant={statusVariant(project.status)} className="capitalize">
            {project.status.replace(/_/g, ' ')}
          </Badge>
        </div>
      </div>

      {/* Summary */}
      {project.summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{project.summary.description}</p>

            {techStack.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Tech Stack</p>
                <div className="flex flex-wrap gap-1">
                  {techStack.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {highlights.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Highlights</p>
                <ul className="text-sm space-y-1">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-muted-foreground">•</span>
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Drill history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drill History</CardTitle>
          <CardDescription>
            {drills.length === 0
              ? 'No completed drills for this project yet.'
              : `${drills.length} drill${drills.length !== 1 ? 's' : ''} completed`}
          </CardDescription>
        </CardHeader>
        {drills.length > 0 && (
          <CardContent>
            <div className="space-y-2">
              {drills.map((d) => {
                const projectQuestions = d.questions;
                const avgScore =
                  projectQuestions.length > 0 &&
                  projectQuestions.some((q) => q.score !== null)
                    ? Math.round(
                        (projectQuestions
                          .filter((q) => q.score !== null)
                          .reduce((s, q) => s + (q.score ?? 0), 0) /
                          projectQuestions.filter((q) => q.score !== null).length) *
                          10,
                      ) / 10
                    : null;

                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        {d.mode}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {projectQuestions.length} question{projectQuestions.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {avgScore !== null && (
                        <span className="text-sm font-mono font-semibold">
                          {avgScore}/5.0
                        </span>
                      )}
                      <Link href={`/drill/${d.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Longitudinal weak areas */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recurring Weak Areas</CardTitle>
          <CardDescription>
            {aggregatedWeakAreas.length === 0
              ? 'No weak areas identified yet — complete some drills!'
              : 'Topics that came up across multiple drills, ranked by frequency'}
          </CardDescription>
        </CardHeader>
        {aggregatedWeakAreas.length > 0 && (
          <CardContent className="space-y-3">
            {aggregatedWeakAreas.map(({ topic, count, filePaths }) => (
              <div key={topic} className="border rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-sm">{topic}</p>
                  <Badge variant="secondary" className="text-xs">
                    {count}× flagged
                  </Badge>
                </div>
                {filePaths.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {filePaths.slice(0, 5).map((fp) => (
                      <code
                        key={fp}
                        className="text-xs bg-muted px-2 py-0.5 rounded font-mono"
                      >
                        {fp}
                      </code>
                    ))}
                    {filePaths.length > 5 && (
                      <span className="text-xs text-muted-foreground">
                        +{filePaths.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
