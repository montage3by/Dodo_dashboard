const fs = require('fs');
const path = require('path');

async function main() {
  const fileArg = process.argv[2];
  const dashboardUrl = String(process.env.DASHBOARD_URL || '').replace(/\/$/, '');
  const token = process.env.DASHBOARD_INGEST_TOKEN || '';

  if (!fileArg) {
    throw new Error('Укажите CSV-файл: node scripts/upload-marketing.js <file.csv>');
  }
  if (!dashboardUrl) {
    throw new Error('Не задан DASHBOARD_URL');
  }
  if (!token) {
    throw new Error('Не задан DASHBOARD_INGEST_TOKEN');
  }

  const filePath = path.resolve(fileArg);
  const csv = fs.readFileSync(filePath, 'utf8');
  const response = await fetch(`${dashboardUrl}/api/marketing/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/csv; charset=utf-8',
    },
    body: csv,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Dashboard returned HTTP ${response.status}`);
  }
  console.log(`Загружено строк: ${payload.count || 0}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
