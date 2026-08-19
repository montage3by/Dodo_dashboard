const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMarketingRow, parseMarketingCsv } = require('../lib/marketing');

test('parses Russian semicolon CSV and normalizes dates and numbers', () => {
  const rows = parseMarketingCsv([
    'Дата;Пиццерия;Новые клиенты;Промокод;Срабатывания;Уникальные клиенты;Новые клиенты по промокоду;Заказы;Выручка;Скидка',
    '18.08.2026;Сабуртало;42;WELCOME20;18;17;9;18;540,50;108,10',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].dateStr, '2026-08-18');
  assert.equal(rows[0].unit, 'Сабуртало');
  assert.equal(rows[0].newClients, 42);
  assert.equal(rows[0].promoCode, 'WELCOME20');
  assert.equal(rows[0].revenue, 540.5);
  assert.equal(rows[0].discount, 108.1);
  assert.match(rows[0].rowId, /^[a-f0-9]{32}$/);
});

test('aggregates duplicate date, unit and promo rows', () => {
  const rows = parseMarketingCsv([
    'date,unit,promocode,promouses,revenue',
    '2026-08-18,Unit 1,SUMMER,2,50',
    '2026-08-18,Unit 1,SUMMER,3,75',
  ].join('\n'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].promoUses, 5);
  assert.equal(rows[0].revenue, 125);
});

test('generates the same row id for the same business key', () => {
  const first = normalizeMarketingRow({ dateStr: '2026-08-18', unit: 'Unit 1', promoCode: 'WELCOME' });
  const second = normalizeMarketingRow({ dateStr: '2026-08-18', unit: 'Unit 1', promoCode: 'WELCOME' });
  assert.equal(first.rowId, second.rowId);
});

test('rejects CSV without a date column', () => {
  assert.throws(
    () => parseMarketingCsv('Пиццерия;Промокод\nСабуртало;WELCOME'),
    /Дата/
  );
});
