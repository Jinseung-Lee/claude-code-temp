"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ShuffleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { getStoredPlayerId, storePlayerId } from "@/lib/game/client-storage";
import { CATEGORIES, type Category } from "@/lib/game/questions";
import { rankByScore } from "@/lib/game/ranking";
import { generateRandomNickname } from "@/lib/game/random-nickname";
import type { ClientRoomView, Difficulty, ItemType } from "@/lib/game/types";

const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "하", medium: "중", hard: "상" };
const EFFECT_LABEL: Record<string, string> = {
  delay: "3초 지연",
  hide_syllable: "초성 가림",
  reverse_input: "거꾸로 입력",
};

const POLL_MS = 700;

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? "").toUpperCase();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const [room, setRoom] = useState<ClientRoomView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [wrongFlash, setWrongFlash] = useState(false);
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [targetingItemType, setTargetingItemType] = useState<ItemType | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const answeredRoundRef = useRef<number | null>(null);

  useEffect(() => {
    // sessionStorage는 클라이언트에서만 읽을 수 있어(서버-클라이언트 하이드레이션 불일치를
    // 피하려고) 마운트 후 한 번 동기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayerId(getStoredPlayerId(code));
    setHydrated(true);
  }, [code]);

  const fetchRoom = useCallback(async () => {
    if (!playerId) return;
    const res = await fetch(`/api/rooms/${code}?playerId=${playerId}`);
    const data = await res.json();
    if (!res.ok) {
      setFetchError(data.error ?? "방 정보를 불러오지 못했습니다.");
      return;
    }
    setFetchError(null);
    setClockOffset(data.serverTime - Date.now());
    setRoom(data as ClientRoomView);
  }, [code, playerId]);

  useEffect(() => {
    if (!playerId) return;
    // 방 상태는 실시간 서버 푸시 없이 짧은 주기로 폴링해 동기화한다(이 프로젝트 규모에 맞춘 단순화).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRoom();
    const timer = setInterval(fetchRoom, POLL_MS);
    return () => clearInterval(timer);
  }, [playerId, fetchRoom]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (room?.round?.index !== undefined && answeredRoundRef.current !== room.round.index) {
      setAnswer("");
      setTargetingItemType(null);
      answeredRoundRef.current = null;
    }
  }, [room?.round?.index]);

  async function join() {
    if (!nickname.trim()) {
      setJoinError("닉네임을 입력해 주세요.");
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error ?? "참여하지 못했습니다.");
        return;
      }
      storePlayerId(code, data.playerId);
      setPlayerId(data.playerId);
    } catch {
      setJoinError("네트워크 오류가 발생했습니다.");
    } finally {
      setJoining(false);
    }
  }

  async function startGame() {
    if (!playerId) return;
    const res = await fetch(`/api/rooms/${code}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: playerId, category, difficulty }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "게임을 시작하지 못했습니다.");
    else fetchRoom();
  }

  async function submitAnswer() {
    if (!playerId || !answer.trim() || !room?.round) return;
    answeredRoundRef.current = room.round.index;
    const res = await fetch(`/api/rooms/${code}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, text: answer }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "제출하지 못했습니다.");
      return;
    }
    if (!data.correct) {
      toast.warning("오답이에요, 다시 시도해 보세요.");
      setAnswer("");
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 400);
    }
    fetchRoom();
  }

  async function activateItem(itemId: string, targetId?: string) {
    if (!playerId) return;
    const res = await fetch(`/api/rooms/${code}/item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, itemId, targetId }),
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "아이템을 사용하지 못했습니다.");
    setTargetingItemType(null);
    fetchRoom();
  }

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/rooms/${code}` : "";

  if (!hydrated) return null;

  if (!playerId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>방 {code} 참여하기</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nickname">닉네임</Label>
              <div className="flex gap-2">
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                  placeholder="내 닉네임"
                  maxLength={12}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="랜덤 닉네임"
                  onClick={() => setNickname(generateRandomNickname())}
                >
                  <ShuffleIcon />
                </Button>
              </div>
            </div>
            {joinError && <p className="text-sm text-destructive">{joinError}</p>}
            <Button onClick={join} disabled={joining}>
              {joining ? "참여하는 중..." : "참여하기"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16">
        <p className="text-destructive">{fetchError}</p>
        <Button render={<Link href="/" />} nativeButton={false}>
          홈으로
        </Button>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-16 text-muted-foreground">
        불러오는 중...
      </div>
    );
  }

  const isHost = room.hostId === playerId;
  const me = room.players.find((p) => p.isSelf);
  const liveRanking = rankByScore(
    room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      isSelf: p.isSelf,
      roundWins: p.roundWins,
      averageAnswerMs: p.averageAnswerMs,
    })),
  );

  const groupedItems = (me?.items ?? []).reduce<
    { type: ItemType; name: string; description: string; kind: string; count: number; instanceIds: string[] }[]
  >((groups, item) => {
    const group = groups.find((g) => g.type === item.type);
    if (group) {
      group.count += 1;
      group.instanceIds.push(item.id);
    } else {
      groups.push({
        type: item.type,
        name: item.name,
        description: item.description,
        kind: item.kind,
        count: 1,
        instanceIds: [item.id],
      });
    }
    return groups;
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">방 {room.code}</h1>
        {room.phase !== "finished" && (
          <Badge variant="outline">
            라운드 {room.round ? room.round.index + 1 : 0} / {room.totalRounds}
          </Badge>
        )}
      </div>

      {room.phase === "lobby" && (
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <CardTitle>대기실</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>공유 URL</Label>
              <div className="flex gap-2">
                <Input value={shareUrl} readOnly onFocus={(e) => e.currentTarget.select()} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(shareUrl).catch(() => {});
                    toast.success("URL을 복사했어요.");
                  }}
                >
                  복사
                </Button>
              </div>
            </div>

            <div>
              <Label>참가자 ({room.players.length}명)</Label>
              <ul className="mt-2 flex flex-col gap-1">
                {room.players.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <span>{p.nickname}</span>
                    {p.isHost && <Badge variant="secondary">방장</Badge>}
                    {p.isSelf && <Badge variant="outline">나</Badge>}
                  </li>
                ))}
              </ul>
            </div>

            {isHost ? (
              <>
                <Separator />
                <div className="flex flex-col gap-2">
                  <Label>카테고리</Label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((c) => (
                      <Button
                        key={c}
                        type="button"
                        size="sm"
                        variant={category === c ? "default" : "outline"}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>난이도</Label>
                  <div className="flex gap-2">
                    {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={difficulty === d ? "default" : "outline"}
                        onClick={() => setDifficulty(d)}
                      >
                        {DIFFICULTY_LABEL[d]}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button onClick={startGame} disabled={room.players.length < 2}>
                  {room.players.length < 2 ? "2명 이상 모여야 시작할 수 있어요" : "게임 시작"}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">방장이 게임을 시작하기를 기다리는 중...</p>
            )}
          </CardContent>
        </Card>
      )}

      {(room.phase === "round_active" || room.phase === "round_result") && room.round && (
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>
                  {room.round.category} · {DIFFICULTY_LABEL[room.round.difficulty]}난이도
                </CardTitle>
                {room.phase === "round_active" && (
                  <span className="text-sm text-muted-foreground">
                    {Math.max(
                      0,
                      Math.ceil(
                        (room.round.startedAt + room.round.durationMs - (now + clockOffset)) /
                          1000,
                      ),
                    )}
                    초
                  </span>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {room.phase === "round_active" && (
                  <Progress
                    value={
                      (Math.max(
                        0,
                        room.round.startedAt + room.round.durationMs - (now + clockOffset),
                      ) /
                        room.round.durationMs) *
                      100
                    }
                  />
                )}

                <div className="rounded-md border bg-muted/30 py-8 text-center text-4xl font-bold tracking-widest">
                  {room.phase === "round_result" ? room.round.answer : room.round.question}
                </div>

                {room.phase === "round_result" ? (
                  <p className="text-center text-sm text-muted-foreground">
                    {room.round.winnerId
                      ? `${room.players.find((p) => p.id === room.round?.winnerId)?.nickname ?? ""}님이 맞혔어요!`
                      : "아무도 맞히지 못했어요."}{" "}
                    잠시 후 다음 라운드가 시작돼요.
                  </p>
                ) : (
                  <>
                    {me && me.activeEffectTypes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {me.activeEffectTypes.map((t, i) => (
                          <Badge key={i} variant="destructive">
                            {EFFECT_LABEL[t] ?? t}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitAnswer();
                      }}
                      className="flex gap-2"
                    >
                      <Input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="정답을 입력하세요"
                        className={wrongFlash ? "border-destructive" : undefined}
                        autoComplete="off"
                        autoFocus
                      />
                      <Button type="submit">제출</Button>
                    </form>
                  </>
                )}
              </CardContent>
            </Card>

            {room.phase === "round_active" && me && groupedItems.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">내 아이템</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {groupedItems.map((group) => (
                    <Button
                      key={group.type}
                      type="button"
                      size="sm"
                      variant={targetingItemType === group.type ? "default" : "outline"}
                      title={group.description}
                      onClick={() => {
                        if (group.kind === "defense") activateItem(group.instanceIds[0]);
                        else setTargetingItemType(targetingItemType === group.type ? null : group.type);
                      }}
                    >
                      {group.name}
                      {group.count > 1 ? ` ×${group.count}` : ""}
                    </Button>
                  ))}
                </CardContent>
                {targetingItemType && (
                  <CardContent className="flex flex-wrap gap-2 pt-0">
                    <span className="text-sm text-muted-foreground">대상 선택:</span>
                    {room.players
                      .filter((p) => !p.isSelf)
                      .map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const group = groupedItems.find((g) => g.type === targetingItemType);
                            if (group) activateItem(group.instanceIds[0], p.id);
                          }}
                        >
                          {p.nickname}
                        </Button>
                      ))}
                  </CardContent>
                )}
              </Card>
            )}
          </div>

          <aside className="md:sticky md:top-4 md:self-start">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">실시간 순위</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {liveRanking.map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Badge variant={p.rank === 1 ? "default" : "outline"}>{p.rank}위</Badge>
                      {p.nickname}
                      {p.isSelf && <Badge variant="outline">나</Badge>}
                    </span>
                    <span className="text-muted-foreground">{p.roundWins}승</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}

      {room.phase === "finished" && room.ranking && (
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <CardTitle>최종 순위</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {room.ranking.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-md border p-3">
                <span className="flex items-center gap-2">
                  <Badge>{r.rank}위</Badge>
                  {r.nickname}
                </span>
                <span className="text-sm text-muted-foreground">
                  승리 {r.roundWins}회
                  {r.averageAnswerMs !== null && ` · 평균 ${(r.averageAnswerMs / 1000).toFixed(1)}초`}
                </span>
              </div>
            ))}
            <Button render={<Link href="/" />} nativeButton={false} className="mt-2">
              홈으로
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

