// Referring doctors: contact details, commission rate, and how many tests and how much commission each sent.
import * as UI from '../core/ui.js';
import { esc, fmtNum, debounce, monthStart, today } from '../core/utils.js';
import { money, dateFilter, bindDateFilter, pager } from '../core/views.js';
import { getBundle, saveDoctor, deleteIfUnused } from '../services/data.js';
import { getSettings } from '../core/settings.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

export function openDoctorForm(existing = null) {
  const d = existing || {};
  return UI.formModal({
    title: existing ? 'Edit doctor' : 'New referring doctor',
    submitLabel: existing ? 'Save changes' : 'Add doctor',
    body: `<div class="row g-3">
      <div class="col-12"><label class="form-label">Doctor name *</label>
        <input name="name" class="form-control form-control-lg" required maxlength="120" value="${esc(d.name || '')}" placeholder="Dr. Full name"></div>
      <div class="col-7"><label class="form-label">Specialty</label>
        <input name="specialty" class="form-control" maxlength="80" value="${esc(d.specialty || '')}" placeholder="Medicine, Gynae, Peds…"></div>
      <div class="col-5"><label class="form-label">Commission %</label>
        <input name="commissionPct" type="number" min="0" max="100" step="0.5" inputmode="decimal" class="form-control" value="${esc(d.commissionPct ?? getSettings().defaultCommission)}"></div>
      <div class="col-12"><label class="form-label">Phone / clinic</label>
        <input name="phone" type="tel" class="form-control" maxlength="30" value="${esc(d.phone || '')}"></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="d-active" ${d.active !== false ? 'checked' : ''}>
        <label class="form-check-label" for="d-active">Active (shown when billing)</label></div></div>
    </div>`,
    onSubmit: (v) => saveDoctor({ ...v, id: existing?.id }),
  });
}

let state = { from: monthStart(), to: today(), q: '' };

export async function render(el, ctx) {
  ctx.setTitle?.('Referring Doctors');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Referring Doctors</h1>
      ${Auth.can('doctor.manage') ? '<button class="btn btn-grad btn-sm" id="add-doc"><i class="bi bi-plus-lg me-1"></i>Add doctor</button>' : ''}
    </div>
    ${dateFilter(state.from, state.to)}
    <div class="search-box my-3"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="dq" placeholder="Search doctor or specialty" value="${esc(state.q)}" autocomplete="off"></div>
    <div id="doc-kpis" class="row g-2 mb-3"></div>
    <div class="list-card" id="doc-list"></div>`;
  bindDateFilter($(el), (from, to) => { state.from = from; state.to = to; load(el); });
  $(el).on('input', '#dq', debounce(function () { state.q = this.value.trim().toLowerCase(); load(el); }, 150));
  $(el).on('click', '#add-doc', async () => { if (await openDoctorForm()) { UI.toast('Doctor added'); load(el); } });
  $(el).on('click', '[data-doc]', async function (ev) {
    if ($(ev.target).closest('[data-del-doc]').length) return;
    const { doctors } = await getBundle(['doctors']);
    const d = doctors.find((x) => x.id === this.dataset.doc);
    if (d && await openDoctorForm(d)) { UI.toast('Doctor updated'); load(el); }
  });
  $(el).on('click', '[data-del-doc]', async function (e) {
    e.stopPropagation();
    const id = this.dataset.delDoc;
    if (!await UI.confirmDialog('Delete this doctor? Doctors who already have bills cannot be deleted; make them inactive instead.', { okLabel: 'Delete', okClass: 'btn-danger' })) return;
    try { await deleteIfUnused('doctors', id, [{ store: 'bills', index: 'doctorId', label: 'bills' }]); UI.toast('Doctor deleted'); load(el); }
    catch (err) { UI.toastError(err); }
  });
  load(el);
}

async function load(el) {
  const { doctors, bills } = await getBundle(['doctors', 'bills']);
  const inRange = (b) => b.date >= state.from && b.date <= state.to && b.status !== 'void';
  const stats = {};
  for (const b of bills) {
    if (!b.doctorId || !inRange(b)) continue;
    const s = (stats[b.doctorId] ||= { count: 0, sales: 0, commission: 0 });
    s.count += 1; s.sales += b.subtotal - b.discount; s.commission += b.commissionAmount;
  }
  const rows = doctors
    .filter((d) => !state.q || d.nameLc.includes(state.q) || (d.specialty || '').toLowerCase().includes(state.q))
    .sort((a, b) => (stats[b.id]?.commission || 0) - (stats[a.id]?.commission || 0) || a.name.localeCompare(b.name));
  const totalComm = Object.values(stats).reduce((s, x) => s + x.commission, 0);
  const totalCount = Object.values(stats).reduce((s, x) => s + x.count, 0);
  $('#doc-kpis', el).html(`
    <div class="col-6"><div class="kpi kpi-violet"><div class="kpi-label">Bills referred</div><div class="kpi-value" data-count="${totalCount}">${totalCount}</div></div></div>
    <div class="col-6"><div class="kpi kpi-amber"><div class="kpi-label">Commission payable</div><div class="kpi-value" data-count="${totalComm}" data-money>${money(totalComm)}</div></div></div>`);
  UI.countUp($('#doc-kpis', el)[0], (n, node) => (node.dataset.money !== undefined ? money(n) : String(Math.round(n))));
  pager($('#doc-list', el), rows, (d) => {
    const s = stats[d.id] || { count: 0, sales: 0, commission: 0 };
    return `<div class="list-row ${d.active ? '' : 'is-off'}" data-doc="${esc(d.id)}" role="button" tabindex="0">
      ${UI.avatar(d.name, 'avatar-sm')}
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(d.name)} ${d.active ? '' : '<span class="pill pill-secondary">inactive</span>'}</div>
        <div class="small text-body-secondary text-truncate">${[esc(d.specialty), `${fmtNum(d.commissionPct)}% commission`, esc(d.phone)].filter(Boolean).join(' · ')}</div>
        <div class="small mt-1"><span class="pill pill-indigo">${s.count} bills</span> <span class="pill pill-amber">Commission ${money(s.commission)}</span></div></div>
      <button class="btn btn-link text-danger p-1" data-del-doc="${esc(d.id)}" aria-label="Delete doctor"><i class="bi bi-trash"></i></button></div>`;
  }, 40, UI.emptyState(doctors.length ? 'No doctors match' : 'No referring doctors yet. Add the doctors who send patients to you.', 'heart-pulse'));
}
