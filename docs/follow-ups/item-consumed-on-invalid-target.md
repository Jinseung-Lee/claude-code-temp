# 유효하지 않은 대상 지정 시 아이템이 소모됨

`lib/game/room-store.ts`의 `applyItemUse`가 `targetId` 유효성 검사(`!targetId`, 대상 없음)보다 먼저 `player.items.splice(...)`로 아이템을 인벤토리에서 제거한다. 정상 UI 흐름에서는 공격형 아이템 사용 시 항상 대상을 먼저 선택하므로 재현되지 않지만, API를 직접 호출하거나 향후 UI가 바뀌면 검증 실패 요청에도 아이템이 소모되는 문제가 발생한다. 검증을 `splice` 이전으로 옮기는 정도의 수정이 필요하다.
