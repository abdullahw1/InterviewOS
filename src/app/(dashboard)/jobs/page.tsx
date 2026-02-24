'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Download, Mail, Trash2, Calendar, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

interface JobApplication {
  id: string;
  company: string;
  role: string;
  stage: string;
  url: string | null;
  notes: string | null;
  followUpDate: Date | null;
  appliedDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

const STAGES = [
  'Applied',
  'Phone Screen',
  'Technical',
  'Onsite',
  'Offer',
  'Rejected',
  'Withdrawn',
];

export default function JobsPage() {
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [groupedApplications, setGroupedApplications] = useState<Record<string, JobApplication[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [followUpDialog, setFollowUpDialog] = useState<{ open: boolean; appId: string | null; variants: any[] }>({
    open: false,
    appId: null,
    variants: [],
  });
  const [isGeneratingFollowUp, setIsGeneratingFollowUp] = useState(false);

  // Form state
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [stage, setStage] = useState('Applied');
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  useEffect(() => {
    fetchApplications();
  }, []);

  const fetchApplications = async () => {
    try {
      const [allRes, groupedRes] = await Promise.all([
        fetch('/api/jobs'),
        fetch('/api/jobs?groupByStage=true'),
      ]);

      if (allRes.ok && groupedRes.ok) {
        const all = await allRes.json();
        const grouped = await groupedRes.json();
        setApplications(all);
        setGroupedApplications(grouped);
      }
    } catch (error) {
      console.error('Failed to fetch applications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company,
          role,
          stage,
          url: url || null,
          notes: notes || null,
          followUpDate: followUpDate || null,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to add application');
      }

      toast.success('Application added successfully!');
      setIsDialogOpen(false);
      resetForm();
      fetchApplications();
    } catch (error) {
      toast.error('Failed to add application');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setCompany('');
    setRole('');
    setStage('Applied');
    setUrl('');
    setNotes('');
    setFollowUpDate('');
  };

  const generateFollowUp = async (appId: string) => {
    setIsGeneratingFollowUp(true);
    setFollowUpDialog({ open: true, appId, variants: [] });

    try {
      const res = await fetch('/api/jobs/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobApplicationId: appId }),
      });

      if (!res.ok) {
        throw new Error('Failed to generate follow-up');
      }

      const data = await res.json();
      setFollowUpDialog({ open: true, appId, variants: data.variants });
      toast.success('Follow-up messages generated!');
    } catch (error) {
      toast.error('Failed to generate follow-up messages');
      setFollowUpDialog({ open: false, appId: null, variants: [] });
    } finally {
      setIsGeneratingFollowUp(false);
    }
  };

  const deleteApplication = async (id: string) => {
    if (!confirm('Are you sure you want to delete this application?')) return;

    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete');
      }

      toast.success('Application deleted');
      fetchApplications();
    } catch (error) {
      toast.error('Failed to delete application');
    }
  };

  const exportToCSV = async () => {
    try {
      const res = await fetch('/api/jobs/export');
      if (!res.ok) {
        throw new Error('Failed to export');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `job-applications-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Applications exported!');
    } catch (error) {
      toast.error('Failed to export applications');
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'Applied': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'Phone Screen': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'Technical': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'Onsite': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'Offer': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'Rejected': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'Withdrawn': return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const getDueToday = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return applications.filter(app => {
      if (!app.followUpDate) return false;
      const followUp = new Date(app.followUpDate);
      followUp.setHours(0, 0, 0, 0);
      return followUp <= today;
    });
  };

  const getThisWeekCount = () => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return applications.filter(app => new Date(app.appliedDate) >= weekAgo).length;
  };

  const getTodayCount = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return applications.filter(app => {
      const applied = new Date(app.appliedDate);
      applied.setHours(0, 0, 0, 0);
      return applied.getTime() === today.getTime();
    }).length;
  };

  const dueToday = getDueToday();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Job Hunt Tracker</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Manage applications and generate follow-ups
          </p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Application
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add Job Application</DialogTitle>
                <DialogDescription>
                  Track a new job application
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="company">Company *</Label>
                  <Input
                    id="company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Google"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Role *</Label>
                  <Input
                    id="role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Software Engineer"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stage">Stage *</Label>
                  <Select value={stage} onValueChange={setStage}>
                    <SelectTrigger id="stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">Job URL</Label>
                  <Input
                    id="url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="followUp">Follow-up Date</Label>
                  <Input
                    id="followUp"
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Contact: John Doe, Referral from..."
                    rows={3}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Application'
                  )}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Applied Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{getTodayCount()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>This Week</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{getThisWeekCount()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow-ups Due</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dueToday.length}</div>
          </CardContent>
        </Card>
      </div>

      {dueToday.length > 0 && (
        <Card className="border-orange-200 dark:border-orange-800">
          <CardHeader>
            <CardTitle className="flex items-center text-orange-600 dark:text-orange-400">
              <Calendar className="w-5 h-5 mr-2" />
              Follow-ups Due Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {dueToday.map((app) => (
                <div
                  key={app.id}
                  className="p-4 border rounded-lg flex items-center justify-between"
                >
                  <div>
                    <div className="font-medium">{app.company}</div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {app.role} • {app.stage}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => generateFollowUp(app.id)}
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Generate Follow-up
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>Applications by stage</CardDescription>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No applications yet. Add your first application!
            </p>
          ) : (
            <div className="space-y-6">
              {STAGES.map((stageName) => {
                const stageApps = groupedApplications[stageName] || [];
                if (stageApps.length === 0) return null;

                return (
                  <div key={stageName}>
                    <div className="flex items-center space-x-2 mb-3">
                      <Badge className={getStageColor(stageName)}>
                        {stageName}
                      </Badge>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {stageApps.length} {stageApps.length === 1 ? 'application' : 'applications'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {stageApps.map((app) => (
                        <div
                          key={app.id}
                          className="p-4 border rounded-lg flex items-center justify-between"
                        >
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              {app.url ? (
                                <a
                                  href={app.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-medium hover:underline"
                                >
                                  {app.company}
                                </a>
                              ) : (
                                <span className="font-medium">{app.company}</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                              {app.role} • Applied {new Date(app.appliedDate).toLocaleDateString()}
                              {app.followUpDate && (
                                <> • Follow-up: {new Date(app.followUpDate).toLocaleDateString()}</>
                              )}
                            </div>
                            {app.notes && (
                              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                {app.notes}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generateFollowUp(app.id)}
                            >
                              <Mail className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteApplication(app.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={followUpDialog.open} onOpenChange={(open) => setFollowUpDialog({ ...followUpDialog, open })}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Follow-up Email Variants</DialogTitle>
            <DialogDescription>
              Choose a variant and customize as needed
            </DialogDescription>
          </DialogHeader>
          {isGeneratingFollowUp ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : (
            <div className="space-y-6">
              {followUpDialog.variants.map((variant, idx) => (
                <Card key={idx}>
                  <CardHeader>
                    <CardTitle className="text-base">
                      Variant {idx + 1} {idx === 0 ? '(Formal)' : '(Professional)'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium">Subject:</Label>
                      <p className="mt-1 text-sm">{variant.subject}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Body:</Label>
                      <p className="mt-1 text-sm whitespace-pre-wrap">{variant.body}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        navigator.clipboard.writeText(`Subject: ${variant.subject}\n\n${variant.body}`);
                        toast.success('Copied to clipboard!');
                      }}
                    >
                      Copy to Clipboard
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
