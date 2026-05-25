'use client';

/**
 * /projects management UI.
 *
 * Lists every Project owned by the authenticated user with status,
 * file count, last-indexed timestamp, ingestion source, and an action
 * menu (Re-index / Remove / Retry). Adds tabs for the three ingestion
 * options:
 *   - Connect GitHub (hidden when not configured)
 *   - Upload archive
 *   - Rescan local paths (development only)
 *
 * Surfaces the one-time migration banner from
 * `MigrationLog.project_drills_foundation` (task 1.2).
 *
 * Validates: Requirements 5.1 - 5.6, 19.3
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
import { Badge } from '@/components/ui/badge';
import { Loader2, Github, Upload, RefreshCw, Trash2, FolderSearch } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectRow {
  id: string;
  repoName: string;
  ingestionSource: string;
  repoPath: string | null;
  status: string;
  partialReason: string | null;
  fileCount: number;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MigrationBanner {
  createdAt: string;
  payload: {
    createdProjects?: number;
    deletedChunks?: number;
    deletedSummaries?: number;
  };
}

interface GithubStatus {
  configured: boolean;
  connection: { githubLogin: string; status: string; updatedAt: string } | null;
}

interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  defaultBranch: string;
  language: string | null;
  pushedAt: string;
  visibility: string;
  private: boolean;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  cloning: { label: 'Cloning', variant: 'secondary' },
  indexing: { label: 'Indexing', variant: 'secondary' },
  indexed: { label: 'Indexed', variant: 'default' },
  partial_indexed: { label: 'Partial', variant: 'outline' },
  failed: { label: 'Failed', variant: 'destructive' },
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '—';
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [banner, setBanner] = useState<MigrationBanner | null>(null);
  const [isDev, setIsDev] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<GithubStatus | null>(null);
  const [showRepoPicker, setShowRepoPicker] = useState(false);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(new Set());
  const [registering, setRegistering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    setIsLoading(true);
    try {
      const [projectsRes, ghRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/projects/github/status').catch(() => null),
      ]);
      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setProjects(data.projects ?? []);
        setBanner(data.migrationBanner ?? null);
        setIsDev(Boolean(data.isDevelopment));
      } else {
        toast.error('Failed to load projects');
      }
      if (ghRes && ghRes.ok) {
        setGithubStatus(await ghRes.json());
      }
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleReindex(projectId: string) {
    setBusyId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}/reindex`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          toast.success('Re-indexed');
        } else {
          toast.error(data.error ?? 'Re-index failed');
        }
        await load();
      } else {
        toast.error('Re-index failed');
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(projectId: string, repoName: string) {
    if (!confirm(`Remove ${repoName}? This cannot be undone.`)) return;
    setBusyId(projectId);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(`Removed ${repoName}`);
        await load();
      } else {
        toast.error('Failed to remove project');
      }
    } finally {
      setBusyId(null);
    }
  }

  function handleConnectGithub() {
    window.location.href = '/api/projects/github/start';
  }

  async function loadRepos() {
    setReposLoading(true);
    try {
      const res = await fetch('/api/projects/github/repos');
      if (res.ok) {
        const data = await res.json();
        setRepos(data.repos ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to load repositories');
      }
    } finally {
      setReposLoading(false);
    }
  }

  function openRepoPicker() {
    setShowRepoPicker(true);
    setSelectedRepos(new Set());
    void loadRepos();
  }

  function toggleRepo(id: number) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleRegisterSelected() {
    if (selectedRepos.size === 0) {
      toast.error('Pick at least one repository');
      return;
    }
    setRegistering(true);
    try {
      const res = await fetch('/api/projects/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds: Array.from(selectedRepos) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 207) {
        const ok = data.registered?.length ?? 0;
        const failed = data.failed?.length ?? 0;
        if (ok > 0) toast.success(`Registered ${ok} repos`);
        if (failed > 0) toast.error(`${failed} failed: ${data.failed.map((f: { repoName?: string; error: string }) => f.repoName ?? f.error).join(', ')}`);
        setShowRepoPicker(false);
        await load();
      } else {
        toast.error(data.error ?? `Registration failed (HTTP ${res.status})`);
      }
    } finally {
      setRegistering(false);
    }
  }

  function handleArchiveClick() {
    fileInputRef.current?.click();
  }

  async function handleArchiveSelected(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    setBusyId('upload');
    try {
      const res = await fetch('/api/projects/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        toast.success('Archive uploaded');
        await load();
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body?.error ?? `Upload failed (HTTP ${res.status})`);
      }
    } finally {
      setBusyId(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRescanLocal() {
    setBusyId('rescan');
    try {
      const res = await fetch('/api/projects/local/rescan', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Discovered ${data.discovered ?? 0} repositories`);
        await load();
      } else {
        toast.error('Rescan failed');
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="mt-2 text-muted-foreground">
          Register repositories so InterviewOS can drill you on real code.
        </p>
      </div>

      {banner ? (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30">
          <CardHeader>
            <CardTitle className="text-base">Migration applied</CardTitle>
            <CardDescription>
              Created {banner.payload.createdProjects ?? 0} Projects, removed{' '}
              {banner.payload.deletedChunks ?? 0} stale chunks and{' '}
              {banner.payload.deletedSummaries ?? 0} stale summaries from the legacy
              parent-folder index.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a project</CardTitle>
          <CardDescription>
            Connect GitHub, upload an archive, or (in development) rescan your local
            paths.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {githubStatus?.configured ? (
              <>
                <Button onClick={handleConnectGithub} variant="default">
                  <Github className="w-4 h-4 mr-2" />
                  {githubStatus.connection ? 'Reconnect GitHub' : 'Connect GitHub'}
                </Button>
                {githubStatus.connection?.status === 'active' ? (
                  <Button onClick={openRepoPicker} variant="default">
                    <Github className="w-4 h-4 mr-2" />
                    Pick repos to register
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button onClick={handleArchiveClick} variant="default" disabled={busyId === 'upload'}>
              {busyId === 'upload' ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload archive
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tar.gz,.tgz,application/zip,application/gzip,application/x-gzip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleArchiveSelected(f);
              }}
            />
            {isDev ? (
              <Button onClick={handleRescanLocal} variant="outline" disabled={busyId === 'rescan'}>
                {busyId === 'rescan' ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FolderSearch className="w-4 h-4 mr-2" />
                )}
                Rescan local paths
              </Button>
            ) : null}
          </div>
          {!githubStatus?.configured ? (
            <p className="mt-3 text-sm text-muted-foreground">
              GitHub OAuth is not configured on this server. Add{' '}
              <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, and{' '}
              <code>GITHUB_TOKEN_ENC_KEY</code> to <code>.env</code> and restart to
              enable repository connection.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your projects</CardTitle>
          <CardDescription>
            {isLoading ? 'Loading…' : `${projects.length} registered`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="text-foreground font-medium">
                No projects yet
              </p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Use the buttons above to connect GitHub, upload a zip / tar.gz of
                your code, or (in development) rescan your local{' '}
                <code>REPO_PATHS</code>.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((p) => {
                const badge = STATUS_BADGE[p.status] ?? {
                  label: p.status,
                  variant: 'secondary' as const,
                };
                const isBusy = busyId === p.id;
                return (
                  <div
                    key={p.id}
                    className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{p.repoName}</span>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {p.ingestionSource}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {p.repoPath ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.fileCount} files indexed · last indexed{' '}
                        {formatDate(p.lastIndexedAt)}
                      </p>
                      {p.partialReason ? (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          {p.partialReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReindex(p.id)}
                        disabled={isBusy}
                      >
                        {isBusy ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-1" />
                        )}
                        {p.status === 'failed' ? 'Retry' : 'Re-index'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(p.id, p.repoName)}
                        disabled={isBusy}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {showRepoPicker ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !registering && setShowRepoPicker(false)}>
          <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col border border-border" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-semibold">Select GitHub repositories</h2>
              <p className="text-sm text-muted-foreground mt-1">{selectedRepos.size} selected · these will be cloned and indexed</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {reposLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Loading repositories…
                </div>
              ) : repos.length === 0 ? (
                <p className="text-center py-8 text-muted-foreground">No repositories found.</p>
              ) : (
                <div className="space-y-2">
                  {repos.map((r) => (
                    <label key={r.id} className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRepos.has(r.id)}
                        onChange={() => toggleRepo(r.id)}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{r.fullName}</span>
                          {r.private ? <Badge variant="outline" className="text-xs">private</Badge> : null}
                          {r.language ? <Badge variant="secondary" className="text-xs">{r.language}</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">default: {r.defaultBranch} · pushed {formatDate(r.pushedAt)}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-border flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowRepoPicker(false)} disabled={registering}>
                Cancel
              </Button>
              <Button onClick={handleRegisterSelected} disabled={registering || selectedRepos.size === 0}>
                {registering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Register {selectedRepos.size > 0 ? selectedRepos.size : ''}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
