"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShuffleIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isCorrectAnswer, maskWord } from "@/lib/game/chosung";
import { getRememberedNickname, rememberNickname } from "@/lib/game/client-storage";
import type { LeaderboardEntry } from "@/lib/game/leaderboard";
import { CATEGORIES, QUESTION_BANK, type Category } from "@/lib/game/questions";
import { generateRandomNickname } from "@/lib/game/random-nickname";
import { DIFFICULTY_LABEL, SINGLE_MODE_DURATION_MS, type Difficulty } from "@/lib/game/types";


const TICK_MS = 150;
const FALL_MIN_MS = 9_000;
const FALL_MAX_MS = 15_000;
const SPAWN_CHANCE_PER_TICK = 0.12;

type Phase = "setup" | "playing" | "result";

interface FallingWord {
  id: string;
  answer: string;
  masked: string;
  lane: number;
  spawnedAt: number;
  fallDurationMs: number;
}

function laneFor(index: number, total: number): number {
  if (total <= 1) return 50;
  return 8 + index * (84 / (total - 1));
}

interface ResultInfo {
  clearedAll: boolean;
  elapsedMs: number | null;
  clearedCount: number;
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
  const [phase, setPhase] = useState<Phase>("setup");
  const [nickname, setNickname] = useState("");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>(CATEGORIES[0]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [fallingWords, setFallingWords] = useState<FallingWord[]>([]);
  const [clearedCount, setClearedCount] = useState(0);
  const [input, setInput] = useState("");
  const [wrongFlash, setWrongFlash] = useState(false);
  const [remainingMs, setRemainingMs] = useState(SINGLE_MODE_DURATION_MS);
  const [now, setNow] = useState(() => Date.now());
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const poolRef = useRef<string[]>([]);
  const spawnedCountRef = useRef(0);
  const sessionStartRef = useRef(0);
  const clearedCountRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
      setResultInfo({ clearedAll, elapsedMs: clearedAll ? elapsedMs : null, clearedCount: finalCount });
      setPhase("result");
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
        if (res.ok) setLeaderboard(data.entries);
      } catch {
        // 랭킹 제출 실패는 조용히 무시한다(결과 화면은 이미 표시됨).
      }
    },
    [category, difficulty, nickname],
  );

  useEffect(() => {
    if (phase !== "playing") return;
    const totalWords = QUESTION_BANK[category].length;

    const timer = setInterval(() => {
      const nowTs = Date.now();
      setNow(nowTs);

      // 시간 안에 못 푼 문제도 사라지지 않고 화면 아래쪽에 계속 남아 기다린다.
      setFallingWords((prev) => {
        if (poolRef.current.length > 0 && Math.random() < SPAWN_CHANCE_PER_TICK) {
          const answer = poolRef.current.shift()!;
          const lane = laneFor(spawnedCountRef.current, totalWords);
          spawnedCountRef.current += 1;
          const fallDurationMs = FALL_MIN_MS + Math.random() * (FALL_MAX_MS - FALL_MIN_MS);
          return [
            ...prev,
            { id: crypto.randomUUID(), answer, masked: maskWord(answer, difficulty), lane, spawnedAt: nowTs, fallDurationMs },
          ];
        }
        return prev;
      });

      const elapsed = nowTs - sessionStartRef.current;
      const remaining = SINGLE_MODE_DURATION_MS - elapsed;
      if (remaining <= 0) {
        setRemainingMs(0);
        finishSession(clearedCountRef.current >= totalWords, elapsed);
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
    setFallingWords([]);
    setClearedCount(0);
    setInput("");
    setResultInfo(null);
    setRemainingMs(SINGLE_MODE_DURATION_MS);
    setPhase("playing");
  }

  function submit() {
    if (input.trim() === "") return;
    const matchIndex = fallingWords.findIndex((w) => isCorrectAnswer(input, w.answer));

    if (matchIndex === -1) {
      setWrongFlash(true);
      setInput("");
      setTimeout(() => setWrongFlash(false), 300);
      return;
    }

    setFallingWords((prev) => prev.filter((_, i) => i !== matchIndex));
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
                    maxLength={12}
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
                초성 문제가 위에서 아래로 떨어져요. 바닥에 닿기 전에 정답을 입력해서 클리어하세요.
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
            <div className="flex items-center justify-between text-sm">
              <span>
                클리어 <strong>{clearedCount}</strong> / {QUESTION_BANK[category].length}
              </span>
              <span className="text-muted-foreground">{Math.ceil(remainingMs / 1000)}초</span>
            </div>
            <div className="relative h-[420px] w-full overflow-hidden rounded-md border bg-muted/20">
              {fallingWords.map((w) => {
                const progress = Math.min(1, (now - w.spawnedAt) / w.fallDurationMs);
                return (
                  <div
                    key={w.id}
                    className="absolute -translate-x-1/2 rounded-md border bg-card px-3 py-1 text-lg font-bold tracking-widest shadow-sm"
                    style={{ left: `${w.lane}%`, top: `${progress * 92}%` }}
                  >
                    {w.masked}
                  </div>
                );
              })}
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
            {leaderboard.map((entry, index) => (
              <div key={entry.id} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant={index === 0 ? "default" : "outline"}>{index + 1}위</Badge>
                  {entry.nickname}
                </span>
                <span className="text-muted-foreground">
                  {entry.clearedAll ? formatMs(entry.elapsedMs ?? 0) : `${entry.clearedCount}개`}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
