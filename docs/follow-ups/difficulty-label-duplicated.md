# DIFFICULTY_LABEL이 두 파일에 중복 정의됨

`app/single/page.tsx`와 `app/rooms/[code]/page.tsx`에 동일한 `DIFFICULTY_LABEL`(하/중/상 매핑) 상수가 각각 정의돼 있다. `lib/game`의 공용 상수로 추출해 재사용하면 두 화면의 라벨이 어긋날 위험을 없앨 수 있다.
