const { withAdminCors } = require('./_http.js');
const { getContext } = require('./_auth.js');
const { getSupabase, hasSupabase, supabaseStatus } = require('./_supabase.js');
const {
  RATE_BOOK_ROLE_TABLE,
  RATE_BOOK_MARKET_TABLE,
  RATE_BOOK_RATE_TABLE,
  RATE_BOOK_SETTINGS_TABLE,
  getRateBookSeed,
  hydrateRateBook,
  settingsFromRow,
  isMissingTableError,
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

function buildReadOnlyPayload(source, error = '', schema = false) {
  const seedRows = buildSeedRows();
  const hydrated = hydrateRateBook(
    seedRows.roles,
    seedRows.markets,
    seedRows.rates,
    settingsFromRow(seedRows.settings)
  );

  return {
    ok: true,
    readOnly: true,
    source,
    error,
    schema,
    settings: hydrated.settings,
    markets: hydrated.markets,
    roles: hydrated.roles,
    supabase: supabaseStatus(),
  };
}

const baseHandler = async (event, context) => {
  try {
    await getContext(event, context, { requireAdmin: true });

    if (!hasSupabase()) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify(
          buildReadOnlyPayload('fallback', 'Rate Book storage is unavailable, so this module is in safe preview mode.', false)
        ),
      };
    }

    const supabase = getSupabase(event);
    const [rolesResult, marketsResult, ratesResult, settingsResult] = await Promise.all([
      supabase
        .from(RATE_BOOK_ROLE_TABLE)
        .select('*')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from(RATE_BOOK_MARKET_TABLE)
        .select('*')
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
        readOnly: false,
        source: 'supabase',
        schema: false,
        settings: hydrated.settings,
        markets: hydrated.markets,
        roles: hydrated.roles,
        supabase: supabaseStatus(),
      }),
    };
  } catch (error) {
    const status = error?.code === 401 ? 401 : error?.code === 403 ? 403 : 200;
    const schemaIssue = isMissingTableError(error, RATE_BOOK_ROLE_TABLE)
      || isMissingTableError(error, RATE_BOOK_MARKET_TABLE)
      || isMissingTableError(error, RATE_BOOK_RATE_TABLE)
      || isMissingTableError(error, RATE_BOOK_SETTINGS_TABLE);

    return {
      statusCode: status,
      headers: HEADERS,
      body: JSON.stringify(
        status === 200
          ? buildReadOnlyPayload(
            schemaIssue ? 'setup-required' : 'fallback-error',
            schemaIssue
              ? 'The Rate Book tables are not available on this environment yet, so the module is running in seeded preview mode.'
              : (error?.message || 'Rate Book data unavailable'),
            schemaIssue
          )
          : {
            ok: false,
            readOnly: true,
            source: 'unauthorized',
            error: error?.message || 'Unauthorized',
            schema: schemaIssue,
            supabase: supabaseStatus(),
          }
      ),
    };
  }
};

exports.handler = withAdminCors(baseHandler);
