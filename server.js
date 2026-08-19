const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  MARKETING_COLUMNS,
  normalizeMarketingRow,
  parseMarketingCsv,
} = require('./lib/marketing');

const dataDir = process.env.DASHBOARD_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'db.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS mindbox_rows (
    mailingId TEXT PRIMARY KEY,
    name TEXT,
    subject TEXT,
    platform TEXT,
    type TEXT,
    campaign TEXT,
    dateStr TEXT,
    sent REAL,
    delivered REAL,
    deliveryRate REAL,
    clicked REAL,
    clickRate REAL,
    conversions REAL,
    conversionRate REAL,
    revenue REAL,
    avgOrder REAL
  );

  CREATE TABLE IF NOT EXISTS marketing_rows (
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
  );
`);

const COLUMNS = [
  'mailingId', 'name', 'subject', 'platform', 'type', 'campaign', 'dateStr',
  'sent', 'delivered', 'deliveryRate', 'clicked', 'clickRate',
  'conversions', 'conversionRate', 'revenue', 'avgOrder',
];

const upsertStmt = db.prepare(`
  INSERT INTO mindbox_rows (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(mailingId) DO UPDATE SET
    ${COLUMNS.filter((c) => c !== 'mailingId').map((c) => `${c} = excluded.${c}`).join(', ')}
`);

const selectAllStmt = db.prepare('SELECT * FROM mindbox_rows ORDER BY dateStr DESC');
const deleteAllStmt = db.prepare('DELETE FROM mindbox_rows');

const upsertMarketingStmt = db.prepare(`
  INSERT INTO marketing_rows (${MARKETING_COLUMNS.join(', ')})
  VALUES (${MARKETING_COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(rowId) DO UPDATE SET
    ${MARKETING_COLUMNS.filter((c) => c !== 'rowId').map((c) => `${c} = excluded.${c}`).join(', ')}
`);

const selectAllMarketingStmt = db.prepare(
  'SELECT * FROM marketing_rows ORDER BY dateStr DESC, unit, promoCode'
);
const deleteAllMarketingStmt = db.prepare('DELETE FROM marketing_rows');

function normalizeRow(row) {
  const normalized = {};
  for (const col of COLUMNS) {
    if (col === 'mailingId' || col === 'name' || col === 'subject' || col === 'platform' || col === 'type' || col === 'campaign' || col === 'dateStr') {
      normalized[col] = row[col] != null ? String(row[col]) : '';
    } else {
      const num = Number(row[col]);
      normalized[col] = Number.isFinite(num) ? num : 0;
    }
  }
  return normalized;
}

const AUTH_USER = process.env.DASHBOARD_USER || 'admin';
const AUTH_PASSWORD = process.env.DASHBOARD_PASSWORD || 'dodo2026';
const INGEST_TOKEN = process.env.DASHBOARD_INGEST_TOKEN || '';

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  const isImportRequest = req.method === 'POST' && req.path === '/api/marketing/import';
  if (isImportRequest && scheme === 'Bearer' && INGEST_TOKEN && encoded && safeEqual(encoded, INGEST_TOKEN)) {
    return next();
  }

  if (scheme === 'Basic' && encoded) {
    const [user, password] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user && password && safeEqual(user, AUTH_USER) && safeEqual(password, AUTH_PASSWORD)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Dodo Dashboard"');
  res.status(401).send('Authentication required');
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/mindbox', (req, res) => {
  const rows = selectAllStmt.all();
  res.json({ rows });
});

app.post('/api/mindbox', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

  const insertMany = db.transaction((items) => {
    for (const raw of items) {
      if (!raw || !raw.mailingId) continue;
      upsertStmt.run(normalizeRow(raw));
    }
  });

  insertMany(rows);

  res.json({ ok: true, count: rows.length, rows: selectAllStmt.all() });
});

app.delete('/api/mindbox', (req, res) => {
  deleteAllStmt.run();
  res.json({ ok: true });
});

app.get('/api/marketing', (req, res) => {
  res.json({ rows: selectAllMarketingStmt.all() });
});

const insertMarketingRows = db.transaction((items) => {
  for (const raw of items) {
    if (!raw) continue;
    const normalized = normalizeMarketingRow(raw);
    if (!normalized.dateStr) continue;
    upsertMarketingStmt.run(normalized);
  }
});

app.post('/api/marketing', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

  insertMarketingRows(rows);

  res.json({ ok: true, count: rows.length, rows: selectAllMarketingStmt.all() });
});

app.post('/api/marketing/import', (req, res) => {
  try {
    const rows = parseMarketingCsv(req.body);
    insertMarketingRows(rows);
    res.json({ ok: true, count: rows.length, rows: selectAllMarketingStmt.all() });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete('/api/marketing', (req, res) => {
  deleteAllMarketingStmt.run();
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dodo dashboard listening on port ${PORT}`);
});
