const {
  MARKETING_COLUMNS,
  normalizeMarketingRow,
} = require('./marketing');

function createMarketingStore(db) {
  const upsert = db.prepare(`
    INSERT INTO marketing_rows (${MARKETING_COLUMNS.join(', ')})
    VALUES (${MARKETING_COLUMNS.map((column) => `@${column}`).join(', ')})
    ON CONFLICT(rowId) DO UPDATE SET
      ${MARKETING_COLUMNS.filter((column) => column !== 'rowId')
        .map((column) => `${column} = excluded.${column}`).join(', ')}
  `);
  const selectAll = db.prepare(
    'SELECT * FROM marketing_rows ORDER BY dateStr DESC, unit, promoCode'
  );
  const deleteAll = db.prepare('DELETE FROM marketing_rows');

  function prepareRows(items) {
    const prepared = [];
    for (const raw of items) {
      if (!raw) continue;
      const normalized = normalizeMarketingRow(raw);
      if (!normalized.dateStr) continue;
      prepared.push(normalized);
    }
    return prepared;
  }

  function writeRows(items) {
    for (const item of items) upsert.run(item);
  }

  const insertRows = db.transaction((items) => {
    writeRows(prepareRows(items));
    return selectAll.all();
  });

  const replaceRows = db.transaction((items) => {
    const prepared = prepareRows(items);
    if (!prepared.length) throw new Error('Новый набор данных пуст');
    deleteAll.run();
    writeRows(prepared);
    return selectAll.all();
  });

  return {
    allRows: () => selectAll.all(),
    clearRows: () => deleteAll.run(),
    insertRows,
    replaceRows,
  };
}

module.exports = { createMarketingStore };
