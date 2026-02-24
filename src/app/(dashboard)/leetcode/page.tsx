'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Calendar, TrendingUp, Target, Flame, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface LeetCodeEntry {
  id: string;
  problemName: string;
  problemUrl: string | null;
  pattern: string;
  difficulty: string;
  timeSpent: number;
  result: string;
  repetitions: number;
  easeFactor: number;
  interval: number;
  nextReviewDate: Date;
  lastReviewDate: Date | null;
  createdAt: Date;
}

export default function LeetCodePage() {
  const [entries, setEntries] = useState<LeetCodeEntry[]>([]);
  const [todayEntries, setTodayEntries] = useState<LeetCodeEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [problemName, setProblemName] = useState('');
  const [problemUrl, setProblemUrl] = useState('');
  const [pattern, setPattern] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [timeSpent, setTimeSpent] = useState('');
  const [result, setResult] = useState('good');

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const [allRes, dueRes] = await Promise.all([
        fetch('/api/leetcode'),
        fetch('/api/leetcode?dueOnly=true'),
      ]);

      if (allRes.ok && dueRes.ok) {
        const all = await allRes.json();
        const due = await dueRes.json();
        setEntries(all);
        setTodayEntries(due);
      }
    } catch (error) {
      console.error('Failed to fetch entries:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/leetcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemName,
          problemUrl: problemUrl || null,
          pattern,
          difficulty,
          timeSpent,
          result,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to add problem');
      }

      toast.success('Problem added successfully!');
      setIsDialogOpen(false);
      resetForm();
      fetchEntries();
    } catch (error) {
      toast.error('Failed to add problem');
    } finally {
      setIsSubmitting(false);
    }
  };

  const markReviewed = async (id: string, newResult: string) => {
    try {
      const res = await fetch(`/api/leetcode/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: newResult }),
      });

      if (!res.ok) {
        throw new Error('Failed to update');
      }

      toast.success('Review recorded!');
      fetchEntries();
    } catch (error) {
      toast.error('Failed to update problem');
    }
  };

  const deleteProblem = async (id: string) => {
    if (!confirm('Are you sure you want to delete this problem?')) return;

    try {
      const res = await fetch(`/api/leetcode/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete');
      }

      toast.success('Problem deleted');
      fetchEntries();
    } catch (error) {
      toast.error('Failed to delete problem');
    }
  };

  const resetForm = () => {
    setProblemName('');
    setProblemUrl('');
    setPattern('');
    setDifficulty('medium');
    setTimeSpent('');
    setResult('good');
  };

  const calculateStreak = () => {
    if (entries.length === 0) return 0;
    
    const sortedEntries = [...entries].sort(
      (a, b) => new Date(b.lastReviewDate || b.createdAt).getTime() - new Date(a.lastReviewDate || a.createdAt).getTime()
    );
    
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    
    for (const entry of sortedEntries) {
      const reviewDate = new Date(entry.lastReviewDate || entry.createdAt);
      reviewDate.setHours(0, 0, 0, 0);
      
      const diffDays = Math.floor((currentDate.getTime() - reviewDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === streak) {
        streak++;
      } else if (diffDays > streak) {
        break;
      }
    }
    
    return streak;
  };

  const getPatternBreakdown = () => {
    const breakdown: Record<string, number> = {};
    entries.forEach(entry => {
      breakdown[entry.pattern] = (breakdown[entry.pattern] || 0) + 1;
    });
    return Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty.toLowerCase()) {
      case 'easy': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'hard': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  const streak = calculateStreak();
  const patternBreakdown = getPatternBreakdown();

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
          <h1 className="text-2xl font-bold">LeetCode Tracker</h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Track problems with spaced repetition
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Problem
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add LeetCode Problem</DialogTitle>
              <DialogDescription>
                Track a new problem you've solved
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Problem Name *</Label>
                <Input
                  id="name"
                  value={problemName}
                  onChange={(e) => setProblemName(e.target.value)}
                  placeholder="Two Sum"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="url">Problem URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={problemUrl}
                  onChange={(e) => setProblemUrl(e.target.value)}
                  placeholder="https://leetcode.com/problems/two-sum"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pattern">Pattern *</Label>
                <Input
                  id="pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="Array, Hash Table"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="difficulty">Difficulty *</Label>
                  <Select value={difficulty} onValueChange={setDifficulty}>
                    <SelectTrigger id="difficulty">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="easy">Easy</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="hard">Hard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time">Time (min) *</Label>
                  <Input
                    id="time"
                    type="number"
                    value={timeSpent}
                    onChange={(e) => setTimeSpent(e.target.value)}
                    placeholder="30"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="result">Result *</Label>
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger id="result">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                    <SelectItem value="again">Again</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Adding...
                  </>
                ) : (
                  'Add Problem'
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Target className="w-5 h-5 mr-2" />
              Total Problems
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{entries.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Flame className="w-5 h-5 mr-2 text-orange-600" />
              Current Streak
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{streak} days</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calendar className="w-5 h-5 mr-2" />
              Due Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{todayEntries.length}</div>
          </CardContent>
        </Card>
      </div>

      {patternBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <TrendingUp className="w-5 h-5 mr-2" />
              Pattern Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {patternBreakdown.map(([pattern, count]) => (
                <div key={pattern} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="text-sm font-medium">{pattern}</div>
                  <div className="text-2xl font-bold">{count}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {todayEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Today's Reviews</CardTitle>
            <CardDescription>Problems due for review today</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {todayEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        {entry.problemUrl ? (
                          <a
                            href={entry.problemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:underline"
                          >
                            {entry.problemName}
                          </a>
                        ) : (
                          <span className="font-medium">{entry.problemName}</span>
                        )}
                        <Badge className={getDifficultyColor(entry.difficulty)}>
                          {entry.difficulty}
                        </Badge>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {entry.pattern} • {entry.timeSpent} min
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      Mark as:
                    </span>
                    {['easy', 'good', 'medium', 'hard', 'again'].map((r) => (
                      <Button
                        key={r}
                        size="sm"
                        variant="outline"
                        onClick={() => markReviewed(entry.id, r)}
                      >
                        {r}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>All Problems</CardTitle>
          <CardDescription>
            {entries.length} problems tracked
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              No problems yet. Add your first problem!
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 border rounded-lg flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      {entry.problemUrl ? (
                        <a
                          href={entry.problemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline"
                        >
                          {entry.problemName}
                        </a>
                      ) : (
                        <span className="font-medium">{entry.problemName}</span>
                      )}
                      <Badge className={getDifficultyColor(entry.difficulty)}>
                        {entry.difficulty}
                      </Badge>
                      <Badge variant="outline">{entry.pattern}</Badge>
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      Next review: {new Date(entry.nextReviewDate).toLocaleDateString()} •
                      Interval: {entry.interval} days • Reps: {entry.repetitions}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteProblem(entry.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
