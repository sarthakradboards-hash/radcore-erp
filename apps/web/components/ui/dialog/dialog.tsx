'use client';
// The one dialog (M1-43): Radix, so focus is trapped and returned, Escape closes it, and the page behind is inert.
import { Dialog as Radix } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { LiveRegion } from '../live-region.tsx';
import './dialog.css';
import './style-nonce.ts';
import { t } from '../../../lib/i18n/index.ts';

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** False for a dialog the person must answer, such as "you are signed out" (A-0): no Escape, outside click or ×. */
  dismissible?: boolean;
  children: ReactNode;
};

export function Dialog({ open, onOpenChange, title, description, dismissible = true, children }: DialogProps) {
  const stay = dismissible ? undefined : (event: Event) => event.preventDefault();
  // Radix hands focus back to its own Trigger, and these dialogs are opened by the screen's buttons and menus. So
  // remember what had focus when it opened, and go back there when it closes.
  const opener = useRef<HTMLElement | null>(null);
  const remember = () => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const giveBack = (event: Event) => {
    if (opener.current?.isConnected !== true) return;
    event.preventDefault();
    opener.current.focus();
  };
  return (
    <Radix.Root open={open} onOpenChange={onOpenChange}>
      <Radix.Portal>
        <Radix.Overlay className="kit-overlay" />
        <Radix.Content className="kit-dialog" onEscapeKeyDown={stay} onInteractOutside={stay}
          onOpenAutoFocus={remember} onCloseAutoFocus={giveBack}
          {...(description === undefined && { 'aria-describedby': undefined })}>
          <Radix.Title className="kit-dialog-title">{title}</Radix.Title>
          {description !== undefined && <Radix.Description>{description}</Radix.Description>}
          {children}
          {dismissible && (
            <Radix.Close className="kit-dialog-close" aria-label={t('kit.dialog.close')}>×</Radix.Close>
          )}
          {/* The modal makes the page's live region inert, so the dialog has its own (RAD-51). */}
          <LiveRegion />
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

/** A button that closes the dialog it is in, for a "Cancel" or "Keep it" beside the form's submit. */
export function CloseButton({ children }: { children: ReactNode }) {
  return <Radix.Close className="kit-button">{children}</Radix.Close>;
}
