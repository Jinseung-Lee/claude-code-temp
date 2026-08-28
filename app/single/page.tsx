"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, ChevronUpIcon, LogOutIcon, ShuffleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isCorrectAnswer, maskWord } from "@/lib/game/chosung";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  NICKNAME_MAX_LENGTH,
  getRememberedNickname,
  rememberNickname,
} from "@/lib/game/client-storage";
import type { RankedLeaderboardEntry, RankedPage } from "@/lib/game/leaderboard";
import { CATEGORIES, QUESTION_BANK, type Category } from "@/lib/game/questions";
import { generateRandomNickname } from "@/lib/game/random-nickname";
import {
  DEFAULT_BOUNDS,
  boundsFor,
  randomVelocity,
  stepWord,
  type DriftingWord,
} from "@/lib/game/drift";
import { DIFFICULTY_LABEL, SINGLE_MODE_DURATION_MS, type Difficulty } from "@/lib/game/types";


/**
 * 글자를 움직이는 주기. 화면 갱신 주기(약 60fps)보다 느리게 두고, CSS
 * transition으로 그 사이를 메워 부드럽게 보이게 한다.
 */
const TICK_MS = 60;

const SPAWN_CHANCE_PER_TICK = 0.05;

type Phase = "setup" | "playing" | "result";

interface ResultInfo {
  clearedAll: boolean;
  elapsedMs: number | null;
  clearedCount: number;
  /** 저장된 내 기록이 전체에서 몇 위인지. 저장 실패 시 null. */
  rank: number | null;
  totalCount: number | null;
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function SinglePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("setup");
  const [nickname, setNickname] = useState("");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [driftingWords, setDriftingWords] = useState<DriftingWord[]>([]);
  const [clearedCount, setClearedCount] = useState(0);
  const [input, setInput] = useState("");
  const [wrongFlash, setWrongFlash] = useState(false);
  const [remainingMs, setRemainingMs] = useState(SINGLE_MODE_DURATION_MS);
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<RankedLeaderboardEntry[]>([]);
  const [allEntries, setAllEntries] = useState<RankedLeaderboardEntry[] | null>(null);
  const [allMeta, setAllMeta] = useState<Omit<RankedPage, "entries"> | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);

  const poolRef = useRef<string[]>([]);
  const spawnedCountRef = useRef(0);
  const sessionStartRef = useRef(0);
  const clearedCountRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  /** 문제별 상자 DOM. 실제 크기를 재서 이동 범위를 좁히는 데 쓴다. */
  const wordElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      const data = await res.json();
      if (res.ok) setLeaderboard(data.entries);
    } catch {
      // 랭킹은 부가 정보라, 조회에 실패해도 게임 진행에는 영향을 주지 않는다.
    }
  }, []);

  useEffect(() => {
    // localStorage는 클라이언트에서만 읽을 수 있어 마운트 후 한 번 동기화한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNickname(getRememberedNickname());
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  useEffect(() => {
    if (phase === "playing") inputRef.current?.focus();
  }, [phase]);

  const finishSession = useCallback(
    async (clearedAll: boolean, elapsedMs: number) => {
      const finalCount = clearedCountRef.current;
      setResultInfo({
        clearedAll,
        elapsedMs: clearedAll ? elapsedMs : null,
        clearedCount: finalCount,
        rank: null,
        totalCount: null,
      });
      setPhase("result");
      // 순위 진입 여부와 무관하게 모든 기록을 남긴다.
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname,
            category,
            difficulty,
            clearedAll,
            elapsedMs: clearedAll ? elapsedMs : null,
            clearedCount: finalCount,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setLeaderboard(data.entries);
          setResultInfo((prev) =>
            prev ? { ...prev, rank: data.rank ?? null, totalCount: data.totalCount ?? null } : prev,
          );
          // 전체 순위를 펼쳐 둔 상태면 방금 기록까지 반영해 다시 읽는다.
          setAllEntries(null);
          setAllMeta(null);
        }
      } catch {
        // 랭킹 제출 실패는 조용히 무시한다(결과 화면은 이미 표시됨).
      }
    },
    [category, difficulty, nickname],
  );

  /** 게임 종료 버튼. 진행 중이던 기록을 남긴 뒤 홈으로 보낸다. */
  const quitToHome = useCallback(async () => {
    const finalCount = clearedCountRef.current;
    try {
      await fetch("/api/leaderboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname,
          category,
          difficulty,
          clearedAll: false,
          elapsedMs: null,
          clearedCount: finalCount,
        }),
      });
    } catch {
      // 저장에 실패해도 홈으로는 보내준다.
    } finally {
      router.push("/");
    }
  }, [category, difficulty, nickname, router]);

  /**
   * 전체 순위를 페이지 단위로 읽는다. `page`가 0이면 처음부터, 그보다 크면
   * 이미 읽은 목록 뒤에 이어 붙인다.
   */
  const fetchAllEntries = useCallback(async (page: number) => {
    setLoadingAll(true);
    try {
      const res = await fetch(`/api/leaderboard?scope=all&page=${page}`);
      const data = (await res.json()) as RankedPage;
      if (!res.ok) return;
      const { entries, ...meta } = data;
      setAllEntries((prev) => (page === 0 || prev === null ? entries : [...prev, ...entries]));
      setAllMeta(meta);
    } catch {
      // 전체 순위 조회 실패는 TOP 10 표시에 영향을 주지 않는다.
    } finally {
      setLoadingAll(false);
    }
  }, []);

  function toggleShowAll() {
    const next = !showAll;
    setShowAll(next);
    if (next && allEntries === null) fetchAllEntries(0);
  }

  useEffect(() => {
    if (phase !== "playing") return;
    const totalWords = QUESTION_BANK[category].length;

    const timer = setInterval(() => {
      const nowTs = Date.now();

      // 시간 안에 못 푼 문제도 사라지지 않고 화면 안을 계속 돌아다닌다.
      setDriftingWords((prev) => {
        const arena = arenaRef.current;
        const containerWidth = arena?.clientWidth ?? 0;
        const containerHeight = arena?.clientHeight ?? 0;
        const moved = prev.map((word) => {
          const element = wordElementsRef.current.get(word.id);
          // 상자를 아직 그리지 않은 첫 틱에는 기본 여백으로 움직인다.
          const bounds = element
            ? boundsFor(element.offsetWidth, element.offsetHeight, containerWidth, containerHeight)
            : DEFAULT_BOUNDS;
          return stepWord(word, TICK_MS / 1000, bounds);
        });

        if (poolRef.current.length > 0 && Math.random() < SPAWN_CHANCE_PER_TICK) {
          const answer = poolRef.current.shift()!;
          spawnedCountRef.current += 1;
          return [
            ...moved,
            {
              id: crypto.randomUUID(),
              answer,
              masked: maskWord(answer, difficulty),
              // 좌상단 기준이므로 오른쪽에 너무 붙지 않게 왼쪽 절반에서
              // 시작하고, 세로는 넓게 흩어 서로 겹치지 않게 한다.
              // 겹쳐도 곧 각자 다른 방향으로 흩어진다.
              x: 4 + Math.random() * 46,
              y: 4 + Math.random() * 82,
              ...randomVelocity(),
            },
          ];
        }
        return moved;
      });

      const elapsed = nowTs - sessionStartRef.current;
      const remaining = SINGLE_MODE_DURATION_MS - elapsed;
      if (remaining <= 0) {
        setRemainingMs(0);
        // 틱 간격(150ms) 때문에 elapsed가 제한시간을 조금 넘을 수 있다.
        // 서버는 제한시간을 넘는 클리어 시간을 거부하므로 잘라서 보낸다.
        finishSession(
          clearedCountRef.current >= totalWords,
          Math.min(elapsed, SINGLE_MODE_DURATION_MS),
        );
      } else {
        setRemainingMs(remaining);
      }
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [phase, category, difficulty, finishSession]);

  function start() {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setNicknameError("닉네임을 입력해 주세요.");
      return;
    }
    setNicknameError(null);
    rememberNickname(trimmed);

    poolRef.current = shuffled(QUESTION_BANK[category]);
    spawnedCountRef.current = 0;
    sessionStartRef.current = Date.now();
    clearedCountRef.current = 0;
    wordElementsRef.current.clear();
    setDriftingWords([]);
    setClearedCount(0);
    setInput("");
    setResultInfo(null);
    setRemainingMs(SINGLE_MODE_DURATION_MS);
    setPhase("playing");
  }

  function submit() {
    if (input.trim() === "") return;
    const matchIndex = driftingWords.findIndex((w) => isCorrectAnswer(input, w.answer));

    if (matchIndex === -1) {
      setWrongFlash(true);
      setInput("");
      setTimeout(() => setWrongFlash(false), 300);
      return;
    }

    setDriftingWords((prev) => prev.filter((_, i) => i !== matchIndex));
    clearedCountRef.current += 1;
    setClearedCount(clearedCountRef.current);
    setInput("");

    const totalWords = QUESTION_BANK[category].length;
    if (clearedCountRef.current >= totalWords) {
      finishSession(true, Date.now() - sessionStartRef.current);
    }
  }

  function formatMs(ms: number): string {
    return `${(ms / 1000).toFixed(1)}초`;
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl flex-1 gap-4 px-6 py-10 md:grid-cols-[1fr_280px]">
      <div className="flex flex-col items-center gap-6">
        {phase === "setup" && (
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>싱글모드</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="single-nickname">닉네임 (랭킹에 표시돼요)</Label>
                <div className="flex gap-2">
                  <Input
                    id="single-nickname"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="닉네임"
                    maxLength={NICKNAME_MAX_LENGTH}
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
                {nicknameError && <p className="text-sm text-destructive">{nicknameError}</p>}
              </div>
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
              <p className="text-sm text-muted-foreground">
                초성 문제가 화면 안을 돌아다녀요. 보이는 문제의 정답을 입력해서
                클리어하세요. 못 푼 문제는 사라지지 않고 계속 남아 있어요.
                60초 안에 카테고리 문제를 모두 클리어하면 시간이 남아도 바로 종료돼요.
              </p>
              <Button onClick={start}>시작하기</Button>
              <Button render={<Link href="/" />} nativeButton={false} variant="ghost">
                홈으로
              </Button>
            </CardContent>
          </Card>
        )}

        {phase === "playing" && (
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>
                클리어 <strong>{clearedCount}</strong> / {QUESTION_BANK[category].length}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">{Math.ceil(remainingMs / 1000)}초</span>
                <Button type="button" variant="outline" size="sm" onClick={quitToHome}>
                  <LogOutIcon data-icon="inline-start" />
                  게임 종료
                </Button>
              </div>
            </div>
            <div
              ref={arenaRef}
              className="relative h-[420px] w-full overflow-hidden rounded-md border bg-muted/20"
            >
              {driftingWords.map((w) => (
                <div
                  key={w.id}
                  ref={(el) => {
                    // 상자 크기를 재려면 DOM이 필요하다. 정답을 맞혀 사라진
                    // 문제는 항목을 지워 Map이 계속 커지지 않게 한다.
                    if (el) wordElementsRef.current.set(w.id, el);
                    else wordElementsRef.current.delete(w.id);
                  }}
                  // 위치 계산은 틱마다 하고, 그 사이는 CSS transition이 메워
                  // 부드럽게 움직이게 한다.
                  //
                  // 좌표는 상자 좌상단 기준이다. 상자 폭이 글자 수에 따라
                  // 달라지므로 중심 기준으로 두면 긴 문제가 벽을 넘어 잘린다.
                  // 좌상단 기준으로 두고 이동 범위를 상자 크기만큼 좁혀야
                  // 어떤 길이든 화면 안에 머문다.
                  //
                  // whitespace-nowrap이 없으면 좁은 상자에서 글자가 세로로 접힌다.
                  className="absolute rounded-md border bg-card px-3 py-1 text-lg font-bold whitespace-nowrap tracking-widest shadow-sm transition-[left,top] duration-[60ms] ease-linear"
                  style={{ left: `${w.x}%`, top: `${w.y}%` }}
                >
                  {w.masked}
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="flex gap-2"
            >
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="정답을 입력하세요"
                className={wrongFlash ? "border-destructive" : undefined}
                autoComplete="off"
              />
              <Button type="submit">제출</Button>
            </form>
          </div>
        )}

        {phase === "result" && resultInfo && (
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>결과</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <p className="text-lg text-center">
                {resultInfo.clearedAll ? (
                  <>
                    이 카테고리 문제를 모두 클리어했어요!
                    <br />
                    기록: <span className="text-3xl font-bold">{formatMs(resultInfo.elapsedMs ?? 0)}</span>
                  </>
                ) : (
                  <>
                    60초 동안 <span className="text-3xl font-bold">{resultInfo.clearedCount}</span>개를
                    클리어했어요!
                  </>
                )}
              </p>
              {resultInfo.rank !== null && (
                <p className="text-sm text-muted-foreground">
                  전체 {resultInfo.totalCount}개 기록 중{" "}
                  <span className="font-semibold text-foreground">{resultInfo.rank}위</span>예요.
                  기록은 저장했어요.
                </p>
              )}
              <div className="flex w-full gap-2">
                <Button className="flex-1" onClick={start}>
                  다시 하기
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

      <aside className="md:sticky md:top-4 md:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">전체 랭킹 TOP 10</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {leaderboard.length === 0 && (
              <p className="text-sm text-muted-foreground">아직 기록이 없어요.</p>
            )}
            {leaderboard.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant={entry.rank === 1 ? "default" : "outline"}>{entry.rank}위</Badge>
                  {entry.nickname}
                </span>
                <span className="text-muted-foreground">
                  {entry.clearedAll ? formatMs(entry.elapsedMs ?? 0) : `${entry.clearedCount}개`}
                </span>
              </div>
            ))}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 gap-1 text-muted-foreground"
              onClick={toggleShowAll}
            >
              전체 순위 보기
              {showAll ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </Button>

            {showAll && (
              <>
                {loadingAll && allEntries === null ? (
                  <p className="text-sm text-muted-foreground">전체 순위를 불러오는 중이에요…</p>
                ) : allEntries === null ? (
                  <p className="text-sm text-muted-foreground">
                    전체 순위를 불러오지 못했어요.
                  </p>
                ) : allEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">아직 기록이 없어요.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      저장된 기록 {allMeta?.totalCount ?? allEntries.length}개 중{" "}
                      {allEntries.length}개 표시
                    </p>
                    {allMeta?.truncated && (
                      <p className="text-xs text-destructive">
                        기록이 매우 많아 오래된 일부는 순위 집계에서 제외됐어요.
                      </p>
                    )}
                    <ScrollArea className="h-72 rounded-md border p-2">
                      <div className="flex flex-col gap-2">
                        {allEntries.map((entry) => (
                          <div key={entry.id} className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="flex items-center gap-2">
                                <Badge variant={entry.rank === 1 ? "default" : "outline"}>
                                  {entry.rank}위
                                </Badge>
                                {entry.nickname}
                              </span>
                              <span className="text-muted-foreground">
                                {entry.clearedAll
                                  ? formatMs(entry.elapsedMs ?? 0)
                                  : `${entry.clearedCount}개`}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {entry.category} · {DIFFICULTY_LABEL[entry.difficulty]}난이도 ·{" "}
                              {new Date(entry.createdAt).toLocaleString("ko-KR")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    {allMeta?.hasMore && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={loadingAll}
                        onClick={() => fetchAllEntries((allMeta?.page ?? 0) + 1)}
                      >
                        {loadingAll ? "불러오는 중…" : "더 보기"}
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
