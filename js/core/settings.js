// Lab profile and preferences stored in LocalStorage (never operational data or secrets).
import { storageKey } from '../config.js';

const KEY = storageKey('labsettings');

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent', 'Electricity', 'Gas & Water', 'Salaries', 'Reagents & Kits', 'Consumables',
  'Equipment Repair', 'Maintenance & Cleaning', 'Transport', 'Internet & Phone', 'Printing & Stationery', 'Other',
];

export const DEFAULT_SETTINGS = {
  lab: {
    name: 'My Diagnostic Lab',
    tagline: 'Accurate results you can trust',
    address: '',
    phone: '',
    email: '',
    license: '',
    reportFooter: 'This is a computer-generated report. Results should be correlated clinically.',
    signatory: 'Lab Supervisor',
  },
  currency: 'Rs',
  taxRate: 0,              // percent added to bills (0 = no tax)
  defaultCommission: 0,    // default referral commission % for new doctors
  prefixes: { bill: 'LAB', mr: 'MR' },
  expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
  theme: 'auto',
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

let cache = null;
export function getSettings() {
  if (!cache) {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { stored = {}; }
    cache = merge(DEFAULT_SETTINGS, stored);
  }
  return cache;
}

export function saveSettings(patch) {
  cache = merge(getSettings(), patch);
  localStorage.setItem(KEY, JSON.stringify(cache));
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

export function replaceSettings(all) {
  cache = merge(DEFAULT_SETTINGS, all || {});
  localStorage.setItem(KEY, JSON.stringify(cache));
  document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  return cache;
}

// Small per-device preference helpers
export const pref = {
  get(k, d = null) { try { const v = localStorage.getItem(storageKey('pref.' + k)); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(storageKey('pref.' + k), JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};

export function applyTheme() {
  const t = getSettings().theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#4f46e5');
}
