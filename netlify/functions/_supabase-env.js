const SUPABASE_URL_KEYS = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
];

const SUPABASE_SERVICE_KEY_KEYS = [
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
];

const SUPABASE_ANON_KEY_KEYS = [
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
];

function resolveEnvVar(names) {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return { value, source: name };
  }
  return { value: '', source: null };
}

function resolveSupabaseUrl() {
  return resolveEnvVar(SUPABASE_URL_KEYS);
}

function resolveSupabaseServiceKey() {
  return resolveEnvVar(SUPABASE_SERVICE_KEY_KEYS);
}

function resolveSupabaseAnonKey() {
  return resolveEnvVar(SUPABASE_ANON_KEY_KEYS);
}

function getSupabaseUrl() {
  return resolveSupabaseUrl().value;
}

function getSupabaseServiceKey() {
  return resolveSupabaseServiceKey().value;
}

function getSupabaseAnonKey() {
  return resolveSupabaseAnonKey().value;
}

module.exports = {
  SUPABASE_URL_KEYS,
  SUPABASE_SERVICE_KEY_KEYS,
  SUPABASE_ANON_KEY_KEYS,
  resolveEnvVar,
  resolveSupabaseUrl,
  resolveSupabaseServiceKey,
  resolveSupabaseAnonKey,
  getSupabaseUrl,
  getSupabaseServiceKey,
  getSupabaseAnonKey,
};
