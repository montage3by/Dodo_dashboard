const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const {
  parseMarketingCsv,
} = require('./lib/marketing');
const { createMarketingStore } = require('./lib/marketing-store');

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

const marketingStore = createMarketingStore(db);

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

db.exec(`
  CREATE TABLE IF NOT EXISTS google_ads_rows (
    id TEXT PRIMARY KEY,
    month TEXT,
    channel TEXT,
    campaign TEXT,
    adset TEXT,
    spend REAL,
    spendGel REAL,
    impressions REAL,
    clicks REAL,
    ctr REAL,
    orders REAL,
    revenueGel REAL,
    roas REAL,
    newClients REAL,
    cac REAL
  )
`);

const GOOGLE_ADS_COLUMNS = [
  'id', 'month', 'channel', 'campaign', 'adset',
  'spend', 'spendGel', 'impressions', 'clicks', 'ctr',
  'orders', 'revenueGel', 'roas', 'newClients', 'cac',
];

const googleAdsUpsertStmt = db.prepare(`
  INSERT INTO google_ads_rows (${GOOGLE_ADS_COLUMNS.join(', ')})
  VALUES (${GOOGLE_ADS_COLUMNS.map((c) => `@${c}`).join(', ')})
  ON CONFLICT(id) DO UPDATE SET
    ${GOOGLE_ADS_COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}
`);

const googleAdsSelectAllStmt = db.prepare('SELECT * FROM google_ads_rows ORDER BY month DESC');
const googleAdsDeleteAllStmt = db.prepare('DELETE FROM google_ads_rows');

function normalizeGoogleAdsRow(row) {
  const normalized = {};
  for (const col of GOOGLE_ADS_COLUMNS) {
    if (col === 'id' || col === 'month' || col === 'channel' || col === 'campaign' || col === 'adset') {
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

app.get('/api/google-ads', (req, res) => {
  const rows = googleAdsSelectAllStmt.all();
  res.json({ rows });
});

app.post('/api/google-ads', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

  const insertMany = db.transaction((items) => {
    for (const raw of items) {
      if (!raw || !raw.id) continue;
      googleAdsUpsertStmt.run(normalizeGoogleAdsRow(raw));
    }
  });

  insertMany(rows);

  res.json({ ok: true, count: rows.length, rows: googleAdsSelectAllStmt.all() });
});

app.delete('/api/google-ads', (req, res) => {
  googleAdsDeleteAllStmt.run();
  res.json({ ok: true });
});

app.get('/api/marketing', (req, res) => {
  res.json({ rows: marketingStore.allRows() });
});

app.post('/api/marketing', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const storedRows = marketingStore.insertRows(rows);
  res.json({ ok: true, count: rows.length, rows: storedRows });
});

app.put('/api/marketing', (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) {
    return res.status(400).json({ ok: false, error: 'Новый набор данных пуст' });
  }
  try {
    const storedRows = marketingStore.replaceRows(rows);
    return res.json({ ok: true, count: rows.length, rows: storedRows });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/marketing/import', (req, res) => {
  try {
    const rows = parseMarketingCsv(req.body);
    const storedRows = marketingStore.insertRows(rows);
    res.json({ ok: true, count: rows.length, rows: storedRows });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete('/api/marketing', (req, res) => {
  marketingStore.clearRows();
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dodo dashboard listening on port ${PORT}`);
});
