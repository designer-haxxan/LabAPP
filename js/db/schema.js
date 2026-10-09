// IndexedDB schema definition and migrations.
import { CONFIG } from '../config.js';

// A new database name: the earlier POS database (disterp_pos) is left untouched on every device.
export const DB_NAME = `${CONFIG.APP_ID}_lab`;
export const DB_VERSION = 1;

// Stores that make up the business data (included in backups).
export const DATA_STORES = [
  'patients', 'doctors', 'tests', 'groups', 'bills', 'payments', 'reports',
  'expenses', 'supplies', 'supplyMoves', 'auditLog', 'meta',
];

const STORES = {
  meta: { keyPath: 'key', indexes: {} },
  patients: { indexes: { nameLc: 'nameLc', phone: 'phone', mrNo: ['mrNo', true] } },
  doctors: { indexes: { nameLc: 'nameLc' } },
  tests: { indexes: { nameLc: 'nameLc', department: 'department', code: 'code' } },
  groups: { indexes: { nameLc: 'nameLc' } },
  bills: { indexes: { number: ['number', true], date: 'date', patientId: 'patientId', doctorId: 'doctorId', status: 'status' } },
  payments: { indexes: { billId: 'billId', date: 'date' } },
  reports: { indexes: { billId: 'billId', status: 'status', date: 'date', patientId: 'patientId', testId: 'testId' } },
  expenses: { indexes: { date: 'date', category: 'category' } },
  supplies: { indexes: { nameLc: 'nameLc', category: 'category' } },
  supplyMoves: { indexes: { supplyId: 'supplyId', date: 'date' } },
  auditLog: { indexes: { at: 'at' } },
};

export function upgrade(db, oldVersion, t) {
  if (oldVersion < 1) {
    for (const [name, def] of Object.entries(STORES)) {
      const os = db.createObjectStore(name, { keyPath: def.keyPath || 'id' });
      for (const [idx, spec] of Object.entries(def.indexes)) {
        const [keyPath, unique] = Array.isArray(spec) ? spec : [spec, false];
        os.createIndex(idx, keyPath, { unique: !!unique });
      }
    }
    t.objectStore('meta').put({ key: 'schemaVersion', value: 1 });
    t.objectStore('meta').put({ key: 'createdAt', value: new Date().toISOString() });
  }
  // Future migrations: if (oldVersion < 2) { ... }
}
