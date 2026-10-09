// Backup & restore: one JSON file with every record and the lab settings. Import validates everything
// (format, versions, record counts and checksum) before any data changes, then replaces in one transaction.
import * as UI from '../core/ui.js';
import { esc, fmtDateTime, today, downloadFile } from '../core/utils.js';
import { getSettings, saveSettings, pref } from '../core/settings.js';
import { CONFIG } from '../config.js';
import { DATA_STORES } from '../db/schema.js';
import { exportAll, replaceAll } from '../services/data.js';
import * as Auth from '../services/auth.js';

const $ = window.jQuery;
const FORMAT = 'labcare-backup';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Stores restored from a backup. Counters live in meta, so numbering continues where it stopped.
const countsOf = (data) => Object.fromEntries(DATA_STORES.filter((s) => s !== 'meta').map((s) => [s, (data[s] || []).length]));

let pending = null; // file that passed every check, waiting for the owner to type REPLACE

export async function render(el, ctx) {
  ctx.setTitle?.('Backup & Restore');
  el.innerHTML = `
    <div class="page-header d-flex align-items-center gap-2 mb-3"><h1 class="h5 mb-0 flex-grow-1">Backup &amp; Restore</h1></div>
    <div class="row g-3">
      <div class="col-md-6"><section class="card-glow panel h-100">
        <div class="panel-title"><i class="bi bi-cloud-arrow-down me-2"></i>Export backup</div>
        <p class="small text-body-secondary">Downloads one file with all patients, bills, payments, results, tests, doctors, expenses, supplies and settings. Keep it somewhere safe. Login passwords are never included.</p>
        <button class="btn btn-grad" id="do-export"><i class="bi bi-download me-1"></i>Download backup</button>
      </section></div>
      <div class="col-md-6"><section class="card-glow panel h-100">
        <div class="panel-title"><i class="bi bi-cloud-arrow-up me-2"></i>Restore from file</div>
        <p class="small text-body-secondary">Replaces all data on this device with the backup. The file is checked first. Make a backup of the current data before restoring.</p>
        <input type="file" class="form-control" id="restore-file" accept="application/json,.json">
        <div id="restore-preview" class="mt-3"></div>
      </section></div>
    </div>`;
  $(el).on('click', '#do-export', async () => {
    try {
      const data = await UI.withLoading(() => exportAll(DATA_STORES), 'Preparing backup…');
      const body = { format: FORMAT, backupVersion: CONFIG.BACKUP_VERSION, appVersion: CONFIG.APP_VERSION, schemaVersion: CONFIG.SCHEMA_VERSION,
        createdAt: new Date().toISOString(), createdBy: Auth.user()?.username || '', counts: countsOf(data), settings: getSettings(), data };
      body.checksum = await sha256(JSON.stringify(data));
      downloadFile(`labcare-backup-${today()}.json`, JSON.stringify(body), 'application/json');
      pref.set('lastBackup', body.createdAt);
      UI.toast('Backup downloaded');
    } catch (e) { UI.toastError(e); }
  });
  $(el).on('input', '#restore-confirm', function () { $('#do-restore', el).prop('disabled', this.value.trim() !== 'REPLACE'); });
  $(el).on('click', '#do-restore', async () => {
    if (!pending || !Auth.can('backup.export')) return UI.toast('Not allowed for this account', 'warning');
    const { body } = pending;
    try {
      await UI.withLoading(() => replaceAll(DATA_STORES, body.data), 'Restoring…');
      if (body.settings) saveSettings(body.settings);
      pending = null;
      UI.toast('Backup restored');
      location.hash = '#/dashboard';
      location.reload();
    } catch (e) { UI.toastError(e); }
  });
  $(el).on('change', '#restore-file', async function () {
    const file = this.files?.[0];
    if (!file) return;
    try {
      pending = await readAndCheck(file);
      showPreview(el, pending);
    } catch (e) { UI.toastError(e); this.value = ''; $('#restore-preview', el).empty(); }
  });
}

// Reads the file and runs every check. Throws a readable error; never changes local data.
async function readAndCheck(file) {
  if (file.size > 60 * 1024 * 1024) throw new Error('This file is too large to be a lab backup.');
  let raw; let body;
  try { raw = await file.text(); body = JSON.parse(raw); } catch { throw new Error('This file is not a valid backup (it is not readable JSON).'); }
  if (body?.format !== FORMAT) throw new Error('This is not a LabCare backup file.');
  if (body.backupVersion !== CONFIG.BACKUP_VERSION) throw new Error(`Backup version ${body.backupVersion} is not supported by this app.`);
  if (Number(body.schemaVersion) > CONFIG.SCHEMA_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
  const data = body.data;
  if (!data || typeof data !== 'object') throw new Error('The backup has no data section.');
  for (const s of DATA_STORES) {
    if (!Array.isArray(data[s])) throw new Error(`The backup is missing "${s}".`);
    for (const rec of data[s]) if (s !== 'meta' && (!rec || typeof rec.id !== 'string')) throw new Error(`A record in "${s}" has no id.`);
  }
  const counts = countsOf(data);
  for (const [s, n] of Object.entries(counts)) {
    if (body.counts?.[s] !== undefined && body.counts[s] !== n) throw new Error(`Record count mismatch in "${s}" (file may be truncated).`);
  }
  if (body.checksum !== await sha256(JSON.stringify(data))) throw new Error('Checksum failed: the file was changed or damaged.');
  return { body, counts };
}

async function showPreview(el, { body, counts }) {
  const cur = Object.fromEntries(Object.entries(await exportAll(DATA_STORES.filter((s) => s !== 'meta'))).map(([s, v]) => [s, v.length]));
  const rows = Object.keys(counts).filter((s) => s !== 'auditLog').map((s) => `<tr><td class="text-capitalize">${esc(s.replace(/([A-Z])/g, ' $1'))}</td><td class="num">${cur[s] ?? 0}</td><td class="num fw-semibold">${counts[s]}</td></tr>`).join('');
  $('#restore-preview', el).html(`
    <div class="alert alert-success small py-2">Backup is valid. Created ${esc(fmtDateTime(body.createdAt))} by ${esc(body.createdBy || 'unknown')}.</div>
    <table class="table table-sm mb-3"><thead><tr><th>Records</th><th class="num">On this device</th><th class="num">In backup</th></tr></thead><tbody>${rows}</tbody></table>
    <label class="form-label small">Type <b>REPLACE</b> to confirm</label>
    <div class="d-flex gap-2"><input class="form-control" id="restore-confirm" autocomplete="off">
      <button class="btn btn-danger" id="do-restore" disabled>Restore</button></div>`);
}
