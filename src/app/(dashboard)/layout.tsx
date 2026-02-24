import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { 
  Home, 
  MessageSquare, 
  FolderGit2, 
  Code2, 
  Briefcase, 
  DollarSign,
  LogOut 
} from 'lucide-react';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <Link href="/" className="text-xl font-bold text-gray-900 dark:text-white">
                  InterviewOS
                </Link>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-4">
                <Link
                  href="/"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <Home className="w-4 h-4 mr-2" />
                  Dashboard
                </Link>
                <Link
                  href="/interview"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Interview
                </Link>
                <Link
                  href="/projects"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <FolderGit2 className="w-4 h-4 mr-2" />
                  Projects
                </Link>
                <Link
                  href="/leetcode"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <Code2 className="w-4 h-4 mr-2" />
                  LeetCode
                </Link>
                <Link
                  href="/jobs"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <Briefcase className="w-4 h-4 mr-2" />
                  Jobs
                </Link>
                <Link
                  href="/costs"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <DollarSign className="w-4 h-4 mr-2" />
                  Costs
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  Settings
                </Link>
              </div>
            </div>
            <div className="flex items-center">
              <span className="text-sm text-gray-700 dark:text-gray-300 mr-4">
                {session.user?.email}
              </span>
              <form action="/api/auth/signout" method="POST">
                <Button variant="ghost" size="sm" type="submit">
                  <LogOut className="w-4 h-4 mr-2" />
                  Logout
                </Button>
              </form>
            </div>
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
