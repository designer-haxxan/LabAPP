// Starter catalog for a Pakistani diagnostic lab. Prices are indicative starting points, checked against
// published Pakistani lab rates in 2026. Set them to your own lab's rates. Consumables start at cost 0.
// Seeding only adds records whose seed id is missing, so it is safe to run more than once.
import { write } from '../db/idb.js';
import { normalizeTest, normalizeGroup } from './data.js';

// Numeric reference range helpers. low/high are inclusive bounds; gender limits the range.
const r = (low, high, gender = 'any') => ({ gender, ageMin: '', ageMax: '', low, high, text: '' });
const rm = (low, high) => r(low, high, 'male');
const rf = (low, high) => r(low, high, 'female');
const num = (id, name, unit, ranges) => ({ id: `seed-p-${id}`, name, unit, type: 'number', options: [], ranges });
const txt = (id, name, unit = '') => ({ id: `seed-p-${id}`, name, unit, type: 'text', options: [], ranges: [] });
const opt = (id, name, options) => ({ id: `seed-p-${id}`, name, unit: '', type: 'options', options: options.split(', '), ranges: [] });

export const SEED_TESTS = [
  { id: 'seed-cbc', code: 'CBC', name: 'Complete Blood Count (CBC)', department: 'Hematology', sampleType: 'EDTA whole blood', turnaround: '2-4 hours', price: 600, params: [
    num('hb', 'Hemoglobin', 'g/dL', [rm(13, 17), rf(12, 15)]),
    num('wbc', 'WBC (Total Leukocyte Count)', '/cumm', [r(4000, 11000)]),
    num('rbc', 'RBC', 'million/cumm', [rm(4.5, 5.9), rf(4.1, 5.1)]),
    num('hct', 'Hematocrit (PCV)', '%', [rm(40, 52), rf(36, 46)]),
    num('mcv', 'MCV', 'fL', [r(80, 100)]),
    num('plt', 'Platelet Count', '/cumm', [r(150000, 450000)]),
    num('neut', 'Neutrophils', '%', [r(40, 75)]),
    num('lymph', 'Lymphocytes', '%', [r(20, 45)]),
  ] },
  { id: 'seed-fbs', code: 'FBS', name: 'Fasting Blood Sugar (FBS)', department: 'Biochemistry', sampleType: 'Fluoride grey-top', turnaround: '2-4 hours', price: 300, params: [
    num('fbs', 'Glucose (Fasting)', 'mg/dL', [r(70, 100)]),
  ] },
  { id: 'seed-rbs', code: 'RBS', name: 'Random Blood Sugar (RBS)', department: 'Biochemistry', sampleType: 'Fluoride grey-top', turnaround: '2-4 hours', price: 250, params: [
    num('rbs', 'Glucose (Random)', 'mg/dL', [r(70, 140)]),
  ] },
  { id: 'seed-hba1c', code: 'HBA1C', name: 'HbA1c (Glycated Hemoglobin)', department: 'Biochemistry', sampleType: 'EDTA whole blood', turnaround: '1 day', price: 1470, params: [
    num('hba1c', 'HbA1c', '%', [r(4.0, 5.6)]),
  ] },
  { id: 'seed-lipid', code: 'LIPID', name: 'Lipid Profile', department: 'Biochemistry', sampleType: 'Serum (fasting)', turnaround: '4-6 hours', price: 1500, params: [
    num('tc', 'Total Cholesterol', 'mg/dL', [r(0, 200)]),
    num('tg', 'Triglycerides', 'mg/dL', [r(0, 150)]),
    num('hdl', 'HDL Cholesterol', 'mg/dL', [rm(40, 999), rf(50, 999)]),
    num('ldl', 'LDL Cholesterol (calculated)', 'mg/dL', [r(0, 100)]),
    num('vldl', 'VLDL Cholesterol', 'mg/dL', [r(2, 30)]),
  ] },
  { id: 'seed-lft', code: 'LFT', name: 'Liver Function Test (LFT)', department: 'Biochemistry', sampleType: 'Serum', turnaround: '6-8 hours', price: 1800, params: [
    num('tbil', 'Total Bilirubin', 'mg/dL', [r(0.1, 1.2)]),
    num('alt', 'ALT (SGPT)', 'U/L', [r(7, 56)]),
    num('ast', 'AST (SGOT)', 'U/L', [r(10, 40)]),
    num('alp', 'Alkaline Phosphatase', 'U/L', [r(44, 147)]),
    num('alb', 'Albumin', 'g/dL', [r(3.5, 5.0)]),
  ] },
  { id: 'seed-rft', code: 'RFT', name: 'Kidney Function Test (RFT / KFT)', department: 'Biochemistry', sampleType: 'Serum', turnaround: '6-8 hours', price: 1200, params: [
    num('creat', 'Creatinine', 'mg/dL', [rm(0.7, 1.3), rf(0.6, 1.1)]),
    num('urea', 'Blood Urea', 'mg/dL', [r(15, 45)]),
    num('uric', 'Uric Acid', 'mg/dL', [rm(3.4, 7.0), rf(2.4, 6.0)]),
    num('na', 'Sodium', 'mmol/L', [r(135, 145)]),
    num('k', 'Potassium', 'mmol/L', [r(3.5, 5.1)]),
  ] },
  { id: 'seed-tft', code: 'THYROID', name: 'Thyroid Profile (T3, T4, TSH)', department: 'Hormones', sampleType: 'Serum', turnaround: '1 day', price: 2730, params: [
    num('tsh', 'TSH', 'mIU/L', [r(0.4, 4.0)]),
    num('t4', 'Free T4', 'ng/dL', [r(0.8, 1.8)]),
    num('t3', 'Free T3', 'pg/mL', [r(2.3, 4.2)]),
  ] },
  { id: 'seed-vitd', code: 'VITD', name: 'Vitamin D (25-OH)', department: 'Hormones', sampleType: 'Serum', turnaround: '1-2 days', price: 2500, params: [
    num('vitd', '25-Hydroxy Vitamin D', 'ng/mL', [r(30, 100)]),
  ] },
  { id: 'seed-b12', code: 'B12', name: 'Vitamin B12', department: 'Hormones', sampleType: 'Serum', turnaround: '1-2 days', price: 2000, params: [
    num('b12', 'Vitamin B12', 'pg/mL', [r(200, 900)]),
  ] },
  { id: 'seed-crp', code: 'CRP', name: 'C-Reactive Protein (CRP)', department: 'Biochemistry', sampleType: 'Serum', turnaround: '4-6 hours', price: 900, params: [
    num('crp', 'CRP (quantitative)', 'mg/L', [r(0, 6)]),
  ] },
  { id: 'seed-esr', code: 'ESR', name: 'ESR (Erythrocyte Sedimentation Rate)', department: 'Hematology', sampleType: 'EDTA whole blood', turnaround: '1-2 hours', price: 300, params: [
    num('esr', 'ESR (1st hour)', 'mm/hr', [rm(0, 15), rf(0, 20)]),
  ] },
  { id: 'seed-bg', code: 'BG', name: 'Blood Group & Rh Factor', department: 'Serology', sampleType: 'EDTA whole blood', turnaround: '1-2 hours', price: 300, params: [
    opt('abo', 'ABO Group', 'A, B, AB, O'),
    opt('rh', 'Rh Factor', 'Positive, Negative'),
  ] },
  { id: 'seed-hbsag', code: 'HBSAG', name: 'Hepatitis B Surface Antigen (HBsAg)', department: 'Serology', sampleType: 'Serum', turnaround: '2-4 hours', price: 800, params: [
    opt('hbsag', 'HBsAg', 'Reactive, Non-reactive'),
  ] },
  { id: 'seed-hcv', code: 'HCV', name: 'Hepatitis C Antibody (Anti-HCV)', department: 'Serology', sampleType: 'Serum', turnaround: '2-4 hours', price: 800, params: [
    opt('hcv', 'Anti-HCV', 'Reactive, Non-reactive'),
  ] },
  { id: 'seed-dengue', code: 'DENGUE', name: 'Dengue NS1 Antigen', department: 'Serology', sampleType: 'Serum / Whole blood', turnaround: '1-2 hours', price: 1000, params: [
    opt('ns1', 'Dengue NS1 Antigen', 'Positive, Negative'),
  ] },
  { id: 'seed-malaria', code: 'MP', name: 'Malaria Parasite (Rapid / Smear)', department: 'Serology', sampleType: 'EDTA / Blood smear', turnaround: '1 hour', price: 500, params: [
    opt('mp', 'Malaria Parasite', 'Negative, P. vivax, P. falciparum, Mixed'),
  ] },
  { id: 'seed-widal', code: 'WIDAL', name: 'Widal Test (Typhoid)', department: 'Serology', sampleType: 'Serum', turnaround: '2-4 hours', price: 500, params: [
    txt('to', 'S. Typhi O', 'titre'),
    txt('th', 'S. Typhi H', 'titre'),
  ] },
  { id: 'seed-urine', code: 'URINE', name: 'Urine Routine & Microscopy', department: 'Urine Analysis', sampleType: 'Urine (random)', turnaround: '1-2 hours', price: 300, params: [
    txt('color', 'Colour'),
    num('ph', 'pH', '', [r(4.5, 8.0)]),
    num('sg', 'Specific Gravity', '', [r(1.005, 1.030)]),
    opt('prot', 'Protein', 'Nil, Trace, 1+, 2+, 3+'),
    opt('gluc', 'Glucose', 'Nil, Trace, 1+, 2+, 3+'),
    num('pus', 'Pus Cells', '/HPF', [r(0, 5)]),
    num('rbcu', 'RBCs', '/HPF', [r(0, 2)]),
  ] },
];

export const SEED_GROUPS = [
  { id: 'seed-g-basic', code: 'BHC', name: 'Basic Health Checkup', price: 2800, testIds: ['seed-cbc', 'seed-fbs', 'seed-lipid', 'seed-urine', 'seed-rft'] },
  { id: 'seed-g-diabetic', code: 'DIAB', name: 'Diabetic Profile', price: 4800, testIds: ['seed-fbs', 'seed-hba1c', 'seed-lipid', 'seed-rft', 'seed-urine'] },
  { id: 'seed-g-liver', code: 'LIVER', name: 'Liver Panel', price: 1800, testIds: ['seed-lft'] },
  { id: 'seed-g-fever', code: 'FEVER', name: 'Fever Panel', price: 2000, testIds: ['seed-cbc', 'seed-dengue', 'seed-malaria', 'seed-widal', 'seed-crp'] },
  { id: 'seed-g-prenatal', code: 'PRE', name: 'Pre-Marriage / Pre-Natal Screen', price: 2400, testIds: ['seed-bg', 'seed-cbc', 'seed-hbsag', 'seed-hcv', 'seed-urine'] },
];

// Basic needs of a lab: consumables, reagents and office supplies. Unit cost is entered by the lab.
// [category, name, unit, reorder level]
export const SEED_SUPPLIES = [
  ['Blood collection', 'EDTA vacutainer tubes (lavender)', 'pcs', 100],
  ['Blood collection', 'Plain vacutainer tubes (red top)', 'pcs', 100],
  ['Blood collection', 'Fluoride tubes (grey top)', 'pcs', 100],
  ['Blood collection', 'Serum separator tubes (gold / SST)', 'pcs', 100],
  ['Blood collection', 'Sodium citrate tubes (blue top)', 'pcs', 50],
  ['Blood collection', 'Disposable syringes 3 ml', 'pcs', 200],
  ['Blood collection', 'Disposable syringes 5 ml', 'pcs', 200],
  ['Blood collection', 'Butterfly needles (21G / 23G)', 'pcs', 100],
  ['Blood collection', 'Lancets (finger prick)', 'pcs', 100],
  ['Blood collection', 'Tourniquets', 'pcs', 50],
  ['Blood collection', 'Pipette tips (1000 µl)', 'pcs', 500],
  ['Hygiene & safety', 'Nitrile examination gloves (box of 100)', 'box', 5],
  ['Hygiene & safety', 'Alcohol swabs', 'pcs', 200],
  ['Hygiene & safety', 'Cotton rolls', 'roll', 10],
  ['Hygiene & safety', 'Adhesive plaster / bandage', 'pcs', 100],
  ['Hygiene & safety', 'Sharps container (safety box)', 'pcs', 5],
  ['Hygiene & safety', 'Biohazard waste bags', 'pcs', 100],
  ['Hygiene & safety', 'Hand sanitizer', 'bottle', 4],
  ['Hygiene & safety', 'Surface disinfectant', 'bottle', 4],
  ['Labels & containers', 'Sample labels / stickers', 'roll', 5],
  ['Labels & containers', 'Urine containers', 'pcs', 100],
  ['Labels & containers', 'Stool containers', 'pcs', 100],
  ['Labels & containers', 'Glass microscope slides', 'box', 5],
  ['Labels & containers', 'Cover slips', 'box', 5],
  ['Reagents & kits', 'Glucose (GOD-POD) reagent', 'kit', 2],
  ['Reagents & kits', 'Lipid profile reagent kit', 'kit', 1],
  ['Reagents & kits', 'LFT reagent kit', 'kit', 1],
  ['Reagents & kits', 'Creatinine & urea reagent kit', 'kit', 1],
  ['Reagents & kits', 'Urine strips (10-parameter)', 'pcs', 100],
  ['Reagents & kits', 'Dengue NS1 rapid test kit', 'test', 20],
  ['Reagents & kits', 'Malaria rapid test kit', 'test', 20],
  ['Reagents & kits', 'HBsAg rapid test kit', 'test', 20],
  ['Reagents & kits', 'HCV rapid test kit', 'test', 20],
  ['Reagents & kits', 'Widal antigen set', 'kit', 1],
  ['Reagents & kits', 'Blood grouping antisera (Anti-A, Anti-B, Anti-D)', 'set', 2],
  ['Reagents & kits', 'Hematology diluent / lyse (CBC analyzer)', 'litre', 10],
  ['Office & printing', 'A4 printer paper (ream)', 'ream', 5],
  ['Office & printing', 'Thermal receipt rolls', 'roll', 20],
  ['Office & printing', 'Printer ink / toner', 'pcs', 2],
  ['Office & printing', 'Register books', 'pcs', 5],
  ['Office & printing', 'Ballpoint pens', 'pcs', 30],
];

// Adds seed tests, groups and supplies whose seed ids are missing. Existing records are never overwritten.
export async function seedCatalog() {
  const now = new Date().toISOString();
  const tests = SEED_TESTS.map((t) => normalizeTest(t));
  const groups = SEED_GROUPS.map((g) => normalizeGroup(g));
  const supplies = SEED_SUPPLIES.map(([category, name, unit, reorderLevel], i) => ({
    id: `seed-s-${i + 1}`, name, nameLc: name.toLowerCase(), category, unit, quantity: 0, reorderLevel, unitCost: 0, active: true, updatedAt: now,
  }));
  let added = 0;
  await write(['tests', 'groups', 'supplies'], async (t) => {
    for (const rec of tests) if (!(await t.get('tests', rec.id))) { await t.put('tests', rec); added++; }
    for (const rec of groups) if (!(await t.get('groups', rec.id))) { await t.put('groups', rec); added++; }
    for (const rec of supplies) if (!(await t.get('supplies', rec.id))) { await t.put('supplies', rec); added++; }
  });
  return added;
}
