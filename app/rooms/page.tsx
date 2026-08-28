"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, PlusIcon, RefreshCwIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DIFFICULTY_LABEL, type RoomPhase, type RoomSummary } from "@/lib/game/types";

/** 방 목록은 자주 바뀌지 않으니 방 안(2초)보다 느슨하게 갱신한다. */
const POLL_MS = 5000;

const PHASE_LABEL: Record<RoomPhase, string> = {
  lobby: "대기 중",
  round_active: "게임 중",
  round_result: "게임 중",
  finished: "종료",
  disbanded: "해체됨",
};

export default function RoomListPage() {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "방 목록을 불러오지 못했습니다.");
        return;
      }
      setError(null);
      setRooms(data.rooms as RoomSummary[]);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    }
  }, []);

  useEffect(() => {
    // 첫 조회를 다음 틱으로 미뤄, effect가 실행되는 도중에 setState가
    // 일어나지 않게 한다(react-hooks/set-state-in-effect).
    const first = setTimeout(fetchRooms, 0);
    const timer = setInterval(fetchRooms, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [fetchRooms]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">멀티모드 방 목록</h1>
          <p className="text-sm text-muted-foreground">
            대기 중인 방에 들어가거나 새 방을 만들어 보세요.
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchRooms} aria-label="목록 새로고침">
          <RefreshCwIcon />
        </Button>
      </div>

      <Button render={<Link href="/rooms/new" />} nativeButton={false} className="w-full">
        <PlusIcon data-icon="inline-start" />
        방 만들기
      </Button>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rooms === null ? (
        <p className="text-sm text-muted-foreground">방 목록을 불러오는 중입니다…</p>
      ) : rooms.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <UsersIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">아직 만들어진 방이 없습니다</p>
            <p className="text-sm text-muted-foreground">
              첫 방을 만들어 친구를 기다려 보세요.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rooms.map((room) => (
            <li key={room.code}>
              <Card className={room.joinable ? "transition-colors hover:border-primary/50" : "opacity-70"}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{room.hostNickname}님의 방</CardTitle>
                    <Badge variant={room.joinable ? "default" : "secondary"}>
                      {PHASE_LABEL[room.phase]}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {room.playerCount}/{room.maxPlayers}인
                    {room.category
                      ? ` · ${room.category} · ${room.difficulty ? DIFFICULTY_LABEL[room.difficulty] : ""}난이도`
                      : ""}
                    {" · "}
                    <span className="font-mono">{room.code}</span>
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  {room.players.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        {room.phase === "lobby" ? "참가자" : "참가자 및 순위"}
                      </span>
                      <ul className="flex flex-col gap-1">
                        {room.players.map((p, index) => (
                          <li
                            key={`${p.nickname}-${index}`}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="flex items-center gap-1.5">
                              {p.rank !== null && (
                                <Badge variant={p.rank === 1 ? "default" : "outline"}>
                                  {p.rank}위
                                </Badge>
                              )}
                              {p.nickname}
                              {p.isHost && <Badge variant="secondary">방장</Badge>}
                            </span>
                            {p.rank !== null && (
                              <span className="text-muted-foreground">{p.roundWins}승</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {room.joinable ? (
                    <Button
                      render={<Link href={`/rooms/${room.code}`} />}
                      nativeButton={false}
                      className="w-full"
                      variant="secondary"
                    >
                      들어가기
                      <ArrowRightIcon data-icon="inline-end" />
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {room.phase === "lobby"
                        ? "인원이 가득 차 들어갈 수 없습니다."
                        : "이미 게임이 시작되어 들어갈 수 없습니다."}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
