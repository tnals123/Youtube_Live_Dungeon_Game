# -*- coding: utf-8 -*-
"""
던전 레이드 - 메인 서버
YouTube 라이브 채팅 연동 + WebSocket 게임 서버
"""

from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit
import threading
import json
import random
import re
import time
import os
import uuid

# ============ Flask 앱 설정 ============
app = Flask(__name__, static_folder='../frontend', static_url_path='')
app.config['SECRET_KEY'] = 'dungeon-raid-secret-key'
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ============ 페이즈 시간 설정 ============
LOBBY_SEC = 60           # 참가 모집 시간
DUNGEON_ENTRY_SEC = 8    # 던전 입장 브리핑 시간
RESULT_SEC = 12          # 층 클리어/전멸 결과 표시 시간
EXPLORE_RESULT_SEC = 6   # 탐험 선택 결과 표시 시간

# ============ 던전 데이터 로드 ============
DUNGEON_FILE = os.path.join(os.path.dirname(__file__), 'dungeons', 'dark_catacomb.json')
dungeon_data = None

def load_dungeon():
    """던전 JSON 로드 (정답은 서버에만 존재, 화면에 노출 금지)"""
    global dungeon_data
    try:
        with open(DUNGEON_FILE, encoding='utf-8') as f:
            dungeon_data = json.load(f)
        print(f"[던전] 로드 완료: {dungeon_data['name']} ({len(dungeon_data['floors'])}층)")
    except Exception as e:
        dungeon_data = None
        print(f"[던전] 로드 실패: {e} - 기본 보스전만 진행됩니다")

def get_floor_config(floor):
    """해당 층 설정 반환 (없으면 None)"""
    if dungeon_data:
        for f in dungeon_data["floors"]:
            if f["floor"] == floor:
                return f
    return None

def dungeon_lang():
    """이 던전의 표시 언어 ('ko' | 'en') - 에디터의 '언어 모드' 체크박스로 설정"""
    return (dungeon_data or {}).get("language", "ko")

def loc(obj, key, default=""):
    """언어 모드에 맞는 텍스트 선택 - 영어 모드인데 <key>_en이 비어 있으면 한국어로 폴백
    (영어 텍스트를 안 채운 필드가 있어도 화면이 빈 채로 나오지 않게)"""
    if not obj:
        return default
    if dungeon_lang() == "en":
        en = obj.get(key + "_en")
        if en:
            return en
    return obj.get(key, default)

def collect_all_sound_files():
    """던전 전체에서 참조되는 모든 사운드 파일명을 모아 중복 없이 반환
    (몬스터별 사운드는 assets/monsters/<이름>.anim.json의 meta에서 읽어옴).
    브리핑 화면에서 이 목록을 통째로 미리 로딩해 층 전환 시 로딩 공백을 없앤다."""
    if not dungeon_data:
        return []

    sounds = set()
    dsounds = dungeon_data.get("sounds", {})
    for k, v in dsounds.items():
        if not v or k.endswith(("_volume", "_max")):
            continue
        # 역할별 공격 사운드는 등급당 여러 개(랜덤 선택용)를 배열로 저장할 수 있음
        if isinstance(v, list):
            sounds.update(f for f in v if f)
        else:
            sounds.add(v)

    monster_names = set()
    for f in dungeon_data.get("floors", []):
        battle = f.get("battle") or {}
        if battle.get("battle_bgm"):
            sounds.add(battle["battle_bgm"])

        sprite = battle.get("sprite", battle.get("name"))
        if sprite:
            monster_names.add(sprite)

        for pat in battle.get("patterns") or []:
            for key in ("telegraph_sfx", "success_sfx", "fail_sfx", "telegraph_loop_sound"):
                if pat.get(key):
                    sounds.add(pat[key])

        explore = f.get("explore")
        if explore:
            for outcome_key in ("on_correct", "on_wrong"):
                outcome = explore.get(outcome_key) or {}
                if outcome.get("sfx"):
                    sounds.add(outcome["sfx"])
            if explore.get("bgm"):
                sounds.add(explore["bgm"])
            if explore.get("ambient_sound"):
                sounds.add(explore["ambient_sound"])

    # 몬스터별 anim.json meta에서 attack_sound / death_sound / hit_sound 읽기
    for name in monster_names:
        anim_path = os.path.join(MONSTERS_DIR, name + '.anim.json')
        try:
            with open(anim_path, encoding='utf-8') as f:
                meta = json.load(f).get("meta", {})
            for key in ("attack_sound", "death_sound", "hit_sound"):
                if meta.get(key):
                    sounds.add(meta[key])
        except (FileNotFoundError, json.JSONDecodeError):
            pass

    return sorted(sounds)

# ============ 게임 데이터 ============
players = {}  # 시청자 데이터 {user_id: {name, role, grade, gold, damage, alive, weapon}}
game_state = {
    "phase": "lobby",      # lobby, dungeon, explore, boss, result, defeat
    "timer": LOBBY_SEC,    # 남은 시간(초)
    "floor": 1,            # 현재 층
    "boss_hp": 0,          # 보스 HP
    "boss_max_hp": 0,      # 보스 최대 HP
    "party_hp": 10000,     # 파티 HP
    "party_max_hp": 10000, # 파티 최대 HP
    "buffs": []            # 이번 층 획득 버프 (예: atk_buff_20)
}

# 탐험 페이즈 상태
explore_state = {
    "events": [],   # 현재 층 탐험 이벤트 목록
    "index": 0,     # 진행 중 이벤트 인덱스
    "stage": None,  # vote(투표 중) | result(결과 표시 중)
    "votes": {}     # user_id -> 선택 커맨드 (마지막 입력이 유효)
}
_last_vote_emit = 0.0  # 투표 현황 emit 스로틀용

# 전투 상태 (일반 몬스터)
current_battle = {}       # 현재 층 전투 설정
monster_attack_in = None  # 몬스터 다음 공격까지 남은 초 (None=공격 안 함)
# 등장 연출(배너+몬스터 페이드인) 동안 전투 로직 대기 - 클라이언트가 연출을 다 보여준 뒤
# 'battle_intro_done'을 보내오면 True (고정 초 카운트다운이 아니라 실제 연출 완료 신호 기반)
battle_logic_ready = False
battle_logic_deadline = 0  # 신호가 안 와도 무한 대기하지 않게 하는 안전장치(UNIX 시각)

# ============ 보스 패턴 상태 ============
# 패턴 = 커맨드별 가중치 점수표. 게이지(0~100)는 유효한 입력 하나하나가
# 무제한으로 누적되는 절대 점수제 - 같은 사람이 같은 커맨드를 반복해서
# 쳐도 매번 그대로 반영된다 (인원수/1인당 반영 횟수 제한 없음).
# 정답은 화면에 절대 노출하지 않고, 게이지의 "반응"으로만 파훼법을 찾게 한다
PATTERN_RESULT_SEC = 5    # 판정 결과 표시 시간
pattern_state = {
    "list": [],       # 이 보스의 패턴 목록
    "index": 0,       # 다음 패턴 인덱스 (순환)
    "stage": None,    # None(패턴 없음) | wait(딜타임) | window(입력 창) | result
    "timer": 0,
    "inputs": {},        # user_id -> 입력 창 동안 마지막 커맨드 (참여자 집계/디버그용)
    "gauge_total": 0.0,  # 게이지 원점수 누적. 정답(양수)은 1인당 1회만, 오답(음수)은 무제한 반영
    "scored_users": set(),  # 이번 입력 창에서 이미 정답 기여를 인정받은 user_id 집합 (도배 방지)
    "max_possible": 0.0     # 이번 패턴 시작 시점 살아있는 파티 구성 기준 "만점" 스냅샷
}
_last_gauge_emit = 0.0

# 커맨드 → 사용 가능 역할 검증용
UTIL_SKILL_ROLES = {"/방어": "warrior", "/역산": "mage", "/퇴격": "archer"}

def command_role_ok(cmd, role, pat=None):
    """해당 역할이 이 커맨드를 쓸 수 있는지. pat이 주어지면(패턴 입력 창 판정 시) 그 패턴
    전용 커스텀 커맨드(pat['custom_commands'])도 함께 인정한다 - 고정 9개 스킬과 달리
    패턴마다 자유롭게 만든 커맨드라, 지금 열려있는 그 패턴의 목록에서만 유효하다."""
    if cmd in ATTACK_SKILLS:
        need = ATTACK_SKILLS[cmd]["role"]
        if need is None:
            return True  # /공격은 전 역할 허용
        return need == role
    if cmd == HEAL_SKILL:
        return role == "healer"
    if cmd in UTIL_SKILL_ROLES:
        return UTIL_SKILL_ROLES[cmd] == role
    if pat:
        for c in pat.get("custom_commands") or []:
            if c.get("cmd") == cmd:
                need = c.get("role")
                return not need or need == role
    return False

# 최근 참가자 큐 (화면 표시용)
recent_joins = []
MAX_RECENT_JOINS = 50

# ============ 역할 설정 ============
ROLES = {
    "warrior": {
        "name": "전사",
        "name_en": "Warrior",
        "emoji": "⚔️",
        "color": "#FF6B6B",
        "weight": 35,
        "commands": ["/강타", "/방어"]
    },
    "archer": {
        "name": "궁수",
        "name_en": "Archer",
        "emoji": "🏹",
        "color": "#4ECDC4",
        "weight": 30,
        "commands": ["/저격", "/퇴격"]
    },
    "mage": {
        "name": "마법사",
        "name_en": "Mage",
        "emoji": "🔮",
        "color": "#9B59B6",
        "weight": 20,
        "commands": ["/파이어볼", "/역산"]
    },
    "healer": {
        "name": "힐러",
        "name_en": "Healer",
        "emoji": "💚",
        "color": "#2ECC71",
        "weight": 15,
        "commands": ["/힐", "/정화"]
    }
}

def role_name(role):
    return ROLES[role]["name_en"] if dungeon_lang() == "en" else ROLES[role]["name"]

# ============ 스킬 설정 ============
# 공격 스킬: 자기 역할 스킬만 발동. coef = 데미지 계수
# /공격 은 누구나 가능하지만 약함 (자기 스킬을 쓰도록 유도)
ATTACK_SKILLS = {
    "/공격":     {"role": None,      "coef": 0.5, "label": "공격"},
    "/강타":     {"role": "warrior", "coef": 1.2, "label": "강타"},
    "/저격":     {"role": "archer",  "coef": 1.2, "label": "저격"},
    "/파이어볼": {"role": "mage",    "coef": 1.3, "label": "파이어볼"},
    "/정화":     {"role": "healer",  "coef": 0.8, "label": "정화"}
}

# 유틸 스킬 (/방어 /역산 /퇴격): 보스 패턴 파훼 전용, 데미지 없음 - 패턴 시스템에서 판정
# (참고: /정화는 ATTACK_SKILLS에도 있어서 패턴 파훼용으로 쓰면서 동시에 자동 공격도 됨 -
#  record_pattern_input()이 ATTACK_SKILLS 여부와 무관하게 항상 먼저 판정하기 때문)
HEAL_SKILL = "/힐"  # 힐러 전용: 파티 HP 회복

# ============ 명령어 영어 별칭 ============
# 영어 모드 시청자도 채팅으로 참여할 수 있게, 아래 영어 명령어를 내부 정규 한국어 명령어로
# 즉시 치환한다(handle_command 진입점 한 곳에서만). 이후 모든 로직(ATTACK_SKILLS,
# UTIL_SKILL_ROLES, 패턴 커맨드 점수표 등)은 지금처럼 한국어 커맨드 문자열만 알면 된다 -
# 즉 두 언어를 동시에 받되, 내부적으로는 한국어 하나로 통일해서 다루는 방식.
CMD_ALIASES = {
    "/join": "/참가", "!join": "!참가",
    "/myinfo": "/내정보", "!myinfo": "!내정보",
    "/role": "/내역할", "!role": "!내역할",
    "/attack": "/공격",
    "/strike": "/강타",
    "/snipe": "/저격",
    "/fireball": "/파이어볼",
    "/purify": "/정화",
    "/heal": "/힐",
    "/defend": "/방어",
    "/reflect": "/역산",
    "/retreat": "/퇴격",
}

def normalize_command(message):
    """영어 별칭 명령어를 내부 정규 한국어 명령어로 치환 (대소문자 무관, 그 외엔 원문 유지)"""
    return CMD_ALIASES.get(message.lower(), message)

# 한국어 정규 커맨드 → 영어 별칭 역방향 조회 (패턴 힌트를 영어 모드에서 보여줄 때 사용).
# 패턴별 커스텀 커맨드(custom_commands)는 여기 없으니 그대로(원문) 표시된다.
CMD_DISPLAY_EN = {ko: en for en, ko in CMD_ALIASES.items()}

def command_display(cmd):
    """이 커맨드의 화면 표시용 문자열 - 영어 모드면 영어 별칭(있으면), 아니면 원본 그대로"""
    if dungeon_lang() == "en" and cmd in CMD_DISPLAY_EN:
        return CMD_DISPLAY_EN[cmd]
    return cmd

# ============ 자동 전투 루프 ============
# 공격/힐 커맨드 1회 = 전투 시작. 이후 등급별 주기(초)로 자동 반복.
# 같은 커맨드를 도배해도 주기는 리셋되지 않는다 (스팸 이득 없음).
# 전투 상태는 층(전투) 시작 시 초기화 - 층마다 다시 커맨드를 쳐야 참전
ATTACK_PERIODS = {"common": 4.0, "uncommon": 3.5, "rare": 3.0, "epic": 2.5, "legendary": 1.5}
COMBAT_TICK = 0.5  # 전투 틱 간격(초) - 틱마다 주기 도래한 인원을 일괄 처리

def get_attack_period(grade):
    """등급별 공격 주기(초) - 던전 JSON의 attack_periods(에디터에서 등급별로 설정)가 있으면
    그 등급 값을 우선 쓰고, 없으면(그 등급을 안 정했거나 dungeon_data 자체가 없으면)
    ATTACK_PERIODS 기본값으로 폴백"""
    overrides = (dungeon_data or {}).get("attack_periods") or {}
    return overrides.get(grade, ATTACK_PERIODS[grade])

# ============ 등급 설정 ============
GRADES = {
    "legendary": {
        "name": "전설",
        "name_en": "Legendary",
        "weight": 1,
        "multiplier": 100,
        "color": "#FFD700",
        "display_time": 4000
    },
    "epic": {
        "name": "영웅",
        "name_en": "Epic",
        "weight": 4,
        "multiplier": 50,
        "color": "#9B59B6",
        "display_time": 4000
    },
    "rare": {
        "name": "희귀",
        "name_en": "Rare",
        "weight": 15,
        "multiplier": 20,
        "color": "#3498DB",
        "display_time": 4000
    },
    "uncommon": {
        "name": "고급",
        "name_en": "Uncommon",
        "weight": 30,
        "multiplier": 5,
        "color": "#2ECC71",
        "display_time": 4000
    },
    "common": {
        "name": "일반",
        "name_en": "Common",
        "weight": 50,
        "multiplier": 1,
        "color": "#95A5A6",
        "display_time": 4000
    }
}

def grade_name(grade):
    return GRADES[grade]["name_en"] if dungeon_lang() == "en" else GRADES[grade]["name"]

# ============ 전투력 시스템 ============
# 파티의 공유 자원 = 전투력 (참가자 기여도의 합, 브리핑의 TOTAL POWER와 동일)
# - 함정/몬스터 공격/패턴 실패 → 최대 전투력의 % 만큼 감소 ("파티 일부가 쓰러졌다"는 설정)
# - 전투력 0 = 전멸
# (예전엔 전투력이 깎인 비율만큼 딜도 같이 줄어드는 로직이 있었으나, "목표 처치 시간" 기반
#  체력 자동 계산이 풀딜을 가정하고 역산하는 것과 충돌해서 제거함 - 딜이 도중에 줄면 실제
#  처치 시간이 목표보다 계속 밀려버림)

# ============ 게임 로직 함수 ============
def get_random_role():
    """역할 랜덤 뽑기"""
    roles = list(ROLES.keys())
    weights = [ROLES[r]["weight"] for r in roles]
    return random.choices(roles, weights=weights)[0]

def get_random_grade():
    """등급 랜덤 뽑기"""
    grades = list(GRADES.keys())
    weights = [GRADES[g]["weight"] for g in grades]
    return random.choices(grades, weights=weights)[0]

def get_party_stats():
    """파티 통계 계산"""
    stats = {
        "total": len(players),
        "warrior": 0,
        "archer": 0,
        "mage": 0,
        "healer": 0,
        "grades": {
            "legendary": 0,
            "epic": 0,
            "rare": 0,
            "uncommon": 0,
            "common": 0
        }
    }

    for player in players.values():
        stats[player["role"]] += 1
        stats["grades"][player["grade"]] += 1

    return stats

def apply_power_damage(pct_of_max):
    """최대 전투력의 pct% 만큼 전투력 감소. 실제 감소량 반환"""
    if pct_of_max <= 0:
        return 0
    dmg = game_state["party_max_hp"] * pct_of_max / 100.0
    game_state["party_hp"] = max(0, game_state["party_hp"] - dmg)
    return dmg

def power_payload():
    """전투력 상태 공통 페이로드"""
    return {
        "party_hp": round(game_state["party_hp"], 1),
        "party_max_hp": round(game_state["party_max_hp"], 1)
    }

def get_total_power():
    """파티 총 전투력 (카드에 표시되는 기여도 +N 그대로 합산)"""
    return sum(
        GRADES[p["grade"]]["multiplier"]
        for p in players.values()
    )

# 역할별 "주력" 공격 스킬 - 예상 DPS 계산에서 이 스킬을 쓴다고 가정 (힐러는 제외:
# 정화/힐 중 뭘 쓸지 알 수 없어서 안전하게 딜 예상에서 빼둠 - 실제로는 이보다 빨리
# 잡힐 수는 있어도 이 예상보다 오래 걸리진 않음)
ROLE_PRIMARY_ATTACK_SKILL = {"warrior": "/강타", "archer": "/저격", "mage": "/파이어볼"}
AVG_BASE_DAMAGE = 300       # base_damage = random.randint(100, 500)의 평균
AVG_CRIT_MULT = 0.85 + 0.15 * 2  # 15% 확률 2배 크리티컬의 기댓값 배율 = 1.15

def expected_party_dps():
    """현재 접속 인원 구성 기준 예상 초당 데미지 총합 (근사치 - 전투력 손실로 인한
    딜 감소는 반영 안 함). 몬스터 체력을 "목표 처치 시간"으로 역산할 때 사용."""
    total = 0.0
    for p in players.values():
        if not p["alive"]:
            continue
        skill = ROLE_PRIMARY_ATTACK_SKILL.get(p["role"])
        if not skill:
            continue
        coef = ATTACK_SKILLS[skill]["coef"]
        mult = GRADES[p["grade"]]["multiplier"]
        period = get_attack_period(p["grade"])
        total += AVG_BASE_DAMAGE * mult * coef * AVG_CRIT_MULT / period
    return total

def get_mvp_candidates(limit=6):
    """MVP 후보 (등급 높은 순, 같으면 먼저 참가한 순)"""
    ranked = sorted(
        players.values(),
        key=lambda p: (-GRADES[p["grade"]]["multiplier"], p["joined_at"])
    )
    # job/grade는 원본 키(warrior/legendary 등)로 보낸다 - 표시 문구(role_name/grade_name)로
    # 바꿔 보내면 DungeonEntryScene.js의 등급순 정렬이 언어에 따라 깨진다 (get_damage_ranking()과
    # 동일하게, 로컬라이즈는 항상 클라이언트가 키를 보고 직접 한다)
    return [
        {
            "name": p["name"],
            "job": p["role"],
            "grade": p["grade"]
        }
        for p in ranked[:limit]
    ]

# ============ 진형(Formation) 시스템 ============
# 화면에 개별 스프라이트로 표시할 역할별 최대 슬롯 수.
# 등급 높은 순(같으면 먼저 참가한 순)으로 슬롯을 차지하고,
# 밀려난 인원은 overflow 숫자("+N명")로만 표시된다.
# 역할별 "한 줄" 정원. 전사·궁수·마법사는 진형이 2줄이라 총 정원 = 이 값 x ROLE_ROWS,
# 힐러는 1줄이라 그대로. 프론트(formation.js ROW_COUNTS/ROLE_ROWS)와 반드시 일치해야 함.
FORMATION_SLOTS = {"warrior": 12, "archer": 11, "mage": 12, "healer": 12}
FORMATION_ROWS = {"warrior": 2, "archer": 2, "mage": 2, "healer": 1}

def formation_payload():
    roster = {}
    for role, per_row in FORMATION_SLOTS.items():
        limit = per_row * FORMATION_ROWS.get(role, 1)
        members = sorted(
            ((uid, p) for uid, p in players.items() if p["role"] == role),
            key=lambda e: (-GRADES[e[1]["grade"]]["multiplier"], e[1]["joined_at"])
        )
        roster[role] = {
            "units": [
                {"user_id": uid, "name": p["name"], "grade": p["grade"], "alive": p["alive"]}
                for uid, p in members[:limit]
            ],
            "overflow": max(0, len(members) - limit)
        }
    return roster

def emit_formation():
    socketio.emit('formation_update', formation_payload())

def handle_join(user_name, user_id, forced_grade=None):
    """시청자 참가 처리. forced_grade가 유효한 등급이면 그 등급으로 고정
    (테스트용 - 등급별 참가 카드 사운드 확인 등), 아니면 평소처럼 랜덤 추첨"""
    global recent_joins

    if user_id in players:
        return None  # 이미 참가함

    role = get_random_role()
    grade = forced_grade if forced_grade in GRADES else get_random_grade()

    player_data = {
        "name": user_name,
        "role": role,
        "grade": grade,
        "gold": 1000,
        "damage": 0,
        "heal": 0,
        "alive": True,
        "weapon": None,
        "joined_at": time.time()
    }

    players[user_id] = player_data

    # 던전 진행 중 난입하면 전투력에 즉시 합류
    if game_state["phase"] != "lobby":
        mult = GRADES[grade]["multiplier"]
        game_state["party_max_hp"] += mult
        game_state["party_hp"] += mult

    # 참가 정보 생성
    join_info = {
        "user_id": user_id,
        "name": user_name,
        "role": role,
        "role_name": role_name(role),
        "role_emoji": ROLES[role]["emoji"],
        "role_color": ROLES[role]["color"],
        "grade": grade,
        "grade_name": grade_name(grade),
        "grade_color": GRADES[grade]["color"],
        "multiplier": GRADES[grade]["multiplier"],
        "display_time": GRADES[grade]["display_time"],
        "timestamp": time.time()
    }

    # 최근 참가자 큐에 추가
    recent_joins.append(join_info)
    if len(recent_joins) > MAX_RECENT_JOINS:
        recent_joins.pop(0)

    # 프론트엔드로 전송
    socketio.emit('player_joined', join_info)

    # 파티 통계 업데이트
    socketio.emit('party_stats', get_party_stats())
    emit_formation()

    print(f"[참가] {user_name} - {GRADES[grade]['name']} {ROLES[role]['name']} (+{GRADES[grade]['multiplier']})")

    return join_info

def handle_info_request(user_name, user_id):
    """!내정보 명령어 처리"""
    if user_id not in players:
        return f"@{user_name} 먼저 !참가 해주세요!"

    p = players[user_id]
    role_info = ROLES[p['role']]
    grade_info = GRADES[p['grade']]

    status = "✅생존" if p['alive'] else "💀사망"

    info = f"@{user_name} {role_info['emoji']}{role_info['name']} "
    info += f"{grade_info['name']}(x{grade_info['multiplier']}) | "
    info += f"💰{p['gold']}G | 딜량:{p['damage']} | {status}"

    return info

def handle_command(user_name, user_id, message):
    """채팅 명령어 처리 (/와 ! 접두사 모두 허용, 영어 별칭도 여기서 한국어로 정규화)"""
    message = normalize_command(message.strip())

    if message in ("/참가", "!참가"):
        if user_id in players:
            return f"@{user_name} 이미 참가 중입니다!"
        if game_state["phase"] not in ("lobby", "boss"):
            return f"@{user_name} 다음 전투에서 참가할 수 있습니다!"
        handle_join(user_name, user_id)
        return None  # 화면에서 처리됨

    elif message in ("/내정보", "!내정보", "/내역할", "!내역할"):
        return handle_info_request(user_name, user_id)

    elif is_explore_vote(message):
        return handle_vote(user_name, user_id, message)

    elif message.startswith("/"):
        return handle_action(user_name, user_id, message)

    return None

def resolve_vote_option(event, message):
    """메시지가 이 이벤트의 선택지와 일치하면 정규(한국어) 옵션 문자열을 반환, 아니면 None.
    영어 모드용 옵션 별칭(options_en, 같은 인덱스끼리 대응)도 함께 인식 - 매칭/집계/정답
    비교는 항상 이 정규 한국어 옵션 기준으로 이뤄지고, 화면 표시만 display_option()으로 언어에
    맞게 바뀐다"""
    options = event.get("options") or []
    if message in options:
        return message
    options_en = event.get("options_en") or []
    lower = message.lower()
    for i, opt_en in enumerate(options_en):
        if opt_en and i < len(options) and lower == opt_en.strip().lower():
            return options[i]
    return None

def display_option(event, kr_option):
    """옵션 하나의 화면 표시용 텍스트 - 영어 모드면 그 옵션의 영어 별칭(없으면 한국어로 폴백)"""
    if dungeon_lang() != "en":
        return kr_option
    options = event.get("options") or []
    options_en = event.get("options_en") or []
    if kr_option in options:
        i = options.index(kr_option)
        if i < len(options_en) and options_en[i]:
            return options_en[i]
    return kr_option

def is_explore_vote(message):
    """현재 탐험 투표 중이고, 메시지가 선택지 커맨드인지(한국어 원본 또는 영어 별칭)"""
    if game_state["phase"] != "explore" or explore_state["stage"] != "vote":
        return False
    if not explore_state["events"]:
        return False
    event = explore_state["events"][explore_state["index"]]
    return resolve_vote_option(event, message) is not None

def handle_vote(user_name, user_id, command):
    """탐험 선택지 투표 (참가자만, 마지막 입력이 유효) - 영어 별칭으로 왔어도 정규(한국어)
    옵션으로 정규화해서 저장하므로, 이후 집계/정답 판정 로직은 언어와 무관하게 그대로 동작"""
    global _last_vote_emit

    if user_id not in players:
        return f"@{user_name} 먼저 /참가 해주세요!"
    if not players[user_id]["alive"]:
        return None

    event = explore_state["events"][explore_state["index"]]
    canonical = resolve_vote_option(event, command)
    if canonical is None:
        return None
    explore_state["votes"][user_id] = canonical

    # 투표 현황 emit (0.3초 스로틀 - 수백 명 동시 입력 대비)
    now = time.time()
    if now - _last_vote_emit >= 0.3:
        _last_vote_emit = now
        socketio.emit('vote_update', get_vote_counts())

    return None

def get_vote_counts():
    """현재 투표 집계 (표시는 display_option()으로 언어에 맞게 변환된 키)"""
    event = explore_state["events"][explore_state["index"]]
    raw_counts = {opt: 0 for opt in event["options"]}
    for choice in explore_state["votes"].values():
        if choice in raw_counts:
            raw_counts[choice] += 1
    alive_total = sum(1 for p in players.values() if p["alive"])
    return {
        "counts": {display_option(event, opt): n for opt, n in raw_counts.items()},
        "voted": len(explore_state["votes"]),
        "alive_total": alive_total
    }

def handle_action(user_name, user_id, command):
    """게임 액션 처리 (전투 스킬)"""
    if user_id not in players:
        return f"@{user_name} 먼저 /참가 해주세요!"

    player = players[user_id]

    if not player["alive"]:
        return f"@{user_name} 사망 상태입니다. 부활을 기다리세요!"

    if game_state["phase"] != "boss":
        return None

    # 보스 패턴 입력 창이 열려 있으면 커맨드 기록 (파훼 게이지용)
    record_pattern_input(user_id, command, player["role"])

    # ===== 공격 스킬: 자동 전투 시작 (등급별 주기로 반복) =====
    if command in ATTACK_SKILLS:
        skill = ATTACK_SKILLS[command]

        # 자기 역할 스킬만 발동 (/공격은 전 역할 허용)
        if skill["role"] is not None and skill["role"] != player["role"]:
            return None

        combat = player.get("combat")
        if combat:
            combat["skill"] = command  # 스킬 교체 (주기는 유지 - 도배 이득 없음)
        else:
            # 첫 타는 즉시 나가고 이후 주기 반복
            player["combat"] = {"skill": command, "next_at": time.time()}
        return None

    # ===== 힐 (힐러 전용): 주기 회복 루프 시작 =====
    if command == HEAL_SKILL:
        if player["role"] != "healer":
            return None

        combat = player.get("combat")
        if combat:
            combat["skill"] = command
        else:
            player["combat"] = {"skill": command, "next_at": time.time()}
        return None

    # 유틸 스킬(/방어 /역산 /퇴격)은 보스 패턴 시스템에서 판정 예정 (여기선 처리 안 함)
    return None

def perform_attack(user_id, player, command):
    """공격 1회 데미지 계산·적용. attack_batch용 페이로드 반환"""
    skill = ATTACK_SKILLS[command]
    multiplier = GRADES[player["grade"]]["multiplier"]

    base_damage = random.randint(100, 500)
    is_critical = random.random() < 0.15  # 15% 크리티컬

    damage = base_damage * multiplier * skill["coef"]
    if is_critical:
        damage *= 2

    # 탐험 보상 버프 적용
    if "atk_buff_20" in game_state["buffs"]:
        damage *= 1.2

    damage = int(damage)
    player["damage"] += damage
    game_state["boss_hp"] = max(0, game_state["boss_hp"] - damage)

    return {
        "user_id": user_id,
        "name": player["name"],
        "role": player["role"],
        "grade": player["grade"],
        # 이 값은 화면 표시뿐 아니라 프론트(formation.js)의 VFX/애니메이션 매핑 키로도 그대로
        # 쓰이기 때문에(에디터의 skill_vfx 설정이 항상 한국어로 저장됨) 언어와 무관하게 항상
        # 한국어 라벨 그대로 보내야 한다 - 영어 표시는 클라이언트가 i18n.js에서 별도로 변환
        "skill": skill["label"],
        "damage": damage,
        "damage_type": "critical" if is_critical else "normal"
    }

DEFAULT_HEAL_DIMINISH_EXPONENT = 0.5  # 1.0=체감 없음(인원수만큼 그대로), 낮을수록 힐러 다인원 체감 강함

def heal_diminish_exponent():
    return (dungeon_data or {}).get("heal_diminish_exponent", DEFAULT_HEAL_DIMINISH_EXPONENT)

def total_healer_count():
    """파티 내 힐러 '총원' - 실제로 힐을 쓰고 있는지와 무관하게 역할이 힐러인 생존자 수.
    쓰고 있는 인원만 세면, 다른 힐러가 나중에 힐을 켤 때마다 내 힐량이 실시간으로 줄어드는
    것처럼 느껴져서(계속 너프당하는 느낌) 총원 기준으로 고정한다 - 인원 변화(참가/사망) 때만 바뀜."""
    return sum(1 for p in players.values() if p["alive"] and p["role"] == "healer")

def perform_heal(user_id, player):
    """힐 1회 적용 (전투력 회복 - 부상자들이 전선 복귀한다는 설정).
    힐러가 많아질수록 총 회복량이 인원수만큼 그대로 늘지 않도록 디미니싱 리턴 적용
    (총량 ∝ 힐러총원^지수 이 되도록, 개인 힐량에 총원^(지수-1)을 곱함)"""
    multiplier = GRADES[player["grade"]]["multiplier"]
    n = max(1, total_healer_count())
    diminish = n ** (heal_diminish_exponent() - 1)
    heal = multiplier * random.uniform(0.5, 1.0) * diminish
    before = game_state["party_hp"]
    game_state["party_hp"] = min(game_state["party_max_hp"], game_state["party_hp"] + heal)
    actual = game_state["party_hp"] - before

    if actual <= 0.05:
        return None

    player["heal"] = player.get("heal", 0) + actual
    return {
        "user_id": user_id,
        "name": player["name"],
        "grade": player["grade"],
        "amount": round(actual, 1)
    }

def clear_combat_states():
    """전투 상태 초기화 (층 시작/게임 리셋 시)"""
    for p in players.values():
        p.pop("combat", None)

def combat_loop():
    """자동 전투 틱: 주기가 도래한 참가자들의 공격/힐을 일괄 처리 후 배치 emit"""
    while True:
        time.sleep(COMBAT_TICK)

        if game_state["phase"] != "boss" or game_state["boss_hp"] <= 0:
            continue
        if not battle_logic_ready:
            continue  # 등장 연출 동안 대기

        now = time.time()
        attacks = []
        heals = []

        for user_id, p in list(players.items()):
            combat = p.get("combat")
            if not combat or not p["alive"]:
                continue
            if now < combat["next_at"]:
                continue

            combat["next_at"] = now + get_attack_period(p["grade"])

            if combat["skill"] == HEAL_SKILL:
                h = perform_heal(user_id, p)
                if h:
                    heals.append(h)
            else:
                attacks.append(perform_attack(user_id, p, combat["skill"]))
                if game_state["boss_hp"] <= 0:
                    break  # 이미 잡았으면 남은 공격은 버림

        if attacks or heals:
            payload = {"attacks": attacks, "heals": heals, "boss_hp": game_state["boss_hp"]}
            payload.update(power_payload())
            socketio.emit('attack_batch', payload)

# ============ YouTube 채팅 연동 ============
youtube_thread = None
youtube_running = False

def youtube_chat_listener(video_id):
    """YouTube 라이브 채팅 리스너"""
    global youtube_running

    try:
        import pytchat

        print(f"[YouTube] 채팅 연결 시도: {video_id}")
        # interruptable=False 필수: pytchat이 기본으로 SIGINT 핸들러를 등록하는데
        # signal.signal()은 메인 스레드에서만 호출 가능함. 이 함수는 항상
        # 백그라운드 스레드에서 실행되므로 켜두면 매번 에러가 남.
        chat = pytchat.create(video_id=video_id, interruptable=False)
        youtube_running = True

        print(f"[YouTube] 채팅 연결 성공!")
        socketio.emit('youtube_status', {'status': 'connected', 'video_id': video_id})

        while chat.is_alive() and youtube_running:
            for c in chat.get().sync_items():
                response = handle_command(
                    user_name=c.author.name,
                    user_id=c.author.channelId,
                    message=c.message
                )

                # 채팅 봇 응답이 필요한 경우
                if response:
                    socketio.emit('chat_response', {'message': response})
                    print(f"[BOT] {response}")

                # Super Chat 처리
                if c.type == "superChat" or c.type == "superSticker":
                    handle_superchat(c.author.name, c.author.channelId, c.amountValue)

        print("[YouTube] 채팅 연결 종료")
        socketio.emit('youtube_status', {'status': 'disconnected'})

    except Exception as e:
        print(f"[YouTube] 에러: {e}")
        socketio.emit('youtube_status', {'status': 'error', 'message': str(e)})

def handle_superchat(user_name, user_id, amount):
    """슈퍼챗 처리"""
    print(f"[슈퍼챗] {user_name}: {amount}원")

    # 슈퍼챗 금액에 따른 보상
    if amount >= 50000:
        # 전설 등급 확정
        if user_id in players:
            players[user_id]["grade"] = "legendary"
        socketio.emit('superchat', {
            'name': user_name,
            'amount': amount,
            'reward': 'legendary_grade'
        })
    elif amount >= 10000:
        # 영웅 등급 확정
        if user_id in players:
            players[user_id]["grade"] = "epic"
        socketio.emit('superchat', {
            'name': user_name,
            'amount': amount,
            'reward': 'epic_grade'
        })

# ============ 인스타그램 라이브 댓글 연동 (비공식) ============
# 인스타그램은 유튜브의 pytchat 같은 공식 실시간 댓글 API가 없어서, 브라우저를 직접 띄워
# 라이브 화면의 댓글 목록을 주기적으로 읽어오는 방식(Playwright)으로 우회한다.
# - 로그인 세션은 backend/instagram_login.py를 미리 한 번 실행해서
#   backend/instagram_auth.json에 저장해둬야 함 (이 파일이 없으면 연결 실패).
# - INSTAGRAM_COMMENT_ROW_SELECTOR는 인스타그램 라이브 화면의 실제 DOM 구조에 맞춘
#   추정값이라, 인스타그램이 화면 구조를 바꾸면 여기를 다시 맞춰야 할 수 있다.
#   (크롬 개발자 도구로 라이브 댓글 하나를 우클릭 → 검사해서, 그 줄 전체를 감싸는
#   공통 요소를 찾아 바꾸면 된다)
INSTAGRAM_COMMENT_ROW_SELECTOR = 'div[role="button"]'
INSTAGRAM_AUTH_PATH = os.path.join(os.path.dirname(__file__), 'instagram_auth.json')

instagram_thread = None
instagram_running = False

def instagram_chat_listener(username):
    """인스타그램 라이브 댓글 리스너 (비공식 - 브라우저 자동화로 댓글 목록을 긁어옴)"""
    global instagram_running

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[Instagram] playwright가 설치돼 있지 않습니다 - "
              "'pip install playwright' 후 'playwright install chromium' 실행 필요")
        socketio.emit('instagram_status', {'status': 'error', 'message': 'playwright not installed'})
        return

    if not os.path.exists(INSTAGRAM_AUTH_PATH):
        print("[Instagram] 로그인 세션이 없습니다 - backend/instagram_login.py를 먼저 실행해서 로그인하세요")
        socketio.emit('instagram_status', {'status': 'error', 'message': 'not logged in - run instagram_login.py first'})
        return

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(storage_state=INSTAGRAM_AUTH_PATH)
            page = context.new_page()

            print(f"[Instagram] 라이브 페이지 접속 시도: {username}")
            page.goto(f"https://www.instagram.com/{username}/live/", timeout=30000)
            page.wait_for_selector(INSTAGRAM_COMMENT_ROW_SELECTOR, timeout=20000)

            instagram_running = True
            print("[Instagram] 댓글 연결 성공!")
            socketio.emit('instagram_status', {'status': 'connected', 'username': username})

            seen_count = 0
            while instagram_running:
                rows = page.query_selector_all(INSTAGRAM_COMMENT_ROW_SELECTOR)
                # 인스타그램이 오래된 댓글을 DOM에서 지워서 목록이 줄어들 수 있음 - 그럴 땐
                # 위치 기준 추적이 어긋나니 지금 보이는 것부터 다시 처리(약간의 중복 처리는
                # 이 게임 특성상 무해함 - 같은 커맨드를 반복 입력하는 것과 같은 효과)
                if len(rows) < seen_count:
                    seen_count = 0

                for row in rows[seen_count:]:
                    try:
                        name_el = row.query_selector('a')
                        if not name_el:
                            continue
                        user_name = name_el.inner_text().strip()
                        full_text = row.inner_text().strip()
                        message = full_text[len(user_name):].strip()
                        if not user_name or not message:
                            continue

                        response = handle_command(user_name=user_name, user_id=user_name, message=message)
                        if response:
                            socketio.emit('chat_response', {'message': response})
                            print(f"[BOT] {response}")
                    except Exception as row_err:
                        print(f"[Instagram] 댓글 한 줄 처리 실패(무시하고 계속): {row_err}")

                seen_count = len(rows)
                time.sleep(1.5)

            browser.close()
            print("[Instagram] 댓글 연결 종료")
            socketio.emit('instagram_status', {'status': 'disconnected'})

    except Exception as e:
        print(f"[Instagram] 에러: {e}")
        socketio.emit('instagram_status', {'status': 'error', 'message': str(e)})

# ============ 게임 타이머 (페이즈 자동 흐름) ============
# lobby → dungeon(브리핑, 입장 시 1회) → 층마다: explore(투표) 또는 boss(전투)
#   → 층 클리어 → 다음 층 → ... → 마지막 층 클리어 = 던전 정복 / 전멸 → lobby 리셋
def game_timer():
    """게임 메인 타이머"""
    global monster_attack_in, battle_logic_ready

    while True:
        time.sleep(1)
        phase = game_state["phase"]

        if phase in ("lobby", "dungeon", "explore", "result", "defeat"):
            if game_state["timer"] > 0:
                game_state["timer"] -= 1
                socketio.emit('timer_update', {
                    "timer": game_state["timer"],
                    "phase": phase
                })

                if game_state["timer"] == 0:
                    if phase == "lobby":
                        min_players = (dungeon_data or {}).get("min_players", 1)
                        if len(players) < min_players:
                            # 최소 인원 미달 - 경고 표시 후 모집 재시작
                            socketio.emit('lobby_insufficient', {
                                "current": len(players),
                                "required": min_players
                            })
                            game_state["timer"] = LOBBY_SEC
                            print(f"[게임] 인원 부족({len(players)}/{min_players}) - 모집 연장")
                        else:
                            start_dungeon()
                    elif phase == "dungeon":
                        enter_floor()
                    elif phase == "explore":
                        if explore_state["stage"] == "vote":
                            resolve_explore()
                        else:  # result
                            next_explore()
                    elif phase == "result":
                        next_floor()
                    elif phase == "defeat":
                        reset_lobby()

        elif phase == "boss":
            if game_state["boss_hp"] <= 0:
                boss_defeated()
            elif game_state["party_hp"] <= 0:
                party_wiped()
            elif not battle_logic_ready:
                # 등장 연출(소개 배너 + 몬스터 페이드인) 동안 전투 로직 대기.
                # 클라이언트의 'battle_intro_done' 신호를 기다리되, 신호가 안 오는 경우
                # (연결 문제 등)에도 전투가 무한정 멈추지 않도록 안전장치 시각에 강제 진행
                if time.time() >= battle_logic_deadline:
                    battle_logic_ready = True
            else:
                # 주기적 공격: 패턴과 패턴 사이 대기시간(wait)에만 발동.
                # 텔레그래프+입력 창(window) 중엔 패턴에만 집중하도록 공격 정지.
                # (패턴이 없는 일반 전투는 stage가 None이라 계속 공격)
                attacked_this_tick = False
                if monster_attack_in is not None and pattern_state["stage"] in ("wait", None):
                    monster_attack_in -= 1
                    if monster_attack_in <= 0:
                        monster_attack()
                        attacked_this_tick = True

                # 보스 패턴 진행 (딜타임 → 입력 창 → 판정 결과 → 반복)
                if pattern_state["stage"] == "wait":
                    pattern_state["timer"] -= 1
                    if pattern_state["timer"] <= 0:
                        if attacked_this_tick:
                            # 공격과 텔레그래프 시작이 같은 틱에 겹치면, 공격 애니메이션이
                            # 텔레그래프 모션에 곧바로 덮여써서 안 보이는 문제 방지 -
                            # 한 박자(1초) 미뤄서 공격이 먼저 화면에 보이게 한다
                            pattern_state["timer"] = 1
                        else:
                            begin_pattern()
                elif pattern_state["stage"] == "window":
                    pattern_state["timer"] -= 1
                    socketio.emit('pattern_timer', {"timer": pattern_state["timer"]})
                    if pattern_state["timer"] <= 0:
                        resolve_pattern()
                elif pattern_state["stage"] == "result":
                    pattern_state["timer"] -= 1
                    if pattern_state["timer"] <= 0:
                        next_pattern()

# ============ 층 진입 (타입에 따라 분기) ============
def enter_floor():
    """현재 층의 타입(battle/explore)에 따라 진행. 층이 없으면 던전 정복"""
    config = get_floor_config(game_state["floor"])

    if config is None:
        dungeon_conquered()
        return

    floor_type = config.get("type", "battle")

    if floor_type == "explore" and config.get("explore"):
        start_explore(config["explore"])
    else:
        start_boss()

def floor_ends_dungeon(floor_num):
    """이 층이 "조기 종료" 설정돼 있는지 - 켜져 있으면 원래 다음 층이 남아있어도
    여기서 바로 던전 정복 처리한다 (테스트 빌드를 특정 층까지만 공개하고 싶을 때 등)"""
    cfg = get_floor_config(floor_num)
    return bool(cfg and cfg.get("end_here"))

def dungeon_conquered():
    """모든 층 클리어 - 던전 정복! (또는 어떤 층의 "조기 종료" 설정으로 여기서 끝났을 수도 있음)"""
    game_state["phase"] = "defeat"  # defeat 타이머 경로 재사용 (→ 로비 리셋)
    game_state["timer"] = RESULT_SEC + 3

    # 이 함수는 boss_defeated()/next_explore()가 "이 층에서 끝"으로 판단했을 때 곧바로(그
    # 층 번호 그대로) 불리기도 하고, enter_floor()에서 층 번호가 이미 마지막을 넘어간 뒤
    # 불리기도 해서 game_state["floor"]로 조회하면 못 찾을 수 있음 - 그럴 땐 던전의 실제
    # 마지막 층 설정으로 대체
    end_floor = get_floor_config(game_state["floor"]) or \
        (dungeon_data["floors"][-1] if dungeon_data and dungeon_data.get("floors") else {})

    socketio.emit('dungeon_clear', {
        "dungeon_name": loc(dungeon_data, "name") if dungeon_data else ("Dungeon" if dungeon_lang() == "en" else "던전"),
        "end_message": loc(end_floor, "end_message") or None,
        "timer": game_state["timer"],
        "ranking": get_damage_ranking(),
        "fade_bgm_on_clear": end_floor.get("fade_bgm_on_clear", False),
        "fade_bgm_duration_sec": end_floor.get("fade_bgm_duration_sec", 1.5)
    })

    print(f"[게임] 🏆 던전 정복! {RESULT_SEC + 3}초 후 로비 리셋")

# ============ 탐험 페이즈 (층 하나 = 투표 이벤트 하나) ============
def start_explore(event):
    """탐험 층 시작"""
    game_state["phase"] = "explore"
    explore_state["events"] = [event]
    explore_state["index"] = 0

    # 상단 배너 전체 문구 (에디터에서 자유 입력, 비어 있으면 자동 생성)
    banner_text = loc(event, "banner_text") or (
        f"Floor {game_state['floor']} Exploration" if dungeon_lang() == "en"
        else f"{game_state['floor']}층 탐험"
    )

    payload = {
        "phase": "explore", "floor": game_state["floor"], "banner_text": banner_text,
        # 이 층 전용 BGM (battle_bgm과 동일한 개념 - 없으면 이전 곡 유지) +
        # 배경음악과 동시에 겹쳐 재생되는 환경음(바람소리/물소리 등 루프, 별도 채널)
        "bgm": event.get("bgm"),
        "bgm_volume": event.get("bgm_volume"),
        "ambient_sound": event.get("ambient_sound"),
        "ambient_sound_volume": event.get("ambient_sound_volume")
    }
    payload.update(power_payload())
    socketio.emit('phase_change', payload)

    begin_explore_event()

def begin_explore_event():
    """탐험 투표 창 오픈"""
    event = explore_state["events"][explore_state["index"]]
    explore_state["stage"] = "vote"
    explore_state["votes"] = {}
    game_state["timer"] = event.get("window_sec", 25)

    # 정답/오답 사운드는 결과가 나올 때(resolve_explore)에만 파일명이 공개되는데, 그때 처음
    # 로딩을 시작하면 늦어서 결과 순간 소리가 안 들릴 수 있음 - 그렇다고 여기서 on_correct/
    # on_wrong 중 어느 쪽 사운드인지 알 수 있게 보내면 정답이 그대로 유출되므로, 어느 쪽
    # 소속인지 알 수 없게 섞어서 미리 로딩만 하도록 보냄
    preload_sfx = [s for s in (
        (event.get("on_correct") or {}).get("sfx"),
        (event.get("on_wrong") or {}).get("sfx")
    ) if s]
    random.shuffle(preload_sfx)

    payload = {
        "floor": game_state["floor"],
        "type": event.get("type"),
        "prompt": loc(event, "prompt"),
        "options": [display_option(event, o) for o in event["options"]],
        "timer": game_state["timer"],
        "preload_sfx": preload_sfx
    }
    payload.update(power_payload())
    socketio.emit('explore_event', payload)

    print(f"[탐험] {game_state['floor']}층 투표: {event['options']}")

def resolve_explore():
    """투표 마감 → 다수결 판정 (동표는 랜덤). 집계/정답 비교는 항상 정규(한국어) 옵션
    기준으로 하고, 화면에 보내는 choice/counts만 표시 언어로 변환한다 - 그래야 영어 모드에서도
    event['answer']와의 비교가 옵션 표시 언어와 무관하게 정확히 맞는다"""
    event = explore_state["events"][explore_state["index"]]

    raw_counts = {opt: 0 for opt in event["options"]}
    for v in explore_state["votes"].values():
        if v in raw_counts:
            raw_counts[v] += 1

    max_votes = max(raw_counts.values()) if raw_counts else 0
    top_options = [opt for opt, n in raw_counts.items() if n == max_votes] or event["options"]
    choice = random.choice(top_options)

    correct = (choice == event.get("answer"))
    outcome = event["on_correct"] if correct else event["on_wrong"]
    damage_pct = outcome.get("damage_pct", 0) or 0
    reward = outcome.get("reward")

    dmg = apply_power_damage(damage_pct)
    if reward:
        game_state["buffs"].append(reward)

    explore_state["stage"] = "result"
    game_state["timer"] = EXPLORE_RESULT_SEC

    floor_cfg = get_floor_config(game_state["floor"]) or {}
    payload = {
        "choice": display_option(event, choice),
        "correct": correct,
        "text": loc(outcome, "text"),
        "damage_pct": damage_pct,
        "damage": round(dmg, 1),
        "reward": reward,
        "counts": {display_option(event, opt): n for opt, n in raw_counts.items()},
        "sfx": outcome.get("sfx"),
        "sfx_volume": outcome.get("sfx_volume"),
        "fade_bgm_on_clear": floor_cfg.get("fade_bgm_on_clear", False),
        "fade_bgm_duration_sec": floor_cfg.get("fade_bgm_duration_sec", 1.5)
    }
    payload.update(power_payload())
    socketio.emit('explore_result', payload)

    result_tag = "정답" if correct else "오답"
    print(f"[탐험] 선택: {choice} ({result_tag}) 피해 {damage_pct}% 전투력: {game_state['party_hp']:.0f}")

def next_explore():
    """탐험 결과 표시 종료 - 다음 층으로 (단, 이 층이 "조기 종료"로 설정돼 있으면 여기서 던전 정복)"""
    if game_state["party_hp"] <= 0:
        party_wiped()
        return

    if floor_ends_dungeon(game_state["floor"]):
        dungeon_conquered()
        return

    next_floor()

def start_dungeon():
    """던전 입장 브리핑 (던전 시작 시 1회만)"""
    game_state["phase"] = "dungeon"
    game_state["timer"] = DUNGEON_ENTRY_SEC
    game_state["floor"] = 1
    game_state["buffs"] = []

    # 전투력 = 참가자 기여도의 합 (브리핑 TOTAL POWER와 동일), 풀 상태로 시작
    game_state["party_max_hp"] = max(1, get_total_power())
    game_state["party_hp"] = game_state["party_max_hp"]

    stats = get_party_stats()

    # 던전의 모든 전투 몬스터를 미리 알려줌 (브리핑 중 클라이언트가 전부 미리 로딩)
    monsters = []
    if dungeon_data:
        for f in dungeon_data["floors"]:
            battle = f.get("battle") or {}
            sprite = battle.get("sprite", battle.get("name"))
            if sprite and sprite not in monsters:
                monsters.append(sprite)

    sound_files = collect_all_sound_files()

    socketio.emit('phase_change', {
        "phase": "dungeon",
        "floor": game_state["floor"],
        "timer": game_state["timer"],
        "party_stats": stats,
        "total_power": get_total_power(),
        "mvp_candidates": get_mvp_candidates(),
        "monsters": monsters,
        "dungeon_sounds": (dungeon_data or {}).get("sounds", {}),
        "sound_files": sound_files
    })

    print(f"[게임] 던전 입장! 참가자: {stats['total']}명, 몬스터 {len(monsters)}종, 사운드 {len(sound_files)}개 프리로드")

def start_boss():
    """전투 시작 (던전 JSON의 층별 전투: normal=일반 몬스터, boss=보스)"""
    config = get_floor_config(game_state["floor"])
    battle = (config or {}).get("battle", {})
    battle_type = battle.get("type", "boss")

    game_state["phase"] = "boss"

    # 목표 처치 시간이 설정돼 있으면 지금 접속한 인원 구성 기준 예상 DPS로 체력 자동 계산.
    # (DPS=0이면, 즉 딜러가 아무도 없으면 계산 불가하니 수동값으로 폴백)
    target_kill_sec = battle.get("target_kill_sec")
    dps = expected_party_dps() if target_kill_sec else 0
    if target_kill_sec and dps > 0:
        game_state["boss_max_hp"] = max(1, target_kill_sec * dps)
    else:
        game_state["boss_max_hp"] = battle.get("hp", 1000000 * game_state["floor"])
    game_state["boss_hp"] = game_state["boss_max_hp"]

    # 자동 전투 상태 초기화 - 층마다 커맨드를 다시 쳐야 참전
    clear_combat_states()

    # 등장 연출(배너+몬스터 페이드인) 동안 전투 로직 대기 - 클라이언트가 연출을 다 보여준 뒤
    # 'battle_intro_done'을 보내오면 시작된다 (on_battle_intro_done). 신호가 없을 때를 대비해
    # 안전장치 시각도 넉넉하게 잡아둠 (연출 소요: 0.7 대기 + 0.5 배너 페이드인 + intro_sec 유지
    # + 0.5 페이드아웃 + 0.8 몬스터 페이드인 = intro_sec+2.5초, 여기에 로딩/전환 지연 여유를 더함)
    global monster_attack_in, current_battle, battle_logic_ready, battle_logic_deadline
    intro_sec = battle.get("intro_sec", 2)
    battle_logic_ready = False
    battle_logic_deadline = time.time() + intro_sec + 8
    current_battle = battle
    # 공격 주기가 설정된 전투는 타입 무관 주기 공격 (패턴 입력 창 중에도 발동)
    if battle.get("attack_interval_sec"):
        monster_attack_in = battle["attack_interval_sec"]
    else:
        monster_attack_in = None

    # 보스 패턴 초기화 (패턴이 있으면 딜타임부터 시작)
    patterns = battle.get("patterns") or []
    pattern_state["list"] = patterns
    pattern_state["index"] = 0
    pattern_state["inputs"] = {}
    pattern_state["gauge_total"] = 0.0
    if patterns:
        pattern_state["stage"] = "wait"
        pattern_state["timer"] = battle.get("pattern_interval_sec", 12)
    else:
        pattern_state["stage"] = None

    boss_name = loc(battle, "name") or (
        f"Guardian of Floor {game_state['floor']}" if dungeon_lang() == "en" else f"{game_state['floor']}층의 수호자"
    )

    # 등장 배너 전체 문구 (에디터에서 자유 입력).
    # 비어 있으면 자동 생성: 새 배너 필드가 없으면 구버전 intro_text(접미사만)를
    # 살려서 "N층 : intro_text"로, 그것도 없으면 "N층 : 몬스터이름"으로 대체
    banner_text = loc(battle, "banner_text")
    if not banner_text:
        suffix = loc(battle, "intro_text") or boss_name
        banner_text = f"Floor {game_state['floor']}: {suffix}" if dungeon_lang() == "en" else f"{game_state['floor']}층 : {suffix}"

    payload = {
        "phase": "boss",
        "battle_type": battle_type,
        "floor": game_state["floor"],
        "floor_total": len(dungeon_data["floors"]) if dungeon_data else game_state["floor"],
        "boss_name": boss_name,
        "boss_emoji": battle.get("emoji", "👹"),
        "boss_sprite": battle.get("sprite", battle.get("name")),
        "banner_text": banner_text,
        "intro_sec": intro_sec,
        "battle_bgm": battle.get("battle_bgm"),
        "battle_bgm_volume": battle.get("battle_bgm_volume"),
        "boss_hp": game_state["boss_hp"],
        "boss_max_hp": game_state["boss_max_hp"],
        "buffs": game_state["buffs"]
    }
    payload.update(power_payload())
    socketio.emit('phase_change', payload)

    print(f"[게임] {game_state['floor']}층 전투 시작! [{battle_type}] {battle.get('name', '')} HP: {game_state['boss_hp']:,}")

def monster_attack():
    """일반 몬스터의 파티 공격 (최대 전투력의 % 만큼 감소)"""
    global monster_attack_in

    interval = current_battle.get("attack_interval_sec", 12)
    no_heal_wipe_sec = current_battle.get("no_heal_wipe_sec")
    if current_battle.get("auto_calc_attack") and no_heal_wipe_sec:
        # 힐 없이 이 시간 안에 전멸하도록 역산: 공격 횟수 = 생존시간/공격주기, 매 공격 100%/횟수
        hits_to_wipe = max(1, no_heal_wipe_sec / interval)
        pct = round(100 / hits_to_wipe, 1)  # 화면 표시용 반올림 - 6.66666...% 방지
    else:
        pct = current_battle.get("attack_damage_pct", 4)
    monster_attack_in = interval

    dmg = apply_power_damage(pct)

    payload = {
        "text": loc(current_battle, "attack_text") or ("The monster attacks!" if dungeon_lang() == "en" else "몬스터가 공격한다!"),
        "damage_pct": pct,
        "damage": round(dmg, 1)
    }
    payload.update(power_payload())
    socketio.emit('monster_attack', payload)

    print(f"[전투] 몬스터 공격! -{pct}% 전투력: {game_state['party_hp']:.0f}/{game_state['party_max_hp']:.0f}")

# ============ 보스 패턴 엔진 ============
def pattern_correct_role_scores(pat):
    """이 패턴의 정답(양수 점수) 커맨드들을, 역할별 "그 역할이 쓸 수 있는 것 중 가장 점수
    높은 (커맨드, 점수)"로 정리해서 반환한다 (role=None 키는 전체 역할 공용 커맨드).
    pattern_hints()와 compute_pattern_max()가 공유하는 핵심 로직이라 따로 뺐다."""
    scores = pat.get("scores") or {}
    custom_by_cmd = {c.get("cmd"): c for c in (pat.get("custom_commands") or [])}
    best = {}
    for cmd, score in scores.items():
        if not score or score <= 0:
            continue
        if cmd in ATTACK_SKILLS:
            role = ATTACK_SKILLS[cmd]["role"]
        elif cmd == HEAL_SKILL:
            role = "healer"
        elif cmd in UTIL_SKILL_ROLES:
            role = UTIL_SKILL_ROLES[cmd]
        elif cmd in custom_by_cmd:
            role = custom_by_cmd[cmd].get("role")
        else:
            continue  # 커스텀 커맨드 목록에서 이미 지워졌는데 점수만 남아있는 경우 방어
        if role not in best or score > best[role][1]:
            best[role] = (cmd, score)
    return best

def pattern_hints(pat):
    """힌트 표시가 켜진 패턴이면, 역할별 정답 커맨드를 반환한다 (role=None이면 전 역할
    공용). 꺼져 있으면 빈 배열 - 화면에 아무것도 안 뜨고 직접 입력해보며 알아내야 한다."""
    if not pat.get("show_hint"):
        return []
    return [
        {"role": role, "command": command_display(cmd)}
        for role, (cmd, score) in pattern_correct_role_scores(pat).items()
    ]

def compute_pattern_max(pat):
    """이 패턴을 "지금 살아있는 파티원 각자가 자기 몫을 정확히 1번씩 해냈을 때" 도달 가능한
    최대 원점수 총합을 계산한다 - 몬스터 체력을 파티 DPS로 역산하는 것(expected_party_dps)과
    같은 발상: 이 값을 성공선의 분모로 써서, 인원·등급 구성과 무관하게 "다들 제대로
    반응했느냐"의 비율로 성공 여부가 결정되게 한다. 패턴 시작 시점에 한 번만 스냅샷 떠서
    입력 창 도중 인원이 바뀌어도(난입/사망) 흔들리지 않는다."""
    best_by_role = pattern_correct_role_scores(pat)
    if not best_by_role:
        return 0.0

    any_role_best = best_by_role.get(None, (None, 0))[1]
    total = 0.0
    for p in players.values():
        if not p["alive"]:
            continue
        role_entry = best_by_role.get(p["role"])
        role_score = role_entry[1] if role_entry else 0
        best = max(role_score, any_role_best)
        if best <= 0:
            continue
        total += best * GRADES[p["grade"]]["multiplier"]
    return total

def begin_pattern():
    """패턴 시작: 텔레그래프 표시 + 입력 창 오픈"""
    pat = pattern_state["list"][pattern_state["index"]]
    pattern_state["stage"] = "window"
    pattern_state["timer"] = pat.get("window_sec", 25)
    pattern_state["inputs"] = {}
    pattern_state["gauge_total"] = 0.0
    pattern_state["scored_users"] = set()
    pattern_state["max_possible"] = compute_pattern_max(pat)

    socketio.emit('pattern_telegraph', {
        "telegraph": loc(pat, "telegraph") or ("The boss is preparing something..." if dungeon_lang() == "en" else "보스가 무언가를 준비한다..."),
        "window": pattern_state["timer"],
        "threshold": pat.get("success_threshold", 70),
        "telegraph_anim": pat.get("telegraph_anim"),
        "telegraph_sfx": pat.get("telegraph_sfx"),
        "telegraph_sfx_volume": pat.get("telegraph_sfx_volume"),
        # 텔레그래프 사운드(telegraph_sfx)는 텔레그래프 시작 순간 1회만 재생되는 효과음이고,
        # 이건 "준비 모션"이 보이는 입력 창이 열려있는 동안 계속 반복 재생되는 배경음 -
        # 결과가 나오는 순간(pattern_result) 클라이언트가 알아서 멈춘다
        "telegraph_loop_sound": pat.get("telegraph_loop_sound"),
        "telegraph_loop_sound_volume": pat.get("telegraph_loop_sound_volume"),
        "hints": pattern_hints(pat)
    })

    print(f"[패턴] 텔레그래프: {pat.get('id', pattern_state['index'])} ({pattern_state['timer']}초)")

def compute_gauge():
    """파훼 게이지: 누적된 원점수를 "지금 파티가 낼 수 있는 최대치"(max_possible, 패턴
    시작 시점 스냅샷) 대비 %로 정규화해서 0~100 사이로 반환한다. 인원·등급 구성과 무관하게
    "다들 제대로 반응했느냐"의 비율로 항상 0~100% 스케일이 유지된다.
    max_possible이 0이면(자격 있는 생존자가 아무도 없음) 판정 불가로 보고 0% 처리."""
    max_possible = pattern_state.get("max_possible", 0)
    if max_possible <= 0:
        return 0
    raw = pattern_state.get("gauge_total", 0)
    return max(0, min(100, round(raw / max_possible * 100, 1)))

def record_pattern_input(user_id, command, role):
    """입력 창 동안 유효한 커맨드마다 게이지에 반영 + 갱신 emit.
    정답(양수 점수) 커맨드는 참가자당 1회만 인정하고 등급 배율(GRADES multiplier)을 곱해
    반영한다 - 도배해도 추가 이득이 없고, 등급 높은 소수가 인원 적은 파티를 캐리할 수 있다.
    오답(음수 점수)은 지금까지처럼 몇 번을 치든 그대로, 등급과 무관하게 매번 감점된다.
    성공선에 도달하는 순간 즉시 파훼 성공 처리 (조기 판정)"""
    global _last_gauge_emit

    if pattern_state["stage"] != "window":
        return

    pat = pattern_state["list"][pattern_state["index"]]
    if not command_role_ok(command, role, pat):
        return

    pattern_state["inputs"][user_id] = command  # 참여자 집계/디버그용

    # 진형 스프라이트가 유틸 스킬 사용 애니메이션을 재생할 수 있게 개별 입력마다 알림
    # (점수 반영 여부와 무관하게 매번 재생 - 도배해도 반응 자체는 계속 나와야 자연스러움)
    socketio.emit('skill_used', {"user_id": user_id, "command": command})

    score = pat.get("scores", {}).get(command, 0)
    if score > 0:
        if user_id not in pattern_state["scored_users"]:
            pattern_state["scored_users"].add(user_id)
            grade = players.get(user_id, {}).get("grade", "common")
            pattern_state["gauge_total"] = pattern_state.get("gauge_total", 0) + score * GRADES[grade]["multiplier"]
    elif score < 0:
        pattern_state["gauge_total"] = pattern_state.get("gauge_total", 0) + score

    gauge = compute_gauge()

    # 성공선 도달 → 남은 시간 무시하고 즉시 파훼!
    if gauge >= pat.get("success_threshold", 70):
        socketio.emit('gauge_update', {"gauge": gauge})
        resolve_pattern()
        return

    now = time.time()
    if now - _last_gauge_emit >= 0.3:
        _last_gauge_emit = now
        socketio.emit('gauge_update', {"gauge": gauge})

def resolve_pattern():
    """입력 창 마감 → 게이지 판정"""
    pat = pattern_state["list"][pattern_state["index"]]
    gauge = compute_gauge()
    threshold = pat.get("success_threshold", 70)
    success = gauge >= threshold
    scores = pat.get("scores", {})

    pattern_state["stage"] = "result"
    pattern_state["timer"] = PATTERN_RESULT_SEC

    if success:
        outcome = pat.get("on_success", {})
        payload = {
            "success": True,
            "gauge": gauge,
            "text": loc(outcome, "text") or ("Pattern broken!" if dungeon_lang() == "en" else "패턴을 파훼했다!"),
            "damage_pct": 0,
            "damage": 0,
            "success_anim": pat.get("success_anim"),
            "success_sfx": pat.get("success_sfx"),
            "success_sfx_volume": pat.get("success_sfx_volume")
        }
    else:
        # 실패 데미지 = 설정된 최대 % x (1 - 게이지/100)
        # 87% 실패는 살짝 아프고, 10% 실패는 참사
        outcome = pat.get("on_fail", {})
        base_pct = outcome.get("power_damage_pct", 30)
        actual_pct = base_pct * (1 - gauge / 100.0)
        dmg = apply_power_damage(actual_pct)

        payload = {
            "success": False,
            "gauge": gauge,
            "text": loc(outcome, "text") or ("Failed to block the pattern!" if dungeon_lang() == "en" else "패턴을 막지 못했다!"),
            "damage_pct": round(actual_pct, 1),
            "damage": round(dmg, 1),
            "resolve_anim": pat.get("resolve_anim"),
            "fail_sfx": pat.get("fail_sfx"),
            "fail_sfx_volume": pat.get("fail_sfx_volume")
        }

    payload.update(power_payload())
    socketio.emit('pattern_result', payload)
    print(f"[패턴] 판정: {'성공' if success else '실패'} (게이지 {gauge}%/{threshold}%) 전투력: {game_state['party_hp']:.0f}")

def next_pattern():
    """결과 표시 종료 → 딜타임 후 다음 패턴 (순환)"""
    pattern_state["index"] = (pattern_state["index"] + 1) % len(pattern_state["list"])
    pattern_state["stage"] = "wait"
    pattern_state["timer"] = current_battle.get("pattern_interval_sec", 12)

def get_damage_ranking(limit=10):
    """딜량 랭킹. 힐러가 딜(정화)보다 힐량이 더 크면, 딜 대신 힐량으로 표시/정렬해서
    힐에 집중한 힐러도 기여도가 0으로 묻히지 않게 함"""
    def contribution(p):
        if p["role"] == "healer" and p.get("heal", 0) > p["damage"]:
            return p.get("heal", 0)
        return p["damage"]

    ranking = sorted(players.values(), key=contribution, reverse=True)
    result = []
    for i, p in enumerate(ranking[:limit]):
        is_heal = p["role"] == "healer" and p.get("heal", 0) > p["damage"]
        result.append({
            "rank": i + 1,
            "name": p["name"],
            "damage": round(p.get("heal", 0)) if is_heal else p["damage"],
            "is_heal": is_heal,
            "role": p["role"],
            "grade": p["grade"]
        })
    return result

def boss_defeated():
    """전투 승리 → 결과 표시 후 다음 층 (마지막 층이면 던전 정복)"""
    game_state["buffs"] = []  # 버프는 전투 하나에만 적용

    # 마지막 층이거나(원래 던전 구조상) 이 층이 "조기 종료"로 설정돼 있으면 결과 대신 던전 정복 연출
    is_final = (dungeon_data and game_state["floor"] >= len(dungeon_data["floors"])) \
        or floor_ends_dungeon(game_state["floor"])
    if is_final:
        dungeon_conquered()
        return

    game_state["phase"] = "result"
    game_state["timer"] = RESULT_SEC

    floor_cfg = get_floor_config(game_state["floor"]) or {}
    socketio.emit('boss_defeated', {
        "floor": game_state["floor"],
        "next_floor": game_state["floor"] + 1,
        "timer": game_state["timer"],
        "ranking": get_damage_ranking(),
        "fade_bgm_on_clear": floor_cfg.get("fade_bgm_on_clear", False),
        "fade_bgm_duration_sec": floor_cfg.get("fade_bgm_duration_sec", 1.5)
    })

    print(f"[게임] {game_state['floor']}층 클리어! {RESULT_SEC}초 후 다음 층")

def next_floor():
    """다음 층으로 진행 (브리핑 없이 바로, 참가자 유지·신규 난입 허용)"""
    game_state["floor"] += 1
    enter_floor()

def party_wiped():
    """파티 전멸 → 결과 표시 후 로비 리셋"""
    game_state["phase"] = "defeat"
    game_state["timer"] = RESULT_SEC

    socketio.emit('party_wiped', {
        "floor": game_state["floor"],
        "timer": game_state["timer"],
        "ranking": get_damage_ranking()
    })

    print(f"[게임] {game_state['floor']}층에서 전멸... {RESULT_SEC}초 후 로비 리셋")

def reset_lobby():
    """로비로 리셋"""
    global players, recent_joins

    game_state["phase"] = "lobby"
    game_state["timer"] = LOBBY_SEC
    game_state["floor"] = 1
    game_state["boss_hp"] = 0
    game_state["boss_max_hp"] = 0

    players = {}
    recent_joins = []

    socketio.emit('phase_change', {"phase": "lobby", "timer": LOBBY_SEC})
    socketio.emit('party_stats', get_party_stats())
    emit_formation()

    print("[게임] 로비 리셋")

# ============ 라우트 ============
@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('../frontend', path)

# 테스트용 API
@app.route('/api/test/join/<name>')
def test_join(name):
    """테스트용 참가 API"""
    user_id = f"test_{name}_{int(time.time() * 1000)}"
    result = handle_join(name, user_id)
    if result:
        return json.dumps(result, ensure_ascii=False), 200
    return "Already joined", 400

@app.route('/api/test/join_many/<int:count>')
def test_join_many(count):
    """테스트용 다수 참가 API"""
    names = ["김철수", "이영희", "박민수", "최강자", "정우성", "이민호", "송중기", "현빈", "공유", "조인성"]

    for i in range(count):
        name = random.choice(names) + str(i)
        user_id = f"test_{i}_{int(time.time() * 1000)}"
        handle_join(name, user_id)
        time.sleep(0.3)  # 0.3초 간격

    return f"{count}명 참가 완료", 200

@app.route('/api/test/join_grade/<grade>')
def test_join_grade(grade):
    """테스트용: 특정 등급 1명 참가 (등급별 참가 카드 사운드/연출 확인용)"""
    if grade not in GRADES:
        return f"Unknown grade: {grade}", 400
    name = f"{GRADES[grade]['name']}테스트{int(time.time() * 1000) % 1000}"
    user_id = f"test_{grade}_{int(time.time() * 1000)}"
    result = handle_join(name, user_id, forced_grade=grade)
    if result:
        return json.dumps(result, ensure_ascii=False), 200
    return "Already joined", 400

# ============ 던전 에디터 툴 API (개발용) ============
MONSTERS_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets', 'monsters')
SOUNDS_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets', 'sounds')

@app.route('/api/tool/dungeon')
def api_tool_dungeon():
    """현재 던전 JSON 원본 반환"""
    try:
        with open(DUNGEON_FILE, encoding='utf-8') as f:
            return f.read(), 200, {'Content-Type': 'application/json'}
    except Exception as e:
        return json.dumps({"error": str(e)}), 500

@app.route('/api/tool/save_dungeon', methods=['POST'])
def api_tool_save_dungeon():
    """던전 JSON 저장 + 서버에 즉시 리로드"""
    data = request.get_json()
    if data is None or "floors" not in data:
        return "Invalid dungeon JSON", 400

    with open(DUNGEON_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    load_dungeon()  # 서버 재시작 없이 반영
    print(f"[툴] 던전 저장 + 리로드: {data.get('name')} ({len(data['floors'])}층)")
    return "Saved", 200

@app.route('/api/tool/sounds')
def api_tool_sounds():
    """사운드 파일 목록 (assets/sounds, 하위 폴더까지 재귀적으로 - 예: theme/, SFX/ 폴더로
    정리해둔 파일도 'theme/파일명.mp3' 형태의 상대경로로 목록에 나타남)"""
    sounds = []
    if os.path.isdir(SOUNDS_DIR):
        for root, _dirs, files in os.walk(SOUNDS_DIR):
            rel_dir = os.path.relpath(root, SOUNDS_DIR)
            for f in files:
                if f.lower().endswith(('.mp3', '.ogg', '.wav')):
                    rel_path = f if rel_dir == '.' else f"{rel_dir}/{f}"
                    sounds.append(rel_path.replace(os.sep, '/'))
    return json.dumps(sorted(sounds), ensure_ascii=False), 200

SPRITESHEETS_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets', 'spritesheets')

@app.route('/api/tool/vfx_sprites')
def api_tool_vfx_sprites():
    """VFX 스프라이트시트 목록 (assets/spritesheets/<역할>/vfx/*.png).
    반환값은 [{file: '힐러/vfx/파일명.png', plist: bool}, ...] - VfxManager가 file 값
    그대로 'assets/spritesheets/' 뒤에 붙여서 로딩한다. plist=true면 같은 이름의 .plist가
    있다는 뜻으로(TexturePacker/cocos2d 아틀라스 - 프레임 크기가 제각각이라 균일한 그리드
    슬라이싱이 아니라 몬스터처럼 plist 기반으로 재생해야 함), 프론트가 이 값을 스킬 VFX
    설정(cfg.plist)에 그대로 저장해서 실제 게임 로딩 방식을 결정한다."""
    sprites = []
    if os.path.isdir(SPRITESHEETS_DIR):
        for root, _dirs, files in os.walk(SPRITESHEETS_DIR):
            if os.path.basename(root) != 'vfx':
                continue
            rel_dir = os.path.relpath(root, SPRITESHEETS_DIR)
            for f in files:
                if f.lower().endswith('.png'):
                    plist_path = os.path.join(root, os.path.splitext(f)[0] + '.plist')
                    sprites.append({
                        'file': f"{rel_dir}/{f}".replace(os.sep, '/'),
                        'plist': os.path.isfile(plist_path)
                    })
    sprites.sort(key=lambda s: s['file'])
    return json.dumps(sprites, ensure_ascii=False), 200

ASSETS_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'assets')

def sanitize_asset_path(rel_path, exts=('.png',)):
    """assets/ 하위 저장 경로 검증: '..'나 절대경로로 assets/ 밖에 못 나가게 막고,
    그 외엔 한글 등 유니코드 폴더/파일명을 그대로 보존 (리컬러 스프라이트 저장 +
    애니메이션 변환 탭의 VFX 지정 저장용). exts는 허용할 확장자 튜플(소문자, 점 포함)"""
    if not rel_path:
        return None
    rel_path = rel_path.strip().replace('\\', '/')
    if not rel_path or rel_path.startswith('/') or ':' in rel_path:
        return None
    parts = [p for p in rel_path.split('/') if p not in ('', '.')]
    if not parts or any(p == '..' for p in parts):
        return None
    if not parts[-1].lower().endswith(exts):
        return None
    safe_rel = os.path.join(*parts)
    full_path = os.path.join(ASSETS_DIR, safe_rel)
    # 최종 방어: 심볼릭 링크 등으로라도 assets/ 밖으로 못 나가는지 재확인
    if not os.path.abspath(full_path).startswith(os.path.abspath(ASSETS_DIR) + os.sep):
        return None
    return safe_rel

@app.route('/api/tool/save_sprite', methods=['POST'])
def api_tool_save_sprite():
    """리컬러 탭에서 편집한 스프라이트 PNG를 assets/ 하위 원하는 경로에 저장
    (폴더가 없으면 자동 생성, 같은 경로에 이미 파일이 있으면 덮어씀)"""
    if 'file' not in request.files:
        return "No file uploaded", 400

    safe_rel = sanitize_asset_path(request.form.get('path', ''), ('.png',))
    if not safe_rel:
        return "Invalid path (assets/ 하위의 .png 상대경로여야 합니다)", 400

    full_path = os.path.join(ASSETS_DIR, safe_rel)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    request.files['file'].save(full_path)

    print(f"[툴] 리컬러 스프라이트 저장: {safe_rel}")
    return json.dumps({"path": safe_rel.replace(os.sep, '/')}, ensure_ascii=False), 200

@app.route('/api/tool/save_plist', methods=['POST'])
def api_tool_save_plist():
    """애니메이션 변환 탭에서 "역할 VFX로 지정" 시, 원본(또는 리컬러 후) plist를 png와
    같은 경로/이름으로 assets/ 하위에 저장 (좌표 자체는 리컬러해도 안 바뀌므로 원본 그대로)"""
    if 'file' not in request.files:
        return "No file uploaded", 400

    safe_rel = sanitize_asset_path(request.form.get('path', ''), ('.plist',))
    if not safe_rel:
        return "Invalid path (assets/ 하위의 .plist 상대경로여야 합니다)", 400

    full_path = os.path.join(ASSETS_DIR, safe_rel)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    request.files['file'].save(full_path)

    print(f"[툴] plist 저장: {safe_rel}")
    return json.dumps({"path": safe_rel.replace(os.sep, '/')}, ensure_ascii=False), 200

def sanitize_sound_filename(filename):
    """업로드 파일명 정리: 경로 조작만 막고 한글 등 유니코드 파일명은 그대로 보존
    (werkzeug의 secure_filename은 비ASCII 문자를 전부 지워버려서 이 프로젝트의
    한글 파일명 관례와 안 맞아 직접 구현)"""
    name = os.path.basename(filename).strip()
    if not re.search(r'\.(mp3|ogg|wav)$', name, re.IGNORECASE):
        return None
    name = name.replace('..', '').replace('/', '').replace('\\', '').replace('\x00', '')
    name = name.strip()
    if not name or name.startswith('.'):
        return None
    return name

@app.route('/api/tool/upload_sound', methods=['POST'])
def api_tool_upload_sound():
    """PC에서 사운드 파일을 직접 선택해 assets/sounds/에 업로드"""
    if 'file' not in request.files:
        return "No file uploaded", 400

    f = request.files['file']
    name = sanitize_sound_filename(f.filename or '')
    if not name:
        return "mp3/ogg/wav 파일만 업로드할 수 있습니다", 400

    os.makedirs(SOUNDS_DIR, exist_ok=True)
    f.save(os.path.join(SOUNDS_DIR, name))

    print(f"[툴] 사운드 업로드: {name}")
    return json.dumps({"filename": name}, ensure_ascii=False), 200

@app.route('/api/tool/monsters')
def api_tool_monsters():
    """png + plist 쌍이 갖춰진 몬스터 목록"""
    monsters = []
    if os.path.isdir(MONSTERS_DIR):
        for f in os.listdir(MONSTERS_DIR):
            if f.endswith('.png'):
                name = f[:-4]
                if os.path.exists(os.path.join(MONSTERS_DIR, name + '.plist')):
                    monsters.append(name)
    return json.dumps(sorted(monsters), ensure_ascii=False), 200

@app.route('/api/tool/save_anim/<name>', methods=['POST'])
def api_tool_save_anim(name):
    """애니메이션 매니페스트(<이름>.anim.json) 저장"""
    if '/' in name or '\\' in name or '..' in name:
        return "Invalid name", 400

    data = request.get_json()
    if data is None:
        return "JSON body required", 400

    path = os.path.join(MONSTERS_DIR, name + '.anim.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"[툴] 애니메이션 매니페스트 저장: {name}.anim.json")
    return "Saved", 200

@app.route('/api/dungeon_meta')
def api_dungeon_meta():
    """던전 전역 설정 조회 (로비 BGM 등, 게임 시작 전 클라이언트 부트스트랩용)"""
    return json.dumps({
        "min_players": (dungeon_data or {}).get("min_players", 1),
        "sounds": (dungeon_data or {}).get("sounds", {}),
        "sound_files": collect_all_sound_files(),
        "skill_vfx": (dungeon_data or {}).get("skill_vfx", {}),
        "language": dungeon_lang()
    }, ensure_ascii=False), 200

@app.route('/api/state')
def api_state():
    """현재 게임 상태 조회 (디버그용)"""
    return json.dumps({
        "game_state": game_state,
        "player_count": len(players),
        "total_power": get_total_power(),
        "grades": get_party_stats()["grades"],
        "explore": {
            "stage": explore_state["stage"],
            "index": explore_state["index"],
            "votes": len(explore_state["votes"])
        } if game_state["phase"] == "explore" else None,
        "pattern": {
            "stage": pattern_state["stage"],
            "index": pattern_state["index"],
            "timer": pattern_state["timer"],
            "inputs": len(pattern_state["inputs"]),
            "count": len(pattern_state["list"])
        } if game_state["phase"] == "boss" else None
    }, ensure_ascii=False), 200

@app.route('/api/reset')
def api_reset():
    """게임 리셋 API"""
    reset_lobby()
    return "Reset complete", 200

@app.route('/api/start_boss')
def api_start_boss():
    """보스전 시작 API (테스트용)"""
    start_boss()
    return "Boss started", 200

@app.route('/api/start_dungeon')
def api_start_dungeon():
    """던전 입장 브리핑 시작 API (테스트용) - 실제 참가자 데이터 사용"""
    if len(players) == 0:
        return "No players joined", 400
    start_dungeon()
    return "Dungeon entry started", 200

@app.route('/api/skip')
def api_skip():
    """현재 페이즈 타이머 스킵 (테스트용) - 1초 후 다음 단계로"""
    if game_state["phase"] == "boss" and pattern_state["stage"] is not None:
        pattern_state["timer"] = 1
        return f"Skipping pattern stage: {pattern_state['stage']}", 200
    if game_state["phase"] in ("lobby", "dungeon", "explore", "result", "defeat"):
        game_state["timer"] = 1
        return f"Skipping {game_state['phase']}", 200
    return f"Cannot skip phase: {game_state['phase']}", 400

@app.route('/api/test/goto/<int:floor>')
def api_test_goto(floor):
    """테스트용: 특정 층으로 바로 이동"""
    if len(players) == 0:
        return "No players joined", 400
    if game_state["phase"] == "lobby":
        # 로비에서 바로 이동하면 전투력 초기화가 필요
        game_state["party_max_hp"] = max(1, get_total_power())
        game_state["party_hp"] = game_state["party_max_hp"]
    game_state["floor"] = floor
    enter_floor()
    return f"Moved to floor {floor}", 200

@app.route('/api/test/vote/<int:count>/<option>')
def api_test_vote(count, option):
    """테스트용 투표: count명이 /<option>에 투표.
    아직 투표 안 한 기존 참가자를 먼저 쓰고, 부족하면 새 테스트 유권자를
    만들어서 채운다 - 기존 참가자를 재사용해 표를 뒤집는 일이 없게 해서,
    어느 버튼을 몇 번 누르든 득표는 오직 누적만 된다."""
    command = "/" + option
    if not is_explore_vote(command):
        return f"Not voting phase or invalid option: {command}", 400

    voted = 0
    not_yet_voted = [
        (uid, p) for uid, p in players.items()
        if p["alive"] and uid not in explore_state["votes"]
    ]
    random.shuffle(not_yet_voted)

    for user_id, p in not_yet_voted:
        if voted >= count:
            break
        handle_vote(p["name"], user_id, command)
        voted += 1

    # 기존 참가자 중 미투표자가 부족하면 새 테스트 유권자를 만들어서 채움
    while voted < count:
        role = get_random_role()
        grade = get_random_grade()
        user_id = f"votebot_{uuid.uuid4().hex}"
        name = f"투표자{voted + 1}"

        players[user_id] = {
            "name": name, "role": role, "grade": grade,
            "gold": 0, "damage": 0, "heal": 0, "alive": True, "weapon": None,
            "joined_at": time.time()
        }
        game_state["party_max_hp"] += GRADES[grade]["multiplier"]
        game_state["party_hp"] += GRADES[grade]["multiplier"]

        handle_vote(name, user_id, command)
        voted += 1

    socketio.emit('party_stats', get_party_stats())
    emit_formation()
    return f"{voted} votes for {command}", 200

@app.route('/api/test/kill_boss')
def api_kill_boss():
    """보스 즉사 (테스트용) - 자동 흐름으로 result 진입"""
    if game_state["phase"] == "boss":
        game_state["boss_hp"] = 0
        return "Boss killed", 200
    return "Not in boss phase", 400

@app.route('/api/test/skill/<cmd>')
def api_test_skill(cmd):
    """테스트용: 특정 스킬 사용. 해당 역할 참가자가 없으면 테스트 봇 생성"""
    command = "/" + cmd

    # 스킬에 필요한 역할
    if command in ATTACK_SKILLS:
        role_needed = ATTACK_SKILLS[command]["role"]
    elif command == HEAL_SKILL:
        role_needed = "healer"
    elif command in UTIL_SKILL_ROLES:
        role_needed = UTIL_SKILL_ROLES[command]
    else:
        return f"Unknown skill: {command}", 400

    # 해당 역할의 생존 참가자 찾기
    candidates = [uid for uid, p in players.items()
                  if p["alive"] and (role_needed is None or p["role"] == role_needed)]

    if candidates:
        user_id = random.choice(candidates)
    else:
        # 없으면 테스트 봇 생성
        role = role_needed or get_random_role()
        grade = get_random_grade()
        user_id = f"skillbot_{role}_{uuid.uuid4().hex}"
        players[user_id] = {
            "name": f"{ROLES[role]['name']}봇",
            "role": role,
            "grade": grade,
            "gold": 1000, "damage": 0, "heal": 0, "alive": True, "weapon": None,
            "joined_at": time.time()
        }
        # 진행 중 난입 봇도 전투력 합류
        game_state["party_max_hp"] += GRADES[grade]["multiplier"]
        game_state["party_hp"] += GRADES[grade]["multiplier"]
        socketio.emit('party_stats', get_party_stats())
        emit_formation()

    p = players[user_id]
    result = handle_command(p["name"], user_id, command)
    role_name = ROLES[p["role"]]["name"]
    grade_name = GRADES[p["grade"]]["name"]

    return f"{p['name']}({grade_name} {role_name}) → {command} {('| ' + result) if result else 'OK'}", 200

@app.route('/api/test/attack/<int:count>')
def api_test_attack(count):
    """테스트용: 참가자 count명이 자기 역할 스킬로 자동 전투 시작 (힐러는 /힐)"""
    if game_state["phase"] != "boss":
        return "Not in battle phase", 400

    role_skill = {
        "warrior": "/강타",
        "archer": "/저격",
        "mage": "/파이어볼",
        "healer": "/힐"
    }

    used = 0
    for user_id, p in list(players.items()):
        if used >= count:
            break
        if p["alive"]:
            handle_action(p["name"], user_id, role_skill[p["role"]])
            used += 1

    return f"{used} attacks", 200

@app.route('/api/test/wipe')
def api_wipe():
    """파티 전멸 (테스트용) - 자동 흐름으로 defeat 진입"""
    if game_state["phase"] == "boss":
        game_state["party_hp"] = 0
        return "Party wiped", 200
    return "Not in boss phase", 400

# ============ WebSocket 이벤트 ============
@socketio.on('connect')
def on_connect():
    print(f'[WebSocket] 클라이언트 연결: {request.sid}')
    emit('game_state', game_state)
    emit('party_stats', get_party_stats())
    emit('recent_joins', recent_joins[-9:])  # 최근 9명
    emit('formation_update', formation_payload())

@socketio.on('disconnect')
def on_disconnect():
    print(f'[WebSocket] 클라이언트 연결 해제: {request.sid}')

@socketio.on('start_youtube')
def on_start_youtube(data):
    """YouTube 채팅 연결 시작"""
    global youtube_thread, youtube_running

    video_id = data.get('video_id')
    if not video_id:
        emit('youtube_status', {'status': 'error', 'message': 'video_id required'})
        return

    # 기존 스레드 종료
    youtube_running = False

    # 새 스레드 시작
    youtube_thread = threading.Thread(target=youtube_chat_listener, args=(video_id,))
    youtube_thread.daemon = True
    youtube_thread.start()

    emit('youtube_status', {'status': 'connecting', 'video_id': video_id})

@socketio.on('stop_youtube')
def on_stop_youtube():
    """YouTube 채팅 연결 중지"""
    global youtube_running
    youtube_running = False
    emit('youtube_status', {'status': 'stopped'})

@socketio.on('start_instagram')
def on_start_instagram(data):
    """인스타그램 라이브 댓글 연결 시작 (비공식)"""
    global instagram_thread, instagram_running

    username = (data or {}).get('username')
    if not username:
        emit('instagram_status', {'status': 'error', 'message': 'username required'})
        return

    instagram_running = False  # 기존 스레드 종료 신호

    instagram_thread = threading.Thread(target=instagram_chat_listener, args=(username,))
    instagram_thread.daemon = True
    instagram_thread.start()

    emit('instagram_status', {'status': 'connecting', 'username': username})

@socketio.on('stop_instagram')
def on_stop_instagram():
    """인스타그램 라이브 댓글 연결 중지"""
    global instagram_running
    instagram_running = False
    emit('instagram_status', {'status': 'stopped'})

@socketio.on('reset_game')
def on_reset_game():
    """게임 리셋"""
    reset_lobby()

@socketio.on('battle_intro_done')
def on_battle_intro_done(data):
    """클라이언트가 등장 연출(배너+몬스터 페이드인)을 다 보여줬다는 신호 - 이때부터 전투 로직
    (몬스터 공격/패턴/자동 전투 틱) 시작. 층이 이미 넘어간 뒤 늦게 도착한 신호는 무시"""
    global battle_logic_ready
    if game_state["phase"] != "boss":
        return
    floor = (data or {}).get("floor")
    if floor is not None and floor != game_state["floor"]:
        return
    battle_logic_ready = True

# ============ 서버 시작 ============
if __name__ == '__main__':
    print("=" * 50)
    print("🎮 던전 레이드 서버")
    print("=" * 50)
    print()
    print("🛠️  개발/테스트: http://localhost:5000")
    print("📺 유튜브 송출: http://localhost:5000/stream.html")
    print()
    print("📋 테스트 API:")
    print("   - http://localhost:5000/api/test/join/홍길동")
    print("   - http://localhost:5000/api/test/join_many/10")
    print("   - http://localhost:5000/api/reset")
    print("   - http://localhost:5000/api/start_boss")
    print()
    print("=" * 50)

    # 던전 데이터 로드
    load_dungeon()

    # 타이머 스레드 시작
    timer_thread = threading.Thread(target=game_timer)
    timer_thread.daemon = True
    timer_thread.start()

    # 자동 전투 틱 스레드 시작
    combat_thread = threading.Thread(target=combat_loop)
    combat_thread.daemon = True
    combat_thread.start()

    # 서버 실행
    # 로컬 OBS 송출용 서버라 Werkzeug로 충분 (외부 공개 서버 아님)
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
