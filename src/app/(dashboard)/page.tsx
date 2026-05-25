import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, FolderGit2, Code2, Briefcase, DollarSign } from 'lucide-react';

async function getDashboardStats(userId: string) {
  const [interviewCount, projectChunkCount, leetcodeCount, jobCount, costRecords, recentDrills] = await Promise.all([
    prisma.interviewSession.count(),
    prisma.projectChunk.count(),
    prisma.leetCodeEntry.count(),
    prisma.jobApplication.count(),
    prisma.costRecord.findMany(),
    prisma.drill.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        mode: true,
        status: true,
        overallScore: true,
        createdAt: true,
        configJson: true,
      },
    }),
  ]);

  const totalCost = costRecords.reduce((sum: number, record: { estimatedCost: number }) => sum + record.estimatedCost, 0);

  return {
    interviewCount,
    projectChunkCount,
    leetcodeCount,
    jobCount,
    totalCost,
    recentDrills,
  };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const stats = await getDashboardStats(session?.user?.id ?? '');

  const features = [
    {
      title: 'Interview Practice',
      description: 'Record and get AI feedback on your interview answers',
      icon: MessageSquare,
      href: '/interview',
      stat: `${stats.interviewCount} sessions`,
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    },
    {
      title: 'Project Drills',
      description: 'Quiz yourself on your own codebase',
      icon: FolderGit2,
      href: '/drill/new',
      stat: `${stats.projectChunkCount} chunks indexed`,
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-900/20',
    },
    {
      title: 'LeetCode Tracker',
      description: 'Track problems with spaced repetition',
      icon: Code2,
      href: '/leetcode',
      stat: `${stats.leetcodeCount} problems`,
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-900/20',
    },
    {
      title: 'Job Hunt',
      description: 'Manage applications and generate follow-ups',
      icon: Briefcase,
      href: '/jobs',
      stat: `${stats.jobCount} applications`,
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    },
    {
      title: 'Cost Tracker',
      description: 'Monitor your OpenAI API usage and costs',
      icon: DollarSign,
      href: '/costs',
      stat: `$${stats.totalCost.toFixed(4)} spent`,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-50 dark:bg-red-900/20',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Welcome back, {session?.user?.email?.split('@')[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your interview prep command center
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.href} href={feature.href}>
              <Card className="hover:shadow-md transition-all hover:border-border/80 cursor-pointer h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-md ${feature.bgColor} flex-shrink-0`}>
                      <Icon className={`w-4 h-4 ${feature.color}`} />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold">{feature.title}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">{feature.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground font-mono">
                    {feature.stat}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {stats.recentDrills.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2">Recent Drills</h2>
          <div className="rounded-lg border divide-y">
            {stats.recentDrills.map((drill) => {
              const config = drill.configJson as Record<string, unknown>;
              const statusMap: Record<string, string> = {
                ended: 'Completed',
                in_progress: 'In Progress',
                pending: 'Pending',
                cost_capped: 'Cost Capped',
                failed: 'Failed',
              };
              return (
                <Link key={drill.id} href={`/drill/${drill.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-accent/50 transition-colors first:rounded-t-lg last:rounded-b-lg">
                  <div className="flex items-center gap-3">
                    <Badge variant={drill.mode === 'Voice' ? 'default' : 'secondary'} className="text-xs">
                      {drill.mode}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {String(config.difficultyTier ?? '')} &middot;{' '}
                      {new Date(drill.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {drill.overallScore !== null && (
                      <span className={`font-mono text-xs font-semibold ${
                        drill.overallScore >= 4 ? 'text-green-600' :
                        drill.overallScore >= 2.5 ? 'text-amber-600' : 'text-red-600'
                      }`}>
                        {drill.overallScore}/5.0
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {statusMap[drill.status] ?? drill.status}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
