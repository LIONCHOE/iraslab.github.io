begin;
create schema if not exists iras_private;
revoke all on schema iras_private from public, anon, authenticated;
create table iras_private.organizers (uid uuid primary key references auth.users(id));
create table public.league_meetings (
  id text primary key, session jsonb not null, closed boolean not null default false,
  revision integer not null default 0, created_at timestamptz not null default now()
);
create table iras_private.hosts (
  meeting text primary key references public.league_meetings(id), owner_id uuid not null,
  code text not null
);
create table iras_private.writers (
  meeting text references public.league_meetings(id), uid uuid not null, primary key(meeting,uid)
);
alter table public.league_meetings enable row level security;
revoke all on public.league_meetings from public,anon,authenticated;
grant select on public.league_meetings to anon,authenticated;
create policy published_meetings on public.league_meetings for select using(true);

create function public.league_open(s jsonb, entry_code text) returns text
language plpgsql security definer set search_path='' as $$
declare mid text := s->>'id';
begin
  if not exists(select 1 from iras_private.organizers where uid=auth.uid()) then raise exception '관리자 권한이 필요합니다'; end if;
  if mid is null or mid !~ '^meet-[a-zA-Z0-9-]{1,74}$' or entry_code is null or entry_code !~ '^[0-9a-f]{16}$'
    or octet_length(s::text)>120000 or jsonb_array_length(s->'matches') not between 1 and 21 then raise exception '모임 형식을 확인하세요'; end if;
  if exists(select 1 from iras_private.hosts where meeting=mid and owner_id=auth.uid()) then return mid; end if;
  insert into public.league_meetings(id,session) values(mid,s);
  insert into iras_private.hosts values(mid,auth.uid(),entry_code);
  return mid;
end $$;

create function public.league_host_code(mid text) returns text language sql stable security definer set search_path='' as $$
  select code from iras_private.hosts where meeting=mid and owner_id=auth.uid()
$$;
create function public.league_join(mid text, entry_code text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from iras_private.hosts h join public.league_meetings m on m.id=h.meeting
    where h.meeting=mid and not m.closed and h.code=lower(trim(entry_code))) then raise exception '모임 코드와 마감 여부를 확인하세요'; end if;
  insert into iras_private.writers values(mid,auth.uid()) on conflict do nothing;
end $$;

create function public.league_score(mid text, game text, a integer, b integer, expected integer)
returns void language plpgsql security definer set search_path='' as $$
declare rowdata public.league_meetings; idx integer; m jsonb; hi integer:=greatest(a,b); lo integer:=least(a,b);
begin
  if not exists(select 1 from iras_private.writers where meeting=mid and uid=auth.uid())
     and not exists(select 1 from iras_private.hosts where meeting=mid and owner_id=auth.uid()) then raise exception '모임 코드를 입력하세요'; end if;
  if a is null or b is null or lo<0 or not ((hi=21 and lo<=19) or (hi between 22 and 29 and hi-lo=2) or (hi=30 and lo in (28,29))) then raise exception '최종 점수를 확인하세요'; end if;
  select * into strict rowdata from public.league_meetings where id=mid for update;
  if rowdata.closed then raise exception '마감된 모임입니다'; end if;
  select (ord-1)::integer,v into strict idx,m from jsonb_array_elements(rowdata.session->'matches') with ordinality as x(v,ord) where v->>'id'=game;
  if expected is distinct from coalesce((m->>'version')::integer,0) then raise exception '다른 기기에서 변경했습니다. 최신 점수를 확인하고 다시 입력하세요'; end if;
  m:=m || jsonb_build_object('result',jsonb_build_array(a,b),'finished',true,'lineups',null,'events','[]'::jsonb,'version',expected+1);
  update public.league_meetings set session=jsonb_set(session,array['matches',idx::text],m),revision=revision+1 where id=mid;
end $$;
create function public.league_close(mid text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from iras_private.hosts where meeting=mid and owner_id=auth.uid()) then raise exception '개설자만 마감할 수 있습니다'; end if;
  perform 1 from public.league_meetings where id=mid for update;
  if exists(select 1 from public.league_meetings m,jsonb_array_elements(m.session->'matches') v where m.id=mid and (v->>'finished')::boolean is not true) then raise exception '모든 경기 결과를 입력하세요'; end if;
  update public.league_meetings set closed=true,revision=revision+1 where id=mid and not closed;
end $$;
do $$ declare f regprocedure; begin
  foreach f in array array['public.league_open(jsonb,text)'::regprocedure,'public.league_host_code(text)'::regprocedure,'public.league_join(text,text)'::regprocedure,'public.league_score(text,text,integer,integer,integer)'::regprocedure,'public.league_close(text)'::regprocedure] loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
end $$;
alter publication supabase_realtime add table public.league_meetings;
commit;
