# wrongPlayerIds가 기록만 되고 쓰이지 않음

`RoundState.wrongPlayerIds`(`lib/game/types.ts`)가 `submitAnswer`의 오답 분기에서 채워지지만 `serializeForPlayer`나 클라이언트 어디에서도 읽히지 않는다. 라운드 중 누가 오답을 냈는지 보여주는 기능을 의도했던 것으로 보이나 UI에 연결되지 않았다. 기능으로 살리거나 필드를 제거하는 정리가 필요하다.
