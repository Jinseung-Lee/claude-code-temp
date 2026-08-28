"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronUpIcon, LogOutIcon, ShuffleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  NICKNAME_MAX_LENGTH,
  clearStoredPlayerId,
  getRememberedNickname,
  getStoredPlayerId,
  rememberNickname,
  storePlayerId,
} from "@/lib/game/client-storage";
import { CATEGORIES, type Category } from "@/lib/game/questions";
import { rankByScore } from "@/lib/game/ranking";
import { generateRandomNickname } from "@/lib/game/random-nickname";
import {
  DIFFICULTY_LABEL,
  LOBBY_IDLE_TIMEOUT_MS,
  type ClientRoomView,
  type Difficulty,
  type ItemType,
} from "@/lib/game/types";

// clear_input은 한 번 발동하고 끝나는 즉시형 효과라 뱃지로 계속 보여주지 않는다.
const EFFECT_LABEL: Record<string, string> = {
  delay: "3초 지연",
  hide_syllable: "초성 가림",
  reverse_input: "거꾸로 입력",
};
const BADGE_VISIBLE_EFFECTS = new Set(Object.keys(EFFECT_LABEL));

const POLL_MS = 700;

/** 더 진행될 일이 없는 종착 상태. 서버는 이 시점에 방을 지운다. */
function isRoomOverPhase(phase: string | undefined): boolean {
  return phase === "finished" || phase === "disbanded";
}

/** 화면 문구에 쓰는 무응답 해체 시간(초). 서버 상수와 같은 값을 보여준다. */
const IDLE_TIMEOUT_SECONDS = Math.round(LOBBY_IDLE_TIMEOUT_MS / 1000);

/** 남은 시간이 이 아래로 떨어지면 카운트다운을 강조한다. */
const IDLE_WARNING_MS = 10_000;

/** 서버가 낙관적 락 충돌로 409를 주면 잠깐 뒤 다시 보낸다. */
const CONFLICT_RETRY_LIMIT = 3;

async function postWithRetry(url: string, body: unknown) {
  for (let attempt = 0; attempt <= CONFLICT_RETRY_LIMIT; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status !== 409 || attempt === CONFLICT_RETRY_LIMIT) return res;
    // 여러 요청이 동시에 밀렸을 때 같은 시각에 함께 재시도하지 않도록 흩뿌린다.
    await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1) * (0.5 + Math.random())));
  }
  throw new Error("unreachable");
}

/**
 * 승자가 이미 확정된 뒤 도착한 제출에 서버가 주는 응답. 사용자가 정답을
 * 맞혔더라도 근소하게 늦으면 여기에 걸리므로, 실패로 취급해 빨간 오류를
 * 띄우지 않는다.
 */
const LATE_SUBMIT_ERRORS = new Set(["라운드가 진행 중이 아닙니다."]);

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code ?? "").toUpperCase();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [nickname, setNickname] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const [room, setRoom] = useState<ClientRoomView | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [wrongFlash, setWrongFlash] = useState(false);
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [targetingItemType, setTargetingItemType] = useState<ItemType | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [itemQuestionAnswer, setItemQuestionAnswer] = useState("");
  const [itemQuestionWrongFlash, setItemQuestionWrongFlash] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const answeredRoundRef = useRef<number | null>(null);
  // 폴링 콜백에서 최신 값을 읽되, 의존성 변화로 폴링을 재시작하지 않게 ref로 둔다.
  const roomRef = useRef<ClientRoomView | null>(null);
  const roomClosedRef = useRef(false);
  const playerIdRef = useRef<string | null>(null);
  const clearedEffectIdsRef = useRef<Set<string>>(new Set());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  // 자동 참여를 한 번만 시도한다. 실패했을 때 무한 재시도로 도는 것을 막는다.
  const autoJoinedRef = useRef(false);

  useEffect(() => {
    // localStorage는 클라이언트에서만 읽을 수 있어(서버-클라이언트 하이드레이션 불일치를
    // 피하려고) 마운트 후 한 번 동기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayerId(getStoredPlayerId(code));
    // 홈에서 만든 ID를 그대로 쓴다. 방마다 다시 입력하지 않게 한다.
    setNickname(getRememberedNickname());
    setHydrated(true);
  }, [code]);

  const fetchRoom = useCallback(async () => {
    if (!playerId) return;
    const res = await fetch(`/api/rooms/${code}?playerId=${playerId}`);
    const data = await res.json();
    if (!res.ok) {
      // 방은 게임 한 판만 살아 있고, 끝나거나 인원이 부족해지면 서버가
      // 지운다. 방이 사라진 것은 오류가 아니라 "이 방은 닫혔다"는 정상 종료다.
      if (res.status === 404) {
        clearStoredPlayerId(code);
        if (roomClosedRef.current) return;
        roomClosedRef.current = true;
        setRoomClosed(true);
        // 아직 아무 상태도 못 받았으면 보여줄 결과가 없으므로 ID 화면으로 돌린다.
        setPlayerId((current) => (roomRef.current ? current : null));
        return;
      }
      // 403은 방은 있지만 내가 그 방의 참가자가 아닌 경우다(저장된 ID가
      // 어긋났거나 방이 다시 만들어졌다). 방이 닫힌 것과는 다르므로
      // ID를 버리고 생성 화면으로 돌린다.
      if (res.status === 403) {
        clearStoredPlayerId(code);
        setRoom(null);
        setPlayerId(null);
        return;
      }
      // 409는 방에 쓰기가 몰려 이번 조회만 밀린 것이다. 다음 폴링에서 곧
      // 받아오므로 화면을 오류로 덮지 않는다.
      if (res.status === 409) return;
      setFetchError(data.error ?? "방 정보를 불러오지 못했습니다.");
      return;
    }
    setFetchError(null);
    setClockOffset(data.serverTime - Date.now());
    setRoom(data as ClientRoomView);
  }, [code, playerId]);

  useEffect(() => {
    if (!playerId) return;
    // 게임이 끝나면 서버가 방을 지우므로 더 물어볼 것이 없다. 계속
    // 폴링하면 404가 돌아와 최종 순위 화면을 덮는다.
    if (isRoomOverPhase(room?.phase) || roomClosed) return;
    // 방 상태는 실시간 서버 푸시 없이 짧은 주기로 폴링해 동기화한다(이 프로젝트 규모에 맞춘 단순화).
    fetchRoom();
    const timer = setInterval(fetchRoom, POLL_MS);
    return () => clearInterval(timer);
  }, [playerId, fetchRoom, room?.phase, roomClosed]);

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

  useEffect(() => {
    const me = room?.players.find((p) => p.isSelf);
    const freshClear = me?.myActiveEffects?.find(
      (e) => e.type === "clear_input" && !clearedEffectIdsRef.current.has(e.id),
    );
    if (freshClear) {
      clearedEffectIdsRef.current.add(freshClear.id);
      // 상대가 방금 "입력 지우기" 아이템을 썼다는 서버 신호를 감지해 로컬 입력을 비운다.
      setAnswer("");
      toast.warning("상대가 내 입력을 지웠어요!");
    }
  }, [room]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [room?.chatMessages.length]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    playerIdRef.current = playerId;
  }, [playerId]);

  /**
   * 탭을 닫거나 다른 페이지로 떠날 때 서버에 나갔음을 알린다. 일반 fetch는
   * 페이지가 사라지면서 취소될 수 있으므로 sendBeacon으로 보낸다.
   *
   * 이미 끝난(finished/disbanded) 방은 서버가 지웠으니 보내지 않는다.
   */
  useEffect(() => {
    if (!playerId) return;

    function notifyLeave() {
      const id = playerIdRef.current;
      if (!id || roomClosedRef.current) return;
      if (isRoomOverPhase(roomRef.current?.phase)) return;
      navigator.sendBeacon?.(
        `/api/rooms/${code}/leave`,
        new Blob([JSON.stringify({ playerId: id })], { type: "application/json" }),
      );
    }

    window.addEventListener("pagehide", notifyLeave);
    return () => window.removeEventListener("pagehide", notifyLeave);
  }, [code, playerId]);

  const join = useCallback(
    async (withId: string) => {
      const trimmed = withId.trim();
      if (!trimmed) {
        setJoinError("ID를 입력해 주세요.");
        return;
      }
      setJoining(true);
      setJoinError(null);
      try {
        // 저장된 ID가 남아 있으면 새 참가자가 아니라 재입장으로 처리된다.
        const res = await postWithRetry(`/api/rooms/${code}/join`, {
          nickname: trimmed,
          existingPlayerId: getStoredPlayerId(code) ?? undefined,
        });
        const data = await res.json();
        if (!res.ok) {
          setJoinError(data.error ?? "참여하지 못했습니다.");
          return;
        }
        rememberNickname(trimmed);
        storePlayerId(code, data.playerId);
        setPlayerId(data.playerId);
      } catch {
        setJoinError("네트워크 오류가 발생했습니다.");
      } finally {
        setJoining(false);
      }
    },
    [code],
  );

  useEffect(() => {
    // 홈에서 ID를 이미 만들었으면 다시 입력받지 않고 곧바로 합류한다.
    if (!hydrated || playerId || joining || joinError || autoJoinedRef.current) return;
    const stored = getRememberedNickname().trim();
    if (!stored) return;
    autoJoinedRef.current = true;
    // 참여 요청을 다음 틱으로 미뤄, effect가 실행되는 도중에 setState가
    // 일어나지 않게 한다(react-hooks/set-state-in-effect).
    const timer = setTimeout(() => join(stored), 0);
    return () => clearTimeout(timer);
  }, [hydrated, playerId, joining, joinError, join]);

  /**
   * 방을 나가 홈으로 돌아간다. 서버에서 참가자를 빼면 남은 인원에 따라
   * 1인 생존 종료나 방 해체가 함께 처리된다.
   */
  async function leaveToHome() {
    if (leaving) return;
    setLeaving(true);
    try {
      if (playerId) {
        await fetch(`/api/rooms/${code}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId }),
        });
        // 나간 방의 참가자 ID는 지워, 다시 들어오면 새 참가자로 합류한다.
        clearStoredPlayerId(code);
        // 떠나는 중에 폴링이 404를 받아 "종료됨" 화면을 띄우지 않게 막는다.
        roomClosedRef.current = true;
      }
    } catch {
      // 나가기 요청이 실패해도 홈으로는 보내준다. 남은 참가자 쪽에서는
      // 무응답 해체나 다음 tick이 정리한다.
    } finally {
      router.push("/");
    }
  }

  async function startGame() {
    if (!playerId) return;
    const res = await postWithRetry(`/api/rooms/${code}/start`, {
      actorId: playerId,
      category,
      difficulty,
    });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "게임을 시작하지 못했습니다.");
    else fetchRoom();
  }

  async function submitAnswer() {
    if (!playerId || !answer.trim() || !room?.round) return;
    answeredRoundRef.current = room.round.index;
    const res = await postWithRetry(`/api/rooms/${code}/answer`, { playerId, text: answer });
    const data = await res.json();
    if (!res.ok) {
      // 라운드가 막 끝난 뒤 도착한 제출은 사용자 잘못이 아니다. 다음 라운드
      // 화면이 곧 내려오므로 오류 대신 상태만 정리한다.
      if (LATE_SUBMIT_ERRORS.has(data.error)) {
        setAnswer("");
        fetchRoom();
        return;
      }
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
    const res = await postWithRetry(`/api/rooms/${code}/item`, { playerId, itemId, targetId });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "아이템을 사용하지 못했습니다.");
    setTargetingItemType(null);
    fetchRoom();
  }

  async function submitItemQuestion() {
    if (!playerId || !itemQuestionAnswer.trim()) return;
    const res = await postWithRetry(`/api/rooms/${code}/item-question`, {
      playerId,
      text: itemQuestionAnswer,
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "제출하지 못했습니다.");
      return;
    }
    setItemQuestionAnswer("");
    if (data.correct) {
      toast.success("아이템을 획득했어요!");
    } else {
      setItemQuestionWrongFlash(true);
      setTimeout(() => setItemQuestionWrongFlash(false), 400);
    }
    fetchRoom();
  }

  async function sendChat() {
    if (!playerId || !chatText.trim()) return;
    const text = chatText;
    setChatText("");
    const res = await postWithRetry(`/api/rooms/${code}/chat`, { playerId, text });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "메시지를 보내지 못했습니다.");
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
              <Label htmlFor="nickname">ID (닉네임)</Label>
              <div className="flex gap-2">
                <Input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join(nickname)}
                  placeholder="내 ID"
                  maxLength={NICKNAME_MAX_LENGTH}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="랜덤 ID"
                  onClick={() => setNickname(generateRandomNickname())}
                >
                  <ShuffleIcon />
                </Button>
              </div>
            </div>
            {joinError && <p className="text-sm text-destructive">{joinError}</p>}
            <p className="text-xs text-muted-foreground">
              방 안에서 이미 쓰이는 ID는 만들 수 없어요.
            </p>
            <Button onClick={() => join(nickname)} disabled={joining}>
              {joining ? "참여하는 중..." : "ID 만들고 참여하기"}
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

  // 결과 화면을 받기 전에 방이 닫힌 경우(참가자가 다 나갔거나 인원 부족).
  if (roomClosed && !room) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16">
        <p className="text-muted-foreground">이 방은 종료되어 사라졌습니다.</p>
        <Button render={<Link href="/rooms" />} nativeButton={false}>
          방 목록으로
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
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">방 {room.code}</h1>
        <div className="flex items-center gap-2">
          {room.phase !== "finished" && (
            <Badge variant="outline">
              라운드 {room.round ? room.round.index + 1 : 0} / {room.totalRounds}
            </Badge>
          )}
          {room.phase !== "finished" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={leaveToHome}
              disabled={leaving}
            >
              <LogOutIcon data-icon="inline-start" />
              게임 종료
            </Button>
          )}
        </div>
      </div>

      {room.phase === "lobby" && (
        <div className="grid gap-4 md:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>참가자 및 설정</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-0 text-muted-foreground hover:bg-transparent"
                  onClick={() => setShareOpen((v) => !v)}
                >
                  URL로 초대하기 (선택)
                  {shareOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </Button>
                {shareOpen && (
                  <div className="mt-2 flex gap-2">
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
                )}
              </div>

              <div className="flex flex-col gap-1 rounded-md border border-dashed p-3">
                <p className="text-sm font-medium">
                  {IDLE_TIMEOUT_SECONDS}초 동안 아무 말이 없으면 방이 해체돼요
                </p>
                <p className="text-xs text-muted-foreground">
                  채팅을 보내거나 누군가 들어오면 다시 {IDLE_TIMEOUT_SECONDS}초로
                  돌아가요. 해체되면 참가자 모두 홈으로 이동합니다.
                </p>
                {room.idleTimeoutRemainingMs !== null && (
                  <p
                    className={
                      room.idleTimeoutRemainingMs <= IDLE_WARNING_MS
                        ? "text-sm font-semibold text-destructive"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    해체까지 {Math.ceil(room.idleTimeoutRemainingMs / 1000)}초 남았어요
                  </p>
                )}
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

              <Separator />

              {isHost ? (
                <>
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

          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-base">채팅</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-2">
              <ScrollArea className="h-64 rounded-md border p-2" ref={chatScrollRef}>
                <div className="flex flex-col gap-1">
                  {room.chatMessages.length === 0 && (
                    <p className="text-sm text-muted-foreground">아직 메시지가 없어요.</p>
                  )}
                  {room.chatMessages.map((m) => (
                    <p key={m.id} className="text-sm">
                      <span className="font-medium">{m.nickname}</span>
                      <span className="text-muted-foreground">: </span>
                      {m.text}
                    </p>
                  ))}
                </div>
              </ScrollArea>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendChat();
                }}
                className="flex gap-2"
              >
                <Input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  placeholder="메시지를 입력하세요"
                  maxLength={200}
                  autoComplete="off"
                />
                <Button type="submit">전송</Button>
              </form>
            </CardContent>
          </Card>
        </div>
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
                    {me && me.activeEffectTypes.filter((t) => BADGE_VISIBLE_EFFECTS.has(t)).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {me.activeEffectTypes
                          .filter((t) => BADGE_VISIBLE_EFFECTS.has(t))
                          .map((t, i) => (
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

                    {room.round.myItemQuestion && (
                      <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                        <span className="text-xs text-muted-foreground">
                          아이템 문제 · 풀면 랜덤 아이템을 얻어요
                        </span>
                        <div className="rounded-md bg-muted/30 py-3 text-center text-xl font-bold tracking-widest">
                          {room.round.myItemQuestion}
                        </div>
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitItemQuestion();
                          }}
                          className="flex gap-2"
                        >
                          <Input
                            value={itemQuestionAnswer}
                            onChange={(e) => setItemQuestionAnswer(e.target.value)}
                            placeholder="아이템 문제 정답"
                            className={itemQuestionWrongFlash ? "border-destructive" : undefined}
                            autoComplete="off"
                          />
                          <Button type="submit" size="sm" variant="secondary">
                            제출
                          </Button>
                        </form>
                      </div>
                    )}
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
                    <Tooltip key={group.type}>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            size="sm"
                            variant={targetingItemType === group.type ? "default" : "outline"}
                            onClick={() => {
                              if (group.kind === "defense") activateItem(group.instanceIds[0]);
                              else
                                setTargetingItemType(targetingItemType === group.type ? null : group.type);
                            }}
                          />
                        }
                      >
                        {group.name}
                        {group.count > 1 ? ` ×${group.count}` : ""}
                      </TooltipTrigger>
                      <TooltipContent>{group.description}</TooltipContent>
                    </Tooltip>
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
            {room.endReason === "last_player_standing" && (
              <p className="text-sm text-muted-foreground">
                다른 참가자가 모두 나가 혼자 남아 승리했어요.
              </p>
            )}
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
            <p className="mt-1 text-center text-xs text-muted-foreground">
              게임이 끝나 이 방은 닫혔습니다. 새로 하려면 방을 다시 만들어 주세요.
            </p>
            <div className="mt-1 flex gap-2">
              <Button render={<Link href="/rooms" />} nativeButton={false} className="flex-1">
                방 목록으로
              </Button>
              <Button
                render={<Link href="/" />}
                nativeButton={false}
                variant="outline"
                className="flex-1"
              >
                홈으로
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

