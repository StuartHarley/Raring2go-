-- Raring2go! starter schema skeleton. This is intentionally a baseline, not a substitute for migrations.
create extension if not exists pgcrypto;

create table organisations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hq','franchise','advertiser')),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table territories (
  id uuid primary key default gen_random_uuid(),
  franchise_organisation_id uuid references organisations(id),
  code text not null unique,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system boolean not null default false
);

create table permissions (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  action text not null,
  unique(module, action)
);

create table role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  scope text not null,
  constraints jsonb not null default '{}'::jsonb,
  primary key(role_id, permission_id, scope)
);

create table user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id),
  organisation_id uuid references organisations(id),
  territory_id uuid references territories(id),
  starts_at timestamptz,
  ends_at timestamptz
);

create table franchises (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references organisations(id),
  status text not null,
  commencement_date date,
  expiry_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table franchise_agreements (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references franchises(id),
  status text not null,
  current_version_id uuid,
  commencement_date date,
  expiry_date date,
  notice_date date,
  fee_terms jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table franchise_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references franchise_agreements(id) on delete cascade,
  version_no integer not null,
  template_version text not null,
  merge_data jsonb not null default '{}'::jsonb,
  document_asset_id uuid,
  signed_asset_id uuid,
  status text not null,
  created_at timestamptz not null default now(),
  unique(agreement_id, version_no)
);

create table advertisers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null unique references organisations(id),
  owning_territory_id uuid references territories(id),
  status text not null default 'prospect',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertisers(id),
  territory_id uuid not null references territories(id),
  stage text not null,
  value_minor bigint,
  currency char(3) not null default 'GBP',
  next_action_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertisers(id),
  territory_id uuid not null references territories(id),
  opportunity_id uuid references opportunities(id),
  status text not null,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  advertiser_id uuid not null references advertisers(id),
  territory_id uuid not null references territories(id),
  campaign_id uuid references campaigns(id),
  invoice_number text not null unique,
  status text not null,
  currency char(3) not null default 'GBP',
  subtotal_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  due_on date,
  created_at timestamptz not null default now()
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year integer not null,
  unique(name, year)
);

create table master_editions (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id),
  name text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table territory_editions (
  id uuid primary key default gen_random_uuid(),
  master_edition_id uuid not null references master_editions(id),
  territory_id uuid not null references territories(id),
  status text not null,
  print_status text not null default 'draft',
  digital_status text not null default 'draft',
  publication_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(master_edition_id, territory_id)
);

create table page_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create table template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references page_templates(id),
  version_no integer not null,
  status text not null,
  definition jsonb not null,
  published_at timestamptz,
  unique(template_id, version_no)
);

create table edition_pages (
  id uuid primary key default gen_random_uuid(),
  territory_edition_id uuid not null references territory_editions(id) on delete cascade,
  page_number integer not null,
  template_version_id uuid references template_versions(id),
  inheritance_state text not null default 'local',
  master_page_key text,
  status text not null default 'draft',
  content_state jsonb not null default '{}'::jsonb,
  unique(territory_edition_id, page_number)
);

create table audience_profiles (
  id uuid primary key default gen_random_uuid(),
  email text,
  home_territory_id uuid references territories(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table consent_events (
  id uuid primary key default gen_random_uuid(),
  audience_profile_id uuid not null references audience_profiles(id),
  purpose text not null,
  action text not null,
  source text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table email_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_organisation_id uuid references organisations(id),
  territory_id uuid references territories(id),
  kind text not null,
  status text not null,
  subject text,
  definition jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  source_type text not null,
  source_id uuid not null,
  status text not null,
  idempotency_key text not null unique,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  purpose text not null,
  source_type text,
  source_id uuid,
  actor_user_id uuid references users(id),
  status text not null,
  context_refs jsonb not null default '[]'::jsonb,
  output jsonb,
  approval_status text,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  territory_id uuid references territories(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
