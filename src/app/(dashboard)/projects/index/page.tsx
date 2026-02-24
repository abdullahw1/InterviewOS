'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Loader2, FolderGit2, FileText, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface IndexStatus {
  totalChunks: number;
  repos: {
    path: string;
    lastIndexed: Date;
  }[];
}

interface IndexResult {
  totalFiles: number;
  totalChunks: number;
  repos: {
    path: string;
    files: number;
    chunks: number;
  }[];
}

export default function ProjectIndexPage() {
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/index');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runIndexing = async () => {
    setIsIndexing(true);
    setIndexResult(null);

    try {
      const res = await fetch('/api/index', {
        method: 'POST',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Indexing failed');
      }

      const result = await res.json();
      setIndexResult(result);
      toast.success('Indexing completed successfully!');
      
      // Refresh status
      await fetchStatus();
    } catch (error: any) {
      toast.error(error.message || 'Failed to index repositories');
    } finally {
      setIsIndexing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/projects">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Project Indexing</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Index your repositories for AI-powered quizzes
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Total Chunks Indexed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{status?.totalChunks || 0}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Indexed Repositories</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{status?.repos.length || 0}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Run Indexing</CardTitle>
              <CardDescription>
                Index repositories configured in REPO_PATHS environment variable
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={runIndexing}
                disabled={isIndexing}
                className="w-full"
                size="lg"
              >
                {isIndexing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Indexing... This may take a few minutes
                  </>
                ) : (
                  <>
                    <FolderGit2 className="w-5 h-5 mr-2" />
                    Start Indexing
                  </>
                )}
              </Button>

              {isIndexing && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Scanning files, generating embeddings, and storing chunks...
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {indexResult && (
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader>
                <CardTitle className="text-green-600 dark:text-green-400">
                  Indexing Complete!
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-gray-600" />
                    <div>
                      <div className="text-2xl font-bold">{indexResult.totalFiles}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Files Processed
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <FolderGit2 className="w-5 h-5 text-gray-600" />
                    <div>
                      <div className="text-2xl font-bold">{indexResult.totalChunks}</div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Chunks Created
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-medium">Repositories:</h3>
                  {indexResult.repos.map((repo) => (
                    <div
                      key={repo.path}
                      className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                    >
                      <div className="font-medium text-sm">
                        {repo.path.split('/').pop()}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        {repo.files} files • {repo.chunks} chunks
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {status && status.repos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Currently Indexed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {status.repos.map((repo) => (
                    <div
                      key={repo.path}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <FolderGit2 className="w-5 h-5 text-gray-600" />
                        <div>
                          <div className="font-medium">
                            {repo.path.split('/').pop()}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {repo.path}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                        <Clock className="w-4 h-4" />
                        <span>
                          {new Date(repo.lastIndexed).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
