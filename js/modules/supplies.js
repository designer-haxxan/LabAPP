// Supplies & stock: lab consumables, reagents and office basics, with stock in/out, reorder alerts and history.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtQty, today, debounce, round2 } from '../core/utils.js';
import { money } from '../core/views.js';
import { getBundle, saveSupply, moveSupply, isLowStock } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
let state = { q: '', cat: 'all', low: false };

const isLow = isLowStock;

function openSupplyForm(existing = null, cats = []) {
  const s = existing || { unit: 'pcs', category: 'Consumables', reorderLevel: 0, unitCost: 0 };
  const catOpts = [...new Set([...cats, 'Blood collection', 'Hygiene & safety', 'Labels & containers', 'Reagents & kits', 'Office & printing', 'Consumables'])];
  return UI.formModal({
    title: existing ? 'Edit item' : 'New supply item',
    submitLabel: existing ? 'Save changes' : 'Add item',
    body: `<div class="row g-3">
      <div class="col-12"><label class="form-label">Item name *</label><input name="name" class="form-control form-control-lg" required maxlength="120" value="${esc(s.name || '')}"></div>
      <div class="col-12"><label class="form-label">Category</label>
        <input name="category" class="form-control" list="sup-cats" maxlength="60" value="${esc(s.category)}"><datalist id="sup-cats">${catOpts.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="col-4"><label class="form-label">Unit</label><input name="unit" class="form-control" maxlength="30" value="${esc(s.unit)}" placeholder="pcs, box, kit"></div>
      <div class="col-4"><label class="form-label">Reorder at</label><input name="reorderLevel" type="number" min="0" step="any" class="form-control" value="${esc(s.reorderLevel)}"></div>
      <div class="col-4"><label class="form-label">Unit cost</label><input name="unitCost" type="number" min="0" step="0.01" class="form-control" value="${esc(s.unitCost)}"></div>
      <div class="col-12"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="s-active" ${s.active !== false ? 'checked' : ''}><label class="form-check-label" for="s-active">Active</label></div></div>
    </div>`,
    onSubmit: (v) => saveSupply({ ...v, id: existing?.id }),
  });
}

function openMoveForm(s, type) {
  return UI.formModal({
    title: `${type === 'in' ? 'Stock in' : 'Use / stock out'} · ${s.name}`,
    submitLabel: type === 'in' ? 'Add stock' : 'Record use',
    submitClass: type === 'in' ? 'btn-success' : 'btn-warning',
    body: `<div class="alert alert-light small mb-3">In stock now: <b>${fmtQty(s.quantity)} ${esc(s.unit)}</b></div>
      <div class="row g-3">
        <div class="col-6"><label class="form-label">Quantity (${esc(s.unit)}) *</label>
          <input name="qty" type="number" min="0.001" step="any" inputmode="decimal" class="form-control form-control-lg" required autofocus></div>
        <div class="col-6"><label class="form-label">Date</label><input name="date" type="date" class="form-control" value="${today()}"></div>
        <div class="col-12"><label class="form-label">Note</label><input name="note" class="form-control" maxlength="200" placeholder="${type === 'in' ? 'Supplier, invoice no.' : 'Used for, batch'}"></div>
      </div>`,
    onSubmit: (v) => moveSupply(s.id, { type, qty: v.qty, note: v.note, date: v.date }),
  });
}

export async function render(el, ctx) {
  ctx.setTitle?.('Supplies & Stock');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Supplies &amp; Stock</h1>
      ${Auth.can('supply.manage') ? '<button class="btn btn-grad btn-sm" id="add-sup"><i class="bi bi-plus-lg me-1"></i>Add item</button>' : ''}
    </div>
    <div class="row g-2 mb-3" id="sup-kpi"></div>
    <div class="d-flex gap-2 flex-wrap mb-3">
      <div class="search-box flex-grow-1"><i class="bi bi-search"></i>
        <input type="search" class="form-control" id="sq" placeholder="Search supplies" value="${esc(state.q)}" autocomplete="off"></div>
      <select class="form-select w-auto" id="scat" aria-label="Category"></select>
      <button class="btn ${state.low ? 'btn-warning' : 'btn-light'}" id="slow"><i class="bi bi-exclamation-triangle me-1"></i>Low stock</button>
    </div>
    <div id="sup-list"></div>`;
  $(el).on('input', '#sq', debounce(function () { state.q = this.value.trim().toLowerCase(); load(el); }, 120));
  $(el).on('change', '#scat', function () { state.cat = this.value; load(el); });
  $(el).on('click', '#slow', function () { state.low = !state.low; $(this).toggleClass('btn-warning', state.low).toggleClass('btn-light', !state.low); load(el); });
  $(el).on('click', '#add-sup', async () => { if (await openSupplyForm(null, cats)) { UI.toast('Item added'); load(el); } });
  $(el).on('click', '[data-in]', async function () { const s = await find(this.dataset.in); if (s && await openMoveForm(s, 'in')) { UI.toast('Stock added'); load(el); } });
  $(el).on('click', '[data-out]', async function () { const s = await find(this.dataset.out); if (s && await openMoveForm(s, 'out')) { UI.toast('Use recorded'); load(el); } });
  $(el).on('click', '[data-edit-sup]', async function () { const s = await find(this.dataset.editSup); if (s && await openSupplyForm(s, cats)) { UI.toast('Item updated'); load(el); } });
  $(el).on('click', '[data-hist]', async function () { showHistory(await find(this.dataset.hist)); });
  let cats = [];
  const find = async (id) => (await getBundle(['supplies'])).supplies.find((x) => x.id === id);
  load(el, (c) => { cats = c; });
}

async function load(el, onCats) {
  const { supplies, supplyMoves } = await getBundle(['supplies', 'supplyMoves']);
  const cats = [...new Set(supplies.map((s) => s.category))].sort();
  onCats?.(cats);
  const catSel = $('#scat', el);
  if (catSel.children().length <= 1 || catSel.data('cats') !== cats.join('|')) {
    catSel.data('cats', cats.join('|')).html(`<option value="all">All categories</option>${cats.map((c) => `<option ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}`);
  }
  const rows = supplies
    .filter((s) => s.active !== false)
    .filter((s) => state.cat === 'all' || s.category === state.cat)
    .filter((s) => !state.q || s.nameLc.includes(state.q))
    .filter((s) => !state.low || isLow(s))
    .sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const low = supplies.filter((s) => s.active !== false && isLow(s)).length;
  const value = round2(supplies.reduce((sum, s) => sum + s.quantity * s.unitCost, 0));
  $('#sup-kpi', el).html(`
    <div class="col-4"><div class="kpi kpi-indigo"><div class="kpi-label">Items</div><div class="kpi-value" data-count="${supplies.length}">${supplies.length}</div></div></div>
    <div class="col-4"><div class="kpi kpi-rose"><div class="kpi-label">Need reorder</div><div class="kpi-value" data-count="${low}">${low}</div></div></div>
    <div class="col-4"><div class="kpi kpi-green"><div class="kpi-label">Stock value</div><div class="kpi-value" data-count="${value}" data-money>${money(value)}</div></div></div>`);
  UI.countUp($('#sup-kpi', el)[0], (n, node) => (node.dataset.money !== undefined ? money(n) : String(Math.round(n))));

  const $list = $('#sup-list', el);
  if (!rows.length) { $list.html(UI.emptyState(supplies.length ? 'No items match' : 'No supplies yet', 'boxes')); return; }
  const byCat = {};
  rows.forEach((s) => (byCat[s.category] ||= []).push(s));
  const canManage = Auth.can('supply.manage');
  $list.html(Object.entries(byCat).map(([c, list], gi) => `
    <section class="dept-block stagger" style="--gi:${gi}">
      <div class="dept-title"><span>${esc(c)}</span><span class="pill pill-secondary">${list.length}</span></div>
      <div class="list-card">${list.map((s) => `
        <div class="list-row sup-row ${isLow(s) ? 'is-low' : ''}">
          <div class="stock-ring ${isLow(s) ? 'low' : ''}" style="--p:${Math.min(100, s.reorderLevel > 0 ? (s.quantity / (s.reorderLevel * 3)) * 100 : 100)}">
            <span>${fmtQty(s.quantity)}</span></div>
          <div class="flex-grow-1 min-w-0">
            <div class="fw-semibold text-truncate">${esc(s.name)}</div>
            <div class="small text-body-secondary">${esc(s.unit)} · reorder at ${fmtQty(s.reorderLevel)}${s.unitCost ? ` · ${money(s.unitCost)} each` : ''}</div>
            ${isLow(s) ? '<span class="pill pill-warning mt-1"><i class="bi bi-exclamation-triangle me-1"></i>Reorder now</span>' : ''}
          </div>
          ${canManage ? `<div class="sup-actions">
            <button class="btn btn-sm btn-outline-success" data-in="${esc(s.id)}" aria-label="Stock in"><i class="bi bi-plus-lg"></i></button>
            <button class="btn btn-sm btn-outline-warning" data-out="${esc(s.id)}" aria-label="Use"><i class="bi bi-dash-lg"></i></button>
            <button class="btn btn-sm btn-light" data-hist="${esc(s.id)}" aria-label="History"><i class="bi bi-clock-history"></i></button>
            <button class="btn btn-sm btn-light" data-edit-sup="${esc(s.id)}" aria-label="Edit"><i class="bi bi-pencil"></i></button></div>` : ''}
        </div>`).join('')}
      </div></section>`).join(''));
}

async function showHistory(s) {
  if (!s) return;
  const { supplyMoves } = await getBundle(['supplyMoves']);
  const list = supplyMoves.filter((m) => m.supplyId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  UI.modal({
    title: `History · ${s.name}`,
    body: list.length ? `<div class="list-card">${list.map((m) => `
      <div class="list-row"><span class="move-ico ${m.type}"><i class="bi bi-arrow-${m.type === 'in' ? 'down' : 'up'}-circle"></i></span>
        <div class="flex-grow-1 min-w-0"><div class="fw-semibold">${m.type === 'in' ? 'Stock in' : 'Used'} ${fmtQty(m.qty)} ${esc(s.unit)}</div>
        <div class="small text-body-secondary text-truncate">${esc(fmtDate(m.date))}${m.note ? ' · ' + esc(m.note) : ''}</div></div>
        <div class="small text-end">Balance<div class="fw-semibold">${fmtQty(m.balance)}</div></div></div>`).join('')}</div>` : UI.emptyState('No movements yet', 'clock-history'),
    footer: '<button class="btn btn-light" data-bs-dismiss="modal">Close</button>',
  });
}
