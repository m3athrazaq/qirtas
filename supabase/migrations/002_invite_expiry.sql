-- قِرطاس — invitation links expire (security update, 2026-10-26).
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste → Run. Safe to run again.
--
-- Until now a link worked forever, for anyone who had it. From now on a link stops working
-- 14 days after it was created (create a new one from the share window when needed).
-- The app also cancels the old links whenever the owner removes a member.

alter table public.invites add column if not exists expires_at timestamptz;
update public.invites set expires_at = created_at + interval '14 days' where expires_at is null;
alter table public.invites alter column expires_at set default (now() + interval '14 days');

create or replace function public.invite_info(invite_token text)
returns table (workspace_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select w.id, w.name, i.role
  from public.invites i join public.workspaces w on w.id = i.workspace_id
  where i.token = invite_token and not i.revoked and (i.expires_at is null or i.expires_at > now())
$$;

create or replace function public.accept_invite(invite_token text, my_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from public.invites
  where token = invite_token and not revoked and (expires_at is null or expires_at > now());
  if inv.token is null then raise exception 'invalid invite'; end if;
  insert into public.members (workspace_id, user_id, role, display_name, email)
  values (inv.workspace_id, auth.uid(), inv.role, my_name, (select email from auth.users where id = auth.uid()))
  on conflict (workspace_id, user_id) do update
    set role = case when public.members.role = 'owner' then 'owner' else excluded.role end,
        display_name = coalesce(excluded.display_name, public.members.display_name);
  return inv.workspace_id;
end $$;
