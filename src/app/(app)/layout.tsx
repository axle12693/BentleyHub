'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { HubProvider, useHub } from '@/lib/hub';
import { ToastHost } from '@/components/ui';

const FULL_NAV = [
  { href: '/', label: 'Home', icon: '🏡' },
  { href: '/calendar', label: 'Calendar', icon: '📅' },
  { href: '/tasks', label: 'Tasks', icon: '✅' },
  { href: '/pets', label: 'Pets', icon: '🐾' },
  { href: '/rewards', label: 'Rewards', icon: '🎁' },
  { href: '/family', label: 'Family', icon: '👪' },
];
// Pet sitters get a deliberately tiny app: today's care checklist + the animals.
const SITTER_NAV = [
  { href: '/', label: 'Today', icon: '🏡' },
  { href: '/pets', label: 'Pets', icon: '🐾' },
];

function Nav() {
  const { isSitter } = useHub();
  const path = usePathname();
  const items = isSitter ? SITTER_NAV : FULL_NAV;
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        {items.map((i) => {
          const active = i.href === '/' ? path === '/' : path.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
              <span className="ico-wrap">
                <span className="ico">{i.icon}</span>
              </span>
              {i.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <HubProvider>
      <div className="shell">{children}</div>
      <Nav />
      <ToastHost />
    </HubProvider>
  );
}
