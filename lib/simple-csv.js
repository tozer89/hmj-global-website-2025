'use strict';

function parseCsv(text) {
  const source = String(text == null ? '' : text);
  const rows = [];
  let current = '';
  let row = [];
  let insideQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '"') {
      if (insideQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === ',' && !insideQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !insideQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(current);
      current = '';
      const hasContent = row.some((entry) => String(entry || '').trim());
      if (hasContent) rows.push(row);
      row = [];
      continue;
    }

    current += char;
  }

  if (insideQuotes) {
    throw new Error('CSV parsing failed because a quoted field was not closed.');
  }

  row.push(current);
  if (row.some((entry) => String(entry || '').trim())) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map((value) => String(value || '').trim());
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    throw new Error(`CSV contains duplicate header(s): ${Array.from(new Set(duplicateHeaders)).join(', ')}`);
  }

  return rows
    .filter((values) => values.some((value) => String(value || '').trim()))
    .map((values) => {
      if (values.length > headers.length) {
        throw new Error('CSV row contains more fields than the header row.');
      }
      const output = {};
      headers.forEach((header, index) => {
        if (!header) return;
        output[header] = String(values[index] == null ? '' : values[index]).trim();
      });
      return output;
    });
}

function csvCell(value) {
  const text = Array.isArray(value)
    ? value.join(' | ')
    : String(value == null ? '' : value);
  if (!/[,"\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function stringifyCsv(rows, columns = null) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const headers = Array.isArray(columns) && columns.length
    ? columns
    : Array.from(safeRows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set()));

  const lines = [
    headers.join(','),
    ...safeRows.map((row) => headers.map((header) => csvCell(row?.[header])).join(',')),
  ];

  return `${lines.join('\n')}\n`;
}

module.exports = {
  parseCsv,
  stringifyCsv,
};
