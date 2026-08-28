"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShuffleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NICKNAME_MAX_LENGTH,
  getRememberedNickname,
  rememberNickname,
  storePlayerId,
} from "@/lib/game/client-storage";
import { generateRandomNickname } from "@/lib/game/random-nickname";

export default function NewRoomPage() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // 홈에서 만든 닉네임을 그대로 쓴다. 다시 입력하지 않아도 되게 채워 둔다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNickname(getRememberedNickname());
  }, []);

  async function createRoom() {
    if (!nickname.trim()) {
      setError("닉네임을 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError(null);
    rememberNickname(nickname.trim());
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "방을 만들지 못했습니다.");
        return;
      }
      storePlayerId(data.code, data.playerId);
      router.push(`/rooms/${data.code}`);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>방 만들기</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nickname">닉네임</Label>
            <div className="flex gap-2">
              <Input
                id="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createRoom()}
                placeholder="방장 닉네임"
                maxLength={NICKNAME_MAX_LENGTH}
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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={createRoom} disabled={loading}>
            {loading ? "만드는 중..." : "방 만들기"}
          </Button>
          <Button render={<Link href="/" />} nativeButton={false} variant="ghost">
            홈으로
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
