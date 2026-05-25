'use client';

/**
 * /settings
 *
 * Profile management. Adds Resume / LinkedIn import on top of the
 * existing free-text resume editor:
 *   - Upload PDF / DOCX / TXT resume (≤5 MB) -> parsed text persisted
 *     on `ResumeProfile.resumeText`.
 *   - LinkedIn URL plus pasted export (text or PDF) -> highlights array
 *     on `ResumeProfile.linkedinHighlights`.
 *   - Surfaces `parseError` so users see why parsing failed.
 *
 * Validates: Requirements 13.1 - 13.5, 20.6
 */

import { useEffect, useRef, useState } from 'react';
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
import { toast } from 'sonner';
import { Loader2, Upload } from 'lucide-react';

export default function SettingsPage() {
  const [resumeText, setResumeText] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [linkedinHighlights, setLinkedinHighlights] = useState<string[]>([]);
  const [linkedinPaste, setLinkedinPaste] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingLinkedin, setIsSavingLinkedin] = useState(false);
  const resumeFileRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/resume');
      if (res.ok) {
        const data = await res.json();
        setResumeText(data.resumeText ?? '');
        setLinkedinUrl(data.linkedinUrl ?? '');
        setLinkedinHighlights(Array.isArray(data.linkedinHighlights) ? data.linkedinHighlights : []);
        setParseError(data.parseError ?? null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSaveText() {
    setIsSaving(true);
    try {
      const res = await fetch('/api/resume', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText }),
      });
      if (res.ok) {
        toast.success('Resume saved');
        setParseError(null);
      } else {
        toast.error('Failed to save resume');
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResumeUpload(file: File) {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/resume', { method: 'POST', body: formData });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        toast.success('Resume uploaded');
        await load();
      } else if (res.ok && !body.ok) {
        toast.error(body.parseError ?? 'Resume parse failed');
        setParseError(body.parseError ?? 'Resume parse failed');
      } else {
        toast.error(body.error ?? `Upload failed (HTTP ${res.status})`);
      }
    } finally {
      setIsUploading(false);
      if (resumeFileRef.current) resumeFileRef.current.value = '';
    }
  }

  async function handleSaveLinkedin() {
    setIsSavingLinkedin(true);
    try {
      const formData = new FormData();
      formData.append('linkedinUrl', linkedinUrl);
      if (linkedinPaste.trim()) formData.append('pasted', linkedinPaste);
      const res = await fetch('/api/resume/linkedin', { method: 'POST', body: formData });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success('LinkedIn highlights saved');
        setLinkedinHighlights(body.linkedinHighlights ?? []);
        setLinkedinPaste('');
      } else {
        toast.error(body.error ?? 'Failed to save LinkedIn data');
      }
    } finally {
      setIsSavingLinkedin(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage your profile and import data the grader uses to personalize drills.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resume</CardTitle>
          <CardDescription>
            Upload a PDF, DOCX, or plain-text resume (up to 5 MB). The parsed text is
            included in Behavioral drill prompts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <Button onClick={() => resumeFileRef.current?.click()} disabled={isUploading}>
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  Upload resume
                </Button>
                <input
                  ref={resumeFileRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleResumeUpload(f);
                  }}
                />
                {parseError ? (
                  <span className="text-sm text-red-600 dark:text-red-400">
                    {parseError}
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="resume">Resume text</Label>
                <Textarea
                  id="resume"
                  placeholder="Paste your resume text here, or upload a file above."
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  rows={15}
                  className="font-mono text-sm"
                />
              </div>
              <Button onClick={handleSaveText} disabled={isSaving}>
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save text
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>LinkedIn</CardTitle>
          <CardDescription>
            Paste your LinkedIn URL and a copy of your About / Experience text.
            InterviewOS does not scrape LinkedIn directly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
            <Input
              id="linkedinUrl"
              type="url"
              placeholder="https://linkedin.com/in/your-handle"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkedinPaste">Paste highlights (one per line)</Label>
            <Textarea
              id="linkedinPaste"
              rows={10}
              placeholder={'Each line becomes one highlight.\ne.g. "Led a team of 5 building..."'}
              value={linkedinPaste}
              onChange={(e) => setLinkedinPaste(e.target.value)}
            />
          </div>
          {linkedinHighlights.length > 0 ? (
            <div className="text-xs text-gray-500">
              Stored {linkedinHighlights.length} highlight
              {linkedinHighlights.length === 1 ? '' : 's'}
            </div>
          ) : null}
          <Button onClick={handleSaveLinkedin} disabled={isSavingLinkedin}>
            {isSavingLinkedin ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save LinkedIn
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
