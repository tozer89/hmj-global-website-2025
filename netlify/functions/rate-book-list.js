const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  RATE_BOOK_ROLE_TABLE,
  RATE_BOOK_MARKET_TABLE,
  RATE_BOOK_RATE_TABLE,
  RATE_BOOK_SETTINGS_TABLE,
  getRateBookSeed,
  hydrateRateBook,
  settingsFromRow,
} = require('./_rate-book-helpers.js');

const HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

function buildSeedRows() {
  const seed = getRateBookSeed();
  const markets = seed.markets.map((market) => ({
    id: market.code,
    code: market.code,
    name: market.name,
    currency: market.currency,
    is_active: market.isActive,
    display_order: market.displayOrder,
  }));
  const roles = seed.roles.map((role) => ({
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
  const rates = [];

  seed.roles.forEach((role) => {
    seed.markets.forEach((market) => {
      const rate = role.rates[market.code];
      if (!rate) return;
      rates.push({
        id: `${role.slug}-${market.code}`,
        role_id: role.slug,
        market_id: market.code,
        pay_rate: rate.payRate,
        charge_rate: rate.chargeRate,
        rate_unit: rate.rateUnit,
        is_featured: !!role.featured,
        is_charge_overridden: false,
        effective_from: '2026-04-01',
      });
    });
  });

  return {
    roles,
    markets,
    rates,
    settings: seed.settings,
  };
}

function toPublicPayload(source, error = '', schema = false) {
  const seedRows = buildSeedRows();
  const hydrated = hydrateRateBook(
    seedRows.roles,
    seedRows.markets,
    seedRows.rates,
    settingsFromRow(seedRows.settings)
  );

  return {
    ok: true,
    publicEnabled: hydrated.settings.publicEnabled !== false,
    settings: hydrated.settings,
    markets: hydrated.markets.filter((market) => market.isActive),
    roles: hydrated.settings.publicEnabled === false
      ? []
      : hydrated.roles
        .filter((role) => role.isActive && role.isPublic)
        .map((role) => ({
          id: role.id,
          slug: role.slug,
          name: role.name,
          discipline: role.discipline,
          sector: role.sector,
          seniority: role.seniority,
          notes: role.notes,
          isFeatured: role.isFeatured,
          updatedAt: role.updatedAt || null,
          marketRates: role.marketRates.map((rate) => ({
            id: rate.id,
            marketCode: rate.marketCode,
            marketName: rate.marketName,
            currency: rate.currency,
            payRate: rate.payRate,
            chargeRate: rate.chargeRate,
            calculatedChargeRate: rate.calculatedChargeRate,
            rateUnit: rate.rateUnit,
          })),
        })),
    source,
    error,
    schema,
    supabase: supabaseStatus(),
  };
}

exports.handler = async (event) => {
  if (!hasSupabase()) {
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(
        toPublicPayload('fallback', 'Rate Book data service unavailable in this environment.', false)
      ),
    };
  }

  try {
    const supabase = getSupabase(event);
    const [rolesResult, marketsResult, ratesResult, settingsResult] = await Promise.all([
      supabase
        .from(RATE_BOOK_ROLE_TABLE)
        .select('*')
        .eq('is_active', true)
        .eq('is_public', true)
        .order('display_order', { ascending: true }),
      supabase
        .from(RATE_BOOK_MARKET_TABLE)
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true }),
      supabase
        .from(RATE_BOOK_RATE_TABLE)
        .select('*'),
      supabase
        .from(RATE_BOOK_SETTINGS_TABLE)
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1),
    ]);

    if (rolesResult.error) throw rolesResult.error;
    if (marketsResult.error) throw marketsResult.error;
    if (ratesResult.error) throw ratesResult.error;
    if (settingsResult.error) throw settingsResult.error;

    const hydrated = hydrateRateBook(
      rolesResult.data || [],
      marketsResult.data || [],
      ratesResult.data || [],
      settingsFromRow((settingsResult.data || [])[0] || {})
    );

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        publicEnabled: hydrated.settings.publicEnabled !== false,
        settings: hydrated.settings,
        markets: hydrated.markets.filter((market) => market.isActive),
        roles: hydrated.settings.publicEnabled === false
          ? []
          : hydrated.roles
            .filter((role) => role.isActive && role.isPublic)
            .map((role) => ({
              id: role.id,
              slug: role.slug,
              name: role.name,
              discipline: role.discipline,
              sector: role.sector,
              seniority: role.seniority,
              notes: role.notes,
              isFeatured: role.isFeatured,
              updatedAt: role.updatedAt || null,
              marketRates: role.marketRates.map((rate) => ({
                id: rate.id,
                marketCode: rate.marketCode,
                marketName: rate.marketName,
                currency: rate.currency,
                payRate: rate.payRate,
                chargeRate: rate.chargeRate,
                calculatedChargeRate: rate.calculatedChargeRate,
                rateUnit: rate.rateUnit,
              })),
            })),
        source: 'supabase',
        schema: false,
        supabase: supabaseStatus(),
      }),
    };
  } catch (error) {
    const message = error?.message || 'Rate Book data unavailable';
    const schema = /rate_book_/i.test(message);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify(
        toPublicPayload(
          schema ? 'setup-required' : 'fallback-error',
          schema ? 'Rate Book tables are not available on this environment yet.' : message,
          schema
        )
      ),
    };
  }
};
