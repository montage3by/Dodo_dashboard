const crypto = require('crypto');

const MARKETING_COLUMNS = [
  'rowId', 'dateStr', 'unit', 'newClients', 'promoCode', 'promoUses',
  'promoCustomers', 'promoNewClients', 'orders', 'revenue', 'discount',
];

const STRING_FIELDS = new Set(['rowId', 'dateStr', 'unit', 'promoCode']);
const NUMBER_FIELDS = MARKETING_COLUMNS.filter((field) => !STRING_FIELDS.has(field));

const HEADER_ALIASES = {
  'id': 'rowId',
  'rowid': 'rowId',
  'дата': 'dateStr',
  'date': 'dateStr',
  'datestr': 'dateStr',
  'пиццерия': 'unit',
  'заведение': 'unit',
  'ресторан': 'unit',
  'unit': 'unit',
  'restaurant': 'unit',
  'новыеклиенты': 'newClients',
  'newclients': 'newClients',
  'промокод': 'promoCode',
  'promo': 'promoCode',
  'promocode': 'promoCode',
  'срабатывания': 'promoUses',
  'применения': 'promoUses',
  'использования': 'promoUses',
  'promouses': 'promoUses',
  'uses': 'promoUses',
  'уникальныеклиенты': 'promoCustomers',
  'клиентыспромокодом': 'promoCustomers',
  'promocustomers': 'promoCustomers',
  'uniquecustomers': 'promoCustomers',
  'новыеклиентыпопромокоду': 'promoNewClients',
  'новыепопромокоду': 'promoNewClients',
  'promonewclients': 'promoNewClients',
  'заказы': 'orders',
  'orders': 'orders',
  'выручка': 'revenue',
  'revenue': 'revenue',
  'скидка': 'discount',
  'суммаскидки': 'discount',
  'discount': 'discount',
};

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/["']/g, '');
}

function parseNumber(value) {
  if (value == null || value === '') return 0;
  const cleaned = String(value)
    .replace(/[\s\u00A0]/g, '')
    .replace(/[₾%]/g, '')
    .replace(',', '.');
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function normalizeDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return raw;
}

function detectDelimiter(line) {
  const commas = (line.match(/,/g) || []).length;
  const semicolons = (line.match(/;/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

function parseCsvLine(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuotes) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  cells.push(current.trim());
  return cells;
}

function buildRowId(row) {
  const identity = [row.dateStr, row.unit, row.promoCode || '__all__'].join('|').toLowerCase();
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 32);
}

function normalizeMarketingRow(row) {
  const normalized = {};
  for (const column of MARKETING_COLUMNS) {
    if (STRING_FIELDS.has(column)) {
      normalized[column] = row[column] != null ? String(row[column]).trim() : '';
    } else {
      normalized[column] = parseNumber(row[column]);
    }
  }
  normalized.dateStr = normalizeDate(normalized.dateStr);
  if (!normalized.rowId) normalized.rowId = buildRowId(normalized);
  return normalized;
}

function parseMarketingCsv(text) {
  const lines = String(text || '').split(/\r\n|\n|\r/).filter((line) => line.trim());
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const fields = parseCsvLine(lines[0], delimiter).map(
    (header) => HEADER_ALIASES[normalizeHeader(header)] || null
  );
  if (!fields.includes('dateStr')) {
    throw new Error('В CSV нет обязательного столбца «Дата»');
  }

  const aggregated = new Map();
  for (let index = 1; index < lines.length; index += 1) {
    const cells = parseCsvLine(lines[index], delimiter);
    const raw = {};
    fields.forEach((field, cellIndex) => {
      if (field) raw[field] = cells[cellIndex];
    });

    const row = normalizeMarketingRow(raw);
    if (!row.dateStr) continue;
    if (!aggregated.has(row.rowId)) {
      aggregated.set(row.rowId, row);
      continue;
    }
    const current = aggregated.get(row.rowId);
    NUMBER_FIELDS.forEach((field) => {
      current[field] += row[field];
    });
  }

  return [...aggregated.values()];
}

module.exports = {
  MARKETING_COLUMNS,
  normalizeMarketingRow,
  parseMarketingCsv,
};
