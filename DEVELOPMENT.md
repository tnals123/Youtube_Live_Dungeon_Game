# 개발 현황 정리 (DEVELOPMENT.md)

마지막 업데이트: 2026-07-19 (전투력 시스템 + 패턴 엔진 + 등장 시퀀스까지)
게임 기획은 `GAME_DESIGN.md` 참고. 이 문서는 **무엇이 어디까지 구현됐는지**와
**이어서 개발할 때 알아야 할 것**을 정리한다.

## 실행 방법

- 서버: `start_server.bat` (venv 활성화 + UTF-8 설정 포함) → http://localhost:5000
- 개발 화면: `localhost:5000` (디버그 패널 포함)
- OBS 송출: `localhost:5000/stream.html` (1080×1920, 디버그 UI 없음)
- **던전 에디터**: `localhost:5000/tool.html` (콘텐츠는 전부 여기서 편집)

## 아키텍처

```
backend/
  server.py            # 단일 파일 서버: Flask + SocketIO + 게임 루프 + 에디터 API
  dungeons/
    dark_catacomb.json # 던전 데이터 (에디터가 저장, 서버가 리로드)
docs/                  # (구 frontend/ - GitHub Pages가 /docs 폴더만 인식해서 이름 변경)
  index.html           # 개발용 (디버그 패널 + 미리보기 크기 선택)
  demo.html            # 서버 없이 혼자 플레이하는 정적 데모 (GitHub Pages용)
  stream.html          # OBS 송출용 ⚠️ 스크립트 목록을 index.html과 항상 동기화할 것
  tool.html            # 던전 에디터 (층 구성/전투/탐험/애니메이션/배치)
  js/
    game.js            # Phaser 설정(1080×1920 고정), 씬 등록, SKILL_ICONS 매핑
    socket.js          # 서버 이벤트 → 씬 라우팅 (씬 전환 연출 포함)
    monsterAnim.js     # plist 파서 + 애니메이션 자동 생성 + anim.json 클립/메타
    scenes/
      LobbyScene.js        # 참가 모집 (모든 에셋 프리로드 담당)
      DungeonEntryScene.js # 던전 입장 브리핑 (1회) + 확대/암전 퇴장 연출
      ExploreScene.js      # 탐험 투표 (실시간 투표 막대)
      BattleScene.js       # 모든 전투 (일반+보스, 패턴 UI 포함)
      BossScene.js         # (사용 중단 - BattleScene으로 통합됨)
  assets/
    monsters/          # 몬스터이름.png + .plist + .anim.json (에디터가 생성)
    sounds/            # 공격 사운드 (mp3/ogg/wav)
    skillIcon/         # 스킬 아이콘 10개
    backgrounds/       # 1층.png, 던전 background.png, 던전_입장.png
    images/그림자.png   # 몬스터 그림자 (없으면 타원 폴백)
```

## 게임 흐름 (구현 완료, 실서버 검증됨)

```
로비 (60초 모집, 참가자 0명이면 자동 연장)
  → 던전 입장 브리핑 (8초, 던전 시작 시 1회만. 스크롤 연출 + 전 몬스터 프리로드)
  → 층(방) 순서대로 진행:  ⚠️ 층 하나 = 콘텐츠 하나 (에디터의 층 목록 = 게임 순서)
      · type: "explore" → 투표 이벤트 1개 (갈림길/상자, 다수결, 동표 랜덤)
      · type: "battle"  → 전투 (normal: 몬스터가 주기 공격 / boss: 패턴 순환)
  → 층 클리어 결과(12초) → 다음 층 (짧은 암전 0.5초 전환, 브리핑 없음)
  → 마지막 층 클리어 = 🏆 던전 정복 연출 → 로비 리셋
  → 파티 HP 0 = 전멸 → 로비 리셋 (참가자 초기화)
```

- **전투력 시스템** (파티 HP 대체): 파티 자원 = 전투력 = 참가자 기여도(등급 배율)의 합
  (브리핑 TOTAL POWER와 동일 수치). 내부 필드명은 `party_hp`/`party_max_hp` 그대로 사용
  - 모든 피해(함정/몬스터 공격/패턴 실패)는 **최대 전투력의 %** 단위 (인원수 무관 밸런스)
  - 전투력이 깎인 비율만큼 모두의 공격 데미지 감소 (하한 `DEAL_REDUCTION_FLOOR`=30%)
  - /힐 = 전투력 회복 (등급 배율 비례). 전투력 0 = 전멸. 난입자는 전투력에 즉시 합류
- 상자 보상 버프(atk_buff_20): **다음 전투 1회**에 적용 후 소진
- 게임 상태는 서버 메모리(딕셔너리). 영속화 없음 (서버 재시작 = 리셋)

## 몬스터 등장 시퀀스 (전투 층 공통)

- 씬 진입(배경만) → "N층 : (등장 문구)" 배너(`intro_sec`초 유지, 에디터 설정)
  → 몬스터 + 그림자 + 몬스터HP바 + 전투력바 **페이드인** + "몬스터가 나타났습니다!" 안내
- **서버는 연출이 끝날 때까지 전투 로직 대기** (`battle_logic_delay` = intro_sec + 3초)
  — 몬스터 공격 쿨타임과 패턴 타이머가 그 후에 시작됨
- 플로팅 데미지: 몬스터 아래쪽 랜덤 위치, 1.8초 유지 (`spawnDamageText`에서 조절)

## 보스 패턴 엔진 (구현 완료, 게임의 심장)

- **패턴 = 커맨드별 가중치 점수표** (`scores: {"/역산": 0.5, "/공격": -0.3}`)
  - 게이지(0~100)는 `pattern_state["gauge_total"]`에 **유효한 입력 하나하나가 무제한 누적**되는
    절대 점수제 (인원수 정규화 없음, 1인당 반영 횟수 제한도 없음 — 같은 사람이 같은 커맨드를
    반복 입력해도 매번 그대로 더해짐. 예전 "역할별 최대치 대비 비율" 방식에서 변경됨).
    예: 0.5점 커맨드가 총 140번 입력되면 70점(성공선) 도달. 필요 횟수는 점수 크기·성공선으로
    콘텐츠 제작자가 직접 튜닝
  - **정답은 화면에 절대 노출 안 함** — 게이지의 실시간 반응(뜨겁다/차갑다)으로 시청자들이 파훼법을 발견
  - 음수 점수로 반전 패턴 가능 ("공격하면 게이지 하락" = 흡혈 패턴)
- 흐름: 딜타임(`pattern_interval_sec`) → 텔레그래프+입력 창(`window_sec`) → 판정 → 결과 5초 → 순환
- 실패 피해 = `power_damage_pct × (1 − 게이지/100)` — 87% 실패는 살짝, 10% 실패는 참사. 실패해도 파훼율 %가 공개돼 다음 사이클의 힌트가 됨
- 입력은 handle_action에서 `record_pattern_input()`으로 기록 (역할 검증 포함, `pattern_state["inputs"]`엔
  참여자별 마지막 커맨드만 남지만 게이지 자체는 매 입력이 누적됨)
- 패턴 애니메이션: `telegraph_anim`(준비 모션)/`resolve_anim`(공격 모션) — anim.json 클립 참조, 없으면 attack→idle 폴백
- ⚠️ **BossScene은 사용 중단** — 모든 전투(normal/boss)는 BattleScene으로 통합됨. 패턴 UI(텔레그래프+게이지)는 BattleScene에 있음

## 명령어 / 스킬 (서버 `ROLES`, `ATTACK_SKILLS`)

- 참가: `/참가` 또는 `!참가` (역할·등급 랜덤), `/내역할`·`!내정보` (아직 채팅응답만, 오버레이 미구현)
- 공격 스킬은 **자기 역할만 발동**, 데미지 = random(100~500) × 등급배율 × 계수 (크리 15% ×2):

| 역할 | 스킬 (계수) |
|---|---|
| 전사 | /강타(1.2) /방어(패턴용) |
| 궁수 | /저격(1.2) /퇴격(0.8) |
| 마법사 | /파이어볼(1.3) /역산(패턴용) |
| 힐러 | /힐(회복) /정화(패턴용) |
| **행인** | /돌팔매(고정 30~80) /함성(응원 게이지) |
| 공통 | /공격(0.5, 정식 역할만) |

### 행인 (공통 직업, 영웅 대체)

- **/참가 없이** 언제든 /돌팔매·/함성·탐험 투표를 치면 그 순간 자동 등록 (참가 카드 없이 조용히)
- 랜덤 배정 안 됨(weight 0), **파티 전투력 미포함**, MVP 후보 제외
- /돌팔매: 고정 소량 데미지 (등급·전투력 딜감소 무관, 크리 가능) — 수백 명이면 태산
- /함성: 응원 게이지 +1, 임계치(max(5, 행인 수)) 도달 시 **파티 전투력 +5% 회복** (사기 충천 연출)
  + 패턴 점수표에 /함성이 있으면 게이지 입력으로도 동작 (기존 절규 패턴)
- 스킬 프레임 5번째 칸: 금색 테두리 + **「미참가자 전용」** 배지

- `/방어 /역산 /정화 /함성`은 직접 효과 없음 — **보스 패턴의 게이지 입력용** (점수표에 따라 게이지 반응)
- ⚠️ 스킬 표를 바꾸면 3곳 동기화: `server.py ROLES/ATTACK_SKILLS`, `BattleScene.roleSkills`, 아이콘(`game.js SKILL_ICONS`)

## 몬스터 시스템 (에디터 기반)

몬스터 추가 절차: ① `assets/monsters/`에 `이름.png`(시트) + `이름.plist` → ② 에디터에서 층에 배치 + 설정 → ③ 저장.

- `monsterAnim.js`가 plist(cocos2d format 2/3) 해석 → 프레임 이름으로 idle/attack/death 자동 분류 (숫자로 순서). **회전(rotation) 내보내기 금지**
- `이름.anim.json` (에디터가 저장):
  - `clips`: 커스텀 클립 (프레임 구간 잘라서 attack1 등 — 보스 패턴 애니메이션용)
  - `meta`: `attack_hit_frame`(타격 순간 프레임), `attack_sound`, `scale`, `y_offset`, `shadow_y`, `shadow_scale`
- 게임 적용: 타격 프레임 순간에 흔들림+사운드+HP반영 / 그림자(`assets/images/그림자.png`, 없으면 타원) / NEAREST 필터로 픽셀 유지 확대
- 폴백 체인: 파일 없음 → 이모지 표시 (게임 안 깨짐)

## 던전 에디터 (tool.html)

- 층 목록(순서=게임 진행), [➕전투 층] [➕탐험 층], ⬆⬇ 순서 이동, 삭제
- [⚔️ 전투] 탭: 몬스터 선택, normal/boss, **등장 문구·배너 시간(초)**, HP, 공격 주기/데미지%/문구, 타격 프레임(슬라이더+프레임 미리보기), 사운드, **배치 미리보기**(실제 층 배경 위에서 idle 재생하며 크기/Y오프셋/그림자 조정)
- [🧭 탐험] 탭: 종류(갈림길/상자), 문구, 선택지 2개, 정답, 투표시간, 정답/오답 결과·피해·보상
- [👑 패턴] 탭: 패턴 목록, 텔레그래프/입력시간/성공선/실패피해%, 커맨드 점수표(11개), 준비·공격 모션(클립 연결)
- [🎬 애니메이션] 탭: 프레임 구간 선택 → 커스텀 클립 생성 (+사용 패턴 메모)
- 💾 던전 저장: 던전 JSON + 몬스터 anim.json 일괄 저장, **서버 즉시 리로드** (재시작 불필요)
- ⚠️ 에디터의 `GAME` 상수(tool.html)와 `BattleScene`의 상수(MONSTER_Y=1080, BG_OFFSET_Y=-135, BG_OVERSCAN=400, MONSTER_TARGET_HEIGHT=400, 그림자 기준폭 300)는 **반드시 같이 수정**

## 테스트 도구 (디버그 패널 + API)

- 패널: Test Join(1/5/20), Reset, ⏩ Skip Phase, 💥 Kill Boss, 💀 Wipe, ⚡ 스킬 테스트 10버튼(해당 역할 없으면 봇 자동생성), 🎬 에디터 열기
- API: `/api/state`(상태 조회), `/api/skip`, `/api/test/join_many/N`, `/api/test/vote/N/옵션`, `/api/test/skill/스킬명`, `/api/test/attack/N`, `/api/test/kill_boss`, `/api/test/goto/층`, `/api/test/wipe`, `/api/reset`
- 에디터 API: `/api/tool/monsters|sounds|dungeon|save_dungeon|save_anim/<name>`

## 유튜브 연동 (구현됨, 실방송 미검증)

- pytchat으로 채팅 수신 (`youtube_chat_listener`), 슈퍼챗 등급 보상 처리
- 디버그 패널에서 Video ID 입력 → Connect
- ⚠️ pytchat은 비공식 → 깨지면 `chat-downloader`나 공식 API로 교체 (수신부 함수 하나만 바꾸면 됨)
- ⚠️ 방송 설정 **초저지연** 필수. 판정 지연 1~3초, 체감 4~8초 → 입력 창 20초+ 유지

## 콘텐츠/에셋 TODO (에디터·에셋 작업)

- 보스 몬스터 스프라이트 없음: 4층 사제(🧟)·6층 군주(👹)는 아직 이모지 폴백
  → 시트+plist 추가 후 패턴별 telegraph/resolve 클립 자르기
- `assets/sounds/` 비어 있음 (공격음 등). BGM·승리/패배음은 기능 자체가 미구현
- `assets/images/그림자.png` 없으면 타원 폴백 중
- 로비 상단 "어둠의 던전 1층" 문구 하드코딩 (던전 이름과 연동 안 됨)
- 탐험 씬 배경이 구 던전 배경 (1층.png 픽셀 톤과 불일치)
- 골드(참가 시 1000G) 미사용 — 상점/보상 기획 필요 시 추가
- 던전 1개 고정 (dark_catacomb) — 복수 던전 로테이션은 추후

## 다음 개발 순서 (우선순위)

1. **/내역할 오버레이** — 화면 표시(3초 큐) + 1인당 쿨타임 60초 (pytchat은 채팅 답장 불가)
2. **공격 로그/이벤트 배칭** — 수백 명 동시 입력 대비 0.5초 묶음 표시
3. **리허설 봇** — 가짜 시청자 N명이 자동 참가/투표/스킬 (배칭 검증 + 방송 리허설)
4. **실방송 테스트** ⚠️ 최대 리스크 — pytchat을 실제 유튜브 라이브에 아직 한 번도 연결 안 해봄.
   비공개 라이브로 채팅→참가→스킬 동작 + 지연 실측. 실패 시 chat-downloader 교체
5. **콘텐츠/밸런스** — 던전 확장(10층), 패턴 다양화, % 수치 튜닝
6. (아이디어) 고등급 전용 캐리 스킬(전설 전사가 패턴을 혼자 막는 등), MVP 개인 스포트라이트

## 개발 시 주의사항 (하드런 교훈)

- venv는 **Windows용** (`venv/Scripts/python.exe`). WSL에서 실행 시 `PYTHONUTF8=1 WSLENV=PYTHONUTF8` 필요 (cp949 이모지 크래시)
- flask-socketio는 `allow_unsafe_werkzeug=True` 필요 (이미 적용, 로컬 전용이라 OK)
- WSL에서 서버 백그라운드 실행 후 중지해도 **python.exe가 살아남음** → `tasklist | findstr python` 확인 후 taskkill. 중복 서버가 뜨면 상태가 뒤죽박죽돼 보임
- `stream.html`은 스크립트 목록을 수동 관리 → **씬 파일 추가 시 index.html과 둘 다 수정**
- Phaser `game.scene.start()`는 이전 씬을 안 멈춤 → 반드시 `socket.js`의 `switchScene()`/`startWithEntryTransition()` 사용
- 씬이 없는 상태에서 도착하는 소켓 이벤트는 유실됨 → `pendingExploreEvent` 패턴처럼 보관 후 전달
- 좌표계는 항상 1080×1920 고정 (미리보기/송출은 스케일만 됨)
