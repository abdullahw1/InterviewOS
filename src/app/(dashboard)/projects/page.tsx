'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Code2, CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface QuizQuestion {
  question: string;
  code_snippet: string;
  context: string;
}

interface QuizGrade {
  score: number;
  what_you_missed: string[];
  strong_points: string[];
  corrected_answer: string;
  followups: string[];
}

export default function ProjectsPage() {
  const [repos, setRepos] = useState<{ path: string; lastIndexed: Date }[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [isLoadingQuestion, setIsLoadingQuestion] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<QuizQuestion | null>(null);
  const [userAnswer, setUserAnswer] = useState('');
  const [isGrading, setIsGrading] = useState(false);
  const [grade, setGrade] = useState<QuizGrade | null>(null);

  useEffect(() => {
    fetchRepos();
  }, []);

  const fetchRepos = async () => {
    try {
      const res = await fetch('/api/index');
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos || []);
        if (data.repos.length > 0) {
          setSelectedRepo(data.repos[0].path);
        }
      }
    } catch (error) {
      console.error('Failed to fetch repos:', error);
    }
  };

  const generateQuestion = async () => {
    if (!selectedRepo) {
      toast.error('Please select a project');
      return;
    }

    setIsLoadingQuestion(true);
    setCurrentQuestion(null);
    setGrade(null);
    setUserAnswer('');

    try {
      const res = await fetch('/api/projects/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          projectName: selectedRepo,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to generate question');
      }

      const question = await res.json();
      setCurrentQuestion(question);
      toast.success('Question generated!');
    } catch (error: any) {
      toast.error(error.message || 'Failed to generate question');
    } finally {
      setIsLoadingQuestion(false);
    }
  };

  const submitAnswer = async () => {
    if (!userAnswer.trim()) {
      toast.error('Please provide an answer');
      return;
    }

    setIsGrading(true);

    try {
      const res = await fetch('/api/projects/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'grade',
          projectName: selectedRepo,
          question: currentQuestion?.question,
          codeSnippet: currentQuestion?.code_snippet,
          userAnswer,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to grade answer');
      }

      const gradeData = await res.json();
      setGrade(gradeData);
      toast.success('Answer graded!');
    } catch (error) {
      toast.error('Failed to grade answer');
    } finally {
      setIsGrading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return 'text-green-600 dark:text-green-400';
    if (score >= 3) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Project Drills</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Quiz yourself on your own codebase
          </p>
        </div>
        <Link href="/projects/index">
          <Button variant="outline">Manage Indexing</Button>
        </Link>
      </div>

      {repos.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No Projects Indexed</CardTitle>
            <CardDescription>
              Index your repositories first to start practicing
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/projects/index">
              <Button>Go to Indexing</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Select Project</CardTitle>
              <CardDescription>Choose a project to quiz yourself on</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((repo) => (
                      <SelectItem key={repo.path} value={repo.path}>
                        {repo.path.split('/').pop()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={generateQuestion}
                disabled={isLoadingQuestion || !selectedRepo}
                className="w-full"
              >
                {isLoadingQuestion ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Question...
                  </>
                ) : (
                  <>
                    <Code2 className="w-4 h-4 mr-2" />
                    Generate New Question
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {currentQuestion && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Question</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-gray-700 dark:text-gray-300">
                    {currentQuestion.question}
                  </p>
                  
                  <div>
                    <Label className="mb-2 block">Code Snippet:</Label>
                    <pre className="p-4 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto text-sm">
                      <code>{currentQuestion.code_snippet}</code>
                    </pre>
                  </div>

                  {!grade && (
                    <div className="space-y-2">
                      <Label htmlFor="answer">Your Answer</Label>
                      <Textarea
                        id="answer"
                        placeholder="Explain what this code does, its purpose, and any design patterns or architectural decisions..."
                        value={userAnswer}
                        onChange={(e) => setUserAnswer(e.target.value)}
                        rows={8}
                      />
                      <Button
                        onClick={submitAnswer}
                        disabled={isGrading || !userAnswer.trim()}
                        className="w-full"
                      >
                        {isGrading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Grading...
                          </>
                        ) : (
                          'Submit Answer'
                        )}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {grade && (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>Your Score</span>
                        <span className={`text-3xl font-bold ${getScoreColor(grade.score)}`}>
                          {grade.score.toFixed(1)}/5
                        </span>
                      </CardTitle>
                    </CardHeader>
                  </Card>

                  {grade.strong_points.length > 0 && (
                    <Card className="border-green-200 dark:border-green-800">
                      <CardHeader>
                        <CardTitle className="flex items-center text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-5 h-5 mr-2" />
                          Strong Points
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="list-disc list-inside space-y-2">
                          {grade.strong_points.map((point, idx) => (
                            <li key={idx} className="text-gray-700 dark:text-gray-300">
                              {point}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {grade.what_you_missed.length > 0 && (
                    <Card className="border-red-200 dark:border-red-800">
                      <CardHeader>
                        <CardTitle className="flex items-center text-red-600 dark:text-red-400">
                          <XCircle className="w-5 h-5 mr-2" />
                          What You Missed
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="list-disc list-inside space-y-2">
                          {grade.what_you_missed.map((point, idx) => (
                            <li key={idx} className="text-gray-700 dark:text-gray-300">
                              {point}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  <Card>
                    <CardHeader>
                      <CardTitle>Corrected Answer</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {grade.corrected_answer}
                      </p>
                    </CardContent>
                  </Card>

                  {grade.followups.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center">
                          <TrendingUp className="w-5 h-5 mr-2" />
                          Follow-up Questions
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-2">
                          {grade.followups.map((question, idx) => (
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
                  )}

                  <Button onClick={generateQuestion} className="w-full">
                    Try Another Question
                  </Button>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
