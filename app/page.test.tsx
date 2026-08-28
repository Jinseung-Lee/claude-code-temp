import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";

import Home from "@/app/page";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

test("닉네임이 없으면 닉네임 입력 화면을 먼저 보여준다", () => {
  render(<Home />);

  expect(screen.getByRole("heading", { level: 1, name: "초성게임" })).toBeInTheDocument();
  expect(screen.getByLabelText("닉네임")).toBeInTheDocument();
  // 닉네임을 확정하기 전에는 모드를 고를 수 없다.
  expect(screen.queryByRole("button", { name: "혼자 하기" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "방 목록 보기" })).not.toBeInTheDocument();
});

test("닉네임을 확정하면 싱글/멀티 진입 링크를 보여준다", () => {
  render(<Home />);

  fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "테스트닉" } });
  fireEvent.click(screen.getByRole("button", { name: /이 닉네임으로 시작/ }));

  expect(screen.getByText("테스트닉")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "혼자 하기" })).toHaveAttribute("href", "/single");
  expect(screen.getByRole("button", { name: "방 목록 보기" })).toHaveAttribute("href", "/rooms");
});

test("저장된 닉네임이 있으면 입력 화면을 건너뛴다", () => {
  window.localStorage.setItem("chosung-nickname", "돌아온유저");
  render(<Home />);

  expect(screen.getByText("돌아온유저")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "혼자 하기" })).toHaveAttribute("href", "/single");
  expect(screen.queryByLabelText("닉네임")).not.toBeInTheDocument();
});

test("모드 선택 화면에서 닉네임을 다시 바꿀 수 있다", () => {
  window.localStorage.setItem("chosung-nickname", "예전닉");
  render(<Home />);

  fireEvent.click(screen.getByRole("button", { name: "닉네임 바꾸기" }));
  fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "새닉네임" } });
  fireEvent.click(screen.getByRole("button", { name: /변경하기/ }));

  expect(screen.getByText("새닉네임")).toBeInTheDocument();
  expect(window.localStorage.getItem("chosung-nickname")).toBe("새닉네임");
});
