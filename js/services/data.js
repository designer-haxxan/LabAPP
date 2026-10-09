// Business rules and every write to the local database. Each operation runs in ONE IndexedDB transaction,
// so a failure leaves no partial bill, payment or report behind.
import { read, write } from '../db/idb.js';
import { getSettings } from '../core/settings.js';
import { uuid, round2, num, today, nowISO, lc, clean, AppError } from '../core/utils.js';
import * as Auth from './auth.js';

const money = (n) => round2(n);

// ---------- Counters & audit ----------
async function nextNumber(t, key, prefix) {
  const cur = (await t.get('meta', `counter:${key}`))?.value || 0;
  const next = cur + 1;
  await t.put('meta', { key: `counter:${key}`, value: next });
  return `${prefix}-${String(next).padStart(6, '0')}`;
}
function audit(t, action, detail = '') {
  return t.put('auditLog', { id: uuid(), at: nowISO(), action, detail: clean(detail, 300), by: Auth.user()?.username || '' });
}

// ---------- Reads ----------
export const listStore = (store) => read([store], (t) => t.getAll(store));
// Reads several stores in one consistent snapshot: { storeName: [records] }.
export function getBundle(stores) {
  return read(stores, async (t) => {
    const out = {};
    for (const s of stores) out[s] = await t.getAll(s);
    return out;
  });
}

// ---------- Reference ranges & flags ----------
// A parameter has ranges: [{ gender:'any'|'male'|'female', ageMin, ageMax, low, high, text }].
// The first range matching the patient's gender and age is used.
const isSet = (v) => v !== '' && v !== null && v !== undefined;
export function rangeFor(param, patient) {
  const age = Number(patient?.age);
  const gender = lc(patient?.gender);
  const hasAge = patient?.age !== '' && patient?.age !== null && patient?.age !== undefined && Number.isFinite(age);
  return (param.ranges || []).find((r) => {
    if (r.gender && r.gender !== 'any' && r.gender !== gender) return false;
    if (hasAge && isSet(r.ageMin) && age < Number(r.ageMin)) return false;
    if (hasAge && isSet(r.ageMax) && age > Number(r.ageMax)) return false;
    if (!hasAge && (isSet(r.ageMin) || isSet(r.ageMax))) return false;
    return true;
  }) || null;
}
export function refText(param, patient) {
  const r = rangeFor(param, patient);
  if (!r) return '';
  if (r.text) return r.text;
  const lo = isSet(r.low) ? r.low : ''; const hi = isSet(r.high) ? r.high : '';
  if (lo !== '' && hi !== '') return `${lo} – ${hi}`;
  if (lo !== '') return `≥ ${lo}`;
  if (hi !== '') return `≤ ${hi}`;
  return '';
}
// 'H' high, 'L' low, 'N' normal, '' not applicable.
export function flagFor(param, value, patient) {
  if (param.type !== 'number' || !isSet(value)) return '';
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  const r = rangeFor(param, patient);
  if (!r) return '';
  if (isSet(r.low) && v < Number(r.low)) return 'L';
  if (isSet(r.high) && v > Number(r.high)) return 'H';
  return isSet(r.low) || isSet(r.high) ? 'N' : '';
}

// ---------- Patients ----------
export async function savePatient(input) {
  Auth.require('patient.edit');
  const name = clean(input.name, 120);
  if (!name) throw new AppError('Enter the patient name.');
  const age = input.age === '' || input.age == null ? '' : Math.round(num(input.age));
  if (age !== '' && (age < 0 || age > 130)) throw new AppError('Age must be between 0 and 130.');
  const gender = ['male', 'female', 'other'].includes(input.gender) ? input.gender : '';
  return write(['meta', 'patients', 'auditLog'], async (t) => {
    const existing = input.id ? await t.get('patients', input.id) : null;
    const rec = {
      id: input.id || uuid(),
      mrNo: existing?.mrNo || await nextNumber(t, 'mr', getSettings().prefixes.mr),
      name, nameLc: lc(name), age, gender,
      phone: clean(input.phone, 30), address: clean(input.address, 300),
      createdAt: existing?.createdAt || nowISO(), updatedAt: nowISO(),
    };
    await t.put('patients', rec);
    await audit(t, existing ? 'patient.update' : 'patient.create', `${rec.mrNo} ${name}`);
    return rec;
  });
}

// ---------- Doctors ----------
export async function saveDoctor(input) {
  Auth.require('doctor.manage');
  const name = clean(input.name, 120);
  if (!name) throw new AppError('Enter the doctor name.');
  const pct = num(input.commissionPct, 0);
  if (pct < 0 || pct > 100) throw new AppError('Commission must be between 0 and 100 percent.');
  const rec = {
    id: input.id || uuid(), name, nameLc: lc(name), specialty: clean(input.specialty, 80),
    phone: clean(input.phone, 30), commissionPct: money(pct), active: input.active !== false, updatedAt: nowISO(),
  };
  return write(['doctors', 'auditLog'], async (t) => {
    await t.put('doctors', rec);
    await audit(t, input.id ? 'doctor.update' : 'doctor.create', name);
    return rec;
  });
}

// ---------- Tests & groups (catalog) ----------
const PARAM_TYPES = ['number', 'text', 'options'];
const GENDERS = ['any', 'male', 'female'];
export function normalizeTest(input) {
  const name = clean(input.name, 160);
  if (!name) throw new AppError('Enter the test name.');
  const price = num(input.price, NaN);
  if (!Number.isFinite(price) || price < 0) throw new AppError('Enter a valid price (0 or more).');
  const params = (input.params || []).map((p, i) => {
    const pname = clean(p.name, 120);
    if (!pname) throw new AppError(`Parameter ${i + 1} needs a name.`);
    const type = PARAM_TYPES.includes(p.type) ? p.type : 'number';
    const options = type === 'options'
      ? String(p.options || '').split(/[,|\n]/).map((o) => clean(o, 60)).filter(Boolean)
      : [];
    let ranges = [];
    if (type === 'number') {
      ranges = (p.ranges || []).map((r) => ({
        gender: GENDERS.includes(r.gender) ? r.gender : 'any',
        ageMin: isSet(r.ageMin) ? num(r.ageMin) : '',
        ageMax: isSet(r.ageMax) ? num(r.ageMax) : '',
        low: isSet(r.low) ? num(r.low) : '',
        high: isSet(r.high) ? num(r.high) : '',
        text: clean(r.text, 80),
      })).filter((r) => r.low !== '' || r.high !== '' || r.text);
    } else if (p.textRef) {
      ranges = [{ gender: 'any', ageMin: '', ageMax: '', low: '', high: '', text: clean(p.textRef, 120) }];
    }
    return { id: p.id || uuid(), name: pname, unit: clean(p.unit, 30), type, options, ranges };
  });
  return {
    id: input.id || uuid(), code: clean(input.code, 20).toUpperCase(), name, nameLc: lc(name),
    department: clean(input.department, 60) || 'General', sampleType: clean(input.sampleType, 60),
    turnaround: clean(input.turnaround, 60), price: money(price), active: input.active !== false,
    notes: clean(input.notes, 500), params, updatedAt: nowISO(),
  };
}
export async function saveTest(input) {
  Auth.require('catalog.manage');
  const rec = normalizeTest(input);
  return write(['tests', 'auditLog'], async (t) => {
    await t.put('tests', rec);
    await audit(t, input.id ? 'test.update' : 'test.create', rec.name);
    return rec;
  });
}
export function normalizeGroup(input) {
  const name = clean(input.name, 160);
  if (!name) throw new AppError('Enter the group name.');
  const price = num(input.price, NaN);
  if (!Number.isFinite(price) || price < 0) throw new AppError('Enter a valid group price.');
  const testIds = [...new Set(input.testIds || [])];
  if (!testIds.length) throw new AppError('Add at least one test to the group.');
  return {
    id: input.id || uuid(), code: clean(input.code, 20).toUpperCase(), name, nameLc: lc(name),
    price: money(price), testIds, active: input.active !== false, notes: clean(input.notes, 300), updatedAt: nowISO(),
  };
}
export async function saveGroup(input) {
  Auth.require('catalog.manage');
  const rec = normalizeGroup(input);
  return write(['groups', 'tests', 'auditLog'], async (t) => {
    for (const id of rec.testIds) if (!(await t.get('tests', id))) throw new AppError('A test in this group no longer exists.');
    await t.put('groups', rec);
    await audit(t, input.id ? 'group.update' : 'group.create', rec.name);
    return rec;
  });
}

// Deletes a record only when nothing refers to it; otherwise the caller should deactivate it.
// usage: [{ store, index, label }] lists where the id may be referenced.
export async function deleteIfUnused(store, id, usage = []) {
  Auth.require({ doctors: 'doctor.manage', patients: 'patient.edit' }[store] || 'catalog.manage');
  return write([store, 'auditLog', ...usage.map((u) => u.store)], async (t) => {
    for (const u of usage) {
      const n = await t.countByIndex(u.store, u.index, id);
      if (n > 0) throw new AppError(`This record is used in ${n} ${u.label}. Deactivate it instead.`);
    }
    await t.delete(store, id);
    await audit(t, `${store}.delete`, id);
  });
}

// ---------- Bills ----------
// input: { id, patientId, doctorId, lines:[{kind:'test'|'group', refId, price?}], discount, paid, method, note }
// Prices come from the catalog inside the transaction; a line price may be lowered by the receptionist.
export async function createBill(input) {
  Auth.require('bill.create');
  if (!input.patientId) throw new AppError('Select a patient first.');
  if (!input.lines?.length) throw new AppError('Add at least one test or group.');
  const settings = getSettings();
  return write(['meta', 'patients', 'doctors', 'tests', 'groups', 'bills', 'payments', 'reports', 'auditLog'], async (t) => {
    // Double tap or retry after a refresh: the same bill id is returned, nothing is saved twice.
    if (input.id) {
      const existing = await t.get('bills', input.id);
      if (existing) return existing;
    }
    const patient = await t.get('patients', input.patientId);
    if (!patient) throw new AppError('This patient no longer exists.');
    const doctor = input.doctorId ? await t.get('doctors', input.doctorId) : null;
    if (input.doctorId && !doctor) throw new AppError('The selected doctor no longer exists.');

    const lines = [];
    for (const l of input.lines) {
      if (l.kind === 'group') {
        const g = await t.get('groups', l.refId);
        if (!g) throw new AppError('A group on this bill no longer exists.');
        const tests = [];
        for (const id of g.testIds) {
          const tr = await t.get('tests', id);
          if (tr) tests.push(tr);
        }
        if (!tests.length) throw new AppError(`Group "${g.name}" has no tests.`);
        lines.push({ id: uuid(), kind: 'group', refId: g.id, name: g.name, listPrice: g.price, price: priceFor(l, g.price), tests });
      } else {
        const tr = await t.get('tests', l.refId);
        if (!tr) throw new AppError('A test on this bill no longer exists.');
        lines.push({ id: uuid(), kind: 'test', refId: tr.id, name: tr.name, listPrice: tr.price, price: priceFor(l, tr.price), tests: [tr] });
      }
    }
    const subtotal = money(lines.reduce((s, l) => s + l.price, 0));
    const discount = money(Math.min(Math.max(num(input.discount, 0), 0), subtotal));
    const taxRate = Math.max(0, num(settings.taxRate, 0));
    const tax = money((subtotal - discount) * taxRate / 100);
    const total = money(subtotal - discount + tax);
    const paid = money(Math.min(Math.max(num(input.paid, 0), 0), total));
    const due = money(total - paid);
    const commissionPct = doctor ? num(doctor.commissionPct, 0) : 0;
    const commissionAmount = doctor ? money((subtotal - discount) * commissionPct / 100) : 0;
    const date = today();
    const number = await nextNumber(t, 'bill', settings.prefixes.bill);

    const bill = {
      id: input.id || uuid(), number, date, createdAt: nowISO(),
      patientId: patient.id,
      patient: { mrNo: patient.mrNo, name: patient.name, age: patient.age, gender: patient.gender, phone: patient.phone },
      doctorId: doctor?.id || '', doctorName: doctor?.name || '', commissionPct, commissionAmount,
      lines, subtotal, discount, taxRate, tax, total, paid, due,
      status: statusFor(total, paid), note: clean(input.note, 300), createdBy: Auth.user()?.username || '',
    };
    await t.put('bills', bill);

    if (paid > 0) {
      await t.put('payments', { id: uuid(), billId: bill.id, billNumber: number, date, amount: paid, method: input.method || 'cash', note: '', createdAt: bill.createdAt });
    }
    for (const l of lines) {
      for (const tr of l.tests) {
        // Parameters are copied into the report, so later catalog edits never change finished reports.
        await t.put('reports', {
          id: uuid(), billId: bill.id, billNumber: number, lineId: l.id, date,
          patientId: patient.id, testId: tr.id, testName: tr.name, department: tr.department,
          sampleType: tr.sampleType, status: 'pending', params: tr.params || [],
          values: {}, flags: {}, remarks: '', createdAt: bill.createdAt,
        });
      }
    }
    await audit(t, 'bill.create', `${number} ${patient.name} ${total}`);
    return bill;
  });
}
function priceFor(line, list) {
  if (line.price === undefined || line.price === null || line.price === '') return money(list);
  const p = num(line.price, NaN);
  if (!Number.isFinite(p) || p < 0) throw new AppError('Line prices must be 0 or more.');
  return money(p);
}
function statusFor(total, paid) {
  if (total - paid <= 0.005) return 'paid';
  return paid > 0 ? 'partial' : 'due';
}

// Records a payment against a bill's balance. Refunds (negative amounts) are written only by voids.
export async function collectPayment(billId, { id, amount, method, note }) {
  Auth.require('payment.collect');
  const amt = money(num(amount, NaN));
  if (!Number.isFinite(amt) || amt <= 0) throw new AppError('Enter an amount greater than 0.');
  return write(['bills', 'payments', 'auditLog'], async (t) => {
    if (id && await t.get('payments', id)) return t.get('bills', billId);
    const bill = await t.get('bills', billId);
    if (!bill) throw new AppError('Bill not found.');
    if (bill.status === 'void') throw new AppError('This bill is void.');
    if (amt > bill.due + 0.005) throw new AppError(`Amount is more than the balance due (${bill.due}).`);
    bill.paid = money(bill.paid + amt);
    bill.due = money(bill.total - bill.paid);
    bill.status = statusFor(bill.total, bill.paid);
    await t.put('bills', bill);
    await t.put('payments', { id: id || uuid(), billId, billNumber: bill.number, date: today(), amount: amt, method: method || 'cash', note: clean(note, 200), createdAt: nowISO() });
    await audit(t, 'payment.collect', `${bill.number} ${amt}`);
    return bill;
  });
}

// Voids a bill. Only allowed while every test is still pending. Money already paid is returned as a refund entry.
export async function voidBill(billId, reason) {
  Auth.require('bill.void');
  const why = clean(reason, 200);
  if (!why) throw new AppError('Enter the reason for voiding this bill.');
  return write(['bills', 'payments', 'reports', 'auditLog'], async (t) => {
    const bill = await t.get('bills', billId);
    if (!bill) throw new AppError('Bill not found.');
    if (bill.status === 'void') throw new AppError('This bill is already void.');
    const reports = await t.getAllByIndex('reports', 'billId', billId);
    if (reports.some((r) => r.status !== 'pending')) throw new AppError('Results have already been entered for this bill, so it cannot be voided.');
    if (bill.paid > 0) {
      await t.put('payments', { id: uuid(), billId, billNumber: bill.number, date: today(), amount: -bill.paid, method: 'refund', note: 'Refund on void', createdAt: nowISO() });
    }
    for (const r of reports) { r.status = 'void'; await t.put('reports', r); }
    Object.assign(bill, { status: 'void', voidReason: why, voidedAt: nowISO(), paid: 0, due: 0 });
    await t.put('bills', bill);
    await audit(t, 'bill.void', `${bill.number}: ${why}`);
    return bill;
  });
}

// ---------- Results ----------
// values: { [paramId]: value }. Flags are computed here from the patient's age and gender at save time.
// verify=true marks the report verified (verifier only); otherwise it is saved as entered.
export async function saveResults(reportId, { values, remarks }, { verify = false } = {}) {
  Auth.require(verify ? 'results.verify' : 'results.enter');
  return write(['reports', 'bills', 'auditLog'], async (t) => {
    const r = await t.get('reports', reportId);
    if (!r) throw new AppError('Report not found.');
    if (r.status === 'void') throw new AppError('This test was voided.');
    const bill = await t.get('bills', r.billId);
    const patient = bill?.patient || {};
    const stored = {}; const flags = {};
    for (const p of r.params) {
      const raw = values?.[p.id];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      if (p.type === 'number') {
        const n = num(raw, NaN);
        if (!Number.isFinite(n)) throw new AppError(`"${p.name}" must be a number.`);
        stored[p.id] = String(n);
      } else {
        stored[p.id] = clean(raw, 200);
      }
      flags[p.id] = flagFor(p, stored[p.id], patient);
    }
    if (verify && r.status === 'pending') throw new AppError('Enter the results before verifying.');
    r.status = verify ? 'verified' : 'entered';
    if (verify) { r.verifiedAt = nowISO(); r.verifiedBy = Auth.user()?.username || ''; }
    else { r.enteredAt = nowISO(); r.enteredBy = Auth.user()?.username || ''; }
    Object.assign(r, { values: stored, flags, remarks: clean(remarks, 1000) });
    await t.put('reports', r);
    await audit(t, verify ? 'result.verify' : 'result.enter', `${r.billNumber} ${r.testName}`);
    return r;
  });
}
// Moves a verified or entered report back to 'entered' so it can be corrected (verifier only).
export async function reopenReport(reportId) {
  Auth.require('results.verify');
  return write(['reports', 'auditLog'], async (t) => {
    const r = await t.get('reports', reportId);
    if (!r || r.status === 'void') throw new AppError('Report not found.');
    r.status = 'entered'; delete r.verifiedAt; delete r.verifiedBy;
    await t.put('reports', r);
    await audit(t, 'result.reopen', `${r.billNumber} ${r.testName}`);
    return r;
  });
}

// ---------- Expenses ----------
export async function saveExpense(input) {
  Auth.require('expense.manage');
  const amount = money(num(input.amount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Enter an amount greater than 0.');
  const date = input.date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('Enter a valid date.');
  const rec = {
    id: input.id || uuid(), date, amount, category: clean(input.category, 60) || 'Other',
    payee: clean(input.payee, 120), method: clean(input.method, 30) || 'cash', note: clean(input.note, 300), updatedAt: nowISO(),
  };
  return write(['expenses', 'auditLog'], async (t) => {
    await t.put('expenses', rec);
    await audit(t, input.id ? 'expense.update' : 'expense.create', `${rec.category} ${amount}`);
    return rec;
  });
}
export async function deleteExpense(id) {
  Auth.require('expense.manage');
  return write(['expenses', 'auditLog'], async (t) => {
    await t.delete('expenses', id);
    await audit(t, 'expense.delete', id);
  });
}

// ---------- Supplies (lab consumables & reagents) ----------
// Alerts only apply once an item has been stocked, so brand-new starter items do not look urgent.
export const isLowStock = (s) => !!s.stocked && s.quantity <= s.reorderLevel;
export async function saveSupply(input) {
  Auth.require('supply.manage');
  const name = clean(input.name, 120);
  if (!name) throw new AppError('Enter the item name.');
  return write(['supplies', 'auditLog'], async (t) => {
    const existing = input.id ? await t.get('supplies', input.id) : null;
    const rec = {
      id: input.id || uuid(), name, nameLc: lc(name), category: clean(input.category, 60) || 'Consumables',
      unit: clean(input.unit, 30) || 'pcs', quantity: existing?.quantity || 0,
      reorderLevel: Math.max(0, num(input.reorderLevel, 0)), unitCost: Math.max(0, num(input.unitCost, 0)),
      active: input.active !== false, updatedAt: nowISO(),
    };
    await t.put('supplies', rec);
    await audit(t, existing ? 'supply.update' : 'supply.create', name);
    return rec;
  });
}
// type 'in' adds stock, 'out' uses it. Stock can never go below zero.
export async function moveSupply(supplyId, { type, qty, note, date }) {
  Auth.require('supply.manage');
  const q = num(qty, NaN);
  if (!Number.isFinite(q) || q <= 0) throw new AppError('Enter a quantity greater than 0.');
  return write(['supplies', 'supplyMoves', 'auditLog'], async (t) => {
    const s = await t.get('supplies', supplyId);
    if (!s) throw new AppError('Item not found.');
    const next = type === 'out' ? s.quantity - q : s.quantity + q;
    if (next < 0) throw new AppError(`Only ${s.quantity} ${s.unit} in stock.`);
    s.quantity = money(next);
    if (type === 'in') s.stocked = true;
    await t.put('supplies', s);
    await t.put('supplyMoves', { id: uuid(), supplyId, type, qty: q, balance: s.quantity, note: clean(note, 200), date: date || today(), createdAt: nowISO() });
    await audit(t, `supply.${type}`, `${s.name} ${q}`);
    return s;
  });
}

// ---------- Backup ----------
export async function exportAll(stores) {
  return read(stores, async (t) => {
    const out = {};
    for (const s of stores) out[s] = await t.getAll(s);
    return out;
  });
}
export async function replaceAll(stores, data) {
  Auth.require('backup.export');
  return write(stores, async (t) => {
    for (const s of stores) {
      await t.clear(s);
      for (const rec of data[s] || []) await t.put(s, rec);
    }
  });
}
