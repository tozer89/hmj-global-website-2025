alter table if exists public.credit_limit_checker_leads
  add column if not exists company_structure text,
  add column if not exists payment_terms_band text,
  add column if not exists accounts_status text;
