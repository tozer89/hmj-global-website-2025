(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PayrollLogic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function parseDate(value) {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function normaliseString(value) {
    return String(value || '').trim().toLowerCase();
  }

  function detectIssues(rows = []) {
    const issues = new Map();
    const comboCounts = new Map();

    rows.forEach((row) => {
      const candidateId = row?.candidateId || row?.candidate?.id;
      const key = candidateId && row?.weekEnding ? `${candidateId}-${row.weekEnding}` : null;
      if (key) comboCounts.set(key, (comboCounts.get(key) || 0) + 1);
    });

    rows.forEach((row) => {
      const id = String(row?.id ?? '');
      if (!id) return;
      const flags = [];
      const totals = row?.totals || {};
      const rate = row?.rate || {};
      const assignment = row?.assignment || {};
      const candidateId = row?.candidateId || row?.candidate?.id;
      const key = candidateId && row?.weekEnding ? `${candidateId}-${row.weekEnding}` : null;

      if (toNumber(totals.hours) === 0 || toNumber(totals.pay) === 0) {
        flags.push('Timesheet has zero hours or pay.');
      }
      if (toNumber(rate.pay) === 0 || toNumber(rate.charge) === 0) {
        flags.push('Missing rate information.');
      }
      if (!assignment?.poNumber) {
        flags.push('Missing PO number.');
      }
      if (String(row?.status || '').toLowerCase() === 'approved' && !row?.approvedAt) {
        flags.push('Approved status without approval date.');
      }
      if (key && comboCounts.get(key) > 1) {
        flags.push('Duplicate candidate/week combination.');
      }

      if (flags.length) {
        issues.set(id, flags);
      }
    });

    return issues;
  }

  function applyFilters(rows = [], filters = {}, options = {}) {
    const searchNeedle = normaliseString(filters.search);
    const statusFilter = normaliseString(filters.status);
    const clientNeedle = normaliseString(filters.client);
    const candidateNeedle = normaliseString(filters.candidate);
    const invoiceNeedle = normaliseString(filters.invoiceRef);
    const costNeedle = normaliseString(filters.costCentre);
    const poNeedle = normaliseString(filters.poNumber);
    const quickFilter = filters.quick || null;
    const showIssuesOnly = !!filters.showIssues;
    const showNotesOnly = !!filters.showNotes;
    const weekFrom = parseDate(filters.weekFrom);
    const weekTo = parseDate(filters.weekTo);
    const issues = options?.issues instanceof Map ? options.issues : new Map();

    return rows.filter((row) => {
      const status = normaliseString(row?.payrollStatus || row?.status);
      if (statusFilter && statusFilter !== 'all' && status !== statusFilter) {
        return false;
      }

      const weekEnding = parseDate(row?.weekEnding);
      if (weekFrom && (!weekEnding || weekEnding < weekFrom)) {
        return false;
      }
      if (weekTo && (!weekEnding || weekEnding > weekTo)) {
        return false;
      }

      if (searchNeedle) {
        const haystack = [
          row?.id,
          row?.candidateName,
          row?.candidate?.name,
          row?.candidate?.payrollRef,
          row?.candidate?.email,
          row?.assignment?.jobTitle,
          row?.assignment?.clientName,
          row?.assignment?.ref,
          row?.projectName,
          row?.siteName,
          row?.invoiceRef,
          row?.costCentre,
          row?.poNumber,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchNeedle)) {
          return false;
        }
      }

      if (clientNeedle && !normaliseString(row?.assignment?.clientName).includes(clientNeedle)) {
        return false;
      }

      if (candidateNeedle) {
        const candidateSource = `${row?.candidateName || ''} ${row?.candidate?.name || ''} ${row?.candidate?.payrollRef || ''}`;
        if (!normaliseString(candidateSource).includes(candidateNeedle)) {
          return false;
        }
      }

      if (invoiceNeedle && !normaliseString(row?.invoiceRef).includes(invoiceNeedle)) {
        return false;
      }

      if (costNeedle && !normaliseString(row?.costCentre).includes(costNeedle)) {
        return false;
      }

      const poSource = `${row?.assignment?.poNumber || ''} ${row?.poNumber || ''}`;
      if (poNeedle && !normaliseString(poSource).includes(poNeedle)) {
        return false;
      }

      if (showNotesOnly) {
        const note = row?.notes || row?.audit?.meta?.note;
        if (!note) return false;
      }

      if (showIssuesOnly && !issues.has(String(row?.id || ''))) {
        return false;
      }

      if (quickFilter) {
        const wf = String(quickFilter);
        if (wf === 'overdue') {
          const overdue = status !== 'paid' && weekEnding && weekEnding < new Date(Date.now() - 6 * 24 * 3600 * 1000);
          if (!overdue) return false;
        } else if (wf === 'unapproved') {
          if (String(row?.status || '').toLowerCase() === 'approved') return false;
        } else if (wf === 'missing-timesheets') {
          if (toNumber(row?.totals?.hours) > 0) return false;
        }
      }

      return true;
    });
  }

  function computeTotals(rows = []) {
    let grossPay = 0;
    let employerCharge = 0;
    let margin = 0;
    const candidateIds = new Set();
    const byClient = new Map();
    const byStatus = new Map();
    const payByCurrency = new Map();
    const chargeByCurrency = new Map();
    const weekTotals = new Map();

    rows.forEach((row) => {
      const pay = toNumber(row?.totals?.pay);
      const charge = toNumber(row?.totals?.charge);
      const rowMargin = charge - pay;
      const status = normaliseString(row?.payrollStatus || row?.status) || 'unknown';
      const client = row?.assignment?.clientName || 'Unassigned';
      const currency = row?.currency || row?.assignment?.currency || 'GBP';
      const week = row?.weekEnding || 'Unknown';

      grossPay += pay;
      employerCharge += charge;
      margin += rowMargin;
      if (row?.candidateId || row?.candidate?.id) {
        candidateIds.add(String(row.candidateId || row.candidate.id));
      } else if (row?.candidateName) {
        candidateIds.add(row.candidateName);
      }

      byStatus.set(status, (byStatus.get(status) || 0) + 1);
      if (!byClient.has(client)) {
        byClient.set(client, { client, pay: 0, charge: 0, margin: 0, count: 0 });
      }
      const ref = byClient.get(client);
      ref.pay += pay;
      ref.charge += charge;
      ref.margin += rowMargin;
      ref.count += 1;

      payByCurrency.set(currency, (payByCurrency.get(currency) || 0) + pay);
      chargeByCurrency.set(currency, (chargeByCurrency.get(currency) || 0) + charge);
      weekTotals.set(week, (weekTotals.get(week) || 0) + pay);
    });

    const sortedClient = Array.from(byClient.values()).sort((a, b) => b.pay - a.pay).slice(0, 8);
    const sortedStatus = Array.from(byStatus.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const weekPairs = Array.from(weekTotals.entries())
      .map(([week, value]) => ({ week, value, date: parseDate(week) }))
      .filter((entry) => entry.date)
      .sort((a, b) => b.date - a.date);

    const currentWeek = weekPairs[0];
    const prevWeek = weekPairs[1];
    let trend = { direction: 'flat', change: 0, current: currentWeek?.value || 0, previous: prevWeek?.value || 0 };
    if (currentWeek && prevWeek) {
      const diff = currentWeek.value - prevWeek.value;
      const change = prevWeek.value === 0 ? 100 : (diff / prevWeek.value) * 100;
      trend = {
        direction: diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down',
        change,
        current: currentWeek.value,
        previous: prevWeek.value,
        currentWeek: currentWeek.week,
        previousWeek: prevWeek.week,
      };
    } else if (currentWeek) {
      trend = {
        direction: 'up',
        change: 100,
        current: currentWeek.value,
        previous: 0,
        currentWeek: currentWeek.week,
        previousWeek: null,
      };
    }

    return {
      rows: rows.length,
      grossPay,
      employerCharge,
      margin,
      candidateCount: candidateIds.size,
      byClient: sortedClient,
      byStatus: sortedStatus,
      byCurrency: Object.fromEntries(payByCurrency.entries()),
      chargeByCurrency: Object.fromEntries(chargeByCurrency.entries()),
      trend,
    };
  }

  function friendlyErrorMessage(error) {
    const raw = error && error.message ? error.message : String(error || '');
    if (/401|403|unauthor/i.test(raw)) {
      return 'Session expired — please log in again.';
    }
    if (/supabase/i.test(raw)) {
      return 'Supabase is unavailable right now. Retry in a moment.';
    }
    if (!raw) {
      return 'Unexpected error. Try again shortly.';
    }
    return raw;
  }

  function prepareAuditPayload(status, note) {
    const payload = { status: normaliseString(status) || 'ready' };
    if (note && String(note).trim()) {
      payload.note = String(note).trim();
    }
    return payload;
  }

  return {
    applyFilters,
    computeTotals,
    detectIssues,
    friendlyErrorMessage,
    prepareAuditPayload,
    toNumber,
  };
});
