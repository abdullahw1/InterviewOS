'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

type Project = {
  id: string;
  repoName: string;
  status: string;
};

const QUESTION_TYPES = [
  'Code_Tracing',
  'Modification',
  'Design_Rationale',
  'Debugging',
  'Tradeoffs',
  'Scaling',
  'Security',
  'Behavioral',
] as const;

const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard', 'Staff'] as const;
const PERSONAS = ['Friendly_Mentor', 'Staff_Engineer', 'Hostile', 'Startup_Founder'] as const;
const REPO_SCOPES = ['Single', 'Multi', 'Whole_Portfolio'] as const;
const DRILL_MODES = ['Text', 'Voice'] as const;

export default function NewDrillPage() {
  const router = useRouter();

  const [lengthMinutes, setLengthMinutes] = useState(15);
  const [questionCount, setQuestionCount] = useState(5);
  const [repoScope, setRepoScope] = useState<(typeof REPO_SCOPES)[number]>('Single');
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [difficultyTier, setDifficultyTier] = useState<(typeof DIFFICULTY_TIERS)[number]>('Medium');
  const [questionTypes, setQuestionTypes] = useState<(typeof QUESTION_TYPES)[number][]>(['Code_Tracing']);
  const [persona, setPersona] = useState<(typeof PERSONAS)[number]>('Friendly_Mentor');
  const [mode, setMode] = useState<(typeof DRILL_MODES)[number]>('Text');

  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch('/api/projects');
        if (res.ok) {
          const data = await res.json();
          setProjects(data.projects ?? []);
        }
      } catch {
        // silently fail
      } finally {
        setLoadingProjects(false);
      }
    }
    fetchProjects();
  }, []);

  const indexedProjects = projects.filter(
    (p) => p.status === 'indexed' || p.status === 'partial_indexed'
  );

  function toggleRepo(id: string) {
    setSelectedRepos((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  }

  function toggleQuestionType(qt: (typeof QUESTION_TYPES)[number]) {
    setQuestionTypes((prev) =>
      prev.includes(qt) ? prev.filter((t) => t !== qt) : [...prev, qt]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const payload = {
        lengthMinutes,
        questionCount,
        repoScope,
        selectedRepos: repoScope === 'Whole_Portfolio' ? [] : selectedRepos,
        difficultyTier,
        questionTypes,
        persona,
        mode,
      };

      const res = await fetch('/api/drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data.blockedRepos
          ? `${data.error}: ${data.blockedRepos.join(', ')}`
          : data.error || 'Failed to create drill';
        setError(msg);
        return;
      }

      const drillId = data.drill.id;
      if (data.drill.mode === 'Text') {
        router.push(`/drill/${drillId}/text`);
      } else {
        router.push(`/drill/${drillId}/voice`);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold">New Drill</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure and launch an interview drill session</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Mode */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">Mode</Label>
            <div className="flex gap-2">
              {DRILL_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-md text-sm font-medium border transition-colors ${
                    mode === m
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Core settings */}
        <Card>
          <CardHeader className="pb-3 pt-4">
            <CardTitle className="text-sm font-medium">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-4">
            {/* Difficulty + Persona row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Difficulty</Label>
                <Select value={difficultyTier} onValueChange={(v) => setDifficultyTier(v as typeof difficultyTier)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTY_TIERS.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Persona</Label>
                <Select value={persona} onValueChange={(v) => setPersona(v as typeof persona)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERSONAS.map((p) => (
                      <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Length slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Length</Label>
                <span className="text-xs font-mono text-muted-foreground">{lengthMinutes} min</span>
              </div>
              <input
                type="range"
                min={5} max={60} step={5}
                value={lengthMinutes}
                onChange={(e) => setLengthMinutes(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>5 min</span>
                <span>60 min</span>
              </div>
            </div>

            {/* Question count slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Questions</Label>
                <span className="text-xs font-mono text-muted-foreground">{questionCount}</span>
              </div>
              <input
                type="range"
                min={1} max={20} step={1}
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1</span>
                <span>20</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Question types */}
        <Card>
          <CardHeader className="pb-3 pt-4">
            <CardTitle className="text-sm font-medium">Question Types</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="grid grid-cols-2 gap-1.5">
              {QUESTION_TYPES.map((qt) => (
                <button
                  key={qt}
                  type="button"
                  onClick={() => toggleQuestionType(qt)}
                  className={`px-3 py-2 rounded-md text-xs font-medium border transition-colors text-left ${
                    questionTypes.includes(qt)
                      ? 'bg-primary/10 text-primary border-primary/30 dark:bg-primary/20'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground hover:bg-accent'
                  }`}
                >
                  {qt.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            {questionTypes.length === 0 && (
              <p className="text-xs text-destructive mt-2">Select at least one question type</p>
            )}
          </CardContent>
        </Card>

        {/* Repo scope */}
        <Card>
          <CardHeader className="pb-3 pt-4">
            <CardTitle className="text-sm font-medium">Repository Scope</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <Select
              value={repoScope}
              onValueChange={(v) => {
                setRepoScope(v as typeof repoScope);
                setSelectedRepos([]);
              }}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPO_SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {repoScope !== 'Whole_Portfolio' && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  {repoScope === 'Single' ? 'Pick exactly 1 repository' : 'Pick 2 or more repositories'}
                </p>
                {loadingProjects ? (
                  <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading projects…
                  </div>
                ) : indexedProjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No indexed projects.{' '}
                    <a href="/projects" className="underline hover:text-foreground">Index a project first.</a>
                  </p>
                ) : (
                  <div className="space-y-0.5 max-h-40 overflow-y-auto border rounded-md divide-y">
                    {indexedProjects.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRepos.includes(p.id)}
                          onChange={() => toggleRepo(p.id)}
                          className="rounded"
                        />
                        <span className="text-sm flex-1 truncate">{p.repoName}</span>
                        <span className="text-xs text-muted-foreground">{p.status}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {repoScope === 'Whole_Portfolio' && (
              <p className="text-xs text-muted-foreground">
                All indexed projects will be included automatically.
              </p>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={submitting || questionTypes.length === 0}
          className="w-full"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Creating Drill…
            </>
          ) : 'Start Drill'}
        </Button>
      </form>
    </div>
  );
}
