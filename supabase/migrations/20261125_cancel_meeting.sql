begin;
create or replace function public.league_cancel(mid text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  is_closed boolean;
begin
  select m.closed into is_closed from public.league_meetings m
    join iras_private.hosts h on h.meeting = m.id
    join iras_private.organizers o on o.uid = h.owner_id
    where m.id = mid and o.uid = auth.uid() for update of m, h;
  if not found then
    raise exception '진행 중인 모임의 개설자만 취소할 수 있습니다.';
  end if;
  if is_closed then
    raise exception '마감된 모임은 취소할 수 없습니다.';
  end if;
  delete from iras_private.writers where meeting = mid;
  delete from iras_private.hosts where meeting = mid;
  delete from public.league_meetings where id = mid;
end;
$$;
revoke all on function public.league_cancel(text) from public, anon, authenticated;
grant execute on function public.league_cancel(text) to authenticated;
commit;
