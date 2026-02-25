import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

export default async function InterviewHistoryPage() {
  const sessions = await prisma.interviewSession.findMany({
    orderBy: { createdAt: 'desc' },
  });

  const avgScore =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + s.overallScore, 0) / sessions.length
      : 0;

  const getScoreTrend = (index: number) => {
    if (index === sessions.length - 1) return null;
    const current = sessions[index].overallScore;
    const previous = sessions[index + 1].overallScore;
    const diff = current - previous;
    
    if (diff > 0.2) return { icon: TrendingUp, color: 'text-green-600', text: `+${diff.toFixed(1)}` };
    if (diff < -0.2) return { icon: TrendingDown, color: 'text-red-600', text: diff.toFixed(1) };
    return { icon: Minus, color: 'text-gray-600', text: '~' };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/interview">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Interview History</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Track your progress over time
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Total Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{sessions.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Average Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{avgScore.toFixed(2)}/5</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {sessions.length > 0 ? sessions[0].overallScore.toFixed(2) : 'N/A'}/5
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Sessions</CardTitle>
          <CardDescription>Click on a session to view details</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No interview sessions yet. Start your first practice!
            </p>
          ) : (
            <div className="space-y-3">
              {sessions.map((session, index) => {
                const trend = getScoreTrend(index);
                const TrendIcon = trend?.icon;
                
                return (
                  <Link key={session.id} href={`/interview/${session.id}`}>
                    <div className="p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <Badge variant="outline">{session.interviewType}</Badge>
                            <span className="text-sm text-gray-600 dark:text-gray-400">
                              {new Date(session.createdAt).toLocaleDateString()}
                            </span>
                            {TrendIcon && (
                              <div className={`flex items-center text-sm ${trend.color}`}>
                                <TrendIcon className="w-4 h-4 mr-1" />
                                <span>{trend.text}</span>
                              </div>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                            {session.company} • {session.difficulty}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold">
                            {session.overallScore.toFixed(1)}
                          </div>
                          <div className="text-xs text-gray-500">/ 5</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
