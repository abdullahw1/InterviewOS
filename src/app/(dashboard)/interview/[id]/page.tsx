import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, AlertTriangle, CheckCircle2, TrendingUp } from 'lucide-react';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

interface FeedbackData {
  scores: {
    clarity: number;
    structure: number;
    technical_depth: number;
    ownership: number;
    concision: number;
  };
  overall: number;
  red_flags: string[];
  missing_resume_signal: string[];
  improved_answer: string;
  followups: string[];
  drills: string[];
}

export default async function InterviewSessionPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await prisma.interviewSession.findUnique({
    where: { id: params.id },
  });

  if (!session) {
    notFound();
  }

  const feedback = session.feedback as unknown as FeedbackData;

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-600 dark:text-green-400';
    if (score >= 3) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreWidth = (score: number) => `${(score / 5) * 100}%`;

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
            <h1 className="text-2xl font-bold">Interview Session</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {new Date(session.createdAt).toLocaleDateString()} at{' '}
              {new Date(session.createdAt).toLocaleTimeString()}
            </p>
          </div>
        </div>
        <Link href="/interview">
          <Button variant="outline">Start New Interview</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Overall Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{feedback.overall.toFixed(1)}/5</div>
            <Badge className="mt-2" variant={feedback.overall >= 4 ? 'default' : 'secondary'}>
              {session.interviewType}
            </Badge>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Rubric Scores</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(feedback.scores).map(([key, value]) => (
              <div key={key}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="capitalize">{key.replace('_', ' ')}</span>
                  <span className={`font-medium ${getScoreColor(value)}`}>
                    {value.toFixed(1)}/5
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      value >= 4
                        ? 'bg-green-600'
                        : value >= 3
                        ? 'bg-yellow-600'
                        : 'bg-red-600'
                    }`}
                    style={{ width: getScoreWidth(value) }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Questions section removed - now using InterviewQuestion model */}

      <Card>
        <CardHeader>
          <CardTitle>Your Answer</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {session.transcript}
          </p>
        </CardContent>
      </Card>

      {feedback.red_flags.length > 0 && (
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="flex items-center text-red-600 dark:text-red-400">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Red Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-2">
              {feedback.red_flags.map((flag, idx) => (
                <li key={idx} className="text-gray-700 dark:text-gray-300">
                  {flag}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {feedback.missing_resume_signal.length > 0 && (
        <Card className="border-yellow-200 dark:border-yellow-800">
          <CardHeader>
            <CardTitle className="flex items-center text-yellow-600 dark:text-yellow-400">
              <TrendingUp className="w-5 h-5 mr-2" />
              Missing Resume Signals
            </CardTitle>
            <CardDescription>
              Consider mentioning these from your background
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc list-inside space-y-2">
              {feedback.missing_resume_signal.map((signal, idx) => (
                <li key={idx} className="text-gray-700 dark:text-gray-300">
                  {signal}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-green-200 dark:border-green-800">
        <CardHeader>
          <CardTitle className="flex items-center text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-5 h-5 mr-2" />
            Improved Answer
          </CardTitle>
          <CardDescription>
            Here's how you could strengthen your response
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {feedback.improved_answer}
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Follow-up Questions</CardTitle>
            <CardDescription>
              Be prepared for these potential follow-ups
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {feedback.followups.map((question, idx) => (
                <li
                  key={idx}
                  className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                >
                  {question}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Practice Drills</CardTitle>
            <CardDescription>Recommended areas to work on</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {feedback.drills.map((drill, idx) => (
                <li
                  key={idx}
                  className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
                >
                  {drill}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
