// Tests & packages: a dynamic test builder (any number of parameters, each numeric / text / option based,
// with reference ranges per gender and age) and packages that bundle tests at one price.
import * as UI from '../core/ui.js';
import { esc, num, uuid, debounce } from '../core/utils.js';
import { money } from '../core/views.js';
import { listStore, saveTest, saveGroup, normalizeTest } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const GENDERS = [['any', 'Any'], ['male', 'Male'], ['female', 'Female']];
const TYPES = [['number', 'Numeric'], ['options', 'Options'], ['text', 'Free text']];

let tab = 'tests';
let q = '';
let data = { tests: [], groups: [] };

export async function render(el, ctx) {
  ctx.setTitle?.('Tests & Packages');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Tests &amp; Packages</h1>
      ${Auth.can('catalog.manage') ? `<button class="btn btn-grad btn-sm" id="add-item"><i class="bi bi-plus-lg me-1"></i><span>${tab === 'tests' ? 'New test' : 'New package'}</span></button>` : ''}
    </div>
    <div class="seg mb-3" role="tablist">
      <button class="seg-btn ${tab === 'tests' ? 'active' : ''}" data-tab="tests" role="tab"><i class="bi bi-eyedropper me-1"></i>Tests</button>
      <button class="seg-btn ${tab === 'packages' ? 'active' : ''}" data-tab="packages" role="tab"><i class="bi bi-box2-heart me-1"></i>Packages</button>
    </div>
    <div class="search-box mb-3"><i class="bi bi-search"></i>
      <input type="search" class="form-control" id="c-q" placeholder="${tab === 'tests' ? 'Search by name, code or department' : 'Search packages'}" value="${esc(q)}" autocomplete="off"></div>
    <div id="c-body"><div class="skel" style="height:160px"></div></div>`;
  $(el).on('click', '[data-tab]', function () { tab = this.dataset.tab; q = ''; render(el, ctx); });
  $(el).on('input', '#c-q', debounce(function () { q = this.value.trim(); draw(el); }, 120));
  $(el).on('click', '#add-item', () => (tab === 'tests' ? openTestEditor() : openGroupEditor()).then(() => load(el)));
  $(el).on('click', '[data-edit-test]', function () { openTestEditor(this.dataset.editTest).then(() => load(el)); });
  $(el).on('click', '[data-edit-group]', function () { openGroupEditor(this.dataset.editGroup).then(() => load(el)); });
  await load(el);
}

async function load(el) {
  const [tests, groups] = await Promise.all([listStore('tests'), listStore('groups')]);
  data = { tests, groups };
  draw(el);
}

function draw(el) {
  const s = q.toLowerCase();
  const $b = $('#c-body', el);
  if (tab === 'tests') {
    const rows = data.tests
      .filter((t) => !s || t.nameLc.includes(s) || (t.code || '').toLowerCase().includes(s) || (t.department || '').toLowerCase().includes(s))
      .sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
    if (!rows.length) { $b.html(UI.emptyState(data.tests.length ? 'No tests match' : 'No tests yet', 'eyedropper')); return; }
    const byDept = {};
    rows.forEach((t) => (byDept[t.department] ||= []).push(t));
    $b.html(Object.entries(byDept).map(([dept, list], gi) => `
      <section class="dept-block stagger" style="--gi:${gi}">
        <div class="dept-title"><span>${esc(dept)}</span><span class="pill pill-secondary">${list.length}</span></div>
        <div class="list-card">${list.map((t) => `
          <button class="list-row ${t.active ? '' : 'is-off'}" data-edit-test="${esc(t.id)}">
            <span class="code-badge">${esc(t.code || '—')}</span>
            <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(t.name)}</div>
              <div class="small text-body-secondary text-truncate">${t.params.length} parameter${t.params.length === 1 ? '' : 's'}${t.sampleType ? ' · ' + esc(t.sampleType) : ''}${t.turnaround ? ' · ' + esc(t.turnaround) : ''}${t.active ? '' : ' · <span class="text-danger">inactive</span>'}</div></div>
            <div class="fw-semibold text-nowrap">${money(t.price)}</div></button>`).join('')}
        </div></section>`).join(''));
  } else {
    const byId = Object.fromEntries(data.tests.map((t) => [t.id, t]));
    const rows = data.groups.filter((g) => !s || g.nameLc.includes(s)).sort((a, b) => a.name.localeCompare(b.name));
    if (!rows.length) { $b.html(UI.emptyState(data.groups.length ? 'No packages match' : 'No packages yet. Bundle common tests into a package.', 'box2-heart')); return; }
    $b.html(`<div class="stagger">${rows.map((g) => {
      const individual = g.testIds.reduce((sum, id) => sum + (byId[id]?.price || 0), 0);
      const save = Math.max(0, individual - g.price);
      return `<button class="pkg-card ${g.active ? '' : 'is-off'}" data-edit-group="${esc(g.id)}">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="min-w-0"><div class="fw-semibold text-truncate fs-6">${esc(g.name)}</div>
          <div class="small text-body-secondary">${g.testIds.length} tests${g.code ? ' · ' + esc(g.code) : ''}</div></div>
          <div class="text-end"><div class="pkg-price">${money(g.price)}</div>
          ${save > 0 ? `<span class="pill pill-success">Save ${money(save)}</span>` : ''}</div></div>
        <div class="chip-row mt-2">${g.testIds.map((id) => `<span class="chip chip-sm">${esc(byId[id]?.name || 'Removed test')}</span>`).join('')}</div>
      </button>`;
    }).join('')}</div>`);
  }
}

// ---------- Test builder ----------
const emptyParam = () => ({ id: uuid(), name: '', unit: '', type: 'number', options: [], textRef: '', ranges: [{ gender: 'any', ageMin: '', ageMax: '', low: '', high: '', text: '' }] });

function paramHtml(p, i, total) {
  const rangeRows = p.ranges.map((r, ri) => `
    <div class="range-row" data-ri="${ri}">
      <select class="form-select form-select-sm rg-gender" aria-label="Gender">${GENDERS.map(([v, l]) => `<option value="${v}" ${r.gender === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input class="form-control form-control-sm rg-agemin" type="number" min="0" placeholder="Age from" value="${esc(r.ageMin ?? '')}" aria-label="Age from">
      <input class="form-control form-control-sm rg-agemax" type="number" min="0" placeholder="Age to" value="${esc(r.ageMax ?? '')}" aria-label="Age to">
      <input class="form-control form-control-sm rg-low" type="number" step="any" placeholder="Low" value="${esc(r.low ?? '')}" aria-label="Lower limit">
      <input class="form-control form-control-sm rg-high" type="number" step="any" placeholder="High" value="${esc(r.high ?? '')}" aria-label="Upper limit">
      <button type="button" class="btn btn-link text-danger p-0 px-1 rg-del" aria-label="Remove range"><i class="bi bi-x-lg"></i></button>
    </div>`).join('');
  return `
  <div class="param-card anim-pop" data-pi="${i}" data-id="${esc(p.id)}">
    <div class="param-head">
      <span class="param-num">${i + 1}</span>
      <input class="form-control pm-name" placeholder="Parameter name, e.g. Hemoglobin" value="${esc(p.name)}" maxlength="120" aria-label="Parameter name">
      <div class="param-tools">
        <button type="button" class="btn btn-light btn-sm pm-up" ${i === 0 ? 'disabled' : ''} aria-label="Move up"><i class="bi bi-arrow-up"></i></button>
        <button type="button" class="btn btn-light btn-sm pm-down" ${i === total - 1 ? 'disabled' : ''} aria-label="Move down"><i class="bi bi-arrow-down"></i></button>
        <button type="button" class="btn btn-light btn-sm text-danger pm-del" aria-label="Delete parameter"><i class="bi bi-trash"></i></button>
      </div>
    </div>
    <div class="row g-2 mt-0">
      <div class="col-5 col-sm-4"><label class="form-label small mb-1">Result type</label>
        <select class="form-select form-select-sm pm-type">${TYPES.map(([v, l]) => `<option value="${v}" ${p.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${p.type === 'number' ? `<div class="col-7 col-sm-4"><label class="form-label small mb-1">Unit</label>
        <input class="form-control form-control-sm pm-unit" placeholder="g/dL, mg/dL…" value="${esc(p.unit)}" maxlength="30"></div>` : ''}
      ${p.type === 'options' ? `<div class="col-12"><label class="form-label small mb-1">Options (comma separated)</label>
        <input class="form-control form-control-sm pm-options" placeholder="Positive, Negative" value="${esc(Array.isArray(p.options) ? p.options.join(', ') : (p.options || ''))}"></div>` : ''}
      ${p.type === 'text' ? `<div class="col-12 col-sm-8"><label class="form-label small mb-1">Reference / normal text (optional)</label>
        <input class="form-control form-control-sm pm-textref" placeholder="e.g. Pale yellow" value="${esc(p.textRef || '')}" maxlength="120"></div>` : ''}
    </div>
    ${p.type === 'number' ? `<div class="ranges mt-2">
      <div class="small fw-semibold text-body-secondary mb-1">Reference ranges <span class="fw-normal">· first matching range is used</span></div>
      <div class="range-head small text-body-secondary"><span>Gender</span><span>Age from</span><span>Age to</span><span>Low</span><span>High</span><span></span></div>
      ${rangeRows}
      <button type="button" class="btn btn-outline-primary btn-sm mt-1 rg-add"><i class="bi bi-plus-lg me-1"></i>Add range</button>
    </div>` : ''}
  </div>`;
}

// Reads the parameter editor from the DOM (the source of truth while the dialog is open).
function readParams(root) {
  return $('.param-card', root).map(function () {
    const $c = $(this);
    const type = $c.find('.pm-type').val();
    return {
      id: $c.data('id'),
      name: $c.find('.pm-name').val(),
      unit: $c.find('.pm-unit').val() || '',
      type,
      options: type === 'options' ? ($c.find('.pm-options').val() || '') : [],
      textRef: type === 'text' ? ($c.find('.pm-textref').val() || '') : '',
      ranges: type === 'number' ? $c.find('.range-row').map(function () {
        const $r = $(this);
        return { gender: $r.find('.rg-gender').val(), ageMin: $r.find('.rg-agemin').val(), ageMax: $r.find('.rg-agemax').val(), low: $r.find('.rg-low').val(), high: $r.find('.rg-high').val(), text: '' };
      }).get() : [],
    };
  }).get();
}

async function openTestEditor(id = null) {
  const existing = id ? data.tests.find((t) => t.id === id) : null;
  const t = existing || { code: '', name: '', department: '', sampleType: '', turnaround: '', price: '', notes: '', active: true, params: [emptyParam()] };
  const depts = [...new Set(data.tests.map((x) => x.department).filter(Boolean))].sort();
  let params = t.params.map((p) => ({ ...p, options: Array.isArray(p.options) ? p.options.join(', ') : p.options }));
  let $root = null;

  const paint = () => {
    $root.find('#params').html(params.map((p, i) => paramHtml(p, i, params.length)).join('') || '<div class="empty-hint"><i class="bi bi-sliders"></i><span>No parameters. Add one, or leave empty for a free-text result.</span></div>');
  };
  const structural = (fn) => { params = readParams($root[0]).map((p, i) => ({ ...params[i], ...p })); fn(); paint(); };

  const res = await UI.formModal({
    title: existing ? `Edit test · ${t.name}` : 'New test',
    size: 'lg',
    submitLabel: existing ? 'Save test' : 'Create test',
    body: `<div class="row g-2 mb-3">
        <div class="col-4 col-sm-3"><label class="form-label small mb-1">Code</label><input name="code" class="form-control text-uppercase" maxlength="20" value="${esc(t.code)}" placeholder="CBC"></div>
        <div class="col-8 col-sm-9"><label class="form-label small mb-1">Test name *</label><input name="name" class="form-control" required maxlength="160" value="${esc(t.name)}"></div>
        <div class="col-6 col-sm-4"><label class="form-label small mb-1">Department</label><input name="department" class="form-control" list="dept-list" maxlength="60" value="${esc(t.department)}" placeholder="Hematology"><datalist id="dept-list">${depts.map((d) => `<option value="${esc(d)}">`).join('')}</datalist></div>
        <div class="col-6 col-sm-4"><label class="form-label small mb-1">Sample type</label><input name="sampleType" class="form-control" maxlength="60" value="${esc(t.sampleType)}" placeholder="EDTA blood"></div>
        <div class="col-6 col-sm-2"><label class="form-label small mb-1">Turnaround</label><input name="turnaround" class="form-control" maxlength="60" value="${esc(t.turnaround)}" placeholder="2-4 hours"></div>
        <div class="col-6 col-sm-2"><label class="form-label small mb-1">Price *</label><input name="price" type="number" min="0" step="0.01" inputmode="decimal" class="form-control" required value="${esc(t.price)}"></div>
        <div class="col-12 d-flex align-items-center gap-3">
          <div class="form-check form-switch mb-0"><input class="form-check-input" type="checkbox" name="active" id="t-active" ${t.active ? 'checked' : ''}><label class="form-check-label small" for="t-active">Available for billing</label></div>
        </div>
      </div>
      <div class="d-flex align-items-center justify-content-between mb-2"><h3 class="h6 mb-0">Parameters</h3>
        <button type="button" class="btn btn-outline-primary btn-sm" id="add-param"><i class="bi bi-plus-lg me-1"></i>Add parameter</button></div>
      <div id="params" class="params-wrap"></div>
      <div class="mt-3"><label class="form-label small mb-1">Notes for the report (optional)</label><input name="notes" class="form-control" maxlength="500" value="${esc(t.notes)}"></div>`,
    onShown: ($m) => {
      $root = $m;
      paint();
      $m.on('click', '#add-param', () => structural(() => params.push(emptyParam())));
      $m.on('click', '.pm-del', function () { const i = +$(this).closest('.param-card').data('pi'); structural(() => params.splice(i, 1)); });
      $m.on('click', '.pm-up', function () { const i = +$(this).closest('.param-card').data('pi'); structural(() => [params[i - 1], params[i]] = [params[i], params[i - 1]]); });
      $m.on('click', '.pm-down', function () { const i = +$(this).closest('.param-card').data('pi'); structural(() => [params[i + 1], params[i]] = [params[i], params[i + 1]]); });
      $m.on('change', '.pm-type', function () { const i = +$(this).closest('.param-card').data('pi'); structural(() => { params[i].type = this.value; if (this.value === 'number' && !params[i].ranges?.length) params[i].ranges = [emptyParam().ranges[0]]; }); });
      $m.on('click', '.rg-add', function () { const i = +$(this).closest('.param-card').data('pi'); structural(() => params[i].ranges.push({ gender: 'any', ageMin: '', ageMax: '', low: '', high: '', text: '' })); });
      $m.on('click', '.rg-del', function () { const $c = $(this).closest('.param-card'); const i = +$c.data('pi'); const ri = +$(this).closest('.range-row').data('ri'); structural(() => params[i].ranges.splice(ri, 1)); });
    },
    onSubmit: async (v, $m) => {
      const payload = { ...v, id: existing?.id, active: !!v.active, params: readParams($m[0]) };
      // Dry-run validation first so a bad parameter never leaves a half-saved test.
      normalizeTest(payload);
      await saveTest(payload);
      UI.toast(existing ? 'Test updated' : 'Test created');
      return true;
    },
  });
  return res;
}

// ---------- Package builder ----------
async function openGroupEditor(id = null) {
  const existing = id ? data.groups.find((g) => g.id === id) : null;
  const g = existing || { code: '', name: '', price: '', notes: '', active: true, testIds: [] };
  const tests = [...data.tests].filter((t) => t.active || g.testIds.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name));
  const checked = new Set(g.testIds);
  const res = await UI.formModal({
    title: existing ? `Edit package · ${g.name}` : 'New package',
    size: 'lg',
    submitLabel: existing ? 'Save package' : 'Create package',
    body: `<div class="row g-2 mb-3">
        <div class="col-8"><label class="form-label small mb-1">Package name *</label><input name="name" class="form-control" required maxlength="160" value="${esc(g.name)}" placeholder="Basic Health Checkup"></div>
        <div class="col-4"><label class="form-label small mb-1">Code</label><input name="code" class="form-control text-uppercase" maxlength="20" value="${esc(g.code)}"></div>
        <div class="col-12"><label class="form-label small mb-1">Package price *</label><input name="price" type="number" min="0" step="0.01" inputmode="decimal" class="form-control" required value="${esc(g.price)}"></div>
      </div>
      <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div class="fw-semibold small">Included tests</div>
        <div class="pkg-sum small" id="pkg-sum"></div></div>
      <div class="search-box mb-2"><i class="bi bi-search"></i><input type="search" class="form-control" id="pkg-q" placeholder="Filter tests" autocomplete="off"></div>
      <div class="list-card pkg-tests" id="pkg-tests">${tests.map((t) => `
        <label class="list-row pick-check"><input class="form-check-input me-2 pkg-check" type="checkbox" value="${esc(t.id)}" data-price="${t.price}" data-name="${esc(t.nameLc)}" ${checked.has(t.id) ? 'checked' : ''}>
          <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(t.name)}</div><div class="small text-body-secondary">${esc(t.department)}</div></div>
          <div class="small fw-semibold">${money(t.price)}</div></label>`).join('') || '<div class="p-3 small text-body-secondary">Create tests first, then bundle them here.</div>'}</div>`,
    onShown: ($m) => {
      const sum = () => {
        const list = $m.find('.pkg-check:checked').map((_, el) => +el.dataset.price).get();
        const individual = list.reduce((a, b) => a + b, 0);
        const price = num($m.find('[name=price]').val(), 0);
        $m.find('#pkg-sum').html(`${list.length} selected · individually ${money(individual)}${individual > price && price > 0 ? ` · <span class="text-success fw-semibold">saves ${money(individual - price)}</span>` : ''}`);
      };
      $m.on('change', '.pkg-check, [name=price]', sum);
      $m.on('input', '#pkg-q', function () { const s = this.value.trim().toLowerCase(); $m.find('.pick-check').each((_, el) => { $(el).toggleClass('d-none', !!s && !$(el).find('.pkg-check').data('name').includes(s)); }); });
      sum();
    },
    onSubmit: async (v, $m) => {
      const testIds = $m.find('.pkg-check:checked').map((_, el) => el.value).get();
      await saveGroup({ ...v, id: existing?.id, active: true, testIds });
      UI.toast(existing ? 'Package updated' : 'Package created');
      return true;
    },
  });
  return res;
}

