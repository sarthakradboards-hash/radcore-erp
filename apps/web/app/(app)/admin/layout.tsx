// The admin area (RAD-57): people, roles, permissions, sessions and the audit trail. Every route behind it checks
// its own permission on the server (users:*, roles:*, audit:read); the shell's menu shows the area by permission.
import type { ReactNode } from 'react';
import { AdminNav } from './shared.tsx';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    // A <div>: the shell (RAD-50) already gives every signed-in screen its one <main>.
    <div className="admin">
      <AdminNav />
      {children}
    </div>
  );
}
