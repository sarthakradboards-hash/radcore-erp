'use client';
// The record layout a document's page is built from (RAD-125): where it is on its way (the status bar), the records it
// points to (related-record buttons) and what it holds in numbers (count cards). They show what the screen is given and
// work nothing out: the server says the status and which records are related, and a count that needs counting comes from
// a count contract, never from adding up a list (ADR-001, RC-176).
import Link from 'next/link';
import { t } from '../../../lib/i18n/index.ts';
import './record.css';

/** The steps in order, the one it is at marked: those before it are done, those after are still to come. */
export function StatusBar({ label, steps, current }: { label: string; steps: readonly { key: string; label: string }[]; current: string }) {
  const at = steps.findIndex((s) => s.key === current);
  return (
    <ol aria-label={label} className="record-steps">
      {steps.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        return (
          <li key={s.key} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
            {s.label}
            {state === 'todo' ? null : <span className="visually-hidden"> ({t(state === 'done' ? 'kit.record.done' : 'kit.record.now')})</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Buttons to the records this one points to, each a real link. None to show renders nothing. */
export function RelatedRecords({ label, links }: { label: string; links: readonly { label: string; href: string }[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={label} className="record-related">
      {links.map((l) => <Link key={l.href} href={l.href} className="kit-button">{l.label}</Link>)}
    </nav>
  );
}

/** Figures the record holds, each a label and a number the screen was given as text. */
export function CountCards({ label, cards }: { label: string; cards: readonly { label: string; value: string }[] }) {
  return (
    <dl aria-label={label} className="record-counts">
      {cards.map((c) => (
        <div key={c.label} className="record-card"><dt>{c.label}</dt><dd>{c.value}</dd></div>
      ))}
    </dl>
  );
}
