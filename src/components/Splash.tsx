import type { ReactNode } from 'react';

/** Centered card used by login, join, welcome and the hub's loading / error screens. */
export function Splash({ logo = '🏡', title = 'Bentley Home Hub', children }: { logo?: string; title?: string; children: ReactNode }) {
  return (
    <main className="splash">
      <div className="splash-card">
        <div className="logo-mark">{logo}</div>
        {title && <h1>{title}</h1>}
        {children}
      </div>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <Splash>
      <p>This site isn’t connected to a database yet.</p>
      <p className="muted">
        Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> to your environment,
        then reload. See the README for the 5-minute Supabase setup.
      </p>
    </Splash>
  );
}
