// Dashboard: today at a glance, a 7-day collection chart, the results queue and low-stock alerts.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, today, round2 } from '../core/utils.js';
import { getSettings, pref } from '../core/settings.js';
import { money, moneyPlain } from '../core/views.js';
import { billBadge, reportBadge } from '../core/badges.js';
import { getBundle, isLowStock } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function lastDays(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}

export async function render(el, ctx) {
  ctx.setTitle?.('Dashboard');
  const u = Auth.user();
  const lab = getSettings().lab;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  el.innerHTML = `
    <section class="lab-hero mb-3">
      <div class="hero-text">
        <div class="hero-kicker">${greet}, ${esc(u?.name || '')}</div>
        <h1 class="hero-title">${esc(lab.name)}</h1>
        <div class="hero-sub">${esc(fmtDate(today()))}</div>
      </div>
      <div class="hero-actions">
        ${Auth.can('bill.create') ? '<a class="btn btn-light btn-sm" href="#/bills/new"><i class="bi bi-plus-lg me-1"></i>New bill</a>' : ''}
        <a class="btn btn-outline-light btn-sm" href="#/results"><i class="bi bi-clipboard2-pulse me-1"></i>Results</a>
      </div>
      <div class="hero-deco" aria-hidden="true"><i class="bi bi-activity"></i></div>
    </section>
    <div id="dash-alert"></div>
    <div class="row g-2 mb-3 stagger" id="dash-kpi"><div class="col-12"><div class="skel" style="height:110px"></div></div></div>
    <div class="row g-3">
      <div class="col-lg-7"><section class="card-glow panel mb-3">
        <div class="panel-title d-flex justify-content-between"><span>Collections, last 7 days</span><a href="#/reports" class="small">Reports</a></div>
        <div class="bars" id="dash-chart"></div></section></div>
      <div class="col-lg-5"><section class="card-glow panel mb-3">
        <div class="panel-title d-flex justify-content-between"><span>Results to do</span><a href="#/results" class="small">All</a></div>
        <div class="list-card" id="dash-pending"></div></section></div>
      <div class="col-lg-7"><section class="card-glow panel mb-3">
        <div class="panel-title d-flex justify-content-between"><span>Recent bills</span><a href="#/bills" class="small">All bills</a></div>
        <div class="list-card" id="dash-recent"></div></section></div>
      <div class="col-lg-5"><section class="card-glow panel mb-3">
        <div class="panel-title d-flex justify-content-between"><span>Stock &amp; alerts</span><a href="#/supplies" class="small">Supplies</a></div>
        <div id="dash-stock"></div></section></div>
    </div>`;

  const { bills, payments, expenses, reports, supplies } = await getBundle(['bills', 'payments', 'expenses', 'reports', 'supplies']);
  const t = today();
  const days = lastDays(7);
  const liveBills = bills.filter((b) => b.status !== 'void');
  const todayBills = liveBills.filter((b) => b.date === t);
  const todayBilled = round2(todayBills.reduce((s, b) => s + b.total, 0));
  const todayCollected = round2(payments.filter((p) => p.date === t).reduce((s, p) => s + p.amount, 0));
  const todayDue = round2(todayBills.reduce((s, b) => s + b.due, 0));
  const todayExp = round2(expenses.filter((e) => e.date === t).reduce((s, e) => s + e.amount, 0));
  const pending = reports.filter((r) => r.status === 'pending').length;
  const toVerify = reports.filter((r) => r.status === 'entered').length;
  const lowStock = supplies.filter((s) => s.active !== false && isLowStock(s));

  $('#dash-kpi', el).html(`
    <div class="col-6 col-lg-2"><div class="kpi kpi-indigo"><div class="kpi-label">Billed today</div><div class="kpi-value" data-count="${todayBilled}">${money(todayBilled)}</div><div class="kpi-sub">${plural(todayBills.length, 'bill')}</div></div></div>
    <div class="col-6 col-lg-2"><div class="kpi kpi-green"><div class="kpi-label">Collected today</div><div class="kpi-value" data-count="${todayCollected}">${money(todayCollected)}</div></div></div>
    <div class="col-6 col-lg-2"><div class="kpi kpi-rose"><div class="kpi-label">Due today</div><div class="kpi-value" data-count="${todayDue}">${money(todayDue)}</div></div></div>
    <div class="col-6 col-lg-2"><div class="kpi kpi-violet"><div class="kpi-label">Tests to do</div><div class="kpi-value" data-count="${pending}" data-int>${pending}</div><div class="kpi-sub">${toVerify} to verify</div></div></div>
    <div class="col-6 col-lg-2"><div class="kpi kpi-amber"><div class="kpi-label">Expenses today</div><div class="kpi-value" data-count="${todayExp}">${money(todayExp)}</div></div></div>
    <div class="col-6 col-lg-2"><div class="kpi kpi-teal"><div class="kpi-label">Net today</div><div class="kpi-value" data-count="${round2(todayCollected - todayExp)}">${money(todayCollected - todayExp)}</div></div></div>`);
  UI.countUp($('#dash-kpi', el)[0], (n, node) => (node.dataset.int !== undefined ? String(Math.round(n)) : moneyPlain(n)));

  const series = days.map((d) => ({ d, v: round2(payments.filter((p) => p.date === d).reduce((s, p) => s + p.amount, 0)) }));
  const max = Math.max(1, ...series.map((x) => x.v));
  $('#dash-chart', el).html(series.map((x, i) => {
    const dt = new Date(x.d + 'T00:00:00');
    return `<div class="bar-col ${x.d === t ? 'is-today' : ''}" title="${esc(fmtDate(x.d))}: ${esc(fmtNum(x.v))}">
      <div class="bar-amt">${x.v ? esc(fmtNum(x.v)) : ''}</div>
      <div class="bar-stack"><div class="bar-col-fill" style="--h:${(x.v / max * 100).toFixed(1)}%;--d:${i * 70}ms"></div></div>
      <div class="bar-day">${DAYS[dt.getDay()]}</div></div>`;
  }).join(''));

  const todo = reports.filter((r) => r.status === 'pending' || r.status === 'entered')
    .sort((a, b) => (a.status === b.status ? a.createdAt.localeCompare(b.createdAt) : a.status === 'entered' ? 1 : -1)).slice(0, 6);
  $('#dash-pending', el).html(todo.length ? todo.map((r) => `
    <a class="list-row" href="#/results/${r.id}">
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(r.testName)}</div>
        <div class="small text-body-secondary text-truncate">${esc(r.billNumber)} · ${esc(fmtDate(r.date))}</div></div>${reportBadge(r.status)}</a>`).join('')
    : UI.emptyState('All caught up. No tests waiting.', 'emoji-smile'));

  const recent = [...liveBills].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
  $('#dash-recent', el).html(recent.length ? recent.map((b) => `
    <a class="list-row" href="#/bills/${b.id}">
      <div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(b.patient.name)}</div>
        <div class="small text-body-secondary">${esc(b.number)} · ${plural(b.lines.length, 'item')}</div></div>
      <div class="text-end"><div class="fw-semibold">${money(b.total)}</div>${billBadge(b.status)}</div></a>`).join('')
    : UI.emptyState('No bills yet. Create the first one.', 'receipt'));

  const lastBackup = pref.get('lastBackup', null);
  const daysSince = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : Infinity;
  const alerts = [];
  if (lowStock.length) alerts.push(`<a class="alert-pill pill-warning" href="#/supplies"><i class="bi bi-box-seam"></i>${plural(lowStock.length, 'supply item')} ${lowStock.length === 1 ? 'needs' : 'need'} reordering</a>`);
  if (daysSince > 7 && Auth.can('backup.export')) alerts.push(`<a class="alert-pill pill-info" href="#/backup"><i class="bi bi-cloud-arrow-down"></i>${lastBackup ? `Last backup ${daysSince} days ago` : 'No backup yet'}. Make one now.</a>`);
  $('#dash-alert', el).html(alerts.length ? `<div class="alerts-row mb-3 stagger">${alerts.join('')}</div>` : '');
  $('#dash-stock', el).html(lowStock.length ? `<div class="list-card">${lowStock.slice(0, 6).map((s) => `
    <a class="list-row" href="#/supplies"><div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(s.name)}</div>
      <div class="small text-body-secondary">${esc(s.category)}</div></div>
      <div class="text-end small"><div class="fw-semibold text-danger">${fmtNum(s.quantity)} ${esc(s.unit)}</div><div class="text-body-secondary">reorder at ${fmtNum(s.reorderLevel)}</div></div></a>`).join('')}</div>`
    : `<div class="empty-hint"><i class="bi bi-check2-circle text-success"></i><span>Stock levels are healthy.</span></div>`);
}
