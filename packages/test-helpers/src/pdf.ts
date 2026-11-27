// A small real PDF for tests that read one (RAD-159's bank statements): each page's lines of text in Helvetica, each
// piece at its own x, top of the page first, 14 points apart. Written by hand, xref and all, so no PDF library is needed.

/** One line: a string at the left margin, or pieces each at its own x (PDF units from the left edge). */
export type TestPdfLine = string | readonly { text: string; x: number }[];

const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** The bytes of a PDF with one page per entry of `pages`. */
export function testPdf(pages: readonly (readonly TestPdfLine[])[]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((lines, i) => {
    const text = lines.flatMap((line, row) => (typeof line === 'string' ? [{ text: line, x: 50 }] : line)
      .map((p) => `BT /F1 10 Tf ${p.x} ${750 - row * 14} Td (${escape(p.text)}) Tj ET`)).join('\n');
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    add(`<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
