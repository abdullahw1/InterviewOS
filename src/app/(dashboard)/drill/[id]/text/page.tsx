'use client';

/**
 * /drill/[id]/text — Text drill UI.
 *
 * Presents questions one at a time, accepts typed answers, persists each
 * DrillQuestion, and grades on submit. At the end, renders a "Promote to
 * Voice" action that creates a new Drill with Drill_Mode = Voice and the
 * same Drill_Config.
 *
 * Validates: Requirements 8.1–8.5
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronRight, Mic, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface DrillQuestion {
  id: string;
  questionType: string;
  prompt: string;
  modelAnswer: string | null;
  filePaths: string[];
  userAnswer: string | null;
  score: number | null;
  feedback: string | null;
}

interface DrillInfo {
  id: string;
  status: string;
  costUsd: number;
}

export default function TextDrillPage() {
  const params = useParams();
  const router = useRouter();
  const drillId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillInfo | null>(null);
  const [questions, setQuestions] = useState<DrillQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [grading, setGrading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDrill = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/drills/${drillId}/text`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to load drill');
        return;
      }

      setDrill(data.drill);
      setQuestions(data.questions);

      // Find the first unanswered question
      const firstUnanswered = data.questions.findIndex(
        (q: DrillQuestion) => q.userAnswer === null
      );
      if (firstUnanswered >= 0) {
        setCurrentIndex(firstUnanswered);
      } else if (data.questions.length > 0) {
        // All answered, show last one
        setCurrentIndex(data.questions.length - 1);
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [drillId]);

  useEffect(() => {
    fetchDrill();
  }, [fetchDrill]);

  const currentQuestion = questions[currentIndex] ?? null;

  const isComplete =
    questions.length > 0 && questions.every((q) => q.score !== null);

  const isCostCapped = drill?.status === 'cost_capped';

  async function handleSubmitAnswer() {
    if (!currentQuestion || !answer.trim()) return;

    setSubmitting(true);
    try {
      // Save the answer
      const saveRes = await fetch(`/api/drills/${drillId}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: currentQuestion.id,
          userAnswer: answer.trim(),
        }),
      });

      if (!saveRes.ok) {
        const data = await saveRes.json();
        toast.error(data.error || 'Failed to save answer');
        return;
      }

      // Update local state
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === currentQuestion.id ? { ...q, userAnswer: answer.trim() } : q
        )
      );

      // Grade the answer
      setAnswer('');
      setGrading(true);
      const gradeRes = await fetch(`/api/drills/${drillId}/text/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: currentQuestion.id }),
      });

      const gradeData = await gradeRes.json();

      if (gradeData.costCapped) {
        setDrill((prev) => (prev ? { ...prev, status: 'cost_capped' } : prev));
        toast.warning('Cost cap reached. Drill ended.');
      } else if (gradeRes.ok) {
        setQuestions((prev) =>
          prev.map((q) =>
            q.id === currentQuestion.id
              ? { ...q, score: gradeData.score, feedback: gradeData.feedback }
              : q
          )
        );
      } else {
        toast.error(gradeData.error || 'Grading failed — answer was saved, try refreshing.');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setSubmitting(false);
      setGrading(false);
    }
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setAnswer('');
    }
  }

  function handlePrev() {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setAnswer('');
    }
  }

  async function handlePromoteToVoice() {
    if (!drill) return;
    setPromoting(true);
    try {
      // End the current text drill first
      await fetch(`/api/drills/${drillId}/text/end`, {
        method: 'POST',
      }).catch(() => {});

      // Fetch the drill config to reuse
      const drillRes = await fetch(`/api/drills/${drillId}/text`);
      const drillData = await drillRes.json();
      const configJson = drillData.drill?.configJson;

      if (!configJson) {
        toast.error('Could not retrieve drill configuration');
        return;
      }

      // Create a new Voice drill with the same config
      const res = await fetch('/api/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...configJson,
          mode: 'Voice',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to create voice drill');
        return;
      }

      const data = await res.json();
      toast.success('Voice drill created!');
      router.push(`/drill/${data.drill.id}/voice`);
    } catch {
      toast.error('Failed to promote to voice');
    } finally {
      setPromoting(false);
    }
  }

  async function handleEndDrill() {
    if (!drill) return;
    try {
      // Compute overall score from graded questions
      const gradedQuestions = questions.filter((q) => q.score !== null);
      const overallScore =
        gradedQuestions.length > 0
          ? Math.round(
              (gradedQuestions.reduce((sum, q) => sum + (q.score ?? 0), 0) /
                gradedQuestions.length) *
                10
            ) / 10
          : null;

      await fetch(`/api/drills/${drillId}/text/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overallScore }),
      });

      toast.success('Drill completed!');
      router.push(`/drill/${drillId}`);
    } catch {
      toast.error('Failed to end drill');
    }
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Generating questions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
            <Button className="mt-4" onClick={() => router.push('/projects')}>
              Back to Projects
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto mt-12">
        <Card>
          <CardHeader>
            <CardTitle>No Questions Generated</CardTitle>
            <CardDescription>
              Make sure your projects are indexed and have code content.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push('/projects')}>
              Go to Projects
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Summary view when drill is complete or cost-capped
  if (isComplete || isCostCapped || drill?.status === 'ended') {
    const gradedQuestions = questions.filter((q) => q.score !== null);
    const overallScore =
      gradedQuestions.length > 0
        ? Math.round(
            (gradedQuestions.reduce((sum, q) => sum + (q.score ?? 0), 0) /
              gradedQuestions.length) *
              10
          ) / 10
        : null;

    return (
      <div className="max-w-3xl mx-auto mt-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              Text Drill {isCostCapped ? '(Cost Capped)' : 'Complete'}
            </CardTitle>
            <CardDescription>
              {overallScore !== null && (
                <span className="text-lg font-semibold">
                  Overall Score: {overallScore} / 5.0
                </span>
              )}
              {isCostCapped && (
                <span className="block text-sm text-amber-600 mt-1">
                  This drill was ended early because the cost cap was reached.
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions.map((q, i) => (
              <div key={q.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline">{q.questionType.replace(/_/g, ' ')}</Badge>
                  {q.score !== null && (
                    <span
                      className={`font-mono text-sm ${
                        q.score >= 3.5
                          ? 'text-green-600'
                          : q.score >= 2
                          ? 'text-amber-600'
                          : 'text-red-600'
                      }`}
                    >
                      {q.score}/5.0
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium mb-1">Q{i + 1}: {q.prompt}</p>
                {q.feedback && (
                  <p className="text-sm text-muted-foreground mt-2">{q.feedback}</p>
                )}
              </div>
            ))}

            <div className="flex gap-3 pt-4 border-t flex-wrap">
              <Button onClick={() => router.push(`/drill/${drillId}`)}>
                View Full Report
              </Button>
              <Button onClick={handlePromoteToVoice} disabled={promoting} variant="secondary">
                {promoting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Mic className="h-4 w-4 mr-2" />
                )}
                Promote to Voice
              </Button>
              <Button variant="outline" onClick={() => router.push('/')}>
                Back to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Active drill view — one question at a time
  return (
    <div className="max-w-3xl mx-auto mt-8 space-y-6">
      {/* Progress bar */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Question {currentIndex + 1} of {questions.length}
        </span>
        <span>
          {questions.filter((q) => q.score !== null).length} graded
        </span>
      </div>
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-primary rounded-full h-2 transition-all"
          style={{
            width: `${((currentIndex + 1) / questions.length) * 100}%`,
          }}
        />
      </div>

      {/* Question card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <Badge variant="outline">
              {currentQuestion?.questionType.replace(/_/g, ' ')}
            </Badge>
            {currentQuestion?.filePaths && currentQuestion.filePaths.length > 0 && (
              <span className="text-xs text-muted-foreground font-mono">
                {(currentQuestion.filePaths as string[]).join(', ')}
              </span>
            )}
          </div>
          <CardTitle className="text-lg mt-2">{currentQuestion?.prompt}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Show previous answer and grade if already answered */}
          {currentQuestion?.userAnswer && currentQuestion?.score !== null ? (
            <div className="space-y-3">
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm font-medium mb-1">Your Answer:</p>
                <p className="text-sm whitespace-pre-wrap">
                  {currentQuestion.userAnswer}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono font-semibold ${
                    currentQuestion.score >= 3.5
                      ? 'text-green-600'
                      : currentQuestion.score >= 2
                      ? 'text-amber-600'
                      : 'text-red-600'
                  }`}
                >
                  Score: {currentQuestion.score}/5.0
                </span>
              </div>
              {currentQuestion.feedback && (
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
                  <p className="text-sm font-medium mb-1">Feedback:</p>
                  <p className="text-sm">{currentQuestion.feedback}</p>
                </div>
              )}
              {currentQuestion.modelAnswer && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Show model answer
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
                    {currentQuestion.modelAnswer}
                  </p>
                </details>
              )}
            </div>
          ) : (
            /* Answer input */
            <div className="space-y-3">
              <textarea
                className="w-full min-h-[150px] p-3 border rounded-lg resize-y bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Type your answer here..."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={submitting || grading}
              />
              <Button
                onClick={handleSubmitAnswer}
                disabled={!answer.trim() || submitting || grading}
                className="w-full"
              >
                {submitting || grading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {grading ? 'Grading...' : 'Submitting...'}
                  </>
                ) : (
                  'Submit & Grade'
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={handlePrev}
          disabled={currentIndex === 0}
        >
          Previous
        </Button>

        <div className="flex gap-2">
          {questions.length > 0 && (
            <Button variant="secondary" onClick={handleEndDrill}>
              End Drill
            </Button>
          )}
          <Button
            onClick={handleNext}
            disabled={currentIndex === questions.length - 1}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}
