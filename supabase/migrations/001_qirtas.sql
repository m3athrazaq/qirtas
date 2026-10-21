-- قِرطاس — database schema for accounts, sync, sharing and the writing assistant.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: every statement checks before it creates.

-- ---------------------------------------------------------------- tables
create table if not exists public.workspaces (
  id uuid primary key,
  name text not null default '',
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  display_name text,
  email text,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists members_user on public.members (user_id);

create table if not exists public.invites (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  workspace_id uuid not null references public.workspaces on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);

-- Every change to every page is a small Yjs update; clients replay them in order.
create table if not exists public.doc_updates (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  doc_id text not null,
  data text not null,
  client_id text,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists doc_updates_ws_id on public.doc_updates (workspace_id, id);
create index if not exists doc_updates_doc on public.doc_updates (workspace_id, doc_id, id);

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  month text not null,
  count int not null default 0,
  primary key (user_id, month)
);

-- ---------------------------------------------------------------- helpers
-- The caller's role in a workspace (null when not a member).
create or replace function public.ws_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where workspace_id = ws and user_id = auth.uid()
$$;

-- Same, for a storage path that starts with the workspace id ("<workspace>/<file>").
create or replace function public.ws_role_path(path text) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members
  where user_id = auth.uid() and workspace_id::text = split_part(path, '/', 1)
$$;

-- Every workspace the caller belongs to.
create or replace function public.my_workspaces() returns setof uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from public.members where user_id = auth.uid()
$$;

create or replace function public.create_workspace(ws uuid, ws_name text, my_name text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.workspaces (id, name, owner_id) values (ws, coalesce(ws_name, ''), auth.uid())
  on conflict (id) do nothing;
  if not exists (select 1 from public.workspaces where id = ws and owner_id = auth.uid()) then
    raise exception 'workspace belongs to someone else';
  end if;
  insert into public.members (workspace_id, user_id, role, display_name, email)
  values (ws, auth.uid(), 'owner', my_name, (select email from auth.users where id = auth.uid()))
  on conflict (workspace_id, user_id) do nothing;
end $$;

create or replace function public.invite_info(invite_token text)
returns table (workspace_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, i.role
  from public.invites i join public.workspaces w on w.id = i.workspace_id
  where i.token = invite_token and not i.revoked
$$;

create or replace function public.accept_invite(invite_token text, my_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.invites where token = invite_token and not revoked;
  if inv.token is null then raise exception 'invalid invite'; end if;
  insert into public.members (workspace_id, user_id, role, display_name, email)
  values (inv.workspace_id, auth.uid(), inv.role, my_name, (select email from auth.users where id = auth.uid()))
  on conflict (workspace_id, user_id) do update
    set role = case when public.members.role = 'owner' then 'owner' else excluded.role end,
        display_name = coalesce(excluded.display_name, public.members.display_name);
  return inv.workspace_id;
end $$;

-- Replace a document's history with one merged update (keeps downloads small).
create or replace function public.compact_doc(ws uuid, doc text, upto bigint, merged text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.ws_role(ws), '') not in ('owner', 'editor') then raise exception 'forbidden'; end if;
  insert into public.doc_updates (workspace_id, doc_id, data, client_id) values (ws, doc, merged, 'compact');
  delete from public.doc_updates where workspace_id = ws and doc_id = doc and id <= upto;
end $$;

-- Counts one use of the writing assistant this month and returns the running total.
create or replace function public.ai_count_use() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.ai_usage (user_id, month, count)
  values (auth.uid(), to_char(now() at time zone 'utc', 'YYYY-MM'), 1)
  on conflict (user_id, month) do update set count = public.ai_usage.count + 1
  returning count into n;
  return n;
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.workspaces where owner_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- row level security
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.doc_updates enable row level security;
alter table public.ai_usage enable row level security;

-- Only these columns can be changed directly; everything else goes through the functions above.
revoke update on public.workspaces from anon, authenticated;
grant update (name) on public.workspaces to authenticated;
revoke update on public.members from anon, authenticated;
grant update (role) on public.members to authenticated;
revoke update on public.invites from anon, authenticated;
grant update (revoked) on public.invites to authenticated;
revoke update, delete on public.doc_updates from anon, authenticated;
revoke insert, update, delete on public.ai_usage from anon, authenticated;

drop policy if exists ws_select on public.workspaces;
create policy ws_select on public.workspaces for select using (id in (select public.my_workspaces()));
drop policy if exists ws_update on public.workspaces;
create policy ws_update on public.workspaces for update
  using (public.ws_role(id) = 'owner') with check (public.ws_role(id) = 'owner');
drop policy if exists ws_delete on public.workspaces;
create policy ws_delete on public.workspaces for delete using (public.ws_role(id) = 'owner');

drop policy if exists m_select on public.members;
create policy m_select on public.members for select using (workspace_id in (select public.my_workspaces()));
drop policy if exists m_update on public.members;
create policy m_update on public.members for update
  using (public.ws_role(workspace_id) = 'owner' and role <> 'owner')
  with check (public.ws_role(workspace_id) = 'owner' and role in ('editor', 'viewer'));
drop policy if exists m_delete on public.members;
create policy m_delete on public.members for delete
  using (role <> 'owner' and (user_id = auth.uid() or public.ws_role(workspace_id) = 'owner'));

drop policy if exists i_select on public.invites;
create policy i_select on public.invites for select using (public.ws_role(workspace_id) = 'owner');
drop policy if exists i_insert on public.invites;
create policy i_insert on public.invites for insert
  with check (public.ws_role(workspace_id) = 'owner' and created_by = auth.uid());
drop policy if exists i_update on public.invites;
create policy i_update on public.invites for update
  using (public.ws_role(workspace_id) = 'owner') with check (public.ws_role(workspace_id) = 'owner');

drop policy if exists d_select on public.doc_updates;
create policy d_select on public.doc_updates for select using (workspace_id in (select public.my_workspaces()));
drop policy if exists d_insert on public.doc_updates;
create policy d_insert on public.doc_updates for insert
  with check (public.ws_role(workspace_id) in ('owner', 'editor') and created_by = auth.uid());

drop policy if exists a_select on public.ai_usage;
create policy a_select on public.ai_usage for select using (user_id = auth.uid());

-- ---------------------------------------------------------------- realtime
do $$ begin
  alter publication supabase_realtime add table public.doc_updates;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.members;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 10485760, array['image/*'])
on conflict (id) do nothing;

drop policy if exists "qirtas assets read" on storage.objects;
create policy "qirtas assets read" on storage.objects for select
  using (bucket_id = 'assets' and public.ws_role_path(name) is not null);
drop policy if exists "qirtas assets write" on storage.objects;
create policy "qirtas assets write" on storage.objects for insert
  with check (bucket_id = 'assets' and public.ws_role_path(name) in ('owner', 'editor'));
drop policy if exists "qirtas assets update" on storage.objects;
create policy "qirtas assets update" on storage.objects for update
  using (bucket_id = 'assets' and public.ws_role_path(name) in ('owner', 'editor'));
