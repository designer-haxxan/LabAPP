// Billing: bill list, new bill (patient, doctor, tests and packages, discounts, payment), bill detail,
// payments, void and receipt printing.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, uuid, num, debounce, round2, today, monthStart } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { money, moneyPlain, dateFilter, rangeFor, bindDateFilter, pager } from '../core/views.js';
import { billBadge, reportBadge } from '../core/badges.js';
import { labHeader, printHtml } from '../core/print.js';
import { getBundle, createBill, collectPayment, voidBill } from '../services/data.js';
import { pickPatient, openPatientForm } from './patients.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const PAY_METHODS = { cash: 'Cash', card: 'Card', bank: 'Bank transfer', easypaisa: 'Easypaisa / JazzCash', cheque: 'Cheque' };
const payOptions = (sel) => Object.entries(PAY_METHODS).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');

export function receiptHtml(bill, payments = []) {
  const cur = getSettings().currency;
  const rows = bill.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.kind === 'group' ? ' <em>(package)</em>' : ''}</td><td class="r">${fmtNum(l.price)}</td></tr>`).join('');
  const paid = payments.filter((p) => p.amount > 0).map((p) => `<tr><td>${esc(fmtDate(p.date))}</td><td>${esc(PAY_METHODS[p.method] || p.method)}</td><td class="r">${fmtNum(p.amount)}</td></tr>`).join('');
  return `${labHeader()}
    <div class="pr-title">${bill.status === 'void' ? 'VOID BILL' : 'BILL / RECEIPT'}</div>
    <table class="pr-meta"><tr><td>Bill no.</td><td>${esc(bill.number)}</td><td>Date</td><td>${esc(fmtDate(bill.date))}</td></tr>
      <tr><td>Patient</td><td>${esc(bill.patient.name)}</td><td>MR no.</td><td>${esc(bill.patient.mrNo)}</td></tr>
      <tr><td>Age / Gender</td><td>${esc(bill.patient.age !== '' ? bill.patient.age + ' yrs' : '—')} / ${esc(bill.patient.gender || '—')}</td><td>Phone</td><td>${esc(bill.patient.phone || '—')}</td></tr>
      ${bill.doctorName ? `<tr><td>Referred by</td><td colspan="3">${esc(bill.doctorName)}</td></tr>` : ''}</table>
    <table class="pr-items"><thead><tr><th>#</th><th>Test / Package</th><th class="r">Amount (${esc(cur)})</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="pr-totals">
      <tr><td>Subtotal</td><td class="r">${fmtNum(bill.subtotal)}</td></tr>
      ${bill.discount ? `<tr><td>Discount</td><td class="r">- ${fmtNum(bill.discount)}</td></tr>` : ''}
      ${bill.tax ? `<tr><td>Tax (${bill.taxRate}%)</td><td class="r">${fmtNum(bill.tax)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="r">${fmtNum(bill.total)}</td></tr>
      <tr><td>Paid</td><td class="r">${fmtNum(bill.paid)}</td></tr>
      <tr><td>Balance due</td><td class="r">${fmtNum(bill.due)}</td></tr>
    </table>
    ${paid ? `<table class="pr-items pr-small-table"><thead><tr><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead><tbody>${paid}</tbody></table>` : ''}
    ${bill.voidReason ? `<p class="pr-small">Void reason: ${esc(bill.voidReason)}</p>` : ''}
    <p class="pr-small pr-center">Results will be issued on the report. Keep this receipt. ${esc(getSettings().lab.reportFooter || '')}</p>`;
}

// ---------- Router ----------
export async function render(el, ctx) {
  if (ctx.params[0] === 'new') return renderNew(el, ctx, ctx.params[1] || '');
  if (ctx.params[0]) return renderDetail(el, ctx.params[0], ctx);
  return renderList(el, ctx);
}

// ---------- List ----------
let listState = { from: monthStart(), to: today(), status: 'all', q: '' };

async function renderList(el, ctx) {
  ctx.setTitle?.('Billing');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Billing</h1>
      ${Auth.can('bill.create') ? '<a class="btn btn-grad btn-sm" href="#/bills/new"><i class="bi bi-plus-lg me-1"></i>New bill</a>' : ''}
    </div>
    ${dateFilter(listState.from, listState.to, `<div><label class="form-label small mb-0">Status</label>
      <select name="status" class="form-select form-select-sm">
        ${[['all', 'All'], ['due', 'Due'], ['partial', 'Partial'], ['paid', 'Paid'], ['void', 'Void']].map(([v, l]) => `<option value="${v}" ${listState.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>`)}
    <div class="search-box my-3"><i class="bi bi-search"></i>
      <input type="search" id="b-q" class="form-control" placeholder="Search bill no. or patient" value="${esc(listState.q)}" autocomplete="off"></div>
    <div id="b-kpis" class="row g-2 mb-3"></div>
    <div class="list-card" id="b-list"><div class="skel" style="height:120px"></div></div>`;
  bindDateFilter($(el), (from, to, fd) => { listState.from = from; listState.to = to; listState.status = fd.status || 'all'; loadList(el); });
  $(el).on('change', '[name=status]', function () { listState.status = this.value; loadList(el); });
  $(el).on('input', '#b-q', debounce(function () { listState.q = this.value.trim(); loadList(el); }, 200));
  loadList(el);
}

async function loadList(el) {
  const { bills, payments } = await getBundle(['bills', 'payments']);
  const [f, t] = [listState.from, listState.to];
  const inRange = (d) => d >= f && d <= t;
  const q = listState.q.toLowerCase();
  const rows = bills
    .filter((b) => inRange(b.date))
    .filter((b) => listState.status === 'all' || b.status === listState.status)
    .filter((b) => !q || b.number.toLowerCase().includes(q) || b.patient.name.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = rows.filter((b) => b.status !== 'void');
  const billed = live.reduce((s, b) => s + b.total, 0);
  const due = live.reduce((s, b) => s + b.due, 0);
  const collected = payments.filter((p) => inRange(p.date)).reduce((s, p) => s + p.amount, 0);
  $('#b-kpis', el).html(`
    <div class="col-4"><div class="kpi kpi-indigo"><div class="kpi-label">Billed</div><div class="kpi-value" data-count="${round2(billed)}">${money(billed)}</div></div></div>
    <div class="col-4"><div class="kpi kpi-green"><div class="kpi-label">Collected</div><div class="kpi-value" data-count="${round2(collected)}">${money(collected)}</div></div></div>
    <div class="col-4"><div class="kpi kpi-rose"><div class="kpi-label">Due</div><div class="kpi-value" data-count="${round2(due)}">${money(due)}</div></div></div>`);
  UI.countUp($('#b-kpis', el)[0], (n) => moneyPlain(n));
  pager($('#b-list', el), rows, (b) => `
    <a class="list-row" href="#/bills/${b.id}">
      <div class="bill-ico"><i class="bi bi-receipt"></i></div>
      <div class="flex-grow-1 min-w-0">
        <div class="fw-semibold text-truncate">${esc(b.patient.name)} <span class="small text-body-secondary">· ${esc(b.number)}</span></div>
        <div class="small text-body-secondary text-truncate">${esc(fmtDate(b.date))} · ${b.lines.length === 1 ? '1 item' : b.lines.length + ' items'}${b.doctorName ? ` · ${esc(b.doctorName)}` : ''}</div>
      </div>
      <div class="text-end"><div class="fw-semibold">${money(b.total)}</div>${billBadge(b.status)}</div></a>`, 40,
  UI.emptyState('No bills for these filters', 'receipt', Auth.can('bill.create') ? '<a class="btn btn-grad btn-sm mt-2" href="#/bills/new">Create a bill</a>' : ''));
}

// ---------- New bill ----------
async function renderNew(el, ctx, patientId) {
  ctx.setTitle?.('New bill');
  const { tests, groups, doctors, patients } = await getBundle(['tests', 'groups', 'doctors', 'patients']);
  const st = {
    billId: uuid(), patient: patients.find((p) => p.id === patientId) || null,
    doctorId: '', lines: [], discount: '', paid: '', method: 'cash', note: '', printAfter: true,
  };
  const activeTests = tests.filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name));
  const activeGroups = groups.filter((g) => g.active).sort((a, b) => a.name.localeCompare(b.name));
  const activeDocs = doctors.filter((d) => d.active).sort((a, b) => a.name.localeCompare(b.name));
  const taxRate = Math.max(0, num(getSettings().taxRate, 0));
  const lineFor = (kind, item) => ({ kind, refId: item.id, name: item.name, listPrice: item.price, price: item.price });

  el.innerHTML = `
    <form class="bill-new" autocomplete="off" novalidate>
      <div class="bill-grid">
        <section class="card-glow panel" id="s-patient">
          <div class="panel-title"><span class="step">1</span> Patient</div>
          <div id="patient-box"></div>
          <div class="d-flex gap-2 mt-2 flex-wrap">
            <button type="button" class="btn btn-outline-primary btn-sm" id="pick-patient"><i class="bi bi-search me-1"></i>Find patient</button>
            ${Auth.can('patient.edit') ? '<button type="button" class="btn btn-light btn-sm" id="new-patient"><i class="bi bi-person-plus me-1"></i>Register new</button>' : ''}
          </div>
          <label class="form-label mt-3 mb-1 small">Referring doctor (optional)</label>
          <select class="form-select" id="doctor">
            <option value="">Self / walk-in</option>
            ${activeDocs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.specialty ? ` — ${esc(d.specialty)}` : ''} (${fmtNum(d.commissionPct)}%)</option>`).join('')}
          </select>
        </section>

        <section class="card-glow panel" id="s-items">
          <div class="panel-title"><span class="step">2</span> Tests &amp; packages</div>
          <div class="search-box mb-2"><i class="bi bi-search"></i>
            <input type="search" class="form-control" id="t-q" placeholder="Search tests, e.g. CBC, sugar, lipid" autocomplete="off"></div>
          <div class="chip-row mb-2" id="t-chips">
            ${activeGroups.slice(0, 6).map((g) => `<button type="button" class="chip chip-pkg" data-add-group="${esc(g.id)}"><i class="bi bi-box2-heart me-1"></i>${esc(g.name)}</button>`).join('')}
          </div>
          <div class="pick-results list-card mb-3" id="t-results"></div>
          <div class="panel-subtitle">Selected (<span id="cart-count">0</span>)</div>
          <div class="cart" id="cart"></div>
        </section>

        <aside class="card-glow panel totals-panel" id="s-totals">
          <div class="panel-title"><span class="step">3</span> Payment</div>
          <dl class="totals" id="totals"></dl>
          <div class="row g-2 mt-1">
            <div class="col-6"><label class="form-label small mb-1">Discount (${esc(getSettings().currency)})</label>
              <input type="number" min="0" step="0.01" inputmode="decimal" class="form-control" id="discount" value=""></div>
            <div class="col-6"><label class="form-label small mb-1">Amount paid now</label>
              <div class="input-group"><input type="number" min="0" step="0.01" inputmode="decimal" class="form-control" id="paid" value="">
                <button type="button" class="btn btn-outline-primary" id="pay-full" title="Pay full amount">Full</button></div></div>
            <div class="col-12"><label class="form-label small mb-1">Payment method</label>
              <select class="form-select" id="method">${payOptions('cash')}</select></div>
            <div class="col-12"><label class="form-label small mb-1">Note (optional)</label>
              <input class="form-control" id="note" maxlength="300" placeholder="e.g. urgent, fasting sample"></div>
          </div>
          <div class="form-check mt-3"><input class="form-check-input" type="checkbox" id="print-after" checked>
            <label class="form-check-label small" for="print-after">Print receipt after saving</label></div>
          <button type="button" class="btn btn-grad btn-lg w-100 mt-3 btn-save" id="save-bill" disabled><i class="bi bi-check2-circle me-1"></i>Save bill</button>
        </aside>
      </div>
    </form>`;

  const $el = $(el);
  const paintPatient = () => {
    const p = st.patient;
    $('#patient-box', el).html(p ? `
      <div class="patient-chip anim-pop">
        ${UI.avatar(p.name, 'avatar-md')}
        <div class="min-w-0 flex-grow-1"><div class="fw-semibold text-truncate">${esc(p.name)}</div>
          <div class="small text-body-secondary text-truncate">${esc(p.mrNo)}${p.age !== '' ? ` · ${p.age} yrs` : ''}${p.gender ? ` · ${esc(p.gender)}` : ''}${p.phone ? ` · ${esc(p.phone)}` : ''}</div></div>
      </div>` : `<div class="empty-hint"><i class="bi bi-person-plus"></i><span>Select who the tests are for</span></div>`);
    refreshSave();
  };
  const readInputs = () => {
    st.discount = $('#discount', el).val(); st.paid = $('#paid', el).val();
    st.method = $('#method', el).val(); st.note = $('#note', el).val();
    st.doctorId = $('#doctor', el).val(); st.printAfter = $('#print-after', el).is(':checked');
  };
  const calc = () => {
    const subtotal = round2(st.lines.reduce((s, l) => s + (num(l.price, 0) || 0), 0));
    const discount = round2(Math.min(Math.max(num(st.discount, 0), 0), subtotal));
    const tax = round2((subtotal - discount) * taxRate / 100);
    const total = round2(subtotal - discount + tax);
    const paid = round2(Math.min(Math.max(num(st.paid, 0), 0), total));
    return { subtotal, discount, tax, total, paid, due: round2(total - paid) };
  };
  const paintTotals = () => {
    const c = calc();
    $('#totals', el).html(`
      <div><dt>Subtotal</dt><dd>${fmtNum(c.subtotal)}</dd></div>
      ${c.discount ? `<div class="text-success"><dt>Discount</dt><dd>− ${fmtNum(c.discount)}</dd></div>` : ''}
      ${c.tax ? `<div><dt>Tax (${taxRate}%)</dt><dd>${fmtNum(c.tax)}</dd></div>` : ''}
      <div class="grand"><dt>Total</dt><dd><span data-count="${c.total}">${fmtNum(c.total)}</span></dd></div>
      <div><dt>Paid now</dt><dd>${fmtNum(c.paid)}</dd></div>
      <div class="${c.due > 0 ? 'text-danger' : 'text-success'}"><dt>Balance due</dt><dd>${fmtNum(c.due)}</dd></div>`);
    $('#totals .grand [data-count]', el).addClass('bump');
    refreshSave();
  };
  const paintCart = () => {
    $('#cart-count', el).text(st.lines.length);
    $('#cart', el).html(st.lines.length ? st.lines.map((l, i) => `
      <div class="cart-line anim-slide" data-i="${i}">
        <div class="min-w-0 flex-grow-1">
          <div class="fw-semibold text-truncate">${esc(l.name)}</div>
          <div class="small text-body-secondary">${l.kind === 'group' ? 'Package' : 'Test'} · list ${fmtNum(l.listPrice)}</div>
        </div>
        <input type="number" min="0" step="0.01" inputmode="decimal" class="form-control form-control-sm cart-price" value="${l.price}" aria-label="Price for ${esc(l.name)}">
        <button type="button" class="btn btn-link text-danger p-1 cart-remove" aria-label="Remove"><i class="bi bi-x-lg"></i></button>
      </div>`).join('') : `<div class="empty-hint"><i class="bi bi-eyedropper"></i><span>No tests yet. Search above or pick a package.</span></div>`);
    paintTotals();
  };
  const addLine = (kind, item) => {
    if (st.lines.some((l) => l.kind === kind && l.refId === item.id)) { UI.toast(`${item.name} is already added`, 'info'); return; }
    st.lines.push(lineFor(kind, item));
    paintCart();
  };
  const searchTests = () => {
    const q = $('#t-q', el).val().trim().toLowerCase();
    const hits = [
      ...activeGroups.filter((g) => !q || g.name.toLowerCase().includes(q) || (g.code || '').toLowerCase().includes(q)).map((g) => ({ kind: 'group', item: g })),
      ...activeTests.filter((t) => !q || t.name.toLowerCase().includes(q) || (t.code || '').toLowerCase().includes(q) || (t.department || '').toLowerCase().includes(q)).map((t) => ({ kind: 'test', item: t })),
    ].slice(0, q ? 30 : 12);
    $('#t-results', el).html(hits.length ? hits.map((h, i) => `
      <button type="button" class="list-row pick-row" data-k="${i}">
        <span class="kind-dot kind-${h.kind}"></span>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(h.item.name)}</div>
          <div class="small text-body-secondary text-truncate">${h.kind === 'group' ? `Package · ${h.item.testIds.length} tests` : esc(h.item.department)}${h.item.sampleType ? ` · ${esc(h.item.sampleType)}` : ''}</div></div>
        <div class="text-end"><div class="fw-semibold">${fmtNum(h.item.price)}</div><span class="add-ico"><i class="bi bi-plus-lg"></i></span></div>
      </button>`).join('') : `<div class="p-3 small text-body-secondary text-center">No match for "${esc(q)}"</div>`);
    $('#t-results', el).data('hits', hits);
  };

  $el.on('click', '#pick-patient', async () => { const p = await pickPatient(); if (p) { st.patient = p; paintPatient(); } });
  $el.on('click', '#new-patient', async () => { const p = await openPatientForm(); if (p) { st.patient = p; paintPatient(); UI.toast(`Registered ${p.mrNo}`); } });
  $el.on('input', '#t-q', debounce(searchTests, 80));
  $el.on('click', '#t-results .pick-row', function () {
    const h = $('#t-results', el).data('hits')[+this.dataset.k];
    if (h) addLine(h.kind, h.item);
  });
  $el.on('click', '[data-add-group]', function () {
    const g = activeGroups.find((x) => x.id === this.dataset.addGroup);
    if (g) addLine('group', g);
  });
  $el.on('input change', '.cart-price', function () {
    const i = +$(this).closest('.cart-line').data('i');
    st.lines[i].price = this.value;
    paintTotals();
  });
  $el.on('click', '.cart-remove', function () {
    st.lines.splice(+$(this).closest('.cart-line').data('i'), 1);
    paintCart();
  });
  $el.on('input change', '#discount, #paid, #method, #note, #doctor, #print-after', () => { readInputs(); paintTotals(); });
  $el.on('click', '#pay-full', () => { readInputs(); st.paid = String(calc().total); $('#paid', el).val(st.paid); paintTotals(); });
  $el.on('click', '#save-bill', async () => {
    readInputs();
    const $btn = $('#save-bill', el).prop('disabled', true);
    try {
      const bill = await UI.withLoading(() => createBill({
        id: st.billId, patientId: st.patient?.id, doctorId: st.doctorId,
        lines: st.lines.map((l) => ({ kind: l.kind, refId: l.refId, price: l.price })),
        discount: st.discount || 0, paid: st.paid || 0, method: st.method, note: st.note,
      }), 'Saving bill…');
      UI.toast(`Saved ${bill.number}`);
      if (st.printAfter) setTimeout(() => printBill(bill.id), 300);
      location.hash = `#/bills/${bill.id}`;
    } catch (e) {
      UI.toastError(e);
      refreshSave();
    }
  });

  function refreshSave() {
    $('#save-bill', el).prop('disabled', !(st.patient && st.lines.length));
  }
  paintPatient();
  paintCart();
  searchTests();
  setTimeout(() => $('#t-q', el).trigger('focus'), 60);
}

// ---------- Detail ----------
async function renderDetail(el, id, ctx) {
  const { bills, payments, reports } = await getBundle(['bills', 'payments', 'reports']);
  const bill = bills.find((b) => b.id === id);
  ctx.setTitle?.(bill ? bill.number : 'Bill');
  if (!bill) { el.innerHTML = UI.emptyState('Bill not found.', 'receipt'); return; }
  const pays = payments.filter((p) => p.billId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reps = reports.filter((r) => r.billId === id);
  const voidable = bill.status !== 'void' && reps.every((r) => r.status === 'pending') && Auth.can('bill.void');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <a href="#/bills" class="btn btn-light btn-sm" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1 text-truncate">${esc(bill.number)}</h1>
      ${billBadge(bill.status)}
    </div>
    <div class="profile-card card-glow mb-3">
      <div class="d-flex align-items-start gap-3">
        ${UI.avatar(bill.patient.name, 'avatar-lg')}
        <div class="min-w-0 flex-grow-1"><div class="fw-semibold fs-5 text-truncate">${esc(bill.patient.name)}</div>
          <div class="small text-body-secondary">MR ${esc(bill.patient.mrNo)} · ${esc(fmtDate(bill.date))}${bill.doctorName ? ` · ${esc(bill.doctorName)}` : ''}</div>
          ${bill.note ? `<div class="small mt-1">Note: ${esc(bill.note)}</div>` : ''}
          ${bill.voidReason ? `<div class="small text-danger mt-1">Void: ${esc(bill.voidReason)}</div>` : ''}</div>
      </div>
      <div class="d-flex gap-2 flex-wrap mt-3 no-print">
        <button class="btn btn-outline-primary btn-sm" id="print-bill"><i class="bi bi-printer me-1"></i>Print receipt</button>
        ${bill.due > 0 && bill.status !== 'void' && Auth.can('payment.collect') ? `<button class="btn btn-grad btn-sm" id="collect"><i class="bi bi-cash-coin me-1"></i>Collect ${fmtNum(bill.due)}</button>` : ''}
        ${voidable ? '<button class="btn btn-outline-danger btn-sm" id="void"><i class="bi bi-x-octagon me-1"></i>Void bill</button>' : ''}
      </div>
    </div>

    <div class="row g-2 mb-3 stagger">
      <div class="col-6 col-md-3"><div class="kpi kpi-indigo"><div class="kpi-label">Total</div><div class="kpi-value" data-count="${bill.total}">${money(bill.total)}</div></div></div>
      <div class="col-6 col-md-3"><div class="kpi kpi-green"><div class="kpi-label">Paid</div><div class="kpi-value" data-count="${bill.paid}">${money(bill.paid)}</div></div></div>
      <div class="col-6 col-md-3"><div class="kpi kpi-rose"><div class="kpi-label">Balance due</div><div class="kpi-value" data-count="${bill.due}">${money(bill.due)}</div></div></div>
      <div class="col-6 col-md-3"><div class="kpi kpi-amber"><div class="kpi-label">Doctor commission</div><div class="kpi-value" data-count="${bill.commissionAmount}">${money(bill.commissionAmount)}</div></div></div>
    </div>

    <h2 class="h6 mt-3 mb-2">Items</h2>
    <div class="list-card mb-3">${bill.lines.map((l) => `
      <div class="list-row"><div class="flex-grow-1 min-w-0"><div class="fw-semibold">${esc(l.name)}</div>
        <div class="small text-body-secondary">${l.kind === 'group' ? 'Package · ' : ''}${l.tests.map((t) => esc(t.name)).join(', ')}</div></div>
        <div class="fw-semibold">${fmtNum(l.price)}</div></div>`).join('')}
      <div class="list-row bg-body-tertiary small"><div class="flex-grow-1">Subtotal${bill.discount ? ' · discount ' + fmtNum(bill.discount) : ''}${bill.tax ? ' · tax ' + fmtNum(bill.tax) : ''}</div><div class="fw-semibold">${fmtNum(bill.total)}</div></div>
    </div>

    <h2 class="h6 mt-3 mb-2">Tests & results</h2>
    <div class="list-card mb-3">${reps.length ? reps.map((r) => `
      <a class="list-row" href="#/results/${r.id}">
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(r.testName)}</div>
          <div class="small text-body-secondary">${esc(r.department)}${r.sampleType ? ' · ' + esc(r.sampleType) : ''}</div></div>
        ${reportBadge(r.status)}<i class="bi bi-chevron-right text-body-secondary ms-2"></i></a>`).join('') : UI.emptyState('No tests on this bill', 'clipboard')}</div>

    <h2 class="h6 mt-3 mb-2">Payments</h2>
    <div class="list-card mb-3">${pays.length ? pays.map((p) => `
      <div class="list-row"><div class="flex-grow-1"><div class="fw-semibold">${esc(PAY_METHODS[p.method] || p.method)}${p.note ? ` <span class="small text-body-secondary">· ${esc(p.note)}</span>` : ''}</div>
        <div class="small text-body-secondary">${esc(fmtDate(p.date))}</div></div>
        <div class="fw-semibold ${p.amount < 0 ? 'text-danger' : 'text-success'}">${p.amount < 0 ? '−' : '+'} ${fmtNum(Math.abs(p.amount))}</div></div>`).join('') : UI.emptyState('No payments yet', 'cash')}</div>`;

  UI.countUp(el, (n) => moneyPlain(n));
  $(el).on('click', '#print-bill', () => printBill(bill.id));
  $(el).on('click', '#collect', () => collectDialog(bill, () => renderDetail(el, id, ctx)));
  $(el).on('click', '#void', () => voidDialog(bill, () => renderDetail(el, id, ctx)));
}

export function printBill(id) {
  getBundle(['bills', 'payments']).then(({ bills, payments }) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill) return;
    printHtml(receiptHtml(bill, payments.filter((p) => p.billId === id)), bill.number);
  });
}

async function collectDialog(bill, done) {
  const payId = uuid();
  const res = await UI.formModal({
    title: `Collect payment · ${bill.number}`,
    submitLabel: 'Record payment',
    body: `<div class="alert alert-light small mb-3">Balance due: <b>${money(bill.due)}</b></div>
      <div class="row g-3">
        <div class="col-6"><label class="form-label">Amount</label>
          <input name="amount" type="number" step="0.01" min="0.01" max="${bill.due}" inputmode="decimal" class="form-control form-control-lg" value="${bill.due}" required></div>
        <div class="col-6"><label class="form-label">Method</label><select name="method" class="form-select">${payOptions('cash')}</select></div>
        <div class="col-12"><label class="form-label">Note</label><input name="note" class="form-control" maxlength="200"></div>
      </div>`,
    onSubmit: (v) => collectPayment(bill.id, { id: payId, amount: v.amount, method: v.method, note: v.note }),
  });
  if (res) { UI.toast('Payment recorded'); done(); }
}

async function voidDialog(bill, done) {
  const res = await UI.formModal({
    title: `Void ${bill.number}?`,
    submitLabel: 'Void bill', submitClass: 'btn-danger',
    body: `<p class="small text-body-secondary">Only possible while no results have been entered. Any money paid is returned as a refund entry.</p>
      <label class="form-label">Reason *</label><input name="reason" class="form-control" maxlength="200" required>`,
    onSubmit: (v) => voidBill(bill.id, v.reason),
  });
  if (res) { UI.toast('Bill voided'); done(); }
}
