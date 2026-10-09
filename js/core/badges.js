// Small status pills and labels shared by several modules.
import { esc } from './utils.js';

const BILL_STATUS = {
  paid: ['Paid', 'success'],
  partial: ['Partial', 'warning'],
  due: ['Due', 'danger'],
  void: ['Void', 'secondary'],
};
const REPORT_STATUS = {
  pending: ['Pending', 'secondary'],
  entered: ['Entered', 'info'],
  verified: ['Verified', 'success'],
  void: ['Void', 'dark'],
};
const FLAG = {
  H: ['High', 'danger'],
  L: ['Low', 'primary'],
  N: ['Normal', 'success'],
};

export const billBadge = (s) => { const [label, c] = BILL_STATUS[s] || [s, 'secondary']; return `<span class="pill pill-${c}">${esc(label)}</span>`; };
export const reportBadge = (s) => { const [label, c] = REPORT_STATUS[s] || [s, 'secondary']; return `<span class="pill pill-${c}">${esc(label)}</span>`; };
export const flagBadge = (f) => {
  if (!f || !FLAG[f]) return '';
  const [label, c] = FLAG[f];
  return `<span class="flag flag-${c}" title="${esc(label)}">${f}</span>`;
};
export const genderLabel = (g) => ({ male: 'Male', female: 'Female', other: 'Other' }[g] || '');
export const initialsOf = (name) => {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
};
// Pill-shaped counter for list headers, e.g. "12 pending".
export const countPill = (n, label, c = 'primary') => `<span class="pill pill-${c}">${n} ${esc(label)}</span>`;
