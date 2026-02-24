'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const [resumeText, setResumeText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchResume();
  }, []);

  const fetchResume = async () => {
    try {
      const res = await fetch('/api/resume');
      if (res.ok) {
        const data = await res.json();
        setResumeText(data.resumeText || '');
      }
    } catch (error) {
      console.error('Failed to fetch resume:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/resume', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText }),
      });

      if (!res.ok) {
        throw new Error('Failed to save');
      }

      toast.success('Resume saved successfully!');
    } catch (error) {
      toast.error('Failed to save resume');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage your profile and preferences
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Resume Text</CardTitle>
          <CardDescription>
            Add your resume text to get personalized feedback on missing signals during
            interview practice
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="resume">Resume Content</Label>
                <Textarea
                  id="resume"
                  placeholder="Paste your resume text here..."
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  rows={15}
                  className="font-mono text-sm"
                />
              </div>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Resume'
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
