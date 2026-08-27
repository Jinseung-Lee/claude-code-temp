-- 멀티플레이 방 상태를 서버 프로세스 메모리 대신 여기에 보관한다.
-- 서버 재시작이나 요청이 다른 인스턴스로 가는 경우에도 진행 중인 방이
-- 사라지지 않게 하는 것이 목적이다.
create table if not exists public.game_rooms (
  code text primary key,
  -- lib/game/types.ts의 Room 구조를 그대로 담는다. 시각 필드는 epoch 밀리초 정수다.
  state jsonb not null,
  -- 낙관적 락용. 갱신할 때마다 1씩 올리고, 기대한 값과 다르면 쓰기가 실패한다.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 오래된 방을 정리할 때 쓴다.
create index if not exists game_rooms_updated_at_idx on public.game_rooms (updated_at);

-- 익명 참가자는 클라이언트에서 이 테이블을 직접 건드리지 않는다. 접근은
-- 서버 라우트 핸들러가 secret key로만 한다. RLS를 켜고 정책을 두지 않아
-- anon/publishable 키로는 아무것도 할 수 없게 한다.
alter table public.game_rooms enable row level security;
