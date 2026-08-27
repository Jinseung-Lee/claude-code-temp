import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import Home from "@/app/page";

test("홈 화면은 제목과 싱글/멀티 진입 링크를 보여준다", () => {
  render(<Home />);

  expect(screen.getByRole("heading", { level: 1, name: "초성게임" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "혼자 하기" })).toHaveAttribute("href", "/single");
  expect(screen.getByRole("button", { name: "방 만들기" })).toHaveAttribute("href", "/rooms/new");
});
