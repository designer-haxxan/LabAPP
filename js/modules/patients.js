// Patients: registration (auto MR number), search, profile with visit history.
import * as UI from '../core/ui.js';
import { esc, fmtDate, debounce } from '../core/utils.js';
import { money, pager } from '../core/views.js';
import { genderLabel, billBadge } from '../core/badges.js';
import { listStore, getBundle, savePatient } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;

// Opens the registration form. Resolves with the saved patient, or undefined when cancelled.
export function openPatientForm(existing = null) {
  const p = existing || {};
  return UI.formModal({
    title: existing ? 'Edit patient' : 'New patient',
    submitLabel: existing ? 'Save changes' : 'Register patient',
    body: `<div class="row g-3">
      <div class="col-12"><label class="form-label">Full name *</label>
        <input name="name" class="form-control form-control-lg" required maxlength="120" value="${esc(p.name || '')}" autocapitalize="words"></div>
      <div class="col-6"><label class="form-label">Age (years)</label>
        <input name="age" type="number" inputmode="numeric" min="0" max="130" class="form-control" value="${esc(p.age ?? '')}"></div>
      <div class="col-6"><label class="form-label">Gender</label>
        <select name="gender" class="form-select">
          <option value="">Not set</option>
          ${['male', 'female', 'other'].map((g) => `<option value="${g}" ${p.gender === g ? 'selected' : ''}>${genderLabel(g)}</option>`).join('')}
        </select></div>
      <div class="col-12"><label class="form-label">Mobile / phone</label>
        <input name="phone" type="tel" inputmode="tel" class="form-control" maxlength="30" value="${esc(p.phone || '')}"></div>
      <div class="col-12"><label class="form-label">Address</label>
        <input name="address" class="form-control" maxlength="300" value="${esc(p.address || '')}"></div>
    </div>`,
    onSubmit: (v) => savePatient({ ...v, id: p.id }),
  });
}

// Searchable patient picker used by billing. Resolves with the chosen patient, or undefined.
export function pickPatient() {
  return UI.pick({
    title: 'Find patient',
    placeholder: 'Name, phone or MR number',
    search: async (q) => {
      const s = q.toLowerCase();
      const all = await listStore('patients');
      return all
        .filter((p) => !s || p.nameLc.includes(s) || (p.phone || '').includes(s) || (p.mrNo || '').toLowerCase().includes(s))
        .sort((a, b) => a.nameLc.localeCompare(b.nameLc))
        .slice(0, 60)
        .map((p) => ({
          id: p.id, value: p, title: p.name,
          subtitle: [p.mrNo, p.age !== '' ? `${p.age} yrs` : '', genderLabel(p.gender), p.phone].filter(Boolean).join(' · '),
        }));
    },
    addNew: { label: 'Register new patient', create: async () => (await openPatientForm()) || undefined },
  });
}

let all = [];
let query = '';

export async function render(el, ctx) {
  if (ctx.params[0]) return renderProfile(el, ctx.params[0], ctx);
  ctx.setTitle?.('Patients');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Patients</h1>
      ${Auth.can('patient.edit') ? '<button class="btn btn-grad btn-sm" id="new-patient"><i class="bi bi-person-plus me-1"></i>New patient</button>' : ''}
    </div>
    <div class="search-box mb-3"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="p-q" placeholder="Search by name, phone or MR number" autocomplete="off" value="${esc(query)}"></div>
    <div id="p-count" class="small text-body-secondary mb-2"></div>
    <div class="list-card" id="p-list"></div>`;
  $(el).on('click', '#new-patient', async () => {
    const p = await openPatientForm();
    if (p) { UI.toast(`Registered ${p.mrNo}`); location.hash = `#/patients/${p.id}`; }
  });
  $(el).on('input', '#p-q', debounce(() => { query = $('#p-q').val().trim(); draw(el); }, 150));
  all = await listStore('patients');
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  draw(el);
}

function draw(el) {
  const s = query.toLowerCase();
  const rows = all.filter((p) => !s || p.nameLc.includes(s) || (p.phone || '').includes(s) || (p.mrNo || '').toLowerCase().includes(s));
  $('#p-count', el).text(`${rows.length} of ${all.length} patients`);
  pager($('#p-list', el), rows, (p) => `
    <a class="list-row" href="#/patients/${p.id}">
      ${UI.avatar(p.name, 'avatar-sm')}
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(p.name)}</div>
        <div class="small text-body-secondary text-truncate">${[esc(p.mrNo), p.age !== '' ? `${p.age} yrs` : '', esc(genderLabel(p.gender)), esc(p.phone)].filter(Boolean).join(' · ')}</div></div>
      <i class="bi bi-chevron-right text-body-secondary"></i></a>`, 40,
  UI.emptyState(all.length ? 'No patients match your search' : 'No patients yet. Register the first patient.', 'person-plus'));
}

async function renderProfile(el, id, ctx) {
  const { patients, bills } = await getBundle(['patients', 'bills']);
  const p = patients.find((x) => x.id === id);
  ctx.setTitle?.(p ? p.name : 'Patient');
  if (!p) { el.innerHTML = UI.emptyState('Patient not found.', 'person-x'); return; }
  const history = bills.filter((b) => b.patientId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = history.filter((b) => b.status !== 'void');
  const totalBilled = live.reduce((s, b) => s + b.total, 0);
  const outstanding = live.reduce((s, b) => s + b.due, 0);
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <a href="#/patients" class="btn btn-light btn-sm" aria-label="Back"><i class="bi bi-arrow-left"></i></a>
      <h1 class="h5 mb-0 flex-grow-1 text-truncate">${esc(p.name)}</h1>
      ${Auth.can('patient.edit') ? '<button class="btn btn-outline-primary btn-sm" id="edit-p"><i class="bi bi-pencil me-1"></i>Edit</button>' : ''}
      ${Auth.can('bill.create') ? `<a class="btn btn-grad btn-sm" href="#/bills/new/${encodeURIComponent(p.id)}"><i class="bi bi-plus-lg me-1"></i>New bill</a>` : ''}
    </div>
    <div class="profile-card card-glow mb-3">
      <div class="d-flex align-items-center gap-3">
        ${UI.avatar(p.name, 'avatar-lg')}
        <div class="min-w-0"><div class="fw-semibold fs-5 text-truncate">${esc(p.name)}</div>
          <div class="small text-body-secondary">MR ${esc(p.mrNo)}</div></div>
      </div>
      <div class="info-grid mt-3">
        <div><span>Age</span><b>${p.age !== '' ? `${p.age} yrs` : '—'}</b></div>
        <div><span>Gender</span><b>${esc(genderLabel(p.gender) || '—')}</b></div>
        <div><span>Phone</span><b>${esc(p.phone || '—')}</b></div>
        <div><span>Registered</span><b>${esc(fmtDate(p.createdAt.slice(0, 10)))}</b></div>
        ${p.address ? `<div class="span-2"><span>Address</span><b>${esc(p.address)}</b></div>` : ''}
      </div>
    </div>
    <div class="row g-2 mb-3 stagger">
      <div class="col-6"><div class="kpi kpi-indigo"><div class="kpi-label">Total billed</div><div class="kpi-value" data-count="${totalBilled}">${money(totalBilled)}</div></div></div>
      <div class="col-6"><div class="kpi kpi-rose"><div class="kpi-label">Outstanding</div><div class="kpi-value" data-count="${outstanding}">${money(outstanding)}</div></div></div>
    </div>
    <h2 class="h6 mt-4 mb-2">Visit history</h2>
    <div class="list-card">${history.length ? history.map((b) => `
      <a class="list-row" href="#/bills/${b.id}">
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${esc(b.number)} <span class="small text-body-secondary">· ${esc(fmtDate(b.date))}</span></div>
          <div class="small text-body-secondary text-truncate">${b.lines.map((l) => esc(l.name)).join(', ')}</div></div>
        <div class="text-end">${billBadge(b.status)}<div class="small fw-semibold mt-1">${money(b.total)}</div></div>
      </a>`).join('') : UI.emptyState('No bills yet for this patient', 'receipt')}</div>`;
  $(el).on('click', '#edit-p', async () => {
    const saved = await openPatientForm(p);
    if (saved) { UI.toast('Patient updated'); renderProfile(el, id, ctx); }
  });
  UI.countUp(el, (n) => money(n));
}
