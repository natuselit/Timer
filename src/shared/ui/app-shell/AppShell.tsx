import type { PropsWithChildren, ReactNode } from 'react';
import './AppShell.css';

type AppShellProps = PropsWithChildren<{
  headerSlot?: ReactNode;
  navigationSlot?: ReactNode;
}>;

export function AppShell({ children, headerSlot, navigationSlot }: AppShellProps) {
  return (
    <div className="app-shell">
      {headerSlot ? <div className="app-shell__header">{headerSlot}</div> : null}
      <main
        className={
          headerSlot ? 'app-shell__content' : 'app-shell__content app-shell__content--without-header'
        }
      >
        {children}
      </main>
      <div className="app-shell__navigation">{navigationSlot}</div>
    </div>
  );
}
