begin;

lock table iras_private.organizers in access exclusive mode;
do $$
begin
  if (select count(*) from iras_private.organizers) <> 1 then
    raise exception '기존 개설자가 정확히 한 명이어야 합니다. 개설자 목록을 확인하세요.';
  end if;
  if not exists (
    select 1 from iras_private.organizers o join auth.users u on u.id = o.uid
    where not u.is_anonymous and u.email is not null
  ) then
    raise exception '이메일로 로그인할 수 있는 기존 개설자를 확인하세요.';
  end if;
end $$;

create unique index if not exists league_one_organizer on iras_private.organizers ((true));
alter table iras_private.organizers add column if not exists login_alias text
  check (login_alias ~ '^[a-z][a-z0-9_]{2,23}$');

create or replace function public.league_organizer_profile()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('alias', login_alias)
  from iras_private.organizers where uid = auth.uid()
$$;

create or replace function public.league_register_alias(requested_alias text)
returns text language plpgsql security definer set search_path = '' as $$
declare normalized text := lower(trim(requested_alias));
begin
  if normalized is null or normalized !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception '아이디는 영문자로 시작하는 영문, 숫자, 밑줄 3~24자로 입력하세요.';
  end if;
  update iras_private.organizers set login_alias = normalized
    where uid = auth.uid() and (login_alias is null or login_alias = normalized);
  if not found then
    raise exception '기존 개설자만 최초 한 번 아이디를 등록할 수 있습니다.';
  end if;
  return normalized;
end $$;

-- Only the login function on the server can resolve a login ID to an email.
create or replace function public.league_resolve_alias(requested_alias text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from iras_private.organizers o
  join auth.users u on u.id = o.uid
  where o.login_alias = requested_alias and not u.is_anonymous
$$;

revoke all on function public.league_organizer_profile(), public.league_register_alias(text),
  public.league_resolve_alias(text) from public, anon, authenticated, service_role;
grant execute on function public.league_organizer_profile(), public.league_register_alias(text) to authenticated;
grant execute on function public.league_resolve_alias(text) to service_role;
commit;
