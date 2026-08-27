import Link from "next/link";
import { ArrowRightIcon, SparklesIcon, UserIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
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
    </div>
  );
}
