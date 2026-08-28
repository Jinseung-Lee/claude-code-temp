import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import RoomListPage from "@/app/rooms/page";
import type { RoomSummary } from "@/lib/game/types";

const openRoom: RoomSummary = {
  code: "ABC234",
  hostNickname: "대기방장",
  phase: "lobby",
  playerCount: 2,
  maxPlayers: 4,
  category: "사자성어",
  difficulty: "easy",
  joinable: true,
  createdAt: 1767225600000,
  players: [
    { nickname: "대기방장", isHost: true, rank: null, roundWins: 0 },
    { nickname: "참가자1", isHost: false, rank: null, roundWins: 0 },
  ],
};

const playingRoom: RoomSummary = {
  ...openRoom,
  code: "XYZ789",
  hostNickname: "게임중방장",
  phase: "round_active",
  playerCount: 4,
  joinable: false,
  players: [
    { nickname: "게임중방장", isHost: true, rank: 1, roundWins: 3 },
    { nickname: "추격자", isHost: false, rank: 2, roundWins: 1 },
  ],
};

function mockRooms(rooms: RoomSummary[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ rooms }) })),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("들어갈 수 있는 방은 방 페이지로 가는 링크를 보여준다", async () => {
  mockRooms([openRoom]);
  render(<RoomListPage />);

  await waitFor(() => expect(screen.getByText("대기방장님의 방")).toBeInTheDocument());
  expect(screen.getByRole("button", { name: /들어가기/ })).toHaveAttribute("href", "/rooms/ABC234");
});

test("진행 중인 방은 목록에 보이지만 입장 링크를 주지 않는다", async () => {
  mockRooms([playingRoom]);
  render(<RoomListPage />);

  await waitFor(() => expect(screen.getByText("게임중방장님의 방")).toBeInTheDocument());
  expect(screen.getByText("게임 중")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /들어가기/ })).not.toBeInTheDocument();
  expect(screen.getByText(/이미 게임이 시작되어/)).toBeInTheDocument();
});

test("방이 없으면 안내 문구를 보여준다", async () => {
  mockRooms([]);
  render(<RoomListPage />);

  await waitFor(() =>
    expect(screen.getByText("아직 만들어진 방이 없습니다")).toBeInTheDocument(),
  );
});

test("대기 중인 방은 참가자 목록을 보여주고 순위는 표시하지 않는다", async () => {
  mockRooms([openRoom]);
  render(<RoomListPage />);

  await waitFor(() => expect(screen.getByText("참가자")).toBeInTheDocument());
  expect(screen.getByText("참가자1")).toBeInTheDocument();
  expect(screen.getByText("방장")).toBeInTheDocument();
  expect(screen.queryByText("1위")).not.toBeInTheDocument();
});

test("진행 중인 방은 참가자별 순위와 승수를 함께 보여준다", async () => {
  mockRooms([playingRoom]);
  render(<RoomListPage />);

  await waitFor(() => expect(screen.getByText("참가자 및 순위")).toBeInTheDocument());
  expect(screen.getByText("1위")).toBeInTheDocument();
  expect(screen.getByText("2위")).toBeInTheDocument();
  expect(screen.getByText("3승")).toBeInTheDocument();
  expect(screen.getByText("추격자")).toBeInTheDocument();
});
