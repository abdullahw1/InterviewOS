import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, FolderGit2, Code2, Briefcase } from 'lucide-react';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function getDashboardStats() {
  const [interviewCount, projectChunkCount, leetcodeCount, jobCount] = await Promise.all([
    prisma.interviewSession.count(),
    prisma.projectChunk.count(),
    prisma.leetCodeEntry.count(),
    prisma.jobApplication.count(),
  ]);

  return {
    interviewCount,
    projectChunkCount,
    leetcodeCount,
    jobCount,
  };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const stats = await getDashboardStats();

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
      href: '/projects',
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
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Welcome back, {session?.user?.email?.split('@')[0]}!
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Your interview prep command center
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link key={feature.href} href={feature.href}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardHeader>
                  <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-lg ${feature.bgColor}`}>
                      <Icon className={`w-6 h-6 ${feature.color}`} />
                    </div>
                    <div>
                      <CardTitle>{feature.title}</CardTitle>
                      <CardDescription>{feature.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {feature.stat}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
