/**
 * i18n - 게임 화면(엔진에 고정된 문자열)의 한국어/영어 전환.
 *
 * 던전마다 다른 서사 텍스트(배너 문구, 상황 문구, 결과 문구 등)는 에디터에서 입력한
 * <필드>_en 값을 서버가 골라서 보내주므로(server.py의 loc()) 여기서 다루지 않는다.
 * 이 파일은 어느 던전이든 항상 똑같이 뜨는 엔진 자체의 UI 문구(투표 안내, 결과 배너,
 * 카운트다운 문구 등)와 역할/등급 이름 전용.
 *
 * window.dungeonLanguage ('ko' | 'en')는 game.js가 /api/dungeon_meta에서 받아 채운다.
 */
window.I18N = {
    ko: {
        voteGuide: '채팅으로 투표하세요! 다수결로 결정됩니다',
        resultCorrect: '✅ 올바른 선택!',
        resultWrong: '💥 잘못된 선택!',
        backToLobby: '잠시 후 로비로 돌아갑니다...',
        votesSuffix: (n) => `${n}표`,
        powerLoss: (dmg, pct) => `전투력 -${dmg} (-${pct}%)`,
        countdownSec: (s) => `⏳ ${s}초`,
        exploreDefaultBanner: (floor) => `${floor}층 탐험`,
        wipedOnFloor: (floor) => `💀 ${floor}층에서 전멸...`,

        monsterAppeared: '몬스터가 나타났습니다! 각자의 역할군에 맞춰 전투하세요!',
        breakGauge: '파훼 게이지',
        congratsBackToLobby: '축하합니다! 잠시 후 로비로 돌아갑니다...',
        patternSuccess: (gauge, text) => `✅ 파훼 성공! (${gauge}%)\n${text}`,
        patternFail: (gauge, text) => `💥 파훼 실패... (파훼율 ${gauge}%)\n${text}`,
        others: (n) => `외 ${n}명`,
        skillDamageLabel: (name, skill, dmg) => `${name}의 ${skill}! -${dmg}`,
        partyPower: (cur, max, pct) => `전투력 ${cur} / ${max} (${pct}%)`,
        partyPowerSimple: (cur, max) => `전투력 ${cur} / ${max}`,
        floorClear: (floor) => `🎉 ${floor}층 클리어!`,
        movingToNextFloor: (floor) => `잠시 후 ${floor}층으로 이동합니다...`,
        dungeonConquered: (name) => `🏆 ${name} 정복!!`,
        damageRankingTitle: '⚔️ 딜량 랭킹',

        totalMembers: (n) => `총 인원: ${n}명`,
        insufficientPlayers: (cur, req) => `이 정도의 인원으로는 험난한 던전을 클리어할 수 없습니다! (${cur}/${req}명)`,
        minPlayersSuffix: (cur, min) => ` (${cur}/${min}명)`,
        secondsLabel: (s) => `${s}초`,
        lobbyFloorTitle: '어둠의 던전 1층',
        untilEntry: '던전 입장까지 ',

        partyStatusTitle: '📊 현재 파티 현황',
        classBreakdown: 'CLASS BREAKDOWN',
        mvpCandidates: 'MVP 후보',
        noParticipants: '참가자 없음',
        classCount: (name, count) => `${name}: ${count}명`,
        entryExclaim: '입장!',
        dungeonDoorOpening: '던전의 문이 열립니다...',
        dungeonEntryCountdown: (s) => `${s}초 후 던전에 입장합니다.\n자신의 역할군을 기억해 주세요!`,

        joinCmd: '/참가',
        joinInstructionSuffix: ' 를 입력해 파티에 참여하세요!',
        joinPrompt: '/참가 로\n참전하세요!',
        myInfoHint: '!내정보 - 내 상태 확인',
    },
    en: {
        voteGuide: 'Vote in chat! Majority wins',
        resultCorrect: '✅ Correct choice!',
        resultWrong: '💥 Wrong choice!',
        backToLobby: 'Returning to lobby shortly...',
        votesSuffix: (n) => `${n} votes`,
        powerLoss: (dmg, pct) => `Power -${dmg} (-${pct}%)`,
        countdownSec: (s) => `⏳ ${s}s`,
        exploreDefaultBanner: (floor) => `Floor ${floor} Exploration`,
        wipedOnFloor: (floor) => `💀 Wiped on floor ${floor}...`,

        monsterAppeared: 'A monster has appeared! Fight according to your role!',
        breakGauge: 'Break Gauge',
        congratsBackToLobby: 'Congratulations! Returning to lobby shortly...',
        patternSuccess: (gauge, text) => `✅ Pattern broken! (${gauge}%)\n${text}`,
        patternFail: (gauge, text) => `💥 Pattern failed... (${gauge}%)\n${text}`,
        others: (n) => `+${n} more`,
        skillDamageLabel: (name, skill, dmg) => `${name}: ${skill}! -${dmg}`,
        partyPower: (cur, max, pct) => `Power ${cur} / ${max} (${pct}%)`,
        partyPowerSimple: (cur, max) => `Power ${cur} / ${max}`,
        floorClear: (floor) => `🎉 Floor ${floor} clear!`,
        movingToNextFloor: (floor) => `Moving to floor ${floor} shortly...`,
        dungeonConquered: (name) => `🏆 ${name} Conquered!!`,
        damageRankingTitle: '⚔️ Damage Ranking',

        totalMembers: (n) => `Total: ${n}`,
        insufficientPlayers: (cur, req) => `Not enough adventurers to clear this dungeon! (${cur}/${req})`,
        minPlayersSuffix: (cur, min) => ` (${cur}/${min})`,
        secondsLabel: (s) => `${s}s`,
        lobbyFloorTitle: 'Dark Dungeon Floor 1',
        untilEntry: 'Entering dungeon in ',

        partyStatusTitle: '📊 Party Status',
        classBreakdown: 'CLASS BREAKDOWN',
        mvpCandidates: 'MVP Candidates',
        noParticipants: 'No participants',
        classCount: (name, count) => `${name}: ${count}`,
        entryExclaim: 'Enter!',
        dungeonDoorOpening: 'The dungeon doors are opening...',
        dungeonEntryCountdown: (s) => `Entering the dungeon in ${s}s.\nRemember your role!`,

        joinCmd: '/join',
        joinInstructionSuffix: ' to join the party!',
        joinPrompt: 'Type /join\nto participate!',
        myInfoHint: '!myinfo - Check my status',
    }
};

// 역할/등급 표시 이름 - 서버의 role_name()/grade_name()과 항상 같은 내용으로 유지
// (서버가 이미 로컬라이즈해서 보내주는 필드(join_info.role_name 등)가 있으면 그걸 우선 쓰고,
// 서버가 원본 키만 보내는 곳(get_mvp_candidates 등)에서만 아래 테이블로 직접 변환한다)
window.ROLE_NAMES = {
    ko: { warrior: '전사', archer: '궁수', mage: '마법사', healer: '힐러' },
    en: { warrior: 'Warrior', archer: 'Archer', mage: 'Mage', healer: 'Healer' }
};
window.GRADE_NAMES = {
    ko: { legendary: '전설', epic: '영웅', rare: '희귀', uncommon: '고급', common: '일반' },
    en: { legendary: 'Legendary', epic: 'Epic', rare: 'Rare', uncommon: 'Uncommon', common: 'Common' }
};

// attack_batch의 skill 필드(공격력 텍스트에 쓰이는 "강타" 등)는 formation.js가 VFX/애니메이션
// 매핑 키로 그대로 쓰기 때문에 서버는 항상 한국어로만 보낸다 - 화면에 띄우는 문구에서만
// 이 표에서 영어로 바꿔서 보여준다 (VFX/애니메이션 쪽 값은 절대 건드리지 않음)
window.SKILL_LABEL_EN = {
    '공격': 'Attack', '강타': 'Strike', '저격': 'Snipe', '파이어볼': 'Fireball', '정화': 'Purify'
};
window.skillLabelDisplay = function (koLabel) {
    if (lang() === 'en' && window.SKILL_LABEL_EN[koLabel]) return window.SKILL_LABEL_EN[koLabel];
    return koLabel;
};

// 전투 화면 하단 "역할별 커맨드 안내" - 서버 CMD_ALIASES와 반드시 짝이 맞아야 함 (backend/server.py)
// iconKey: game.js SKILL_ICONS의 실제 아이콘 이미지 키 - 표시 커맨드(cmd)는 언어별로 달라도
// 아이콘 이미지 자체는 항상 이 한국어 기준 키로 고정해서 찾는다 (cmd에서 바로 유추하면
// 영어 모드에서 이미지가 없는 키가 만들어져 이모지로 폴백돼버림)
window.ROLE_SKILLS_I18N = {
    ko: [
        { key: 'warrior', name: '전사', skills: [{ cmd: '/강타', icon: '🗡️', iconKey: 'skill_강타' }, { cmd: '/방어', icon: '🛡️', iconKey: 'skill_방어' }] },
        { key: 'archer', name: '궁수', skills: [{ cmd: '/저격', icon: '🎯', iconKey: 'skill_저격' }, { cmd: '/퇴격', icon: '💨', iconKey: 'skill_퇴격' }] },
        { key: 'mage', name: '마법사', skills: [{ cmd: '/파이어볼', icon: '🔥', iconKey: 'skill_파이어볼' }, { cmd: '/역산', icon: '🌀', iconKey: 'skill_역산' }] },
        { key: 'healer', name: '힐러', skills: [{ cmd: '/힐', icon: '💚', iconKey: 'skill_힐' }, { cmd: '/정화', icon: '🌿', iconKey: 'skill_정화' }] }
    ],
    en: [
        { key: 'warrior', name: 'Warrior', skills: [{ cmd: '/strike', icon: '🗡️', iconKey: 'skill_강타' }, { cmd: '/defend', icon: '🛡️', iconKey: 'skill_방어' }] },
        { key: 'archer', name: 'Archer', skills: [{ cmd: '/snipe', icon: '🎯', iconKey: 'skill_저격' }, { cmd: '/retreat', icon: '💨', iconKey: 'skill_퇴격' }] },
        { key: 'mage', name: 'Mage', skills: [{ cmd: '/fireball', icon: '🔥', iconKey: 'skill_파이어볼' }, { cmd: '/reflect', icon: '🌀', iconKey: 'skill_역산' }] },
        { key: 'healer', name: 'Healer', skills: [{ cmd: '/heal', icon: '💚', iconKey: 'skill_힐' }, { cmd: '/purify', icon: '🌿', iconKey: 'skill_정화' }] }
    ]
};

function lang() {
    return window.dungeonLanguage === 'en' ? 'en' : 'ko';
}

window.t = function (key, ...args) {
    const entry = window.I18N[lang()][key];
    return typeof entry === 'function' ? entry(...args) : entry;
};

window.roleName = function (role) {
    return (window.ROLE_NAMES[lang()] || window.ROLE_NAMES.ko)[role] || role;
};

window.gradeName = function (grade) {
    return (window.GRADE_NAMES[lang()] || window.GRADE_NAMES.ko)[grade] || grade;
};

window.roleSkillsHint = function () {
    return window.ROLE_SKILLS_I18N[lang()];
};
