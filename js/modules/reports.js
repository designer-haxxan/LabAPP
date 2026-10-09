// Finance & operations reports for a date range: collections, dues, daily book, doctor commissions,
// test volumes, payment methods and expenses. Printable and exportable as CSV.
import * as UI from '../core/ui.js';
import { esc, fmtDate, fmtNum, round2, today, monthStart, toCSV, downloadFile } from '../core/utils.js';
import { money, moneyPlain, dateFilter, bindDateFilter, plainNum } from '../core/views.js';
import { labHeader, printHtml } from '../core/print.js';
import { getBundle } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const METHODS = { cash: 'Cash', card: 'Card', bank: 'Bank transfer', easypaisa: 'Easypaisa / JazzCash', cheque: 'Cheque', refund: 'Refund' };
let range = { from: monthStart(), to: today() };
let last = null; // data of the last render, reused by print and CSV

export async function render(el, ctx) {
  ctx.setTitle?.('Reports');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3 flex-wrap">
      <h1 class="h5 mb-0 flex-grow-1">Reports</h1>
      <button class="btn btn-light btn-sm" id="r-csv"><i class="bi bi-filetype-csv me-1"></i>CSV</button>
      <button class="btn btn-outline-primary btn-sm" id="r-print"><i class="bi bi-printer me-1"></i>Print</button>
    </div>
    ${dateFilter(range.from, range.to)}
    <div id="r-body" class="mt-3"><div class="skel" style="height:260px"></div></div>`;
  bindDateFilter($(el), (from, to) => { range = { from, to }; load(el); });
  $(el).on('click', '#r-print', () => last && printReport(last));
  $(el).on('click', '#r-csv', () => last && exportCsv(last));
  load(el);
}

async function load(el) {
  const { bills, payments, expenses, reports } = await getBundle(['bills', 'payments', 'expenses', 'reports']);
  const { from, to } = range;
  const inR = (d) => d >= from && d <= to;
  const live = bills.filter((b) => inR(b.date) && b.status !== 'void');
  const pays = payments.filter((p) => inR(p.date));
  const exps = expenses.filter((e) => inR(e.date));
  const repRows = reports.filter((r) => inR(r.date) && r.status !== 'void');
  const finance = Auth.can('reports.finance');

  const billed = round2(live.reduce((s, b) => s + b.total, 0));
  const collected = round2(pays.reduce((s, p) => s + p.amount, 0));
  const due = round2(live.reduce((s, b) => s + b.due, 0));
  const spent = round2(exps.reduce((s, e) => s + e.amount, 0));
  const net = round2(collected - spent);
  const commission = round2(live.reduce((s, b) => s + b.commissionAmount, 0));

  const days = {};
  const day = (d) => (days[d] ||= { date: d, bills: 0, billed: 0, collected: 0, expenses: 0 });
  live.forEach((b) => { const x = day(b.date); x.bills += 1; x.billed += b.total; });
  pays.forEach((p) => { day(p.date).collected += p.amount; });
  exps.forEach((e) => { day(e.date).expenses += e.amount; });
  const dayRows = Object.values(days).sort((a, b) => b.date.localeCompare(a.date));

  const docMap = {};
  live.filter((b) => b.doctorId).forEach((b) => {
    const d = (docMap[b.doctorId] ||= { name: b.doctorName, bills: 0, sales: 0, commission: 0 });
    d.bills += 1; d.sales += b.subtotal - b.discount; d.commission += b.commissionAmount;
  });
  const docRows = Object.values(docMap).sort((a, b) => b.commission - a.commission);

  const testMap = {};
  repRows.forEach((r) => { testMap[r.testName] = (testMap[r.testName] || 0) + 1; });
  const testRows = Object.entries(testMap).sort((a, b) => b[1] - a[1]);
  const testMax = testRows[0]?.[1] || 1;

  const methodMap = {};
  pays.forEach((p) => { methodMap[p.method] = round2((methodMap[p.method] || 0) + p.amount); });
  const dues = live.filter((b) => b.due > 0).sort((a, b) => b.due - a.due);
  const expMap = {};
  exps.forEach((e) => { expMap[e.category] = round2((expMap[e.category] || 0) + e.amount); });
  const expRows = Object.entries(expMap).sort((a, b) => b[1] - a[1]);

  last = { from, to, billed, collected, due, spent, net, commission, dayRows, docRows, testRows, methodMap, dues, expRows, finance, billCount: live.length };

  $('#r-body', el).html(`
    <div class="row g-2 mb-3 stagger">
      <div class="col-6 col-lg-3"><div class="kpi kpi-indigo"><div class="kpi-label">Billed</div><div class="kpi-value" data-count="${billed}">${money(billed)}</div><div class="kpi-sub">${live.length === 1 ? '1 bill' : live.length + ' bills'}</div></div></div>
      <div class="col-6 col-lg-3"><div class="kpi kpi-green"><div class="kpi-label">Collected</div><div class="kpi-value" data-count="${collected}">${money(collected)}</div><div class="kpi-sub">cash received</div></div></div>
      <div class="col-6 col-lg-3"><div class="kpi kpi-rose"><div class="kpi-label">Outstanding</div><div class="kpi-value" data-count="${due}">${money(due)}</div><div class="kpi-sub">${dues.length === 1 ? '1 bill' : dues.length + ' bills'} unpaid</div></div></div>
      ${finance ? `<div class="col-6 col-lg-3"><div class="kpi ${net >= 0 ? 'kpi-teal' : 'kpi-rose'}"><div class="kpi-label">Net after expenses</div><div class="kpi-value" data-count="${net}">${money(net)}</div><div class="kpi-sub">expenses ${money(spent)}</div></div></div>` : ''}
    </div>

    ${finance ? `<div class="card-glow panel mb-3 flow-panel">
      <div class="panel-title">Money flow</div>
      <div class="flow">
        <div class="flow-node"><span>Billed</span><b>${money(billed)}</b></div>
        <div class="flow-arrow"><i></i></div>
        <div class="flow-node"><span>Collected</span><b>${money(collected)}</b></div>
        <div class="flow-arrow out"><i></i></div>
        <div class="flow-node neg"><span>Expenses</span><b>${money(spent)}</b></div>
        <div class="flow-arrow"><i></i></div>
        <div class="flow-node ${net >= 0 ? 'pos' : 'neg'}"><span>Net</span><b>${money(net)}</b></div>
      </div>
      <div class="small text-body-secondary mt-2">Doctor commission for this period: ${money(commission)} (payable to doctors, not deducted above).</div>
    </div>` : ''}

    <section class="mb-4"><h2 class="h6 mb-2">Daily book</h2>
      <div class="table-responsive list-card p-0"><table class="table table-sm table-hover align-middle mb-0 table-report">
        <thead><tr><th>Date</th><th class="num">Bills</th><th class="num">Billed</th><th class="num">Collected</th>${finance ? '<th class="num">Expenses</th><th class="num">Net</th>' : ''}</tr></thead>
        <tbody>${dayRows.map((d) => `<tr><td>${esc(fmtDate(d.date))}</td><td class="num">${d.bills}</td><td class="num">${fmtNum(d.billed)}</td><td class="num">${fmtNum(d.collected)}</td>${finance ? `<td class="num">${fmtNum(d.expenses)}</td><td class="num fw-semibold ${d.collected - d.expenses < 0 ? 'text-danger' : ''}">${fmtNum(d.collected - d.expenses)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${finance ? 6 : 4}" class="text-center text-body-secondary py-3">No activity in this period</td></tr>`}</tbody></table></div>
    </section>

    <div class="row g-3">
      <div class="col-lg-6"><section class="mb-4"><h2 class="h6 mb-2">Tests performed</h2>
        <div class="list-card">${testRows.length ? testRows.map(([n, c], i) => `<div class="bar-row" style="--d:${i * 40}ms"><div class="bar-label text-truncate">${esc(n)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${(c / testMax * 100).toFixed(1)}%"></div></div><div class="bar-val">${c}</div></div>`).join('') : UI.emptyState('No tests in this period', 'eyedropper')}</div></section></div>
      <div class="col-lg-6"><section class="mb-4"><h2 class="h6 mb-2">Payment methods</h2>
        <div class="list-card">${Object.keys(methodMap).length ? Object.entries(methodMap).map(([m, v]) => `<div class="list-row"><div class="flex-grow-1">${esc(METHODS[m] || m)}</div><div class="fw-semibold">${money(v)}</div></div>`).join('') : UI.emptyState('No payments in this period', 'cash')}</div></section></div>
    </div>

    ${finance ? `<div class="row g-3">
      <div class="col-lg-6"><section class="mb-4"><h2 class="h6 mb-2">Referring doctors</h2>
        <div class="list-card">${docRows.length ? docRows.map((d) => `<div class="list-row"><div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(d.name)}</div><div class="small text-body-secondary">${d.bills} bills · sales ${fmtNum(d.sales)}</div></div><div class="text-end"><div class="small text-body-secondary">Commission</div><div class="fw-semibold">${money(d.commission)}</div></div></div>`).join('') : UI.emptyState('No referred bills in this period', 'heart-pulse')}</div></section></div>
      <div class="col-lg-6"><section class="mb-4"><h2 class="h6 mb-2">Expenses by category</h2>
        <div class="list-card">${expRows.length ? expRows.map(([c, v]) => `<div class="list-row"><div class="flex-grow-1">${esc(c)}</div><div class="fw-semibold">${money(v)}</div></div>`).join('') : UI.emptyState('No expenses in this period', 'wallet2')}</div></section></div>
    </div>` : ''}

    <section class="mb-4"><h2 class="h6 mb-2">Outstanding balances</h2>
      <div class="list-card">${dues.length ? dues.slice(0, 80).map((b) => `<a class="list-row" href="#/bills/${b.id}"><div class="flex-grow-1 min-w-0"><div class="fw-semibold text-truncate">${esc(b.patient.name)}</div><div class="small text-body-secondary">${esc(b.number)} · ${esc(fmtDate(b.date))}</div></div><div class="fw-semibold text-danger">${money(b.due)}</div></a>`).join('') : UI.emptyState('No balances due. Well done!', 'emoji-smile')}</div>
    </section>`);
  UI.countUp($('#r-body', el)[0], (n) => moneyPlain(n));
}

function printReport(d) {
  const row = (cells, tag = 'td') => `<tr>${cells.map((c, i) => `<${tag} class="${i > 0 ? 'r' : ''}">${c}</${tag}>`).join('')}</tr>`;
  const html = `${labHeader()}
    <div class="pr-title">FINANCE REPORT · ${esc(fmtDate(d.from))} to ${esc(fmtDate(d.to))}</div>
    <table class="pr-totals"><tr><td>Billed (${d.billCount} bills)</td><td class="r">${fmtNum(d.billed)}</td></tr>
      <tr><td>Collected</td><td class="r">${fmtNum(d.collected)}</td></tr>
      <tr><td>Outstanding</td><td class="r">${fmtNum(d.due)}</td></tr>
      ${d.finance ? `<tr><td>Expenses</td><td class="r">${fmtNum(d.spent)}</td></tr><tr class="grand"><td>Net after expenses</td><td class="r">${fmtNum(d.net)}</td></tr>` : ''}</table>
    <h3 class="pr-h">Daily book</h3>
    <table class="pr-items"><thead>${row(['Date', 'Bills', 'Billed', 'Collected', ...(d.finance ? ['Expenses'] : [])], 'th')}</thead><tbody>${d.dayRows.map((x) => row([esc(fmtDate(x.date)), x.bills, fmtNum(x.billed), fmtNum(x.collected), ...(d.finance ? [fmtNum(x.expenses)] : [])])).join('')}</tbody></table>
    ${d.finance && d.docRows.length ? `<h3 class="pr-h">Doctor commissions</h3><table class="pr-items"><thead>${row(['Doctor', 'Bills', 'Commission'], 'th')}</thead><tbody>${d.docRows.map((x) => row([`${esc(x.name)}`, x.bills, fmtNum(x.commission)])).join('')}</tbody></table>` : ''}
    ${d.finance && d.expRows.length ? `<h3 class="pr-h">Expenses by category</h3><table class="pr-items"><tbody>${d.expRows.map(([c, v]) => row([esc(c), fmtNum(v)])).join('')}</tbody></table>` : ''}
    <p class="pr-small pr-center">Printed ${esc(fmtDate(today()))}</p>`;
  printHtml(html, 'Finance report');
}

function exportCsv(d) {
  const rows = [['Date', 'Bills', 'Billed', 'Collected', 'Expenses'], ...d.dayRows.map((x) => [x.date, x.bills, plainNum(x.billed), plainNum(x.collected), plainNum(x.expenses)])];
  rows.push([], ['Outstanding bills'], ['Bill', 'Date', 'Patient', 'Total', 'Due']);
  d.dues.forEach((b) => rows.push([b.number, b.date, b.patient.name, plainNum(b.total), plainNum(b.due)]));
  downloadFile(`lab-report_${d.from}_${d.to}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  UI.toast('CSV downloaded');
}
