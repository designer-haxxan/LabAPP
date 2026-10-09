// Printing: renders a document into #print-area and opens the system print dialog.
// The CSS in app.css shows #print-area only while printing.
import { esc, fmtDate } from './utils.js';
import { getSettings } from './settings.js';

export function labHeader() {
  const { lab } = getSettings();
  return `<header class="pr-head">
      <div class="pr-brand">
        <div class="pr-name">${esc(lab.name)}</div>
        ${lab.tagline ? `<div class="pr-tag">${esc(lab.tagline)}</div>` : ''}
        ${lab.address ? `<div class="pr-small">${esc(lab.address)}</div>` : ''}
        <div class="pr-small">${[lab.phone && `Tel: ${esc(lab.phone)}`, lab.email && esc(lab.email), lab.license && `Lic: ${esc(lab.license)}`].filter(Boolean).join(' · ')}</div>
      </div>
    </header>`;
}

// Opens the print dialog with the given HTML body (already escaped by the caller).
export function printHtml(html, title = 'Print') {
  const area = document.getElementById('print-area');
  area.innerHTML = html;
  const prev = document.title;
  document.title = title;
  const done = () => { document.title = prev; area.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Give images/fonts a tick to lay out before the dialog opens.
  setTimeout(() => window.print(), 60);
}

export const fmtDateSafe = (d) => fmtDate(d) || '';
