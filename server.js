const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
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
  )
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

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dodo dashboard listening on port ${PORT}`);
});
