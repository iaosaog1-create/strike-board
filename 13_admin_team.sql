-- 13_admin_team.sql : 소속팀에 '행정' 추가 + master가 가입 승인 때 소속·직책·소속팀 수정
-- 비정상상황 앱 전용 Supabase 프로젝트에서 한 번 실행 (여러 번 실행해도 안전)

-- A) 소속 팀 허용값: 1팀~10팀 또는 행정
alter table public.profiles drop constraint if exists profiles_plan_team_chk;
alter table public.profiles add constraint profiles_plan_team_chk
  check (plan_team is null or plan_team ~ '^([0-9]{1,2}팀|행정)$');

-- B) 가입 신청 함수: '행정' 허용
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_emp   text := btrim(new.raw_user_meta_data ->> 'emp_no');
  v_name  text := btrim(new.raw_user_meta_data ->> 'name');
  v_div   int  := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'division_id', '')), '')::int;
  v_title text := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'req_title'), ''), '팀장');
  v_team  text := nullif(btrim(new.raw_user_meta_data ->> 'team'), '');
  v_plan  text := nullif(btrim(new.raw_user_meta_data ->> 'plan_team'), '');
begin
  if coalesce(v_emp, '') = '' or coalesce(v_name, '') = '' then
    raise exception '사번과 이름은 필수입니다';
  end if;
  if v_title not in ('관리','팀장','총괄팀장') then
    raise exception '올바른 직책이 아닙니다';
  end if;
  if v_div is not null and not exists (select 1 from public.divisions where id = v_div) then
    raise exception '올바른 소속이 아닙니다';
  end if;
  if v_title <> '관리' and not exists (select 1 from public.divisions where id = v_div and kind = '사업부') then
    raise exception '팀장·총괄팀장은 사업부 소속이어야 합니다';
  end if;
  if v_team is not null and not exists (select 1 from public.shift_defs where code = v_team) then
    raise exception '올바른 근무조가 아닙니다';
  end if;
  if v_plan is not null and v_plan !~ '^([0-9]{1,2}팀|행정)$' then
    raise exception '올바른 소속 팀이 아닙니다';
  end if;
  if v_title = '팀장' and v_plan is null then
    raise exception '팀장은 소속 팀(1팀~10팀, 행정)을 선택해야 합니다';
  end if;
  insert into public.profiles (id, emp_no, name, division_id, req_title, team, plan_team)
  values (new.id, v_emp, v_name, v_div, v_title, v_team, v_plan);
  return new;
end $$;

-- C) 가입 승인: master가 소속(p_division)·직책(p_title)·소속팀(p_plan_team)을 함께 수정
drop function if exists public.review_member(uuid, boolean, text, text, text);
create or replace function public.review_member(
  p_user uuid, p_approve boolean, p_role text default 'leader', p_team text default null, p_plan_team text default null,
  p_division int default null, p_title text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_div int;
begin
  if not public.is_owner() then
    raise exception '가입 승인은 관리자(master)만 할 수 있습니다';
  end if;
  if p_approve and p_role not in ('admin','chief','leader') then
    raise exception '지정할 수 있는 권한은 admin, chief, leader 입니다';
  end if;
  if p_team is not null and not exists (select 1 from public.shift_defs where code = p_team) then
    raise exception '올바른 근무조가 아닙니다';
  end if;
  if p_plan_team is not null and p_plan_team !~ '^([0-9]{1,2}팀|행정)$' then
    raise exception '올바른 팀이 아닙니다';
  end if;
  if p_title is not null and p_title not in ('관리','팀장','총괄팀장') then
    raise exception '올바른 직책이 아닙니다';
  end if;
  if p_division is not null and not exists (select 1 from public.divisions where id = p_division) then
    raise exception '올바른 소속이 아닙니다';
  end if;
  select coalesce(p_division, division_id) into v_div from public.profiles where id = p_user;
  if p_approve and p_role = 'leader' and coalesce(p_plan_team, (select plan_team from public.profiles where id = p_user)) is null then
    raise exception '팀장은 소속 팀(1팀~10팀, 행정)을 지정해야 합니다';
  end if;
  if p_approve and p_role in ('chief','leader') then
    if not exists (select 1 from public.divisions where id = v_div and kind = '사업부') then
      raise exception '팀장·총괄팀장은 사업부 소속이어야 합니다';
    end if;
  end if;
  update public.profiles
     set status      = case when p_approve then 'approved' else 'rejected' end,
         role        = case when p_approve then p_role else role end,
         team        = case when p_approve then coalesce(p_team, team) else team end,
         plan_team   = case when p_approve then coalesce(p_plan_team, plan_team) else plan_team end,
         division_id = case when p_approve then v_div else division_id end,
         req_title   = case when p_approve then coalesce(p_title, req_title) else req_title end,
         approved_at = now(),
         approved_by = auth.uid()
   where id = p_user and role <> 'master';
end $$;
revoke all on function public.review_member(uuid, boolean, text, text, text, int, text) from public, anon;
grant execute on function public.review_member(uuid, boolean, text, text, text, int, text) to authenticated;
