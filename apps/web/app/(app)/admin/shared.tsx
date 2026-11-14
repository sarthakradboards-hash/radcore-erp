'use client';
// Pieces the admin screens share (RAD-57). The server decides who may do what (M1-14 to M1-18): the screens only
// grey out what its flags say and word its error codes; they hold no permission rule of their own.
import { AUDIT_RANGE_MAX_DAYS } from '@radcore/lib-platform/contract';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { z } from 'zod';
import { Dialog, CloseButton } from '../../../components/ui/dialog/dialog.tsx';
import { Form, SubmitButton } from '../../../components/ui/form/form.tsx';
import { ADMIN_PAGES, allowed } from '../../../components/shell/nav.ts';
import { useMe } from '../../../components/shell/session-provider.tsx';
import { announce } from '../../../components/ui/live-region.tsx';
import { t } from '../../../lib/i18n/index.ts';
import './admin.css';

// The pages come from the shell's menu (components/shell/nav.ts), each with the permission its screen reads, so the
// sub-menu, like the main one, offers only what the person may open (RC-151). The server still checks every request.
export function AdminNav() {
  const here = usePathname();
  const { permissions } = useMe();
  return (
    <nav aria-label={t('admin.nav')} className="admin-nav">
      <ul>
        {ADMIN_PAGES.filter((page) => allowed(page, permissions)).map(({ href, label }) => (
          <li key={href}><Link href={href} aria-current={here === href ? 'page' : undefined}>{t(label)}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

const CODES = ['own_account', 'last_admin', 'role_not_grantable', 'email_taken', 'role_not_editable', 'matrix_changed',
  'unknown_permission', 'permission_not_held', 'current_session'] as const;
/** The admin contracts' error codes in the screen's words, for Form's and ReasonDialog's `messages`. */
export const MESSAGES: Partial<Record<string, string>> = Object.fromEntries(CODES.map((c) => [c, t(`admin.err.${c}`)]));
MESSAGES['range_too_long'] = t('admin.err.range_too_long', { days: String(AUDIT_RANGE_MAX_DAYS) });
// A refusal that only means the list on screen was stale (someone else got there first).
for (const c of ['not_invited', 'already_disabled', 'not_disabled']) MESSAGES[c] = t('admin.listStale');

/** A row of buttons that filter a list: one is pressed. Pressing only filters; it never changes data. */
export function ChoiceButtons<V extends string>({ label, value, options, onChange }: {
  label: string; value: V; options: readonly { value: V; label: string }[]; onChange: (value: V) => void;
}) {
  return (
    <div role="group" aria-label={label} className="kit-actions admin-choices">
      {options.map((o) => (
        <button key={o.value} type="button" className="kit-button" aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const nothing = z.object({});

/** Asks before an action that takes no reason (ending sessions). A refusal shows in the dialog, worded. */
export function ConfirmDialog({ open, onOpenChange, title, body, action, onConfirm, done }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; body: string; action: string;
  onConfirm: () => Promise<string | void>; done: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <Form schema={nothing} defaultValues={{}} saved={false} messages={MESSAGES}
        onSubmit={async () => {
          const said = await onConfirm();
          onOpenChange(false);
          setTimeout(() => announce(said ?? done), 0);
        }}>
        <div className="kit-actions">
          <CloseButton>{t('admin.cancel')}</CloseButton>
          <SubmitButton>{action}</SubmitButton>
        </div>
      </Form>
    </Dialog>
  );
}
