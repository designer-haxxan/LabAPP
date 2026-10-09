// Expenses: every lab running cost (rent, salaries, reagents, utilities...), by category and date range.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, today, monthStart, round2 } from '../core/utils.js';
import { getSettings } from '../core/settings.js';
import { money, dateFilter, bindDateFilter, pager } from '../core/views.js';
import { getBundle, saveExpense, deleteExpense } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const METHODS = { cash: 'Cash', bank: 'Bank transfer', card: 'Card', easypaisa: 'Easypaisa / JazzCash' };
let state = { from: monthStart(), to: today(), cat: 'all' };

function openExpenseForm(existing = null) {
  const e = existing || { date: today(), method: 'cash' };
  const cats = getSettings().expenseCategories;
  return UI.formModal({
    title: existing ? 'Edit expense' : 'Add expense',
    submitLabel: existing ? 'Save changes' : 'Save expense',
    body: `<div class="row g-3">
      <div class="col-6"><label class="form-label">Date</label><input name="date" type="date" class="form-control" required value="${esc(e.date)}"></div>
      <div class="col-6"><label class="form-label">Amount (${esc(getSettings().currency)}) *</label>
        <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" class="form-control form-control-lg" required value="${esc(e.amount ?? '')}"></div>
      <div class="col-12"><label class="form-label">Category</label>
        <select name="category" class="form-select">${cats.map((c) => `<option ${e.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="col-6"><label class="form-label">Paid to</label><input name="payee" class="form-control" maxlength="120" value="${esc(e.payee || '')}" placeholder="Landlord, vendor, staff"></div>
      <div class="col-6"><label class="form-label">Method</label>
        <select name="method" class="form-select">${Object.entries(METHODS).map(([k, v]) => `<option value="${k}" ${e.method === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label">Note</label><input name="note" class="form-control" maxlength="300" value="${esc(e.note || '')}"></div>
    </div>`,
    onSubmit: (v) => saveExpense({ ...v, id: existing?.id }),
  });
}

export async function render(el, ctx) {
  ctx.setTitle?.('Expenses');
  const cats = getSettings().expenseCategories;
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Expenses</h1>
      ${Auth.can('expense.manage') ? '<button class="btn btn-grad btn-sm" id="add-exp"><i class="bi bi-plus-lg me-1"></i>Add expense</button>' : ''}
    </div>
    ${dateFilter(state.from, state.to, `<div><label class="form-label small mb-0">Category</label>
      <select name="cat" class="form-select form-select-sm"><option value="all">All</option>${cats.map((c) => `<option ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`)}
    <div class="row g-2 my-3" id="exp-kpi"></div>
    <div class="card-glow panel mb-3" id="exp-breakdown"></div>
    <h2 class="h6 mb-2">Entries</h2>
    <div class="list-card" id="exp-list"></div>`;
  bindDateFilter($(el), (from, to, fd) => { state.from = from; state.to = to; state.cat = fd.cat || 'all'; load(el); });
  $(el).on('click', '#add-exp', async () => { if (await openExpenseForm()) { UI.toast('Expense saved'); load(el); } });
  $(el).on('click', '[data-exp]', async function (ev) {
    if ($(ev.target).closest('[data-del-exp]').length) return;
    const { expenses } = await getBundle(['expenses']);
    const x = expenses.find((e) => e.id === this.dataset.exp);
    if (x && await openExpenseForm(x)) { UI.toast('Expense updated'); load(el); }
  });
  $(el).on('click', '[data-del-exp]', async function (ev) {
    ev.stopPropagation();
    if (!await UI.confirmDialog('Delete this expense? This cannot be undone.', { okLabel: 'Delete', okClass: 'btn-danger' })) return;
    try { await deleteExpense(this.dataset.delExp); UI.toast('Expense deleted'); load(el); } catch (err) { UI.toastError(err); }
  });
  load(el);
}

async function load(el) {
  const { expenses } = await getBundle(['expenses']);
  const rows = expenses
    .filter((e) => e.date >= state.from && e.date <= state.to && (state.cat === 'all' || e.category === state.cat))
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt?.localeCompare(a.updatedAt || '') || 0);
  const total = round2(rows.reduce((s, e) => s + e.amount, 0));
  const byCat = {};
  rows.forEach((e) => { byCat[e.category] = round2((byCat[e.category] || 0) + e.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  $('#exp-kpi', el).html(`
    <div class="col-6 col-md-4"><div class="kpi kpi-rose"><div class="kpi-label">Total expenses</div><div class="kpi-value" data-count="${total}">${money(total)}</div></div></div>
    <div class="col-6 col-md-4"><div class="kpi kpi-indigo"><div class="kpi-label">Entries</div><div class="kpi-value" data-count="${rows.length}">${rows.length}</div></div></div>
    <div class="col-12 col-md-4"><div class="kpi kpi-amber"><div class="kpi-label">Average per entry</div><div class="kpi-value" data-count="${rows.length ? round2(total / rows.length) : 0}" data-money>${money(rows.length ? total / rows.length : 0)}</div></div></div>`);
  UI.countUp($('#exp-kpi', el)[0], (n, node) => (node.dataset.money !== undefined ? money(n) : String(Math.round(n))));
  $('#exp-breakdown', el).html(cats.length ? `<div class="panel-title">Where the money went</div>` + cats.map(([c, v], i) => `
    <div class="bar-row" style="--d:${i * 60}ms">
      <div class="bar-label text-truncate">${esc(c)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(v / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${fmtNum(v)}</div></div>`).join('') : UI.emptyState('No expenses in this period', 'wallet2'));
  pager($('#exp-list', el), rows, (e) => `
    <div class="list-row" data-exp="${esc(e.id)}" role="button" tabindex="0">
      <div class="exp-ico"><i class="bi bi-arrow-down-circle"></i></div>
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(e.category)}${e.payee ? ` <span class="small text-body-secondary">· ${esc(e.payee)}</span>` : ''}</div>
        <div class="small text-body-secondary text-truncate">${esc(fmtDate(e.date))} · ${esc(METHODS[e.method] || e.method)}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
      <div class="text-end"><div class="fw-semibold">${money(e.amount)}</div>
        ${Auth.can('expense.manage') ? `<button class="btn btn-link text-danger p-0 small" data-del-exp="${esc(e.id)}">Delete</button>` : ''}</div></div>`, 40,
  UI.emptyState('No expenses for these filters', 'wallet2'));
}
