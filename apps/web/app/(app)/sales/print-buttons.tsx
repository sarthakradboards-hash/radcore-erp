'use client';
// A document's print buttons (RAD-120 on lib-sales' print contracts): the server makes the PDF, on A4 or the 80 mm roll, under the
// document's own read key, and logs each as a look at it. The tab is opened in the click (a tab opened after the wait would be taken
// for a pop-up) and given the PDF when it arrives; the browser's own viewer prints it. A person without the key sees no button.
import type { Contract } from '@radcore/lib-common';
import { PAPER_SIZES, type Paper } from '@radcore/lib-platform/contract';
import { useState } from 'react';
import { useMe } from '../../../components/shell/session-provider.tsx';
import { ApiError, callPdf } from '../../../lib/api-client.ts';
import { t } from '../../../lib/i18n/index.ts';
import { noteSignedOut } from '../../../lib/session/signed-out.ts';

/** How long the PDF's address lives: the tab has read it by then, and a printout is not kept in memory for the life of the page. */
const REVOKE_AFTER_MS = 60_000;

/** `papers` narrows the sizes offered (the counter prints on the roll only), and `label` names the one button then. */
export function PrintButtons({ contract, id, papers = PAPER_SIZES, label }: { contract: Contract; id: string; papers?: readonly Paper[]; label?: string }) {
  const { permissions } = useMe();
  const [busy, setBusy] = useState<Paper | null>(null);
  const [problem, setProblem] = useState('');
  if (contract.perm !== null && !permissions.includes(contract.perm)) return null;
  const print = async (paper: Paper) => {
    setProblem('');
    const tab = window.open('', '_blank');
    if (tab === null) { setProblem(t('sales.print.err.blocked')); return; }
    tab.opener = null; // the printout's tab has no hold on this one
    setBusy(paper);
    try {
      const pdf = await callPdf(contract, { id, paper });
      const url = URL.createObjectURL(pdf);
      tab.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
    } catch (e) {
      tab.close();
      noteSignedOut(e); // a signed-out session opens the sign-in dialog, as any other read does
      setProblem(e instanceof ApiError && e.code === 'too_large' ? t('sales.print.err.too_large')
        : e instanceof ApiError && e.code === 'wrong_status' ? t('sales.print.err.not_ready') : t('sales.print.err'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {papers.map((paper) => (
        <button key={paper} type="button" className="kit-button" disabled={busy !== null} aria-busy={busy === paper} onClick={() => void print(paper)}>
          {label ?? t(`sales.print.${paper}`)}
        </button>
      ))}
      {problem === '' ? null : <p role="alert" className="kit-form-alert">{problem}</p>}
    </>
  );
}
