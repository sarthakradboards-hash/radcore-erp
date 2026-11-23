// A job work challan's printout (RAD-142, on RAD-120's engine; ADR-008 §11): Rule 55's delivery challan for inputs
// sent for job work. It's statutory, so the job worker's name, address, state and GSTIN print in full and the look at
// the party is logged. The issuer is today's company profile, as for a sales challan. The goods' value is a stock
// value, `cost()`: it prints only for a principal who sees costs, as the screen shows it.
import { getCompanyProfile, getPartyById } from '@radcore/lib-accounts';
import { dec, formatDate, formatMoney, roundMoney } from '@radcore/lib-common';
import type { Ctx, PrintBlock, PrintDef } from '@radcore/lib-platform';
import { itemLabels } from '../services/items.ts';
import { getChallanById, JOB_WORK_RETURN_DAYS } from '../services/job-work-challans.ts';

type Detail = string | { masked: string } | null;
const text = (v: Detail): string => (v === null ? '' : typeof v === 'string' ? v : v.masked);
const oneLine = (parts: readonly string[]) => parts.filter((p) => p !== '').join(', ');
// A service's value is never masked (the handler masks answers); the contract's type allows it.
const amount = (v: Detail): string | null => (typeof v === 'string' ? v : null);

async function challanOf(ctx: Ctx, id: string) {
  const c = await getChallanById(ctx, { id });
  const { company } = await getCompanyProfile(ctx);
  const p = await getPartyById(ctx, { id: c.partyId });
  const labels = await itemLabels(ctx, c.lines.map((l) => l.itemId));
  return { ...c, company, labels, seesCost: ctx.shows('cost'), returnDays: ctx.settings.get(JOB_WORK_RETURN_DAYS),
    jobWorker: { id: p.id, name: p.name, gstin: p.gstin, stateCode: p.stateCode,
      address: oneLine([text(p.addressLine1), text(p.addressLine2), `${text(p.city)} ${text(p.pincode)}`.trim()]) } };
}

export const jobWorkChallanPrint: PrintDef<Awaited<ReturnType<typeof challanOf>>> = {
  read: challanOf,
  title: (m) => `Job work challan ${m.number}`,
  // Statutory: the address is always on the page.
  looks: (m) => [{ table: 'parties', id: m.jobWorker.id }],
  layout: (m) => {
    const c = m.company;
    const value = (v: string | null) => (!m.seesCost ? 'Hidden' : v === null ? '—' : formatMoney(v));
    const total = roundMoney(m.lines.reduce((t, l) => t.plus(amount(l.value) ?? '0'), dec('0')));
    const blocks: PrintBlock[] = [
      { kind: 'heading', text: m.status === 'cancelled' ? 'Job work challan (cancelled)' : 'Job work challan' },
      ...(c === null ? [] : [{ kind: 'text', text: c.legalName, bold: true } as const,
        { kind: 'text', text: oneLine([c.addressLine1, c.addressLine2 ?? '', `${c.city} ${c.pincode}`]) } as const,
        { kind: 'pairs', rows: [['GSTIN', c.gstin], ['State code', c.stateCode]] } as const]),
      { kind: 'pairs', rows: [['Challan no.', m.number], ['Date', formatDate(m.businessDate)], ['Sent from', m.fromName]] },
      { kind: 'text', text: 'Job worker', bold: true },
      { kind: 'text', text: m.jobWorker.name },
      ...(m.jobWorker.address === '' ? [] : [{ kind: 'text', text: m.jobWorker.address } as const]),
      { kind: 'pairs', rows: [['GSTIN', m.jobWorker.gstin ?? 'Unregistered'], ['State code', m.jobWorker.stateCode]] },
      { kind: 'table', columns: [{ label: '#', share: 0.6, onThermal: false }, { label: 'Item', share: 4 }, { label: 'HSN', share: 1.7 },
        { label: 'Qty', share: 1.2, align: 'right' }, { label: 'Batch / serials', share: 3 }, { label: 'Value', share: 2, align: 'right', onThermal: false }],
      rows: m.lines.map((l) => {
        const item = m.labels.get(l.itemId);
        const picked = [...l.batches.flatMap((b) => (b.batchNo === null ? [] : [b.batchNo])), ...l.serials].join(', ');
        return [String(l.lineNo), `${l.name} (${l.sku})`, item?.hsn ?? '', `${dec(l.qty).toString()} ${item?.unit ?? ''}`.trim(), picked, value(amount(l.value))];
      }) },
      { kind: 'totals', rows: [{ label: 'Value', value: value(total), strong: true }] },
      { kind: 'text', small: true,
        text: `Inputs sent for job work under section 143 of the CGST Act, to come back within ${m.returnDays} days. Not a supply.` },
      ...(m.notes === null ? [] : [{ kind: 'text', text: m.notes, small: true } as const]),
      ...(c === null ? [] : [{ kind: 'rule' } as const, { kind: 'text', text: `For ${c.legalName}`, align: 'right', bold: true } as const,
        { kind: 'text', text: 'Authorised signatory', align: 'right', small: true } as const]),
      { kind: 'text', text: 'Received by the job worker', small: true },
    ];
    return blocks;
  },
};
