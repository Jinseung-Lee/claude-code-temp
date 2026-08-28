-- 싱글모드 플레이 기록을 서버 프로세스 메모리 대신 여기에 보관한다.
-- 순위 진입 여부와 무관하게 모든 플레이 기록을 남기는 것이 목적이다.
create table if not exists public.single_scores (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  category text not null,
  -- easy | medium | hard. lib/game/chosung.ts의 Difficulty와 같다.
  difficulty text not null,
  -- 선택한 카테고리의 문제를 모두 클리어했는지. 순위 정렬의 1차 기준이다.
  cleared_all boolean not null default false,
  -- 모두 클리어한 경우의 소요 시간(밀리초). 못 채우면 null이다.
  elapsed_ms integer,
  cleared_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- 전체 순위는 최신순으로 읽어 상한만큼 자른다.
create index if not exists single_scores_created_at_idx
  on public.single_scores (created_at desc);

-- 익명 참가자는 클라이언트에서 이 테이블을 직접 건드리지 않는다. 접근은
-- 서버 라우트 핸들러가 secret key로만 한다. RLS를 켜고 정책을 두지 않아
-- anon/publishable 키로는 아무것도 할 수 없게 한다.
alter table public.single_scores enable row level security;
