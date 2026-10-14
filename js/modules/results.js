// Results & reports: worklist of tests to perform, result entry with live high/low flags, verification,
// reopening, and printable lab reports (one page per test, or every test of a bill).
import * as UI from '../core/ui.js';
import { esc, fmtDate, debounce } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { labHeader, printHtml } from '../core/print.js';
import { reportBadge, flagBadge, genderLabel, countPill } from '../core/badges.js';
import { getBundle, saveResults, reopenReport, flagFor, refText } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
let filter = { status: 'pending', q: '' };

export async function render(el, ctx) {
  if (ctx.params[0]) return renderEntry(el, ctx.params[0], ctx);
  ctx.setTitle?.('Results & Reports');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Results &amp; Reports</h1>
    </div>
    <div class="seg mb-3" role="tablist" id="rs-seg">
      ${[['pending', 'To do'], ['entered', 'Entered'], ['verified', 'Verified'], ['all', 'All']].map(([v, l]) => `<button class="seg-btn ${filter.status === v ? 'active' : ''}" data-st="${v}" role="tab">${l}</button>`).join('')}
    </div>
    <div class="search-box mb-3"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="rq" placeholder="Search patient, test or bill no." value="${esc(filter.q)}" autocomplete="off"></div>
    <div id="rs-count" class="mb-2"></div>
    <div class="list-card" id="rs-list"><div class="skel" style="height:140px"></div></div>`;
  $(el).on('click', '[data-st]', function () { filter.status = this.dataset.st; $('#rs-seg .seg-btn', el).removeClass('active'); $(this).addClass('active'); load(el); });
  $(el).on('input', '#rq', debounce(function () { filter.q = this.value.trim().toLowerCase(); load(el); }, 150));
  load(el);
}

async function load(el) {
  const { reports, bills } = await getBundle(['reports', 'bills']);
  const billNo = Object.fromEntries(bills.map((b) => [b.id, b]));
  const all = reports.filter((r) => r.status !== 'void' && billNo[r.billId]?.status !== 'void');
  const counts = { pending: 0, entered: 0, verified: 0 };
  all.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const rows = all
    .filter((r) => filter.status === 'all' || r.status === filter.status)
    .filter((r) => !filter.q || [r.testName, billNo[r.billId]?.patient.name, r.billNumber].some((x) => (x || '').toLowerCase().includes(filter.q)))
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  $('#rs-count', el).html(`${countPill(counts.pending, 'to do', 'secondary')} ${countPill(counts.entered, 'to verify', 'info')} ${countPill(counts.verified, 'verified', 'success')}`);
  const $list = $('#rs-list', el);
  if (!rows.length) { $list.html(UI.emptyState(filter.status === 'pending' ? 'Nothing waiting. All tests have results.' : 'No tests here', 'clipboard2-check')); return; }
  $list.html(`<div class="stagger">${rows.slice(0, 150).map((r) => {
    const b = billNo[r.billId];
    return `<a class="list-row" href="#/results/${r.id}">
      <div class="res-ico res-${r.status}"><i class="bi bi-${r.status === 'verified' ? 'patch-check-fill' : r.status === 'entered' ? 'pencil-square' : 'hourglass-split'}"></i></div>
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(r.testName)}</div>
        <div class="small text-body-secondary text-truncate">${esc(b?.patient.name || '')} · ${esc(b?.patient.mrNo || '')} · ${esc(r.billNumber)} · ${esc(fmtDate(r.date))}</div></div>
      <div class="text-end">${reportBadge(r.status)}</div></a>`;
  }).join('')}</div>${rows.length > 150 ? `<div class="p-3 small text-center text-body-secondary">Showing 150 of ${rows.length}. Narrow the search to see more.</div>` : ''}`);
}

// ---------- Entry ----------
async function renderEntry(el, id, ctx) {
  const { reports, bills } = await getBundle(['reports', 'bills']);
  const r = reports.find((x) => x.id === id);
  ctx.setTitle?.(r ? r.testName : 'Result');
  if (!r || r.status === 'void') { el.innerHTML = UI.emptyState('Test not found or voided.', 'clipboard-x'); return; }
  const bill = bills.find((b) => b.id === r.billId);
  const patient = bill?.patient || {};
  const canEnter = Auth.can('results.enter');
  const canVerify = Auth.can('results.verify');
  const locked = r.status === 'verified' && !canVerify;

  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <a href="#/results" class="btn btn-light btn-sm" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1 text-truncate">${esc(r.testName)}</h1>
      ${reportBadge(r.status)}
    </div>
    <div class="profile-card card-glow mb-3">
      <div class="d-flex align-items-center gap-3">
        ${UI.avatar(patient.name || '?', 'avatar-md')}
        <div class="min-w-0 flex-grow-1"><div class="fw-semibold text-truncate">${esc(patient.name || '')}</div>
          <div class="small text-body-secondary">MR ${esc(patient.mrNo || '')} · ${patient.age !== '' && patient.age != null ? esc(patient.age) + ' yrs' : 'age —'} · ${esc(genderLabel(patient.gender) || 'gender —')}</div>
          <div class="small text-body-secondary">${esc(r.billNumber)} · ${esc(fmtDate(r.date))}${bill?.doctorName ? ` · ${esc(bill.doctorName)}` : ''}</div></div>
      </div>
      <div class="small mt-2 text-body-secondary">${esc(r.department)}${r.sampleType ? ' · Sample: ' + esc(r.sampleType) : ''}</div>
    </div>

    <form id="res-form" class="${locked ? 'is-locked' : ''}" novalidate>
      ${r.params.length ? `<div class="list-card res-table mb-3">
        <div class="res-head"><span>Parameter</span><span>Result</span><span>Reference</span><span></span></div>
        ${r.params.map((p) => {
          const v = r.values[p.id] ?? '';
          const f = flagFor(p, v, patient);
          const ref = refText(p, patient);
          const unit = p.unit ? `<span class="res-unit">${esc(p.unit)}</span>` : '';
          let input;
          if (p.type === 'options') {
            input = `<select class="form-select res-in" data-pid="${esc(p.id)}" ${locked || !canEnter ? 'disabled' : ''}><option value="">—</option>${p.options.map((o) => `<option ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
          } else if (p.type === 'text') {
            input = `<input class="form-control res-in" data-pid="${esc(p.id)}" value="${esc(v)}" maxlength="200" ${locked || !canEnter ? 'disabled' : ''}>`;
          } else {
            input = `<div class="res-num"><input type="number" step="any" inputmode="decimal" class="form-control res-in" data-pid="${esc(p.id)}" data-num value="${esc(v)}" ${locked || !canEnter ? 'disabled' : ''}>${unit}</div>`;
          }
          return `<div class="res-row" data-pid="${esc(p.id)}">
            <div class="res-name"><b>${esc(p.name)}</b></div>
            <div class="res-input">${input}</div>
            <div class="res-ref small text-body-secondary">${ref ? esc(ref) : '—'}${p.type === 'number' && p.unit ? ` <span class="text-nowrap">${esc(p.unit)}</span>` : ''}</div>
            <div class="res-flag" data-flag>${flagBadge(f)}</div></div>`;
        }).join('')}
      </div>` : `<div class="alert alert-light small mb-3"><i class="bi bi-info-circle me-1"></i>This test has no structured parameters. Write the result in the remarks box below.</div>`}

      <label class="form-label small fw-semibold">Remarks / ${r.params.length ? 'interpretation' : 'result'}</label>
      <textarea class="form-control mb-3" rows="${r.params.length ? 3 : 6}" id="remarks" maxlength="1000" ${locked || !canEnter ? 'disabled' : ''}>${esc(r.remarks || '')}</textarea>
    </form>

    <div class="result-actions d-flex gap-2 flex-wrap no-print">
      ${canEnter && !locked ? `<button class="btn btn-outline-primary" id="save-res"><i class="bi bi-save me-1"></i>${r.status === 'pending' ? 'Save result' : 'Update result'}</button>` : ''}
      ${canVerify && !locked && r.status !== 'pending' ? `<button class="btn btn-grad" id="verify-res"><i class="bi bi-patch-check me-1"></i>Verify &amp; finalize</button>` : ''}
      ${r.status !== 'pending' ? `<button class="btn btn-light" id="print-res"><i class="bi bi-printer me-1"></i>Print report</button>` : ''}
      ${canVerify && r.status === 'verified' ? `<button class="btn btn-light" id="reopen-res"><i class="bi bi-arrow-counterclockwise me-1"></i>Reopen</button>` : ''}
      ${bill && reports.filter((x) => x.billId === bill.id && x.status !== 'void').length > 1 ? `<button class="btn btn-light" id="print-all"><i class="bi bi-files me-1"></i>Print all for bill</button>` : ''}
    </div>
    ${r.status === 'verified' ? `<p class="small text-body-secondary mt-3">Verified by ${esc(r.verifiedBy || '—')} on ${esc(fmtDate((r.verifiedAt || '').slice(0, 10)))}</p>` : ''}`;

  // Live flags while typing, using the same range rules the saved flags use.
  $(el).on('input', '.res-in[data-num]', function () {
    const row = $(this).closest('.res-row');
    const p = r.params.find((x) => x.id === row.data('pid'));
    row.find('[data-flag]').html(flagBadge(flagFor(p, this.value, patient)));
  });
  const collect = () => {
    const values = {};
    $('#res-form .res-in', el).each(function () { values[this.dataset.pid] = this.value; });
    return { values, remarks: $('#remarks', el).val() };
  };
  const run = async (verify) => {
    const { values, remarks } = collect();
    try {
      await UI.withLoading(() => saveResults(id, { values, remarks }, { verify }), verify ? 'Verifying…' : 'Saving…');
      UI.toast(verify ? 'Verified and finalized' : 'Result saved');
      renderEntry(el, id, ctx);
    } catch (e) { UI.toastError(e); }
  };
  $(el).on('click', '#save-res', () => run(false));
  $(el).on('click', '#verify-res', () => run(true));
  $(el).on('click', '#reopen-res', async () => {
    if (!await UI.confirmDialog('Reopen this report so the result can be corrected? It will need verifying again.', { okLabel: 'Reopen' })) return;
    try { await reopenReport(id); UI.toast('Report reopened'); renderEntry(el, id, ctx); } catch (e) { UI.toastError(e); }
  });
  $(el).on('click', '#print-res', () => printReports([r], bill));
  $(el).on('click', '#print-all', () => printReports(reports.filter((x) => x.billId === bill.id && x.status !== 'void' && x.status !== 'pending'), bill));
}

// ---------- Printable report ----------
export function printReports(list, bill) {
  if (!list.length) return UI.toast('Nothing to print yet. Enter results first.', 'warning');
  const html = list.map((r) => reportSheet(r, bill)).join('');
  printHtml(html, `Report ${bill?.number || ''}`);
}

function reportSheet(r, bill) {
  const lab = getSettings().lab;
  const patient = bill?.patient || {};
  const prelim = r.status !== 'verified';
  const rows = r.params.map((p) => {
    const v = r.values[p.id];
    if (v === undefined || v === '') return '';
    const f = flagFor(p, v, patient);
    const shown = f === 'H' || f === 'L' ? `<b>${esc(v)}</b>` : esc(v);
    return `<tr><td>${esc(p.name)}</td><td class="r">${shown}</td><td>${esc(p.unit || '')}</td><td>${esc(refText(p, patient) || '')}</td><td class="c">${f ? `<b>${f === 'N' ? '' : f}</b>` : ''}</td></tr>`;
  }).join('');
  return `<section class="pr-page">
    ${labHeader(lab.reportFooter)}
    ${prelim ? '<div class="pr-watermark">PRELIMINARY</div>' : ''}
    <div class="pr-title">LABORATORY REPORT · ${esc(r.testName.toUpperCase())}</div>
    <table class="pr-meta"><tr><td>Patient</td><td><b>${esc(patient.name || '')}</b></td><td>MR no.</td><td>${esc(patient.mrNo || '')}</td></tr>
      <tr><td>Age / Gender</td><td>${patient.age !== '' && patient.age != null ? esc(patient.age) + ' yrs' : '—'} / ${esc(genderLabel(patient.gender) || '—')}</td><td>Bill no.</td><td>${esc(r.billNumber)}</td></tr>
      <tr><td>Referred by</td><td>${bill?.doctorName ? esc(bill.doctorName) : 'Self'}</td><td>Report date</td><td>${esc(fmtDate(r.date))}</td></tr>
      <tr><td>Sample</td><td>${esc(r.sampleType || '—')}</td><td>Department</td><td>${esc(r.department)}</td></tr></table>
    ${r.params.length ? `<table class="pr-items"><thead><tr><th>Parameter</th><th class="r">Result</th><th>Unit</th><th>Reference</th><th class="c">Flag</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No values entered</td></tr>'}</tbody></table>` : ''}
    ${r.remarks ? `<div class="pr-remarks"><b>${r.params.length ? 'Interpretation' : 'Result'}:</b> ${esc(r.remarks).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="pr-sign"><div>${esc(r.enteredBy ? 'Entered by ' + r.enteredBy : '')}</div>
      <div>${esc(r.verifiedBy ? 'Verified by ' + r.verifiedBy : lab.signatory)}</div></div>
  </section>`;
}
