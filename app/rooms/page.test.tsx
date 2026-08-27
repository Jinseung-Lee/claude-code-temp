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
};

const playingRoom: RoomSummary = {
  ...openRoom,
  code: "XYZ789",
  hostNickname: "게임중방장",
  phase: "round_active",
  playerCount: 4,
  joinable: false,
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
