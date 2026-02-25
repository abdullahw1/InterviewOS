'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, Database } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectInfo {
  name: string;
  path: string;
}

interface ProjectSummary {
  repoName: string;
  description: string;
  techStack: string[];
  highlights: string[];
  createdAt: string;
  updatedAt: string;
}

export default function ManageProjectsPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [indexed, setIndexed] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState(false);

  useEffect(() => {
    fetchProjects();
    fetchIndexedProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/projects/index-all');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchIndexedProjects = async () => {
    try {
      const res = await fetch('/api/projects/summaries');
      if (res.ok) {
        const data = await res.json();
        setIndexed(data.summaries);
      }
    } catch (error) {
      console.error('Error fetching indexed projects:', error);
    }
  };

  const startIndexing = async () => {
    setIndexing(true);
    try {
      const res = await fetch('/api/projects/index-all', {
        method: 'POST',
      });

      if (res.ok) {
        toast.success('Project indexing started! This may take a few minutes.');
        
        // Poll for updates
        const interval = setInterval(async () => {
          await fetchIndexedProjects();
        }, 5000);

        // Stop polling after 2 minutes
        setTimeout(() => {
          clearInterval(interval);
          setIndexing(false);
          toast.success('Indexing complete!');
        }, 120000);
      } else {
        throw new Error('Failed to start indexing');
      }
    } catch (error) {
      console.error('Error starting indexing:', error);
      toast.error('Failed to start indexing');
      setIndexing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Projects</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Index your projects to use them in interviews and project quizzes
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Database className="w-5 h-5 mr-2" />
            Project Indexing
          </CardTitle>
          <CardDescription>
            Create embeddings and summaries of your projects for AI-powered features
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div>
              <p className="font-medium">Projects to Index</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {projects.length} repositories configured
              </p>
            </div>
            <Button
              onClick={startIndexing}
              disabled={indexing}
            >
              {indexing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Indexing...
                </>
              ) : (
                'Start Indexing'
              )}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Configured Projects:</p>
            <ul className="space-y-1">
              {projects.map((project, idx) => (
                <li key={idx} className="flex items-center text-sm">
                  <Badge variant="outline" className="mr-2">{idx + 1}</Badge>
                  <span className="font-mono text-xs">{project.name}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Indexed Projects</CardTitle>
          <CardDescription>
            {indexed.length} project{indexed.length !== 1 ? 's' : ''} currently indexed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {indexed.length === 0 ? (
            <p className="text-center text-gray-600 dark:text-gray-400 py-8">
              No projects indexed yet. Click "Start Indexing" above to begin.
            </p>
          ) : (
            <div className="space-y-4">
              {indexed.map((project) => (
                <div
                  key={project.repoName}
                  className="p-4 border rounded-lg space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold flex items-center">
                        <CheckCircle className="w-4 h-4 text-green-600 mr-2" />
                        {project.repoName}
                      </h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {project.description}
                      </p>
                    </div>
                    <Badge variant="secondary">
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </Badge>
                  </div>

                  {project.techStack.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {project.techStack.slice(0, 8).map((tech, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          {tech}
                        </Badge>
                      ))}
                      {project.techStack.length > 8 && (
                        <Badge variant="outline" className="text-xs">
                          +{project.techStack.length - 8} more
                        </Badge>
                      )}
                    </div>
                  )}

                  {project.highlights.length > 0 && (
                    <ul className="text-sm space-y-1 mt-2">
                      {project.highlights.slice(0, 3).map((highlight, idx) => (
                        <li key={idx} className="text-gray-700 dark:text-gray-300">
                          • {highlight}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
