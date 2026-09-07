const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { createMarketingStore } = require('../lib/marketing-store');

function createStore() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE marketing_rows (
      rowId TEXT PRIMARY KEY,
      dateStr TEXT,
      unit TEXT,
      newClients REAL,
      promoCode TEXT,
      promoUses REAL,
      promoCustomers REAL,
      promoNewClients REAL,
      orders REAL,
      revenue REAL,
      discount REAL
    )
  `);
  return { db, store: createMarketingStore(db) };
}

test('replaces the complete marketing dataset instead of merging it', () => {
  const { db, store } = createStore();
  store.insertRows([
    { dateStr: '2026-08-18', unit: 'Demo', promoCode: 'WELCOME20', promoUses: 18 },
  ]);

  const rows = store.replaceRows([
    { dateStr: '2026-08-19', unit: 'Tbilisi-1', promoCode: 'DODO25', promoUses: 4 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].promoCode, 'DODO25');
  assert.equal(store.allRows().some((row) => row.promoCode === 'WELCOME20'), false);
  db.close();
});

test('keeps the previous dataset when replacement contains no valid rows', () => {
  const { db, store } = createStore();
  store.insertRows([
    { dateStr: '2026-08-18', unit: 'Existing', promoCode: 'DODO25', promoUses: 2 },
  ]);

  assert.throws(() => store.replaceRows([null, { dateStr: '' }]), /пуст/);
  assert.equal(store.allRows().length, 1);
  assert.equal(store.allRows()[0].unit, 'Existing');
  db.close();
});
