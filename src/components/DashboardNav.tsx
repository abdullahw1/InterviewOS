'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  Home,
  MessageSquare,
  FolderGit2,
  Code2,
  Briefcase,
  DollarSign,
  Library,
  Settings,
  LogOut,
  Mic,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileNav, type NavLink } from '@/components/MobileNav';

const navLinks: NavLink[] = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/drill/new', label: 'Drills', icon: Mic },
  { href: '/projects', label: 'Projects', icon: FolderGit2 },
  { href: '/question-bank', label: 'Question Bank', icon: Library },
  { href: '/interview', label: 'Interview', icon: MessageSquare },
  { href: '/leetcode', label: 'LeetCode', icon: Code2 },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/costs', label: 'Costs', icon: DollarSign },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface DashboardNavProps {
  userEmail?: string | null;
}

export function DashboardNav({ userEmail }: DashboardNavProps) {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <nav className="bg-card border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14">
          <div className="flex items-center gap-1">
            <MobileNav links={navLinks} />
            <Link
              href="/"
              className="flex-shrink-0 flex items-center ml-2 sm:ml-0 mr-4"
            >
              <span className="text-base font-semibold tracking-tight">InterviewOS</span>
            </Link>
            <div className="hidden sm:flex items-center gap-0.5">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {userEmail && (
              <span className="hidden md:inline text-xs text-muted-foreground">
                {userEmail}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="text-muted-foreground hover:text-foreground h-8 px-2"
              onClick={() => signOut({ callbackUrl: '/login' })}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1.5">Sign out</span>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
