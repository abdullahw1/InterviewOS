import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { MobileNav } from '@/components/MobileNav';
import {
  Home,
  MessageSquare,
  FolderGit2,
  Code2,
  Briefcase,
  DollarSign,
  Settings,
  LogOut,
} from 'lucide-react';

const navLinks = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/interview', label: 'Interview', icon: MessageSquare },
  { href: '/projects', label: 'Projects', icon: FolderGit2 },
  { href: '/leetcode', label: 'LeetCode', icon: Code2 },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/costs', label: 'Costs', icon: DollarSign },
  { href: '/settings', label: 'Settings', icon: Settings },
];

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
            <div className="flex items-center">
              <MobileNav links={navLinks} />
              <div className="flex-shrink-0 flex items-center ml-2 sm:ml-0">
                <Link href="/" className="text-xl font-bold text-gray-900 dark:text-white">
                  InterviewOS
                </Link>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-4">
                {navLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center">
              <span className="hidden sm:inline text-sm text-gray-700 dark:text-gray-300 mr-4">
                {session.user?.email}
              </span>
              <form action="/api/auth/signout" method="POST">
                <Button variant="ghost" size="sm" type="submit">
                  <LogOut className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">Logout</span>
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
