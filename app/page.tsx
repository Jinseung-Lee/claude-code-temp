"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  PencilIcon,
  ShuffleIcon,
  SparklesIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NICKNAME_MAX_LENGTH,
  getRememberedNickname,
  rememberNickname,
} from "@/lib/game/client-storage";
import { generateRandomNickname } from "@/lib/game/random-nickname";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // localStorage는 클라이언트에서만 읽을 수 있어 마운트 후 한 번 동기화한다.
    const stored = getRememberedNickname().trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNickname(stored);
    setDraft(stored || generateRandomNickname());
    setHydrated(true);
  }, []);

  function confirmNickname() {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError("닉네임을 입력해 주세요.");
      return;
    }
    setError(null);
    rememberNickname(trimmed);
    setNickname(trimmed);
    setEditing(false);
  }

  // 하이드레이션 불일치를 피하려고 저장된 닉네임을 읽기 전에는 아무것도 그리지 않는다.
  if (!hydrated) return null;

  const showNicknameForm = !nickname || editing;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 bg-background px-6 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <SparklesIcon className="size-7" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-bold tracking-tight">초성게임</h1>
          <p className="max-w-sm text-muted-foreground">
            제한시간 안에 초성을 보고 정답을 맞혀보세요. 혼자서 기록에
            도전하거나, 지인들과 방을 만들어 함께 즐길 수 있어요.
          </p>
        </div>
      </div>

      {showNicknameForm ? (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>{nickname ? "닉네임 바꾸기" : "닉네임 만들기"}</CardTitle>
            <CardDescription>
              회원가입 없이 닉네임만 만들면 바로 시작할 수 있어요. 한 번 만들면
              다음에 접속할 때 그대로 쓰여요.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex flex-col gap-3">
            <div className="flex w-full flex-col gap-2">
              <Label htmlFor="home-nickname">닉네임</Label>
              <div className="flex gap-2">
                <Input
                  id="home-nickname"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && confirmNickname()}
                  placeholder="내 닉네임"
                  maxLength={NICKNAME_MAX_LENGTH}
                  autoFocus
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="랜덤 닉네임"
                  onClick={() => setDraft(generateRandomNickname())}
                >
                  <ShuffleIcon />
                </Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button className="w-full" onClick={confirmNickname}>
              {nickname ? "변경하기" : "이 닉네임으로 시작"}
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            {nickname && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setDraft(nickname);
                  setError(null);
                  setEditing(false);
                }}
              >
                취소
              </Button>
            )}
          </CardFooter>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-full border px-4 py-2">
            <span className="text-sm text-muted-foreground">내 닉네임</span>
            <span className="font-medium">{nickname}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="닉네임 바꾸기"
              onClick={() => {
                setDraft(nickname);
                setEditing(true);
              }}
            >
              <PencilIcon />
            </Button>
          </div>

          <div className="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
            <Card className="flex flex-col transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UserIcon className="size-5" />
                  </div>
                  <Badge variant="secondary">혼자 플레이</Badge>
                </div>
                <CardTitle className="mt-2">싱글모드</CardTitle>
                <CardDescription>제한시간 안에 최대한 많이 맞혀보세요</CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto">
                <Button render={<Link href="/single" />} nativeButton={false} className="w-full">
                  혼자 하기
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </CardFooter>
            </Card>

            <Card className="flex flex-col transition-colors hover:border-primary/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UsersIcon className="size-5" />
                  </div>
                  <Badge variant="secondary">함께 플레이</Badge>
                </div>
                <CardTitle className="mt-2">멀티모드</CardTitle>
                <CardDescription>방을 만들거나 열려 있는 방에 들어가세요</CardDescription>
              </CardHeader>
              <CardFooter className="mt-auto">
                <Button
                  render={<Link href="/rooms" />}
                  nativeButton={false}
                  className="w-full"
                  variant="secondary"
                >
                  방 목록 보기
                  <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
