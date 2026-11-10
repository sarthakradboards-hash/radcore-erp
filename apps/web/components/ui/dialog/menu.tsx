'use client';
// A row's or a page's actions (M1-43): Radix, so arrow keys, Home, End, type-ahead and Escape work.
import { DropdownMenu } from 'radix-ui';
import { useRef } from 'react';
import '../form/form.css'; // .kit-button
import './dialog.css';
import './style-nonce.ts';

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };

/** `label` names the button, for example "Actions for INV-0042"; give it the row's name so each one differs. */
export function Menu({ label, items }: { label: string; items: readonly MenuItem[] }) {
  // The chosen action runs once the menu has closed and handed focus back to its button. Run any sooner, and a
  // dialog it opens loses focus to that button, leaving keyboard users outside the dialog.
  const chosen = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="kit-button">{label}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="kit-menu" align="end" sideOffset={4}
          onCloseAutoFocus={() => { const run = chosen.current; chosen.current = null; run?.(); }}>
          {items.map((item) => (
            <DropdownMenu.Item key={item.label} className="kit-menu-item" disabled={item.disabled ?? false}
              onSelect={() => { chosen.current = item.onSelect; }}>
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
