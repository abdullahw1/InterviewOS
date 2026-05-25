'use client';

/**
 * /question-bank
 *
 * CRUD UI for the authenticated user's Question_Bank entries plus
 * import (JSON or CSV) and export (canonical JSON download). Behavioral
 * entries get a STAR template in the answer editor (Requirement 6.6).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 20.6
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Plus, Trash2, Pencil, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

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
type QuestionType = (typeof QUESTION_TYPES)[number];

const DIFFICULTY_TIERS = ['Easy', 'Medium', 'Hard', 'Staff'] as const;
type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

interface Entry {
  id: string;
  questionType: QuestionType;
  prompt: string;
  modelAnswer: string;
  rubric: string | null;
  tags: string[];
  difficultyTier: DifficultyTier;
  createdAt: string;
  updatedAt: string;
}

const STAR_TEMPLATE = `Situation:\n\nTask:\n\nAction:\n\nResult:\n`;

function emptyDraft(): {
  questionType: QuestionType;
  prompt: string;
  modelAnswer: string;
  rubric: string;
  tags: string;
  difficultyTier: DifficultyTier;
} {
  return {
    questionType: 'Code_Tracing',
    prompt: '',
    modelAnswer: '',
    rubric: '',
    tags: '',
    difficultyTier: 'Medium',
  };
}

export default function QuestionBankPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [filterType, setFilterType] = useState<'all' | QuestionType>('all');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/question-bank');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      } else {
        toast.error('Failed to load question bank');
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => (filterType === 'all' ? entries : entries.filter((e) => e.questionType === filterType)),
    [entries, filterType]
  );

  function startEdit(entry: Entry) {
    setEditingId(entry.id);
    setDraft({
      questionType: entry.questionType,
      prompt: entry.prompt,
      modelAnswer: entry.modelAnswer,
      rubric: entry.rubric ?? '',
      tags: entry.tags.join(', '),
      difficultyTier: entry.difficultyTier,
    });
  }

  function startCreate() {
    setEditingId('new');
    setDraft(emptyDraft());
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyDraft());
  }

  async function save() {
    if (!draft.prompt.trim() || !draft.modelAnswer.trim()) {
      toast.error('Prompt and model answer are required');
      return;
    }
    setIsSaving(true);
    const payload = {
      questionType: draft.questionType,
      prompt: draft.prompt,
      modelAnswer: draft.modelAnswer,
      rubric: draft.rubric.trim() ? draft.rubric : null,
      tags: draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      difficultyTier: draft.difficultyTier,
    };
    try {
      const url = editingId === 'new' ? '/api/question-bank' : `/api/question-bank/${editingId}`;
      const method = editingId === 'new' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? 'Save failed');
        return;
      }
      toast.success('Saved');
      cancelEdit();
      await load();
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this entry?')) return;
    const res = await fetch(`/api/question-bank/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Deleted');
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } else {
      toast.error('Delete failed');
    }
  }

  function handleExport() {
    window.location.href = '/api/question-bank/export';
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json');
    const res = await fetch('/api/question-bank/import', {
      method: 'POST',
      headers: { 'content-type': isJson ? 'application/json' : 'text/csv' },
      body: text,
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(
        `Imported ${data.inserted ?? 0} entries${
          (data.rejected?.length ?? 0) > 0 ? ` (${data.rejected.length} rejected)` : ''
        }`
      );
      await load();
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error ?? 'Import failed');
    }
    if (importInputRef.current) importInputRef.current.value = '';
  }

  const isBehavioral = draft.questionType === 'Behavioral';

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Question Bank</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Your curated questions and model answers. Used by the grader to compare
            against your spoken answers.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleImportClick}>
            <Upload className="w-4 h-4 mr-2" />
            Import
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
            }}
          />
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button onClick={startCreate}>
            <Plus className="w-4 h-4 mr-2" />
            New Question
          </Button>
        </div>
      </div>

      {editingId ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId === 'new' ? 'New Question' : 'Edit Question'}</CardTitle>
            <CardDescription>
              {isBehavioral
                ? 'Behavioral answer uses the STAR template.'
                : 'Provide a model answer to grade your spoken responses against.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Question type</Label>
                <Select
                  value={draft.questionType}
                  onValueChange={(v) => {
                    const next = v as QuestionType;
                    setDraft((d) => ({
                      ...d,
                      questionType: next,
                      modelAnswer:
                        next === 'Behavioral' && !d.modelAnswer.trim()
                          ? STAR_TEMPLATE
                          : d.modelAnswer,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUESTION_TYPES.map((qt) => (
                      <SelectItem key={qt} value={qt}>
                        {qt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Difficulty</Label>
                <Select
                  value={draft.difficultyTier}
                  onValueChange={(v) =>
                    setDraft((d) => ({ ...d, difficultyTier: v as DifficultyTier }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTY_TIERS.map((dt) => (
                      <SelectItem key={dt} value={dt}>
                        {dt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Prompt</Label>
              <Textarea
                rows={3}
                value={draft.prompt}
                onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Model answer{isBehavioral ? ' (STAR)' : ''}</Label>
              <Textarea
                rows={isBehavioral ? 12 : 8}
                value={draft.modelAnswer}
                onChange={(e) => setDraft((d) => ({ ...d, modelAnswer: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>Rubric (optional)</Label>
              <Textarea
                rows={3}
                value={draft.rubric}
                onChange={(e) => setDraft((d) => ({ ...d, rubric: e.target.value }))}
                placeholder="Bullet points the grader should look for"
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                placeholder="systems, react, leadership"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save
              </Button>
              <Button variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between flex-wrap gap-2">
            <span>Entries</span>
            <div className="w-48">
              <Select
                value={filterType}
                onValueChange={(v) => setFilterType(v as typeof filterType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {QUESTION_TYPES.map((qt) => (
                    <SelectItem key={qt} value={qt}>
                      {qt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-500">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No entries yet.</p>
          ) : (
            <div className="space-y-3">
              {filtered.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 border rounded-lg flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="default">{entry.questionType}</Badge>
                      <Badge variant="outline">{entry.difficultyTier}</Badge>
                      {entry.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <p className="font-medium break-words">{entry.prompt}</p>
                    <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-wrap">
                      {entry.modelAnswer}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startEdit(entry)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(entry.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
