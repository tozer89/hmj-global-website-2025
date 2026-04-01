const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getRateBookSeed,
  calculateChargeFromPay,
  pickCurrentRates,
  hydrateRateBook,
} = require('../netlify/functions/_rate-book-helpers.js');

test('rate book seed exposes 50 roles across 5 markets', () => {
  const seed = getRateBookSeed();
  assert.equal(seed.roles.length, 50);
  assert.equal(seed.markets.length, 5);
  assert.equal(seed.roles[0].name, 'Electrician');
  assert.equal(seed.roles.at(-1).name, 'Operations Manager');
});

test('rate book charge calculation follows HMJ margin rules', () => {
  assert.equal(calculateChargeFromPay(34, {}, 'GBP'), 37.5);
  assert.equal(calculateChargeFromPay(35, {}, 'EUR'), 40);
  assert.equal(calculateChargeFromPay(34.5, {}, 'GBP'), 38);
  assert.equal(calculateChargeFromPay(20, {}, 'USD'), null);
});

test('current rate selection prefers the latest active effective window', () => {
  const rows = [
    {
      id: 'older',
      role_id: 'role-1',
      market_id: 'market-1',
      pay_rate: 30,
      charge_rate: 33.5,
      effective_from: '2026-03-01',
      effective_to: null,
      updated_at: '2026-03-01T00:00:00.000Z',
    },
    {
      id: 'future',
      role_id: 'role-1',
      market_id: 'market-1',
      pay_rate: 32,
      charge_rate: 37,
      effective_from: '2026-05-01',
      effective_to: null,
      updated_at: '2026-04-01T00:00:00.000Z',
    },
    {
      id: 'current',
      role_id: 'role-1',
      market_id: 'market-1',
      pay_rate: 31,
      charge_rate: 34.5,
      effective_from: '2026-04-01',
      effective_to: null,
      updated_at: '2026-04-02T00:00:00.000Z',
    },
  ];

  const picked = pickCurrentRates(rows, new Date('2026-04-10T12:00:00.000Z'));
  assert.equal(picked.length, 1);
  assert.equal(picked[0].id, 'current');
});

test('hydrated rate book exposes grouped market rates per role', () => {
  const seed = getRateBookSeed();
  const roles = seed.roles.slice(0, 2).map((role) => ({
    id: role.slug,
    slug: role.slug,
    name: role.name,
    discipline: role.discipline,
    sector: role.sector,
    seniority: role.seniority,
    is_active: role.isActive,
    is_public: role.isPublic,
    display_order: role.displayOrder,
    notes: role.notes,
  }));
  const markets = seed.markets.map((market) => ({
    id: market.code,
    code: market.code,
    name: market.name,
    currency: market.currency,
    is_active: market.isActive,
    display_order: market.displayOrder,
  }));
  const rates = [];
  seed.roles.slice(0, 2).forEach((role) => {
    Object.entries(role.rates).forEach(([marketCode, rate]) => {
      rates.push({
        id: `${role.slug}-${marketCode}`,
        role_id: role.slug,
        market_id: marketCode,
        pay_rate: rate.payRate,
        charge_rate: rate.chargeRate,
        rate_unit: 'hour',
        is_featured: role.featured,
        effective_from: '2026-04-01',
      });
    });
  });

  const hydrated = hydrateRateBook(roles, markets, rates, seed.settings);
  assert.equal(hydrated.roles.length, 2);
  assert.equal(hydrated.roles[0].marketRates.length, 5);
  assert.equal(hydrated.roles[0].marketRates[0].marketCode, 'UK');
});
