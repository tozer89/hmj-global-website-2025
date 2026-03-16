(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HMJCreditLimitStatementImport = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HEADER_ALIASES = {
    invoiceRef: [
      'invoice ref', 'invoice reference', 'invoice no', 'invoice number', 'invoice #', 'reference', 'ref',
      'document number', 'document no', 'transaction reference', 'inv ref', 'inv no', 'inv number'
    ],
    invoiceDate: [
      'invoice date', 'document date', 'doc date', 'transaction date', 'txn date', 'date invoiced', 'raised date'
    ],
    dueDate: [
      'due date', 'due', 'payable date', 'payment due date', 'date due'
    ],
    outstandingAmount: [
      'outstanding', 'open balance', 'balance', 'amount due', 'amount outstanding', 'outstanding amount',
      'open amount', 'unpaid amount', 'due amount', 'current balance', 'remaining balance'
    ],
    grossAmount: [
      'gross amount', 'gross', 'invoice total', 'total amount', 'document total'
    ],
    netAmount: [
      'net amount', 'net', 'net total', 'tax exclusive'
    ],
    vatAmount: [
      'vat', 'vat amount', 'tax amount', 'tax'
    ],
    currency: [
      'currency', 'ccy', 'curr'
    ],
    clientName: [
      'client', 'account', 'account name', 'customer', 'customer name', 'debtor', 'client name'
    ],
    status: [
      'status', 'state', 'invoice status'
    ],
    daysOverdue: [
      'days overdue', 'overdue days', 'days late'
    ],
    ageingBucket: [
      'ageing', 'aging', 'age bucket', 'ageing bucket', 'aging bucket'
    ],
    creditNoteFlag: [
      'credit note', 'credit', 'credit flag', 'is credit note'
    ],
    paymentReference: [
      'payment reference', 'payment ref', 'remittance ref'
    ],
    statementDate: [
      'statement date', 'as at', 'as of', 'report date'
    ],
  };

  const REQUIRED_FIELDS = ['outstandingAmount'];
  const IMPORTANT_FIELDS = ['invoiceRef', 'invoiceDate', 'dueDate', 'outstandingAmount', 'currency'];
  const CURRENCY_CODES = ['GBP', 'EUR'];
  const DATE_OUTPUT_RE = /^\d{4}-\d{2}-\d{2}$/;
  const PDF_DATE_RE = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
  const PDF_DECIMAL_AMOUNT_RE = /(?:GBP|EUR|£|€)?\s*-?\(?(?:(?:\d{1,3}(?:,\d{3})+)|\d{4,}|\d+)(?:\.\d{2})?\)?/g;
  const PDF_STRICT_STATEMENT_AMOUNT_RE = /(?:GBP|EUR|£|€)?\s*-?\(?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)\.\d{2}\)?/g;

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function trimString(value) {
    return typeof value === 'string' ? value.trim() : String(value == null ? '' : value).trim();
  }

  function roundMoney(value) {
    const number = Number(value) || 0;
    return Math.round(number * 100) / 100;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function pad(number) {
    return String(number).padStart(2, '0');
  }

  function formatDate(date) {
    const safe = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(safe.getTime())) return '';
    return [
      safe.getUTCFullYear(),
      pad(safe.getUTCMonth() + 1),
      pad(safe.getUTCDate()),
    ].join('-');
  }

  function parseIsoDate(value) {
    const text = trimString(value);
    if (!DATE_OUTPUT_RE.test(text)) return null;
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(5, 7));
    const day = Number(text.slice(8, 10));
    return new Date(Date.UTC(year, month - 1, day));
  }

  function addDays(value, days) {
    const date = value instanceof Date ? value : parseIsoDate(value);
    if (!date) return null;
    return new Date(date.getTime() + (Number(days) || 0) * 24 * 60 * 60 * 1000);
  }

  function endOfMonth(date) {
    const safe = date instanceof Date ? date : parseIsoDate(date);
    if (!safe) return null;
    return new Date(Date.UTC(safe.getUTCFullYear(), safe.getUTCMonth() + 1, 0));
  }

  function normaliseWhitespace(value) {
    return String(value || '')
      .replace(/\u0000/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\r/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function stripBom(text) {
    return String(text || '').replace(/^\uFEFF/, '');
  }

  function detectSourceType(fileName, contentType, buffer) {
    const name = trimString(fileName).toLowerCase();
    const mime = trimString(contentType).toLowerCase();
    if (name.endsWith('.csv') || mime === 'text/csv' || mime === 'application/csv') return 'csv';
    if (name.endsWith('.xlsx') || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
    if (name.endsWith('.pdf') || mime.indexOf('pdf') >= 0) return 'pdf';
    if (buffer && buffer.length >= 5) {
      const head = buffer.slice(0, 5).toString('utf8');
      if (head === '%PDF-') return 'pdf';
    }
    return '';
  }

  function normaliseHeader(value) {
    return trimString(value)
      .toLowerCase()
      .replace(/[_\-]+/g, ' ')
      .replace(/[^\w\s#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function labelCase(value) {
    const text = trimString(value);
    if (!text) return '';
    return text
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fieldOptions() {
    return [
      { key: 'invoiceRef', label: 'Invoice ref' },
      { key: 'invoiceDate', label: 'Invoice date' },
      { key: 'dueDate', label: 'Due date' },
      { key: 'outstandingAmount', label: 'Outstanding amount' },
      { key: 'currency', label: 'Currency' },
      { key: 'status', label: 'Status' },
      { key: 'daysOverdue', label: 'Days overdue' },
      { key: 'grossAmount', label: 'Gross amount' },
      { key: 'netAmount', label: 'Net amount' },
      { key: 'vatAmount', label: 'VAT amount' },
      { key: 'clientName', label: 'Client name' },
      { key: 'creditNoteFlag', label: 'Credit note flag' },
      { key: 'paymentReference', label: 'Payment reference' },
      { key: 'statementDate', label: 'Statement date' },
      { key: 'ageingBucket', label: 'Ageing bucket' },
    ];
  }

  function excelSerialToIso(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 1) return '';
    const utcDays = Math.floor(number - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())));
  }

  function parseFlexibleDate(value, options) {
    const settings = options && typeof options === 'object' ? options : {};
    if (value == null || value === '') return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return formatDate(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())));
    }

    const text = trimString(value);
    if (!text) return '';
    if (DATE_OUTPUT_RE.test(text)) return text;

    if (/^\d{5,6}(?:\.\d+)?$/.test(text)) {
      return excelSerialToIso(text);
    }

    const slash = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
    if (slash) {
      let day = Number(slash[1]);
      let month = Number(slash[2]);
      let year = Number(slash[3]);
      if (year < 100) year += year >= 70 ? 1900 : 2000;
      if (day <= 12 && month <= 12 && settings.dayFirst === false) {
        const tmp = day;
        day = month;
        month = tmp;
      }
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        return formatDate(new Date(Date.UTC(year, month - 1, day)));
      }
    }

    const wordMonth = text.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
    if (wordMonth) {
      const months = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11,
      };
      const monthIndex = months[wordMonth[2].toLowerCase()];
      if (monthIndex != null) {
        let year = Number(wordMonth[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
        return formatDate(new Date(Date.UTC(year, monthIndex, Number(wordMonth[1]))));
      }
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDate(new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())));
    }
    return '';
  }

  function deriveDueDate(invoiceDate, paymentTerms) {
    const date = parseIsoDate(invoiceDate);
    if (!date) return '';
    const terms = paymentTerms && typeof paymentTerms === 'object' ? paymentTerms : {};
    const type = trimString(terms.type) || '30_eom';
    if (type === '30_from_invoice') return formatDate(addDays(date, 30));
    if (type === '14_net') return formatDate(addDays(date, 14));
    if (type === 'custom_net') return formatDate(addDays(date, clampNumber(terms.customNetDays, 0, 180, 21)));
    return formatDate(addDays(endOfMonth(date), 30));
  }

  function detectCurrencyFromText(value, fallback) {
    const text = trimString(value).toUpperCase();
    if (!text) return trimString(fallback).toUpperCase() || '';
    if (text.indexOf('GBP') >= 0 || text.indexOf('£') >= 0) return 'GBP';
    if (text.indexOf('EUR') >= 0 || text.indexOf('€') >= 0) return 'EUR';
    return trimString(fallback).toUpperCase() || '';
  }

  function parseAmount(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return roundMoney(value);
    const text = trimString(value);
    if (!text) return 0;
    const negative = /\(.*\)/.test(text) || /^-/.test(text);
    const cleaned = text
      .replace(/[()]/g, '')
      .replace(/[A-Za-z£€$]/g, '')
      .replace(/\s+/g, '')
      .trim();
    if (!cleaned) return 0;

    let normalised = cleaned;
    const commaCount = (cleaned.match(/,/g) || []).length;
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (commaCount && dotCount) {
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        normalised = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        normalised = cleaned.replace(/,/g, '');
      }
    } else if (commaCount && !dotCount) {
      normalised = /,\d{2}$/.test(cleaned)
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    }

    const number = Number(normalised);
    if (!Number.isFinite(number)) return 0;
    return roundMoney(negative ? -Math.abs(number) : number);
  }

  function parseInteger(value) {
    const number = Number(String(value == null ? '' : value).replace(/[^\d\-]/g, ''));
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  function parseBooleanFlag(value) {
    const text = trimString(value).toLowerCase();
    if (!text) return false;
    return ['y', 'yes', 'true', '1', 'credit', 'credit note'].indexOf(text) >= 0;
  }

  function detectCsvDelimiter(text) {
    const sample = String(text || '').split(/\r?\n/).slice(0, 6);
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestScore = -1;
    candidates.forEach(function (delimiter) {
      const counts = sample.map(function (line) {
        let inQuotes = false;
        let count = 1;
        for (let index = 0; index < line.length; index += 1) {
          const char = line[index];
          if (char === '"') {
            if (inQuotes && line[index + 1] === '"') {
              index += 1;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === delimiter && !inQuotes) {
            count += 1;
          }
        }
        return count;
      }).filter(function (count) { return count > 1; });
      const score = counts.length ? counts.reduce(function (sum, count) { return sum + count; }, 0) : 0;
      if (score > bestScore) {
        best = delimiter;
        bestScore = score;
      }
    });
    return best;
  }

  function parseDelimitedText(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const input = String(text || '');

    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      if (char === '"') {
        if (inQuotes && input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === delimiter && !inQuotes) {
        row.push(cell);
        cell = '';
        continue;
      }
      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && input[index + 1] === '\n') index += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += char;
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows
      .map(function (items) {
        return items.map(function (item) { return stripBom(String(item || '')); });
      })
      .filter(function (items) {
        return items.some(function (item) { return trimString(item); });
      });
  }

  function columnLetterToIndex(ref) {
    const letters = String(ref || '').replace(/\d+/g, '').toUpperCase();
    if (!letters) return -1;
    let index = 0;
    for (let cursor = 0; cursor < letters.length; cursor += 1) {
      index = index * 26 + (letters.charCodeAt(cursor) - 64);
    }
    return index - 1;
  }

  function getNodeDeps() {
    try {
      return {
        JSZip: require('jszip'),
        DOMParser: require('@xmldom/xmldom').DOMParser,
      };
    } catch {
      return {};
    }
  }

  function xmlText(node) {
    if (!node) return '';
    if (typeof node.textContent === 'string') return node.textContent;
    const parts = [];
    const children = node.childNodes || [];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.nodeType === 3 || child.nodeType === 4) parts.push(child.nodeValue || '');
      else parts.push(xmlText(child));
    }
    return parts.join('');
  }

  async function parseXlsxBuffer(buffer, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const deps = getNodeDeps();
    if (!deps.JSZip || !deps.DOMParser) {
      throw new Error('XLSX parsing dependencies are unavailable.');
    }

    const zip = await deps.JSZip.loadAsync(buffer);
    const parser = new deps.DOMParser();

    async function readXml(path) {
      const file = zip.file(path);
      if (!file) return null;
      const text = await file.async('text');
      return parser.parseFromString(text, 'application/xml');
    }

    const sharedStringsDoc = await readXml('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsDoc
      ? Array.prototype.map.call(sharedStringsDoc.getElementsByTagName('si'), function (node) {
        return trimString(xmlText(node));
      })
      : [];

    const workbookDoc = await readXml('xl/workbook.xml');
    if (!workbookDoc) throw new Error('Workbook structure not found inside XLSX.');
    const relsDoc = await readXml('xl/_rels/workbook.xml.rels');
    const relMap = {};
    if (relsDoc) {
      Array.prototype.forEach.call(relsDoc.getElementsByTagName('Relationship'), function (node) {
        const id = trimString(node.getAttribute('Id'));
        const target = trimString(node.getAttribute('Target'));
        if (id && target) relMap[id] = target.replace(/^\//, '');
      });
    }
    const firstSheet = workbookDoc.getElementsByTagName('sheet')[0];
    if (!firstSheet) throw new Error('No worksheet was found inside the uploaded XLSX.');
    const relationId = trimString(firstSheet.getAttribute('r:id'));
    const sheetTarget = relMap[relationId] || 'worksheets/sheet1.xml';
    const sheetPath = sheetTarget.indexOf('xl/') === 0 ? sheetTarget : ('xl/' + sheetTarget.replace(/^\/+/, ''));
    const sheetDoc = await readXml(sheetPath);
    if (!sheetDoc) throw new Error('The first worksheet could not be read from the uploaded XLSX.');

    const matrix = [];
    Array.prototype.forEach.call(sheetDoc.getElementsByTagName('row'), function (rowNode) {
      const row = [];
      Array.prototype.forEach.call(rowNode.getElementsByTagName('c'), function (cellNode) {
        const ref = trimString(cellNode.getAttribute('r'));
        const columnIndex = columnLetterToIndex(ref);
        const type = trimString(cellNode.getAttribute('t'));
        let value = '';
        if (type === 'inlineStr') {
          value = xmlText(cellNode.getElementsByTagName('is')[0]);
        } else {
          value = xmlText(cellNode.getElementsByTagName('v')[0]);
          if (type === 's') {
            value = sharedStrings[Number(value) || 0] || '';
          } else if (type === 'b') {
            value = value === '1' ? 'TRUE' : 'FALSE';
          }
        }
        if (columnIndex < 0) {
          row.push(value);
        } else {
          while (row.length < columnIndex) row.push('');
          row[columnIndex] = value;
        }
      });
      while (row.length && !trimString(row[row.length - 1])) row.pop();
      if (row.some(function (cell) { return trimString(cell); })) {
        matrix.push(row);
      }
    });

    return createDraftFromMatrix(matrix, Object.assign({}, settings, {
      sourceType: 'xlsx',
    }));
  }

  function scoreHeaderRow(cells) {
    const labels = Array.isArray(cells) ? cells.map(normaliseHeader) : [];
    let score = 0;
    labels.forEach(function (header) {
      Object.keys(HEADER_ALIASES).forEach(function (field) {
        if (HEADER_ALIASES[field].indexOf(header) >= 0) score += field === 'outstandingAmount' ? 3 : 2;
      });
    });
    if (labels.length >= 3) score += 1;
    return score;
  }

  function inferMapping(headers) {
    const list = Array.isArray(headers) ? headers : [];
    const mapping = {};
    const used = new Set();
    Object.keys(HEADER_ALIASES).forEach(function (field) {
      let bestIndex = -1;
      let bestScore = 0;
      list.forEach(function (header, index) {
        const normalised = normaliseHeader(header);
        const aliases = HEADER_ALIASES[field];
        let score = 0;
        aliases.forEach(function (alias) {
          if (normalised === alias) score = Math.max(score, 100);
          else if (normalised.indexOf(alias) >= 0 || alias.indexOf(normalised) >= 0) score = Math.max(score, 60);
        });
        if (field === 'outstandingAmount' && /amount|balance|outstanding|due/.test(normalised)) score += 8;
        if (field === 'invoiceDate' && /invoice|document|doc|transaction|txn/.test(normalised) && /date/.test(normalised)) score += 6;
        if (field === 'dueDate' && /due|payable|payment/.test(normalised)) score += 8;
        if (field === 'invoiceRef' && /invoice|ref|document/.test(normalised)) score += 6;
        if (score > bestScore && !used.has(index)) {
          bestIndex = index;
          bestScore = score;
        }
      });
      if (bestIndex >= 0 && bestScore > 0) {
        mapping[field] = list[bestIndex];
        used.add(bestIndex);
      }
    });
    return mapping;
  }

  function createDraftFromMatrix(matrix, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const rows = Array.isArray(matrix) ? matrix : [];
    if (!rows.length) {
      return materialiseImportedStatement({
        status: 'draft',
        sourceType: settings.sourceType || '',
        fileName: settings.fileName || '',
        rawTable: { headers: [], rows: [], headerRowIndex: 0 },
        mapping: {},
        warnings: ['No readable rows were found in the uploaded file.'],
        parseMethod: settings.parseMethod || 'none',
        parseScore: 0,
      }, settings);
    }

    let headerRowIndex = 0;
    let bestScore = -1;
    const headerScanLimit = Math.min(rows.length, 8);
    for (let index = 0; index < headerScanLimit; index += 1) {
      const score = scoreHeaderRow(rows[index]);
      if (score > bestScore) {
        bestScore = score;
        headerRowIndex = index;
      }
    }

    const headers = (rows[headerRowIndex] || []).map(function (cell, index) {
      const label = labelCase(cell);
      return label || ('Column ' + (index + 1));
    });
    const bodyRows = rows.slice(headerRowIndex + 1)
      .map(function (cells, index) {
        const padded = headers.map(function (_, cellIndex) {
          return cells[cellIndex] == null ? '' : String(cells[cellIndex]);
        });
        return {
          rowNumber: headerRowIndex + index + 2,
          cells: padded,
        };
      })
      .filter(function (row) {
        return row.cells.some(function (cell) { return trimString(cell); });
      })
      .slice(0, 600);

    const warnings = [];
    if (rows.length - headerRowIndex - 1 > bodyRows.length) {
      warnings.push('Only the first 600 statement rows were loaded for review.');
    }
    const mapping = inferMapping(headers);
    return materialiseImportedStatement({
      status: 'draft',
      sourceType: settings.sourceType || '',
      fileName: settings.fileName || '',
      rawTable: {
        headers: headers,
        rows: bodyRows,
        headerRowIndex: headerRowIndex,
      },
      mapping: mapping,
      warnings: warnings.concat(Array.isArray(settings.warnings) ? settings.warnings : []),
      parseMethod: settings.parseMethod || 'table_headers',
      parseScore: bestScore,
      extraction: settings.extraction || null,
    }, settings);
  }

  function chooseRowValue(rawTable, row, mapping, fieldKey) {
    const headers = rawTable && Array.isArray(rawTable.headers) ? rawTable.headers : [];
    const header = mapping && typeof mapping === 'object' ? mapping[fieldKey] : '';
    if (!header) return '';
    const index = headers.indexOf(header);
    if (index < 0) return '';
    return row && Array.isArray(row.cells) ? row.cells[index] : '';
  }

  function buildRowWarningText(warnings) {
    return (Array.isArray(warnings) ? warnings : []).filter(Boolean).join(' • ');
  }

  function sanitiseReconciliationAdjustmentLines(lines, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const fallbackDate = parseFlexibleDate(settings.forecastStartDate || formatDate(new Date()), { dayFirst: true })
      || formatDate(new Date());
    const output = [];

    (Array.isArray(lines) ? lines : []).forEach(function (line, index) {
      const source = line && typeof line === 'object' ? line : {};
      const rawDate = parseFlexibleDate(source.date, { dayFirst: true });
      const warnings = [];
      if (!rawDate && Number(source.amount)) {
        warnings.push('Adjustment date missing, so the forecast start date has been used.');
      }
      const amount = roundMoney(source.amount);
      if (!amount && trimString(source.note)) {
        warnings.push('Adjustment amount is zero.');
      }
      const item = {
        id: trimString(source.id) || ('import-adjustment-' + index),
        include: source.include !== false,
        date: rawDate || fallbackDate,
        amount: amount,
        note: trimString(source.note),
        warnings: uniqueStrings(warnings),
      };
      item.warningText = buildRowWarningText(item.warnings);
      if (item.date || item.amount || item.note) {
        output.push(item);
      }
    });

    return output;
  }

  function summariseAdjustmentLines(lines) {
    const includedLines = (Array.isArray(lines) ? lines : []).filter(function (line) {
      return line && line.include !== false;
    });
    return {
      adjustmentLineCount: Array.isArray(lines) ? lines.length : 0,
      adjustmentIncludedCount: includedLines.length,
      adjustmentTotal: roundMoney(includedLines.reduce(function (total, line) {
        return total + roundMoney(line && line.amount);
      }, 0)),
      warnings: uniqueStrings(includedLines.reduce(function (items, line) {
        return items.concat(Array.isArray(line && line.warnings) ? line.warnings : []);
      }, [])),
    };
  }

  function sanitiseImportedRows(rows, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const scenarioCurrency = detectCurrencyFromText(settings.scenarioCurrency || 'GBP', 'GBP') || 'GBP';
    const paymentTerms = settings.paymentTerms || {};
    const output = [];

    (Array.isArray(rows) ? rows : []).forEach(function (row, index) {
      const invoiceDate = parseFlexibleDate(row && row.invoiceDate, { dayFirst: true });
      let dueDate = parseFlexibleDate(row && row.dueDate, { dayFirst: true });
      const amount = roundMoney(row && row.outstandingAmount);
      const warnings = Array.isArray(row && row.warnings) ? row.warnings.slice() : [];
      let dueDateDerived = row && row.dueDateDerived === true;
      if (!dueDate && invoiceDate) {
        dueDate = deriveDueDate(invoiceDate, paymentTerms);
        dueDateDerived = !!dueDate;
        if (dueDate) warnings.push('Due date estimated from invoice date and selected payment terms.');
      }
      const currency = detectCurrencyFromText(row && row.currency, scenarioCurrency) || scenarioCurrency;
      if (!trimString(row && row.currency)) {
        warnings.push('Currency missing, scenario currency assumed.');
      }
      if (!dueDate) warnings.push('Due date missing.');
      if (!amount) warnings.push('Outstanding amount missing or zero.');
      const creditNote = parseBooleanFlag(row && row.creditNote) || amount < 0 || /credit/i.test(trimString(row && row.status));
      output.push({
        id: trimString(row && row.id) || ('import-row-' + index),
        include: row && row.include !== false,
        sourceRowNumber: Number(row && row.sourceRowNumber) || (index + 2),
        invoiceRef: trimString(row && row.invoiceRef),
        invoiceDate: invoiceDate,
        dueDate: dueDate,
        dueDateDerived: dueDateDerived,
        outstandingAmount: amount,
        currency: currency,
        grossAmount: roundMoney(row && row.grossAmount),
        netAmount: roundMoney(row && row.netAmount),
        vatAmount: roundMoney(row && row.vatAmount),
        clientName: trimString(row && row.clientName),
        status: trimString(row && row.status),
        daysOverdue: Number.isFinite(Number(row && row.daysOverdue)) ? Math.round(Number(row.daysOverdue)) : null,
        ageingBucket: trimString(row && row.ageingBucket),
        creditNote: creditNote,
        paymentReference: trimString(row && row.paymentReference),
        note: trimString(row && row.note),
        warnings: uniqueStrings(warnings),
        warningText: buildRowWarningText(warnings),
      });
    });

    return output.filter(function (row) {
      return row.invoiceRef || row.invoiceDate || row.dueDate || row.outstandingAmount;
    });
  }

  function uniqueStrings(values) {
    const output = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach(function (value) {
      const text = trimString(value);
      if (!text || seen.has(text)) return;
      seen.add(text);
      output.push(text);
    });
    return output;
  }

  function summariseRows(rows, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const forecastStartDate = parseIsoDate(parseFlexibleDate(settings.forecastStartDate || formatDate(new Date()), { dayFirst: true })) || new Date();
    const includedRows = rows.filter(function (row) { return row.include !== false; });
    const totals = includedRows.reduce(function (acc, row) {
      acc.importedTotal += row.outstandingAmount;
      if (row.outstandingAmount > 0 && !row.creditNote) acc.scheduledReceiptTotal += row.outstandingAmount;
      if (row.creditNote || row.outstandingAmount < 0) acc.creditNoteCount += 1;
      if (row.dueDate && parseIsoDate(row.dueDate) && parseIsoDate(row.dueDate).getTime() < forecastStartDate.getTime() && row.outstandingAmount > 0) {
        acc.overdueRowCount += 1;
      }
      return acc;
    }, {
      importedTotal: 0,
      scheduledReceiptTotal: 0,
      overdueRowCount: 0,
      creditNoteCount: 0,
    });

    const currencySet = Array.from(new Set(includedRows.map(function (row) { return detectCurrencyFromText(row.currency); }).filter(Boolean)));
    const warnings = [];
    const duplicateRefs = {};
    let missingDueCount = 0;
    let missingCurrencyCount = 0;
    includedRows.forEach(function (row) {
      if (!row.dueDate) missingDueCount += 1;
      if (!trimString(row.currency)) missingCurrencyCount += 1;
      const key = trimString(row.invoiceRef).toLowerCase();
      if (key) duplicateRefs[key] = (duplicateRefs[key] || 0) + 1;
    });

    const duplicateCount = Object.keys(duplicateRefs).filter(function (key) { return duplicateRefs[key] > 1; }).length;
    if (missingDueCount) warnings.push(missingDueCount + ' row' + (missingDueCount === 1 ? '' : 's') + ' do not include a due date, so the selected payment terms are being used as a fallback where possible.');
    if (missingCurrencyCount) warnings.push(missingCurrencyCount + ' row' + (missingCurrencyCount === 1 ? '' : 's') + ' do not include a currency, so the scenario currency is assumed.');
    if (duplicateCount) warnings.push(duplicateCount + ' duplicate invoice reference' + (duplicateCount === 1 ? '' : 's') + ' detected. Review before confirming.');
    if (totals.creditNoteCount) warnings.push(totals.creditNoteCount + ' credit note or negative-balance row' + (totals.creditNoteCount === 1 ? '' : 's') + ' will stay in the imported total but will not be treated as future cash receipts.');

    return {
      rowCount: rows.length,
      includedRowCount: includedRows.length,
      importedTotal: roundMoney(totals.importedTotal),
      scheduledReceiptTotal: roundMoney(totals.scheduledReceiptTotal),
      overdueRowCount: totals.overdueRowCount,
      creditNoteCount: totals.creditNoteCount,
      detectedCurrency: currencySet.length === 1 ? currencySet[0] : (detectCurrencyFromText(settings.scenarioCurrency || 'GBP') || 'GBP'),
      multipleCurrencies: currencySet.length > 1,
      warnings: warnings,
    };
  }

  function confidenceFromDraft(draft, rowSummary) {
    const mapping = draft && draft.mapping ? draft.mapping : {};
    const warnings = uniqueStrings((draft && draft.warnings) || []).concat(uniqueStrings((rowSummary && rowSummary.warnings) || []));
    let score = 0.08;
    if (mapping.outstandingAmount) score += 0.28;
    if (mapping.dueDate) score += 0.18;
    else if (mapping.invoiceDate) score += 0.1;
    if (mapping.invoiceRef) score += 0.12;
    if (mapping.currency) score += 0.08;
    if (draft && draft.rawTable && Array.isArray(draft.rawTable.headers) && draft.rawTable.headers.length >= 3) score += 0.08;
    if (rowSummary && rowSummary.includedRowCount >= 3) score += 0.08;
    if (draft && (draft.sourceType === 'csv' || draft.sourceType === 'xlsx')) score += 0.08;
    if (draft && draft.sourceType === 'pdf') {
      score += draft.parseMethod === 'table_headers' ? 0.04 : 0.01;
      if (draft.extraction && draft.extraction.strategy === 'ocr_pdf_text') score -= 0.05;
    }
    if (warnings.length >= 3) score -= 0.08;
    if (rowSummary && rowSummary.multipleCurrencies) score -= 0.05;
    if (rowSummary && rowSummary.includedRowCount === 0) score -= 0.35;
    if (!mapping.outstandingAmount) score -= 0.22;
    if (!mapping.dueDate && !mapping.invoiceDate) score -= 0.16;
    const parseMethod = trimString(draft && draft.parseMethod);
    if (parseMethod === 'statement_ledger_lines') {
      score = Math.max(score, rowSummary && rowSummary.includedRowCount >= 2 ? 0.84 : 0.66);
    } else if (parseMethod === 'summary_report') {
      score = Math.min(score, 0.24);
    } else if (parseMethod === 'heuristic_lines') {
      score = Math.min(score, 0.58);
    }
    score = Math.max(0.05, Math.min(0.96, score));

    return {
      score: Math.round(score * 100) / 100,
      level: score >= 0.78 ? 'high' : (score >= 0.52 ? 'medium' : 'low'),
    };
  }

  function buildReconciliationSummary(statement, openingBalance) {
    const enteredOpeningBalance = roundMoney(openingBalance);
    const importedTotal = roundMoney(statement && statement.importedTotal);
    const adjustmentTotal = roundMoney(statement && statement.adjustmentTotal);
    const reconciliationTotal = statement && statement.reconciliationTotal != null
      ? roundMoney(statement.reconciliationTotal)
      : roundMoney(importedTotal + adjustmentTotal);
    const reconciliationMode = trimString(statement && statement.reconciliationMode) || 'keep_manual_opening_balance';
    const variance = roundMoney(reconciliationTotal - enteredOpeningBalance);
    const scaleFactor = reconciliationMode === 'scale_to_opening_balance' && reconciliationTotal
      ? roundMoney(enteredOpeningBalance / reconciliationTotal)
      : 1;
    const effectiveOpeningBalance = reconciliationMode === 'use_imported_total'
      ? reconciliationTotal
      : enteredOpeningBalance;
    return {
      enteredOpeningBalance: enteredOpeningBalance,
      importedTotal: importedTotal,
      adjustmentTotal: adjustmentTotal,
      reconciliationTotal: reconciliationTotal,
      variance: variance,
      matches: Math.abs(variance) < 0.01,
      reconciliationMode: reconciliationMode,
      scaleFactor: scaleFactor,
      effectiveOpeningBalance: effectiveOpeningBalance,
    };
  }

  function materialiseImportedStatement(input, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const draft = input && typeof input === 'object' ? cloneJson(input) : {};
    const rawTable = draft.rawTable && typeof draft.rawTable === 'object' ? draft.rawTable : null;
    const mapping = draft.mapping && typeof draft.mapping === 'object' ? draft.mapping : {};
    let rows;

    if (rawTable && Array.isArray(rawTable.rows) && Array.isArray(rawTable.headers)) {
      rows = rawTable.rows.map(function (row, index) {
        const invoiceDateRaw = chooseRowValue(rawTable, row, mapping, 'invoiceDate');
        const dueDateRaw = chooseRowValue(rawTable, row, mapping, 'dueDate');
        const amountRaw = chooseRowValue(rawTable, row, mapping, 'outstandingAmount')
          || chooseRowValue(rawTable, row, mapping, 'grossAmount')
          || chooseRowValue(rawTable, row, mapping, 'netAmount');
        return {
          id: 'import-row-' + index,
          include: true,
          sourceRowNumber: row.rowNumber,
          invoiceRef: chooseRowValue(rawTable, row, mapping, 'invoiceRef'),
          invoiceDate: parseFlexibleDate(invoiceDateRaw, { dayFirst: true }),
          dueDate: parseFlexibleDate(dueDateRaw, { dayFirst: true }),
          outstandingAmount: parseAmount(amountRaw),
          currency: detectCurrencyFromText(
            chooseRowValue(rawTable, row, mapping, 'currency') || amountRaw,
            settings.scenarioCurrency
          ),
          grossAmount: parseAmount(chooseRowValue(rawTable, row, mapping, 'grossAmount')),
          netAmount: parseAmount(chooseRowValue(rawTable, row, mapping, 'netAmount')),
          vatAmount: parseAmount(chooseRowValue(rawTable, row, mapping, 'vatAmount')),
          clientName: chooseRowValue(rawTable, row, mapping, 'clientName'),
          status: chooseRowValue(rawTable, row, mapping, 'status'),
          daysOverdue: parseInteger(chooseRowValue(rawTable, row, mapping, 'daysOverdue')),
          ageingBucket: chooseRowValue(rawTable, row, mapping, 'ageingBucket'),
          creditNote: parseBooleanFlag(chooseRowValue(rawTable, row, mapping, 'creditNoteFlag')),
          paymentReference: chooseRowValue(rawTable, row, mapping, 'paymentReference'),
          note: '',
          warnings: [],
        };
      });
    } else {
      rows = sanitiseImportedRows(draft.rows, settings);
    }

    const sanitisedRows = sanitiseImportedRows(rows, settings);
    const adjustmentLines = sanitiseReconciliationAdjustmentLines(draft.adjustmentLines, settings);
    const rowSummary = summariseRows(sanitisedRows, settings);
    const adjustmentSummary = summariseAdjustmentLines(adjustmentLines);
    const confidence = confidenceFromDraft(draft, rowSummary);
    const warnings = uniqueStrings((draft.warnings || []).concat(rowSummary.warnings, adjustmentSummary.warnings));
    const importedTotal = rowSummary.importedTotal;
    const adjustmentTotal = adjustmentSummary.adjustmentTotal;
    const reconciliationTotal = roundMoney(importedTotal + adjustmentTotal);
    const scheduledReceiptTotal = roundMoney(rowSummary.scheduledReceiptTotal + adjustmentTotal);

    return {
      status: trimString(draft.status) || 'draft',
      sourceType: trimString(draft.sourceType),
      fileName: trimString(draft.fileName),
      fileSize: Number(draft.fileSize) || 0,
      importedAt: trimString(draft.importedAt) || '',
      parseMethod: trimString(draft.parseMethod),
      parseScore: Number(draft.parseScore) || 0,
      confidence: confidence.level,
      confidenceScore: confidence.score,
      needsReview: confidence.level !== 'high' || warnings.length > 0,
      warnings: warnings,
      rawTable: rawTable ? rawTable : null,
      mapping: cloneJson(mapping),
      rows: sanitisedRows,
      adjustmentLines: adjustmentLines,
      rowCount: rowSummary.rowCount,
      includedRowCount: rowSummary.includedRowCount,
      importedTotal: importedTotal,
      scheduledReceiptTotal: scheduledReceiptTotal,
      adjustmentLineCount: adjustmentSummary.adjustmentLineCount,
      adjustmentIncludedCount: adjustmentSummary.adjustmentIncludedCount,
      adjustmentTotal: adjustmentTotal,
      reconciliationTotal: reconciliationTotal,
      overdueRowCount: rowSummary.overdueRowCount,
      creditNoteCount: rowSummary.creditNoteCount,
      detectedCurrency: rowSummary.detectedCurrency,
      multipleCurrencies: rowSummary.multipleCurrencies,
      reconciliationMode: trimString(draft.reconciliationMode) || 'keep_manual_opening_balance',
      overdueCollectionDays: clampNumber(draft.overdueCollectionDays, 0, 60, 7),
      extraction: draft.extraction || null,
    };
  }

  function prepareConfirmedStatement(input, options) {
    const statement = materialiseImportedStatement(input, options);
    return {
      status: 'confirmed',
      sourceType: statement.sourceType,
      fileName: statement.fileName,
      fileSize: statement.fileSize,
      importedAt: statement.importedAt || new Date().toISOString(),
      parseMethod: statement.parseMethod,
      confidence: statement.confidence,
      confidenceScore: statement.confidenceScore,
      warnings: statement.warnings.slice(0, 12),
      rows: cloneJson(statement.rows),
      adjustmentLines: cloneJson(statement.adjustmentLines),
      rowCount: statement.rowCount,
      includedRowCount: statement.includedRowCount,
      importedTotal: statement.importedTotal,
      scheduledReceiptTotal: statement.scheduledReceiptTotal,
      adjustmentLineCount: statement.adjustmentLineCount,
      adjustmentIncludedCount: statement.adjustmentIncludedCount,
      adjustmentTotal: statement.adjustmentTotal,
      reconciliationTotal: statement.reconciliationTotal,
      overdueRowCount: statement.overdueRowCount,
      creditNoteCount: statement.creditNoteCount,
      detectedCurrency: statement.detectedCurrency,
      multipleCurrencies: statement.multipleCurrencies,
      reconciliationMode: statement.reconciliationMode,
      overdueCollectionDays: statement.overdueCollectionDays,
      extraction: statement.extraction || null,
    };
  }

  function buildAiAssistedDraft(rows, options) {
    const settings = options && typeof options === 'object' ? options : {};
    return materialiseImportedStatement({
      status: 'draft',
      sourceType: settings.sourceType || 'pdf',
      fileName: settings.fileName || '',
      fileSize: Number(settings.fileSize) || 0,
      importedAt: settings.importedAt || '',
      rows: Array.isArray(rows) ? rows.map(function (row, index) {
        const source = row && typeof row === 'object' ? row : {};
        return {
          id: trimString(source.id) || ('ai-import-row-' + index),
          include: source.include !== false,
          sourceRowNumber: Number(source.sourceRowNumber) || (index + 1),
          invoiceRef: trimString(source.invoiceRef || source.invoice_reference || source.reference),
          invoiceDate: parseFlexibleDate(source.invoiceDate || source.invoice_date, { dayFirst: true }),
          dueDate: parseFlexibleDate(source.dueDate || source.due_date, { dayFirst: true }),
          outstandingAmount: parseAmount(source.outstandingAmount != null ? source.outstandingAmount : source.outstanding_amount),
          currency: detectCurrencyFromText(source.currency, settings.scenarioCurrency),
          grossAmount: parseAmount(source.grossAmount != null ? source.grossAmount : source.gross_amount),
          netAmount: parseAmount(source.netAmount != null ? source.netAmount : source.net_amount),
          vatAmount: parseAmount(source.vatAmount != null ? source.vatAmount : source.vat_amount),
          clientName: trimString(source.clientName || source.client_name),
          status: trimString(source.status),
          daysOverdue: parseInteger(source.daysOverdue != null ? source.daysOverdue : source.days_overdue),
          ageingBucket: trimString(source.ageingBucket || source.ageing_bucket),
          creditNote: parseBooleanFlag(source.creditNote != null ? source.creditNote : source.credit_note),
          paymentReference: trimString(source.paymentReference || source.payment_reference),
          note: trimString(source.note) || trimString(source.confidence),
          warnings: uniqueStrings(Array.isArray(source.warnings) ? source.warnings : []),
        };
      }) : [],
      warnings: uniqueStrings([
        'AI-assisted extraction was used because the PDF could not be read confidently using the standard parser.',
      ].concat(Array.isArray(settings.warnings) ? settings.warnings : [])),
      parseMethod: settings.parseMethod || 'ai_assisted_json',
      parseScore: Number(settings.parseScore) || 2,
      extraction: settings.extraction || null,
    }, settings);
  }

  function parseCsvText(text, options) {
    const delimiter = detectCsvDelimiter(text);
    const matrix = parseDelimitedText(stripBom(String(text || '')), delimiter);
    return createDraftFromMatrix(matrix, Object.assign({}, options, {
      sourceType: 'csv',
      parseMethod: 'table_headers',
    }));
  }

  function parsePdfHeuristicLine(line, index) {
    const raw = trimString(line);
    if (!raw) return null;
    const dateMatches = raw.match(PDF_DATE_RE) || [];
    const amountMatches = raw.match(PDF_DECIMAL_AMOUNT_RE) || [];
    if (!amountMatches.length) return null;
    const amountText = amountMatches[amountMatches.length - 1];
    const amount = parseAmount(amountText);
    if (!amount) return null;
    const refPart = raw
      .replace(amountText, '')
      .replace(dateMatches.join(' '), '')
      .replace(/\b(current|overdue|due|not due|credit note)\b/ig, '')
      .trim();
    return {
      rowNumber: index + 1,
      cells: [
        refPart || ('Row ' + (index + 1)),
        dateMatches[0] || '',
        dateMatches[1] || '',
        amountText,
        detectCurrencyFromText(raw, ''),
        /\boverdue\b/i.test(raw) ? 'Overdue' : '',
      ],
    };
  }

  function isLikelyPdfStatementNoiseLine(line) {
    const text = trimString(line);
    if (!text) return true;
    const lower = text.toLowerCase();
    if (
      /^date reference due date original total debit credit balance$/i.test(text)
      || /^statement totals$/i.test(text)
      || /^current\s+\d+/i.test(text)
      || /^please ensure all payments are made to:/i.test(text)
      || /^all amounts shown in /i.test(text)
      || /^a\/c ref:/i.test(text)
      || /^a\/c name:/i.test(text)
      || /^date:/i.test(text)
      || /^terms /i.test(text)
      || /^vat no\./i.test(text)
      || /^bic:/i.test(text)
      || /^iban:/i.test(text)
      || /^debtors summary report /i.test(text)
      || /^as of /i.test(text)
      || /^accrual basis /i.test(text)
      || /^customer current /i.test(text)
      || /^total £/i.test(text)
      || /^total\s+[£€]?\d/i.test(text)
      || lower.indexOf('remittances@') >= 0
    ) return true;
    if (/^[A-Z][A-Z\s&()\/\-]{2,}$/.test(text) && text.length < 48) return true;
    return false;
  }

  function looksLikePdfSummaryReport(lines) {
    const preview = (Array.isArray(lines) ? lines : []).slice(0, 12).join(' ').toLowerCase();
    return preview.indexOf('debtors summary report') >= 0
      || preview.indexOf('customer current 1 - 30') >= 0
      || preview.indexOf('91 and over total') >= 0;
  }

  function isLikelyStructuredInvoiceReference(text) {
    const value = trimString(text).replace(/\s+/g, ' ');
    if (!value) return false;
    if (/^(current|total|customer|statement|date|reference|due)$/i.test(value)) return false;
    if (/\b(?:si|inv|cn|crn|sr|dr|dn)\b/i.test(value)) return true;
    return /[A-Za-z]/.test(value) && /\d/.test(value);
  }

  function parsePdfStatementLedgerLine(line, index, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const raw = trimString(line);
    if (!raw || isLikelyPdfStatementNoiseLine(raw)) return null;

    const dateMatches = Array.from(raw.matchAll(PDF_DATE_RE));
    const amountMatches = Array.from(raw.matchAll(PDF_STRICT_STATEMENT_AMOUNT_RE));
    if (!dateMatches.length || !amountMatches.length) return null;
    if (dateMatches[0].index !== 0) return null;

    const firstAmount = amountMatches[0];
    const firstAmountIndex = typeof firstAmount.index === 'number' ? firstAmount.index : raw.indexOf(firstAmount[0]);
    const dueDateMatch = dateMatches.find(function (match, matchIndex) {
      return matchIndex > 0 && typeof match.index === 'number' && match.index < firstAmountIndex;
    }) || null;
    const refStart = (dateMatches[0][0] || '').length;
    const refEnd = dueDateMatch ? dueDateMatch.index : firstAmountIndex;
    const reference = raw.slice(refStart, refEnd).replace(/\s+/g, ' ').trim();
    if (!isLikelyStructuredInvoiceReference(reference)) return null;

    const parsedInvoiceDate = parseFlexibleDate(dateMatches[0][0], { dayFirst: true });
    const parsedDueDate = dueDateMatch ? parseFlexibleDate(dueDateMatch[0], { dayFirst: true }) : '';
    const amountTexts = amountMatches
      .filter(function (match) { return typeof match.index === 'number' && match.index >= firstAmountIndex; })
      .map(function (match) { return trimString(match[0]); });
    if (!amountTexts.length) return null;

    let outstandingAmount = parseAmount(amountTexts[0]);
    if (!outstandingAmount) {
      outstandingAmount = parseAmount(amountTexts.find(function (value) { return parseAmount(value) !== 0; }) || '');
    }
    if (!outstandingAmount) return null;

    return {
      id: 'pdf-ledger-row-' + index,
      include: true,
      sourceRowNumber: index + 1,
      invoiceRef: reference,
      invoiceDate: parsedInvoiceDate,
      dueDate: parsedDueDate,
      outstandingAmount: outstandingAmount,
      currency: detectCurrencyFromText(raw, settings.scenarioCurrency),
      status: dueDateMatch ? '' : 'Due date missing',
      note: amountTexts.length > 1 ? 'Outstanding amount taken from the first value on the statement line.' : '',
      warnings: parsedDueDate ? [] : ['Due date missing.'],
    };
  }

  function parsePdfText(text, options) {
    const settings = options && typeof options === 'object' ? options : {};
    const lines = normaliseWhitespace(text).split('\n').map(trimString).filter(Boolean);
    const structuredRows = lines
      .map(function (line, index) { return parsePdfStatementLedgerLine(line, index, settings); })
      .filter(Boolean)
      .slice(0, 600);

    if (structuredRows.length) {
      return materialiseImportedStatement({
        status: 'draft',
        sourceType: 'pdf',
        fileName: settings.fileName || '',
        rows: structuredRows,
        warnings: structuredRows.length < 2
          ? ['Only one invoice-like row was recovered from this PDF. Review before confirming, or upload CSV/XLSX if available.']
          : [],
        parseMethod: 'statement_ledger_lines',
        parseScore: 4,
        extraction: settings.extraction || null,
      }, settings);
    }

    if (looksLikePdfSummaryReport(lines)) {
      return materialiseImportedStatement({
        status: 'draft',
        sourceType: 'pdf',
        fileName: settings.fileName || '',
        rows: [],
        warnings: [
          'This PDF looks like a customer summary or aged-debt report rather than an invoice-level statement. Upload a statement with invoice rows, or use CSV/XLSX for reliable scheduling.',
        ],
        parseMethod: 'summary_report',
        parseScore: 0,
        extraction: settings.extraction || null,
      }, settings);
    }

    const tabularCandidates = lines.filter(function (line) {
      return /\t/.test(line) || /\s{2,}/.test(line) || /\|/.test(line);
    });

    let draft;
    if (tabularCandidates.length >= 3) {
      const delimiter = tabularCandidates.some(function (line) { return /\t/.test(line); })
        ? '\t'
        : (tabularCandidates.some(function (line) { return /\|/.test(line); }) ? '|' : null);
      const matrix = delimiter
        ? tabularCandidates.map(function (line) { return line.split(delimiter).map(trimString); })
        : tabularCandidates.map(function (line) { return line.split(/\s{2,}/).map(trimString); });
      draft = createDraftFromMatrix(matrix, Object.assign({}, settings, {
        sourceType: 'pdf',
        parseMethod: 'table_headers',
      }));
    } else {
      const rows = lines
        .map(parsePdfHeuristicLine)
        .filter(Boolean)
        .slice(0, 600);
      draft = materialiseImportedStatement({
        status: 'draft',
        sourceType: 'pdf',
        fileName: settings.fileName || '',
        rawTable: {
          headers: ['Invoice ref', 'Invoice date', 'Due date', 'Outstanding amount', 'Currency', 'Status'],
          rows: rows,
          headerRowIndex: 0,
        },
        mapping: {
          invoiceRef: 'Invoice ref',
          invoiceDate: 'Invoice date',
          dueDate: 'Due date',
          outstandingAmount: 'Outstanding amount',
          currency: 'Currency',
          status: 'Status',
        },
        warnings: ['PDF table structure was weak, so line-by-line extraction has been used. Review the rows before confirming.'],
        parseMethod: 'heuristic_lines',
        parseScore: 1,
        extraction: settings.extraction || null,
      }, settings);
    }

    if (draft.extraction && draft.extraction.strategy === 'ocr_pdf_text') {
      draft.warnings = uniqueStrings(['OCR fallback was used to recover text from this PDF. Review the imported rows before confirming.'].concat(draft.warnings || []));
      draft.confidence = draft.confidence === 'high' ? 'medium' : draft.confidence;
      draft.confidenceScore = Math.min(draft.confidenceScore || 0.7, 0.74);
      draft.needsReview = true;
    }
    return draft;
  }

  function validateConfirmedStatement(statement) {
    const input = statement && typeof statement === 'object' ? statement : {};
    const rows = sanitiseImportedRows(input.rows, input);
    const confirmed = prepareConfirmedStatement(Object.assign({}, input, { rows: rows }), input);
    return confirmed;
  }

  return {
    CURRENCY_CODES: CURRENCY_CODES,
    FIELD_OPTIONS: fieldOptions(),
    IMPORTANT_FIELDS: IMPORTANT_FIELDS,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    HEADER_ALIASES: HEADER_ALIASES,
    detectSourceType: detectSourceType,
    parseCsvText: parseCsvText,
    parsePdfText: parsePdfText,
    parseXlsxBuffer: parseXlsxBuffer,
    parseFlexibleDate: parseFlexibleDate,
    parseAmount: parseAmount,
    materialiseImportedStatement: materialiseImportedStatement,
    prepareConfirmedStatement: prepareConfirmedStatement,
    buildAiAssistedDraft: buildAiAssistedDraft,
    buildReconciliationSummary: buildReconciliationSummary,
    validateConfirmedStatement: validateConfirmedStatement,
  };
});
