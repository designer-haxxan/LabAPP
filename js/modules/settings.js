// Settings: lab profile printed on reports and receipts, billing defaults, expense categories, theme.
import * as UI from '../core/ui.js';
import { esc, num } from '../core/utils.js';
import { getSettings, saveSettings, DEFAULT_EXPENSE_CATEGORIES } from '../core/settings.js';
import { seedCatalog } from '../services/seed.js';
import * as Auth from '../services/auth.js';
import { CONFIG } from '../config.js';

const $ = window.jQuery;

export async function render(el, ctx) {
  ctx.setTitle?.('Settings');
  const s = getSettings();
  const canManage = Auth.can('settings.manage');
  const dis = canManage ? '' : 'disabled';
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3"><h1 class="h5 mb-0 flex-grow-1">Settings</h1></div>
    <form id="set-form" class="settings-form" novalidate>
      <section class="card-glow panel mb-3">
        <div class="panel-title"><i class="bi bi-building me-2"></i>Lab profile</div>
        <p class="small text-body-secondary mb-3">Printed on every receipt and report.</p>
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">Lab name *</label><input name="lab.name" class="form-control" required maxlength="120" value="${esc(s.lab.name)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label">Tagline</label><input name="lab.tagline" class="form-control" maxlength="120" value="${esc(s.lab.tagline)}" ${dis}></div>
          <div class="col-12"><label class="form-label">Address</label><input name="lab.address" class="form-control" maxlength="300" value="${esc(s.lab.address)}" ${dis}></div>
          <div class="col-md-4"><label class="form-label">Phone</label><input name="lab.phone" type="tel" class="form-control" maxlength="40" value="${esc(s.lab.phone)}" ${dis}></div>
          <div class="col-md-4"><label class="form-label">Email</label><input name="lab.email" type="email" class="form-control" maxlength="120" value="${esc(s.lab.email)}" ${dis}></div>
          <div class="col-md-4"><label class="form-label">License / registration no.</label><input name="lab.license" class="form-control" maxlength="60" value="${esc(s.lab.license)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label">Report signatory</label><input name="lab.signatory" class="form-control" maxlength="80" value="${esc(s.lab.signatory)}" ${dis}></div>
          <div class="col-md-6"><label class="form-label">Report footer note</label><input name="lab.reportFooter" class="form-control" maxlength="300" value="${esc(s.lab.reportFooter)}" ${dis}></div>
        </div>
      </section>

      <section class="card-glow panel mb-3">
        <div class="panel-title"><i class="bi bi-cash-stack me-2"></i>Billing</div>
        <div class="row g-3">
          <div class="col-md-3 col-6"><label class="form-label">Currency</label><input name="currency" class="form-control" maxlength="8" value="${esc(s.currency)}" ${dis}></div>
          <div class="col-md-3 col-6"><label class="form-label">Tax %</label><input name="taxRate" type="number" min="0" max="100" step="0.5" class="form-control" value="${esc(s.taxRate)}" ${dis}></div>
          <div class="col-md-3 col-6"><label class="form-label">Default doctor commission %</label><input name="defaultCommission" type="number" min="0" max="100" step="0.5" class="form-control" value="${esc(s.defaultCommission)}" ${dis}></div>
          <div class="col-md-3 col-6"><label class="form-label">Bill number prefix</label><input name="prefixes.bill" class="form-control text-uppercase" maxlength="8" value="${esc(s.prefixes.bill)}" ${dis}></div>
          <div class="col-md-3 col-6"><label class="form-label">MR number prefix</label><input name="prefixes.mr" class="form-control text-uppercase" maxlength="8" value="${esc(s.prefixes.mr)}" ${dis}></div>
          <div class="col-12"><div class="form-text">Bill and MR numbers keep counting from where they are. Changing the prefix only affects new numbers.</div></div>
        </div>
      </section>

      <section class="card-glow panel mb-3">
        <div class="panel-title"><i class="bi bi-wallet2 me-2"></i>Expense categories</div>
        <label class="form-label">Categories (comma separated)</label>
        <textarea class="form-control" name="expenseCategories" rows="3" ${dis}>${esc(s.expenseCategories.join(', '))}</textarea>
        <div class="form-text">Used when recording expenses. Existing expenses keep their category name.</div>
      </section>

      <section class="card-glow panel mb-3">
        <div class="panel-title"><i class="bi bi-palette me-2"></i>Appearance</div>
        <div class="seg" role="radiogroup" aria-label="Theme">
          ${[['auto', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<label class="seg-btn ${s.theme === v ? 'active' : ''}"><input type="radio" class="visually-hidden" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''}>${l}</label>`).join('')}
        </div>
      </section>

      ${canManage ? `<div class="d-flex gap-2 flex-wrap mb-4">
        <button class="btn btn-grad" type="submit"><i class="bi bi-check2 me-1"></i>Save settings</button>
        <button class="btn btn-light" type="button" id="reseed"><i class="bi bi-arrow-repeat me-1"></i>Add missing starter tests &amp; supplies</button>
      </div>` : '<div class="alert alert-light small">Only a manager or owner can change these settings.</div>'}
    </form>
    <div class="small text-body-secondary text-center mb-4">${esc(CONFIG.APP_NAME)} · version ${esc(CONFIG.APP_VERSION)}</div>`;

  $(el).on('change', '[name=theme]', function () { saveSettings({ theme: this.value }); $(el).find('.seg-btn').removeClass('active'); $(this).closest('.seg-btn').addClass('active'); });
  $(el).on('submit', '#set-form', async (e) => {
    e.preventDefault();
    if (!canManage) return;
    const patch = { lab: {}, prefixes: {} };
    const fd = Object.fromEntries(new FormData(e.currentTarget).entries());
    for (const [k, v] of Object.entries(fd)) {
      if (k === 'theme') continue;
      const val = String(v).trim();
      if (k.startsWith('lab.')) patch.lab[k.slice(4)] = val;
      else if (k.startsWith('prefixes.')) patch.prefixes[k.slice(9)] = val.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8) || 'X';
      else if (k === 'expenseCategories') patch.expenseCategories = val.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 40);
      else if (k === 'taxRate' || k === 'defaultCommission') patch[k] = Math.min(100, Math.max(0, num(val, 0)));
      else patch[k] = val;
    }
    if (!patch.lab.name) return UI.toast('Enter the lab name', 'warning');
    if (!patch.expenseCategories?.length) patch.expenseCategories = DEFAULT_EXPENSE_CATEGORIES;
    saveSettings(patch);
    UI.toast('Settings saved');
    ctx.setTitle?.('Settings');
  });
  $(el).on('click', '#reseed', async () => {
    try {
      const n = await UI.withLoading(() => seedCatalog(), 'Adding starter records…');
      UI.toast(n ? `Added ${n} starter records` : 'Starter records are already present');
    } catch (err) { UI.toastError(err); }
  });
}
