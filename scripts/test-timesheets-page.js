const fs = require('node:fs');
const path = require('node:path');
const { createTimesheetsApp } = require('../admin/timesheets.js');

const htmlPath = path.join(__dirname, '..', 'admin', 'timesheets.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const requiredIds = ['weekToolbar', 'filters', 'tableInner', 'bulkBar', 'sidePanel'];
requiredIds.forEach((id) => {
  if (!new RegExp(`id="${id}"`).test(html)) {
    throw new Error(`Missing required element #${id} in HTML`);
  }
});

class FakeElement {
  constructor(tagName = 'div', id = '', ownerDocument = null) {
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.attributes = new Map();
    this._text = '';
    this._html = '';
    this._classes = new Set();
    const datasetStore = {};
    this.dataset = new Proxy(datasetStore, {
      set: (target, key, value) => {
        target[key] = String(value);
        const attr = `data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
        this.attributes.set(attr, String(value));
        return true;
      },
      get: (target, key) => target[key],
    });
    if (this.tagName === 'CANVAS') {
      const ctx = {
        canvas: this,
        clearRect() {},
        fillRect() {},
        fillText() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        fill() {},
        stroke() {},
        closePath() {},
        font: '',
        strokeStyle: '',
        fillStyle: '',
      };
      this.getContext = () => ctx;
      this.width = 760;
      this.height = 280;
    }
    const updateClassName = () => {
      this._className = Array.from(this._classes).join(' ');
    };
    this.classList = {
      add: (...cls) => { cls.forEach((c) => c && this._classes.add(c)); updateClassName(); },
      remove: (...cls) => { cls.forEach((c) => this._classes.delete(c)); updateClassName(); },
      contains: (cls) => this._classes.has(cls),
      toggle: (cls, force) => {
        const shouldAdd = force !== undefined ? force : !this._classes.has(cls);
        if (shouldAdd) this._classes.add(cls); else this._classes.delete(cls);
        updateClassName();
      },
    };
    Object.defineProperty(this, 'className', {
      get: () => Array.from(this._classes).join(' '),
      set: (value) => {
        this._classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
        updateClassName();
      },
    });
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentNode = null;
    }
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  setAttribute(name, value) {
    if (name === 'class') {
      this.className = value;
      return;
    }
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(value);
    }
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes.get(name);
  }

  removeAttribute(name) {
    if (name === 'class') {
      this.className = '';
      return;
    }
    this.attributes.delete(name);
  }

  addEventListener() {}

  focus() {}

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const match = (el) => {
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        return el.classList.contains(cls);
      }
      if (selector.startsWith('[') && selector.endsWith(']')) {
        const content = selector.slice(1, -1);
        const [namePart, valuePart] = content.split('=');
        const attrName = namePart;
        if (valuePart) {
          const expected = valuePart.replace(/^["']|["']$/g, '');
          return el.getAttribute(attrName) === expected;
        }
        return el.attributes.has(attrName);
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };
    const traverse = (node) => {
      node.children.forEach((child) => {
        if (match(child)) results.push(child);
        traverse(child);
      });
    };
    traverse(this);
    return results;
  }

  set textContent(value) {
    this._text = String(value);
    this._html = '';
    this.children = [];
  }

  get textContent() {
    if (this.children.length) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._text;
  }

  set innerHTML(value) {
    this._html = String(value);
    this.children = [];
    this._text = '';
  }

  get innerHTML() {
    if (this.children.length) {
      return this.children.map((child) => child.textContent).join('');
    }
    return this._html;
  }
}

function createFakeDocument(idMap) {
  const document = {
    body: null,
    _elements: new Map(),
    createElement(tagName) {
      const el = new FakeElement(tagName, '', document);
      return el;
    },
    getElementById(id) {
      if (!this._elements.has(id)) {
        const tagName = idMap.get(id) || 'div';
        const el = new FakeElement(tagName, id, document);
        this._elements.set(id, el);
        if (this.body) this.body.appendChild(el);
      }
      return this._elements.get(id);
    },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
  };
  const body = new FakeElement('body', '', document);
  document.body = body;
  idMap.forEach((tagName, id) => {
    const el = new FakeElement(tagName, id, document);
    document._elements.set(id, el);
    body.appendChild(el);
  });
  return document;
}

const idRegex = /<([a-zA-Z0-9-]+)[^>]*id="([^"]+)"/g;
const idMap = new Map();
let match;
while ((match = idRegex.exec(html))) {
  idMap.set(match[2], match[1]);
}

const document = createFakeDocument(idMap);
global.document = document;

global.localStorage = {
  _data: new Map(),
  getItem(key) { return this._data.get(key) || null; },
  setItem(key, value) { this._data.set(key, value); },
};

const consoleErrors = [];
const originalError = console.error;
console.error = (...args) => { consoleErrors.push(args.join(' ')); };

const app = createTimesheetsApp(document, { disablePersistence: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getText(id) {
  return document.getElementById(id)?.textContent?.trim() || '';
}

const toolbar = document.getElementById('weekToolbar');
const filtersPanel = document.getElementById('filters');
const tableInner = document.getElementById('tableInner');
const bulkBar = document.getElementById('bulkBar');
const sidePanel = document.getElementById('sidePanel');
assert(toolbar && filtersPanel && tableInner && bulkBar && sidePanel, 'Layout elements missing');

app.setFilter('status', 'submitted');
const submittedRows = app.getVisibleRows();
assert(submittedRows.length > 0, 'No submitted rows after filter');
assert(submittedRows.every((row) => row.status === 'submitted'), 'Filter should show only submitted rows');

app.setFilter('status', '');
const draftCountBefore = app.state.allRows.length;
app.createDraft({ assignmentId: 'A-NEW-1', weekEnding: '2024-01-07' });
app.createDraft({ assignmentId: 'A-NEW-1', weekEnding: '2024-01-07' });
const matchingDrafts = app.state.allRows.filter((row) => row.assignmentId === 'A-NEW-1' && row.weekEnding === '2024-01-07');
assert(matchingDrafts.length === 1, 'Duplicate drafts should not be created');
assert(app.state.allRows.length === draftCountBefore + 1, 'Draft count should increase once');

app.setFilter('search', 'A-NEW-1');
app.applyFilters();
const createdRow = app.getVisibleRows()[0];
assert(createdRow, 'Created draft should be visible');
app.handleHoursChange(createdRow.id, 'std', 35);
const refreshedRow = app.state.allRows.find((row) => row.id === createdRow.id);
assert(Math.abs(refreshedRow.totalStd - 35) < 0.01, 'Standard hours should update');
app.applyFilters();
const totalStd = parseFloat(getText('totalsStd'));
assert(Number.isFinite(totalStd), 'Totals STD should be numeric');
assert(Math.abs(totalStd - refreshedRow.totalStd) < 0.2, 'Totals row should match updated hours');
app.setFilter('search', '');
app.applyFilters();

const draftIds = app.state.allRows.filter((row) => row.status === 'draft').slice(0, 2).map((row) => row.id);
app.changeStatus(draftIds, 'approved');
const approvedRows = app.state.allRows.filter((row) => draftIds.includes(row.id));
assert(approvedRows.every((row) => row.status === 'approved'), 'Drafts should be approved in bulk');

const csvSample = `assignment_id,week_ending,h_mon,ot_hours,notes\nA-1001,2024-01-14,8,2,ok\n,2024-01-14,8,0,missing`;
const dryRun = app.dryRunCsv(csvSample);
assert(dryRun.rows.length === 1, 'Dry run should parse valid row');
assert(dryRun.errors.length === 1, 'Dry run should capture invalid rows');

const reminders = app.previewReminders();
assert(Array.isArray(reminders), 'Reminders should return an array');
reminders.forEach((entry) => {
  assert(entry.contractor && entry.email, 'Reminder entries require contractor and email');
});

console.error = originalError;
if (consoleErrors.length) {
  throw new Error(`Console errors detected: ${consoleErrors.join('\n')}`);
}

console.log('[test] timesheets page scenarios passed');
