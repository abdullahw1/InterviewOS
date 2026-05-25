'use client';

/**
 * Client component: Markdown export and grade-now actions on the drill report.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, BarChart2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type QuestionShape = {
  id: string;
  questionType: string;
  prompt: string;
  userAnswer: string | null;
  score: number | null;
  feedback: string | null;
  modelAnswer: string | null;
  filePaths: unknown;
};

type DrillShape = {
  id: string;
  mode: string;
  status: string;
  overallScore: number | null;
  weakAreas: unknown;
  remediation: unknown;
  voiceMetrics: unknown;
  costUsd: number;
  createdAt: Date;
};

interface Props {
  drillId: string;
  drill: DrillShape;
  questions: QuestionShape[];
}

function buildMarkdown(drill: DrillShape, questions: QuestionShape[]): string {
  const weakAreas = Array.isArray(drill.weakAreas)
    ? (drill.weakAreas as Array<{ topic: string; filePaths: string[] }>)
    : [];
  const remediation = Array.isArray(drill.remediation)
    ? (drill.remediation as string[])
    : [];
  const vm = drill.voiceMetrics as Record<string, number> | null;

  const lines: string[] = [
    `# Drill Report`,
    ``,
    `**Mode:** ${drill.mode}  `,
    `**Date:** ${new Date(drill.createdAt).toLocaleString()}  `,
    `**Status:** ${drill.status}  `,
    `**Overall Score:** ${drill.overallScore !== null ? `${drill.overallScore}/5.0` : 'N/A'}  `,
    `**Cost:** $${drill.costUsd.toFixed(3)}`,
    ``,
  ];

  if (vm) {
    lines.push(`## Voice Metrics`, ``);
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Filler Word Rate | ${(vm.fillerWordRate ?? 0).toFixed(1)}% |`);
    if (vm.paceWPM !== undefined) lines.push(`| Pace | ${vm.paceWPM} WPM |`);
    if (vm.voiceShakinessScore !== undefined)
      lines.push(`| Steadiness | ${Math.round((1 - vm.voiceShakinessScore) * 100)}% |`);
    if (vm.toneConsistencyScore !== undefined)
      lines.push(`| Tone Consistency | ${Math.round(vm.toneConsistencyScore * 100)}% |`);
    lines.push(``);
  }

  if (questions.length > 0) {
    lines.push(`## Questions`, ``);
    questions.forEach((q, i) => {
      lines.push(`### Q${i + 1}: ${q.questionType.replace(/_/g, ' ')}`);
      lines.push(``, q.prompt, ``);
      if (q.userAnswer) {
        lines.push(`**Your Answer:**`, ``, q.userAnswer, ``);
      }
      if (q.score !== null) lines.push(`**Score:** ${q.score}/5.0`, ``);
      if (q.feedback) lines.push(`**Feedback:** ${q.feedback}`, ``);
    });
  }

  if (weakAreas.length > 0) {
    lines.push(`## Weak Areas`, ``);
    weakAreas.forEach((wa, i) => {
      lines.push(`${i + 1}. **${wa.topic}**`);
      if (wa.filePaths?.length > 0) {
        lines.push(`   - Files: ${wa.filePaths.join(', ')}`);
      }
    });
    lines.push(``);
  }

  if (remediation.length > 0) {
    lines.push(`## Recommended Files to Review`, ``);
    remediation.forEach((fp, i) => lines.push(`${i + 1}. \`${fp}\``));
    lines.push(``);
  }

  return lines.join('\n');
}

export function DrillReportActions({ drillId, drill, questions }: Props) {
  const [grading, setGrading] = useState(false);

  function handleExport() {
    const md = buildMarkdown(drill, questions);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drill-${drillId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleGrade() {
    setGrading(true);
    try {
      const res = await fetch(`/api/drills/${drillId}/grade`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? 'Grading failed');
        return;
      }
      toast.success('Drill graded — refresh to see results');
      window.location.reload();
    } catch {
      toast.error('Network error while grading');
    } finally {
      setGrading(false);
    }
  }

  const isGraded = drill.overallScore !== null;

  return (
    <div className="flex items-center gap-2">
      {!isGraded && (
        <Button size="sm" variant="secondary" onClick={handleGrade} disabled={grading}>
          {grading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1" />
          ) : (
            <BarChart2 className="h-4 w-4 mr-1" />
          )}
          Grade Now
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={handleExport}>
        <Download className="h-4 w-4 mr-1" />
        Export Markdown
      </Button>
    </div>
  );
}
