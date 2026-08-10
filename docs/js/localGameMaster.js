/**
 * LocalGameMaster - 서버 없이 혼자 플레이하는 데모용 "가짜 게임 마스터"
 *
 * 실제 게임은 backend/server.py가 Socket.IO로 이벤트를 내려보내고, 프론트는
 * GameSocket(socket.js)이 그걸 받아 각 씬(LobbyScene/DungeonEntryScene/
 * ExploreScene/BattleScene)의 메서드를 호출하는 구조다. 이 클래스는 실제 서버
 * 접속 없이 window.gameSocket 자리에 대신 들어가서, 같은 이벤트들을 정해진
 * 각본(로비 → 던전 입장 → 1층 전투 → 2층 탐험 갈림길 → 3층 전투(패턴) → 클리어)에
 * 맞춰 스스로 만들어 씬에 흘려보낸다. 씬 코드는 실제 서버가 보낸 건지 여기서
 * 만든 건지 구분하지 못한다 (socket.js와 동일한 공개 인터페이스를 흉내냄).
 *
 * 데모 범위: 1층(플러그)은 보스 패턴(QTE) 없는 "일반 전투", 2층은 실제 2층
 * 탐험 데이터를 재사용, 3층(스크라벤)은 실제 3층 패턴 데이터(파훼 게이지·
 * 텔레그래프·성공/실패 판정)를 그대로 재현한다.
 * 데미지/게이지 공식은 server.py의 공식을 최대한 그대로 따르되, 인원이 훨씬
 * 적은 1인 데모에 맞게 파티 최대HP·회복량 등 일부 상수만 데모용으로 조정했다
 * (주석에 "데모 튜닝"이라고 표시).
 */

// ============ 게임 상수 (backend/server.py의 ROLES/GRADES/ATTACK_SKILLS와 동일) ============
// util* 필드는 실서버의 UTIL_SKILL_ROLES(보스 패턴 파훼 전용 명령어). 1층(플러그)은
// 패턴이 없어서 이 버튼을 누르면 "다음 몬스터 공격 피해 절반 감소"라는 단순화된
// 효과만 주고, 3층(스크라벤)에서는 실제 파훼 게이지 점수로 그대로 반영된다
const LGM_ROLES = {
    warrior: { name: '전사', emoji: '⚔️', weight: 35, attackCmd: '/강타', attackLabel: '강타', coef: 1.2, utilCmd: '/방어', utilIcon: '🛡️' },
    archer:  { name: '궁수', emoji: '🏹', weight: 30, attackCmd: '/저격', attackLabel: '저격', coef: 1.2, utilCmd: '/퇴격', utilIcon: '💨' },
    mage:    { name: '마법사', emoji: '🔮', weight: 20, attackCmd: '/파이어볼', attackLabel: '파이어볼', coef: 1.3, utilCmd: '/역산', utilIcon: '🌀' },
    healer:  { name: '힐러', emoji: '💚', weight: 15, attackCmd: '/정화', attackLabel: '정화', coef: 0.8 }
};

const LGM_GRADES = {
    legendary: { name: '전설', weight: 1, multiplier: 100 },
    epic:      { name: '영웅', weight: 4, multiplier: 50 },
    rare:      { name: '희귀', weight: 15, multiplier: 20 },
    uncommon:  { name: '고급', weight: 30, multiplier: 5 },
    common:    { name: '일반', weight: 50, multiplier: 1 }
};

// 등급별 자동공격 주기(초) - dark_catacomb.json의 attack_periods로 legendary만 5초로 덮어씀
const LGM_ATTACK_PERIODS = { common: 4.0, uncommon: 3.5, rare: 3.0, epic: 2.5, legendary: 5.0 };

const LGM_BOT_NAMES = [
    '용사철수', '밤하늘', '구름낚시', '레이드왕', '초코라떼',
    '달빛전사', '느긋한여우', '새벽별', '고구마', '조용한파도'
];

// 3층 스크라벤의 실제 파훼 패턴 - backend/dungeons/dark_catacomb.json의
// floor 3 battle.patterns[0]과 동일한 값 (telegraph/scores/threshold 등)
const SCRAVEN_PATTERN = {
    telegraph: '스크라벤이 모든 것을 찢어발길 준비를 합니다.',
    window_sec: 25,
    success_threshold: 70,
    // 커맨드별 게이지 점수 - 양수(방어/퇴격)는 유저당 1회만, 음수(역산/정화)는 칠 때마다 감점
    scores: { '/방어': 0.5, '/퇴격': 0.3, '/역산': -0.3, '/정화': -0.2 },
    on_fail: { power_damage_pct: 30 },
    telegraph_anim: 'idle',
    resolve_anim: 'attack3',
    success_anim: 'hit',
    // 실제 JSON에 있던 사운드 필드 - 처음 옮겨 적을 때 빠뜨렸던 부분 (텔레그래프 무음 버그의 원인)
    telegraph_sfx: '텔레그래프사운드1.wav',
    telegraph_sfx_volume: 1.28,
    telegraph_loop_sound: '스크라벤대기모션1.wav',
    telegraph_loop_sound_volume: 1.28,
    pattern_interval_sec: 12,  // JSON에 없으면 서버 기본값 12초
    attack_interval_sec: 4
};

function lgmWeightedPick(table) {
    const keys = Object.keys(table);
    const total = keys.reduce((s, k) => s + table[k].weight, 0);
    let r = Math.random() * total;
    for (const k of keys) {
        r -= table[k].weight;
        if (r <= 0) return k;
    }
    return keys[keys.length - 1];
}

function lgmMakeUnit(name, userId, roleOverride, gradeOverride) {
    const role = roleOverride || lgmWeightedPick(LGM_ROLES);
    const grade = gradeOverride || lgmWeightedPick(LGM_GRADES);
    return {
        user_id: userId,
        name: name,
        role: role,
        role_name: LGM_ROLES[role].name,
        role_emoji: LGM_ROLES[role].emoji,
        grade: grade,
        grade_name: LGM_GRADES[grade].name,
        multiplier: LGM_GRADES[grade].multiplier,
        display_time: 4000,
        alive: true,
        totalDamage: 0,
        totalHeal: 0,
        nextAttackIn: Math.random() * LGM_ATTACK_PERIODS[grade]  // 각자 다른 타이밍에 공격하도록 시작 오프셋을 흩뿌림
    };
}

class LocalGameMaster {
    constructor() {
        this.connected = true;
        this.pendingExploreEvent = null;
        this._timers = [];       // setTimeout/setInterval id 모음 (restart 시 일괄 정리)
        this._resetState();
    }

    _resetState() {
        this.you = null;
        this._youJoined = false;
        this.bots = [];
        this.partyHp = 0;
        this.partyMaxHp = 0;
        this.bossHp = 0;
        this.bossMaxHp = 0;
        this._battleRunning = false;
        this._lastClickAt = 0;
        this._shielded = false;
        this._exploreTally = {};

        this._currentFloor = 0;      // 1=플러그, 3=스크라벤 (승리 시 다음 단계 분기용)
        this._monsterAttackPct = 0;
        this._monsterAttackText = '';
        this._monsterAttackChatText = '';
        this._monsterAttackIn = 0;

        // 보스 패턴(파훼) 상태 - 플러그 층(패턴 없음)에서는 _activePattern이 계속 null
        this._activePattern = null;
        this._patternStage = null;   // 'wait' | 'window' | 'result'
        this._patternTimer = 0;
        this._patternGaugeTotal = 0;
        this._patternMaxPossible = 0;
        this._patternScoredUsers = new Set();
    }

    _clearTimers() {
        this._timers.forEach(id => { clearTimeout(id); clearInterval(id); });
        this._timers = [];
    }

    _sleep(ms) {
        return new Promise(resolve => {
            const id = setTimeout(resolve, ms);
            this._timers.push(id);
        });
    }

    // ============ 씬 전환 헬퍼 (GameSocket과 동일 로직) ============
    switchScene(sceneKey, data) {
        if (!window.game) return;
        window.game.scene.getScenes(true).forEach(s => {
            if (s.scene.key !== sceneKey) s.scene.stop();
        });
        window.game.scene.start(sceneKey, data);
    }

    startWithEntryTransition(sceneKey, data) {
        const entryScene = this.getScene('DungeonEntryScene');
        if (entryScene && entryScene.transitionTo) {
            entryScene.transitionTo(sceneKey, data);
            return;
        }
        const active = this.getActiveScene();
        if (active && active.cameras && active.cameras.main) {
            active.cameras.main.fadeOut(250, 0, 0, 0);
            active.time.delayedCall(280, () => this.switchScene(sceneKey, data));
        } else {
            this.switchScene(sceneKey, data);
        }
    }

    getActiveScene() {
        if (!window.game) return null;
        const scenes = window.game.scene.getScenes(true);
        return scenes.length > 0 ? scenes[0] : null;
    }

    getScene(key) {
        if (!window.game) return null;
        const scene = window.game.scene.getScene(key);
        return (scene && scene.scene.isActive()) ? scene : null;
    }

    // 실제 유튜브 라이브 채팅처럼 보이게, 봇/당신의 명령어를 오른쪽 채팅 로그에도 같이 찍는다
    _chat(name, text, opts) { if (window.ChatLog) window.ChatLog.post(name, text, opts); }
    _chatSystem(text) { if (window.ChatLog) window.ChatLog.postSystem(text); }

    // ============ 관리용 no-op (실서버 전용 기능 - 데모에선 아무 것도 안 함) ============
    startYoutube() {}
    stopYoutube() {}
    startInstagram() {}
    stopInstagram() {}
    log(msg) { if (typeof debugLog === 'function') debugLog(msg); }

    // BattleScene이 몬스터 등장 연출을 끝내면 이걸 호출한다 (실서버에선 이 신호를 받고
    // 나서야 전투 로직을 시작함) - 여기서는 이 신호를 받는 순간 전투 틱 루프를 시작한다
    notifyBattleIntroDone() {
        this._startBattleLoop();
    }

    resetGame() {
        this.restart();
    }

    // ============ 이벤트 발사 헬퍼 (socket.js의 각 on() 핸들러와 1:1 대응) ============
    // 씬이 하필 전환되는 타이밍에 걸려 메서드가 없거나 내부 상태가 아직 안 갖춰졌을 때
    // 여기서 던진 예외가 각본 전체(async 함수 체인)를 조용히 멈춰버리는 걸 막기 위해
    // 이벤트 발사는 전부 이 래퍼를 통과시킨다 - 실패해도 콘솔에 로그만 남기고 계속 진행
    _safe(label, fn) {
        try {
            fn();
        } catch (e) {
            console.error(`[LocalGameMaster] ${label} 처리 중 오류 (무시하고 계속 진행):`, e);
        }
    }

    _fireGameState(data) { this._safe('game_state', () => { window.gameState = data; }); }

    _firePlayerJoined(data) {
        this._safe('player_joined', () => {
            const scene = this.getActiveScene();
            if (scene && scene.addPlayer) scene.addPlayer(data);
        });
    }

    _firePartyStats(stats) {
        this._safe('party_stats', () => {
            window.partyStats = stats;
            if (window.game) {
                const scene = window.game.scene.getScene('LobbyScene');
                if (scene && scene.updatePartyStats) scene.updatePartyStats(stats);
            }
        });
    }

    _fireFormationUpdate(roster) {
        this._safe('formation_update', () => {
            window.formationRoster = roster;
            const scene = this.getActiveScene();
            if (scene && scene.updateFormation) scene.updateFormation(roster);
        });
    }

    _fireTimerUpdate(timer, phase) {
        this._safe('timer_update', () => {
            const scene = this.getActiveScene();
            if (scene && scene.updateTimer) scene.updateTimer(timer, phase);
        });
    }

    _fireExploreEvent(data) {
        this._safe('explore_event', () => {
            const scene = this.getScene('ExploreScene');
            if (scene && scene.showEvent) {
                scene.showEvent(data);
            } else {
                this.pendingExploreEvent = data;
            }
        });
    }

    _fireVoteUpdate(data) {
        this._safe('vote_update', () => {
            const scene = this.getScene('ExploreScene');
            if (scene && scene.updateVotes) scene.updateVotes(data);
        });
    }

    _fireExploreResult(data) {
        this._safe('explore_result', () => {
            const scene = this.getScene('ExploreScene');
            if (scene && scene.showResult) scene.showResult(data);
        });
    }

    _firePhaseChange(data) {
        this._safe('phase_change:' + data.phase, () => {
            window.BgmManager.stopLooping();
            window.AmbientManager.stop();
            if (data.phase !== 'explore') this.pendingExploreEvent = null;
            if (!window.game) return;

            if (data.phase === 'dungeon') {
                this.switchScene('DungeonEntryScene', {
                    floor: data.floor,
                    partyStats: data.party_stats,
                    totalPower: data.total_power,
                    mvpCandidates: data.mvp_candidates,
                    monsters: data.monsters
                });
            } else if (data.phase === 'explore') {
                this.startWithEntryTransition('ExploreScene', data);
            } else if (data.phase === 'boss') {
                this.startWithEntryTransition('BattleScene', data);
            } else if (data.phase === 'lobby') {
                this.switchScene('LobbyScene');
            }
        });
    }

    _fireAttackBatch(data) {
        this._safe('attack_batch', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showAttackBatch) scene.showAttackBatch(data);
        });
    }

    // 방어/역산/퇴격처럼 몬스터 HP를 안 깎는 유틸 스킬 - 진형 스프라이트에 동작 애니메이션만 재생
    _fireSkillUsed(data) {
        this._safe('skill_used', () => {
            const scene = this.getActiveScene();
            if (scene && scene.formation) {
                scene.formation.playAttack(data.user_id, (data.command || '').replace(/^\//, ''));
            }
        });
    }

    _fireMonsterAttack(data) {
        this._safe('monster_attack', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showMonsterAttack) scene.showMonsterAttack(data);
        });
    }

    // ===== 보스 패턴(파훼 QTE) - 3층 스크라벤 전용 =====
    _firePatternTelegraph(data) {
        this._safe('pattern_telegraph', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showPatternTelegraph) scene.showPatternTelegraph(data);
        });
    }

    _fireGaugeUpdate(gauge) {
        this._safe('gauge_update', () => {
            const scene = this.getActiveScene();
            if (scene && scene.updateGauge) scene.updateGauge(gauge);
        });
    }

    _firePatternTimer(timer) {
        this._safe('pattern_timer', () => {
            const scene = this.getActiveScene();
            if (scene && scene.updatePatternTimer) scene.updatePatternTimer(timer);
        });
    }

    _firePatternResult(data) {
        this._safe('pattern_result', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showPatternResult) scene.showPatternResult(data);
        });
    }

    _fireBossDefeated(data) {
        this._safe('boss_defeated', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showVictory) scene.showVictory(data);
        });
    }

    _fireDungeonClear(data) {
        this._safe('dungeon_clear', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showConquered) scene.showConquered(data);
        });
    }

    _firePartyWiped(data) {
        this._safe('party_wiped', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showDefeat) scene.showDefeat(data);
        });
    }

    // ============ 데모 각본 시작/재시작 ============
    start() {
        this._resetState();
        this._runLobby().catch(e => console.error('[LocalGameMaster] 데모 진행 중 오류:', e));
    }

    restart() {
        this._clearTimers();
        if (window.DemoUI) window.DemoUI.hideAll();
        if (window.ChatLog) window.ChatLog.clear();
        this._resetState();
        this._runLobby().catch(e => console.error('[LocalGameMaster] 데모 진행 중 오류:', e));
    }

    // ============ 1. 로비 ============
    async _runLobby() {
        // LobbyScene은 Phaser 부팅 시 이미 첫 씬으로 자동 실행돼 있으므로, 여기서 또
        // start()를 불러 불필요하게 재시작시키면 카드 렌더링이 씹히는 타이밍 문제가
        // 생길 수 있다 - 이미 떠 있으면 건드리지 않는다
        if (!this.getScene('LobbyScene')) {
            this._firePhaseChange({ phase: 'lobby' });
            await this._sleep(400);  // 재시작된 경우 create() 끝날 시간 확보
        }
        this._fireTimerUpdate(14, 'lobby');
        this._chatSystem('🎮 로비가 열렸습니다! 채팅으로 /참가 를 입력하면 함께할 수 있어요');

        // 등급은 데모가 재밌게 느껴지도록 희귀 이상만 나오게 살짝 편향
        this.you = lgmMakeUnit('당신', 'demo_you', null, lgmWeightedPick({
            legendary: LGM_GRADES.legendary, epic: LGM_GRADES.epic, rare: LGM_GRADES.rare
        }));

        const botCount = 10;
        // 역할군당 최소 2명은 보장 (4역할 x 2 = 8명), 나머지는 실서버와 같은 가중치로 랜덤 배정
        const roleDraft = [];
        Object.keys(LGM_ROLES).forEach(r => { roleDraft.push(r, r); });
        while (roleDraft.length < botCount) roleDraft.push(lgmWeightedPick(LGM_ROLES));
        roleDraft.sort(() => Math.random() - 0.5);  // 참가 순서가 역할별로 뭉쳐 보이지 않게 섞기

        const shuffledNames = [...LGM_BOT_NAMES].sort(() => Math.random() - 0.5).slice(0, botCount);
        this.bots = shuffledNames.map((name, i) => lgmMakeUnit(name, 'demo_bot_' + i, roleDraft[i]));

        // 다른 시청자(봇)들은 곧바로 채팅으로 참가하기 시작 - 화면이 살아있다는 걸 바로 보여줌
        const joinYou = () => {
            if (this._youJoined) return;
            this._youJoined = true;
            this._firePlayerJoined(this.you);
            this._firePartyStats(this._computePartyStats());
            this._chat('당신', '/참가', { you: true });
            if (window.DemoUI) window.DemoUI.hideJoinButton();
        };

        if (window.DemoUI) window.DemoUI.showJoinButton(joinYou);

        for (let i = 0; i < this.bots.length; i++) {
            this._firePlayerJoined(this.bots[i]);
            this._firePartyStats(this._computePartyStats());
            this._chat(this.bots[i].name, '/참가');
            await this._sleep(550);
        }

        // 투표(탐험)와 마찬가지로, 참가 버튼을 눌러도 로비 카운트다운 자체는 끊기지 않고
        // 끝까지 자연스럽게 흘러간다
        for (let t = 13; t >= 0; t--) {
            this._fireTimerUpdate(t, 'lobby');
            await this._sleep(700);
        }

        joinYou();  // 그때까지 안 눌렀으면 자동으로 참가 처리하고 계속 진행
        await this._sleep(400);

        this._runDungeonEntry();
    }

    // 참가 버튼을 아직 안 눌렀으면 "당신"은 통계/진형/랭킹에서 제외 (화면엔 안 보이는데
    // 인원수만 먼저 세어지는 불일치를 막기 위함)
    _allUnits() {
        return [this._youJoined ? this.you : null, ...this.bots].filter(Boolean);
    }

    _computePartyStats() {
        const all = this._allUnits();
        const stats = { total: all.length, warrior: 0, archer: 0, mage: 0, healer: 0 };
        all.forEach(u => { stats[u.role] = (stats[u.role] || 0) + 1; });
        return stats;
    }

    _computeTotalPower() {
        const all = this._allUnits();
        return all.reduce((sum, u) => sum + u.multiplier * 100, 0);
    }

    _computeMvpCandidates() {
        const all = this._allUnits();
        return [...all]
            .sort((a, b) => b.multiplier - a.multiplier)
            .slice(0, 3)
            .map(u => ({ name: u.name, job: u.role, grade: u.grade }));
    }

    // ============ 2. 던전 입장 브리핑 ============
    async _runDungeonEntry() {
        this._chatSystem('🚪 모집 마감! 파티가 던전에 입장합니다...');

        // 파티 HP는 던전 입장 시 정해져서 1층부터 3층까지 그대로 이어진다 (총 3개 층:
        // 1층 플러그 전투 → 2층 탐험 → 3층 스크라벤 전투 후 데모 종료)
        this.partyMaxHp = 3500;
        this.partyHp = 3500;

        this._firePhaseChange({
            phase: 'dungeon',
            floor: 1,
            party_stats: this._computePartyStats(),
            total_power: this._computeTotalPower(),
            mvp_candidates: this._computeMvpCandidates(),
            monsters: ['플러그', '스크라벤']   // 이번 던전에서 만날 몬스터 스프라이트 미리 로딩용
        });

        // 진형 로스터도 같이 흘려보내 브리핑 화면 이후 씬들이 바로 참조할 수 있게 함
        this._fireFormationUpdate(this._buildFormationRoster());

        await this._sleep(6000);  // 실제 서버 DUNGEON_ENTRY_SEC(8초)와 비슷하게 맞춘 연출 대기

        this._runBattlePlug();
    }

    _buildFormationRoster() {
        const roster = {
            warrior: { units: [], overflow: 0 },
            archer: { units: [], overflow: 0 },
            mage: { units: [], overflow: 0 },
            healer: { units: [], overflow: 0 }
        };
        this._allUnits().forEach(u => {
            roster[u.role].units.push({ user_id: u.user_id, name: u.name, grade: u.grade, alive: u.alive });
        });
        return roster;
    }

    // ============ 3. 탐험 갈림길 (2층 - 실제 2층 데이터 재사용) ============
    async _runExplore() {
        this._currentFloor = 2;

        this._firePhaseChange({
            phase: 'explore',
            floor: 2,
            banner_text: '2층 갈림길 탐험',
            ambient_sound: '던전소리1.wav',
            ambient_sound_volume: 0.76,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        await this._sleep(500);
        this._fireFormationUpdate(this._buildFormationRoster());
        await this._sleep(300);
        this._fireFormationUpdate(this._buildFormationRoster());  // create()가 늦게 끝났을 경우 대비 재전송

        this._exploreOptions = ['/왼쪽', '/오른쪽'];
        this._exploreTally = { '/왼쪽': 0, '/오른쪽': 0 };
        this._yourExploreVote = null;  // 실제 서버처럼, 클릭은 "투표"일 뿐 그 자리에서 바로 결과가 나오지 않는다

        this._chatSystem('🧭 갈림길 발견! /왼쪽 또는 /오른쪽 을 채팅에 입력해 투표하세요');

        this._fireExploreEvent({
            floor: 2,
            type: 'fork',
            prompt: '갈림길이 나타났다.\n왼쪽에서 바람소리가, 오른쪽에서 물소리가 들린다.',
            options: this._exploreOptions,
            timer: 15,
            preload_sfx: ['5.wav', '바닥무너짐1.wav'],
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        // 클릭 = 투표 등록만. 실제 서버처럼 제한시간이 다 될 때까지 기다렸다가 다수결로
        // 판정한다 - 눌렀다고 바로 라운드가 끝나버리지 않는다
        const castVote = (choice) => {
            if (this._yourExploreVote) return;
            this._yourExploreVote = choice;
            this._chat('당신', choice, { you: true });
            this._exploreTally[choice] = (this._exploreTally[choice] || 0) + 1;
            this._fireVoteUpdate({
                counts: { ...this._exploreTally },
                voted: Object.values(this._exploreTally).reduce((a, b) => a + b, 0),
                alive_total: this.bots.length + 1
            });
            if (window.DemoUI) window.DemoUI.markVoteCast(choice);
        };

        if (window.DemoUI) window.DemoUI.showExploreChoice(this._exploreOptions, castVote);

        // 봇들도 실제 채팅처럼 각자 다른 타이밍에 투표를 올린다 (정답 쪽으로 살짝 편향된
        // 랜덤 - "채팅이 대체로 맞는 쪽으로 쏠리는" 느낌을 냄)
        this.bots.forEach(bot => {
            const choice = Math.random() < 0.7 ? '/왼쪽' : '/오른쪽';
            const delay = 500 + Math.random() * 12500;
            this._t(() => {
                this._exploreTally[choice]++;
                this._chat(bot.name, choice);
                this._fireVoteUpdate({
                    counts: { ...this._exploreTally },
                    voted: Object.values(this._exploreTally).reduce((a, b) => a + b, 0),
                    alive_total: this.bots.length + 1
                });
            }, delay);
        });

        // 제한시간이 다 될 때까지 그대로 흘러간다 - 투표했다고 카운트가 끊기지 않는다
        for (let t = 14; t >= 0; t--) {
            this._fireTimerUpdate(t, 'explore');
            await this._sleep(1000);
        }

        if (window.DemoUI) window.DemoUI.hideExploreChoice();
        // 투표 안 했으면 정답으로 자동 처리 (혼자 구경만 해도 데모가 자연스럽게 이어지도록)
        this._resolveExplore(this._yourExploreVote || '/왼쪽');
    }

    _resolveExplore(choice) {
        const correct = choice === '/왼쪽';
        const outcome = correct
            ? { text: '안전한 길이다. 파티가 조용히 전진한다.', damage_pct: 0, sfx: '5.wav' }
            : { text: '바닥이 무너진다! 함정이다!', damage_pct: 10, sfx: '바닥무너짐1.wav' };

        const damage = Math.round(this.partyMaxHp * (outcome.damage_pct / 100));
        this.partyHp = Math.max(0, this.partyHp - damage);

        this._chatSystem((correct ? '✅ ' : '❌ ') + outcome.text);

        this._fireExploreResult({
            choice: choice,
            correct: correct,
            text: outcome.text,
            damage_pct: outcome.damage_pct,
            damage: damage,
            reward: null,
            counts: { ...this._exploreTally },
            sfx: outcome.sfx,
            fade_bgm_on_clear: true,
            fade_bgm_duration_sec: 3,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        this._t(() => this._runBattleScraven(), 4500);
    }

    _t(fn, delay) {
        const id = setTimeout(fn, delay);
        this._timers.push(id);
        return id;
    }

    // ============ 4. 1층 전투 (플러그 - 일반 전투, 보스 패턴 없음) ============
    async _runBattlePlug() {
        this._currentFloor = 1;
        this._activePattern = null;
        this._monsterAttackPct = 6.7;  // no_heal_wipe_sec(60)/attack_interval_sec(4) ≈ 15회 → 100/15
        this._monsterAttackText = '플러그가 전기를 내뿜습니다!';
        this._monsterAttackChatText = '💢 플러그의 반격! 파티가 피해를 입었다';

        this.bossMaxHp = 200000;
        this.bossHp = this.bossMaxHp;
        this._battleSafetyMs = 90000;

        this._firePhaseChange({
            phase: 'boss',
            battle_type: 'normal',
            floor: 1,
            floor_total: 3,
            boss_name: '플러그',
            boss_emoji: '🐀',
            boss_sprite: '플러그',
            banner_text: '1층 : 플러그의 방',
            intro_sec: 2,
            battle_bgm: 'theme/012 Thunderwave Cave (PMD Blue Rescue Team OST).mp3',
            battle_bgm_volume: 0.45,
            boss_hp: this.bossHp,
            boss_max_hp: this.bossMaxHp,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        this._chatSystem('⚔️ 플러그가 나타났다! 스킬 버튼으로 함께 공격하세요');

        await this._sleep(300);
        this._fireFormationUpdate(this._buildFormationRoster());
        // BattleScene이 몬스터 등장 연출을 끝내면 notifyBattleIntroDone()을 호출해서
        // 실제 전투 루프(_startBattleLoop)를 시작시킨다
    }

    // ============ 5. 3층 전투 (스크라벤 - 실제 파훼 패턴 포함) ============
    async _runBattleScraven() {
        this._currentFloor = 3;
        this._activePattern = SCRAVEN_PATTERN;
        // no_heal_wipe_sec(30)/attack_interval_sec(4) = 7.5회 → 100/7.5 ≈ 13.3% (플러그보다 훨씬 아픔)
        this._monsterAttackPct = 13.3;
        this._monsterAttackText = '스크라벤이 먹잇감을 향해 발톱을 휘두릅니다.';
        this._monsterAttackChatText = '💢 스크라벤의 발톱 공격! 파티가 피해를 입었다';

        this.bossMaxHp = 1300000;  // 5x (기존 260000)
        this.bossHp = this.bossMaxHp;
        // HP를 5배로 늘린 만큼, 안전장치(강제 종료) 시간도 같이 늘려서 실제 딜로 이길
        // 여지를 준다 (안 늘리면 클릭을 아무리 해도 항상 안전장치로만 끝나버림)
        this._battleSafetyMs = 240000;

        this._firePhaseChange({
            phase: 'boss',
            battle_type: 'miniboss',
            floor: 3,
            floor_total: 3,
            boss_name: '스크라벤',
            boss_emoji: '👾',
            boss_sprite: '스크라벤',
            banner_text: '3층 : 스크라벤의 방',
            intro_sec: 2,
            battle_bgm: 'theme/068 - Dialgas Fight to the Finish! - (Pokémon Mystery Dungeon - Explorers of Sky).mp3',
            battle_bgm_volume: 0.43,
            boss_hp: this.bossHp,
            boss_max_hp: this.bossMaxHp,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        this._chatSystem('👾 스크라벤이 나타났다! 이번엔 패턴 파훼도 함께 대응해야 합니다');

        await this._sleep(300);
        this._fireFormationUpdate(this._buildFormationRoster());
    }

    _startBattleLoop() {
        if (this._battleRunning) return;
        this._battleRunning = true;
        this._battleStartedAt = Date.now();

        if (window.DemoUI) window.DemoUI.showSkillButton(this.you, (cmd) => this._youAct(cmd));

        // 봇들의 자동 공격 - COMBAT_TICK(0.5초)마다 각자의 공격 주기가 찬 봇들을 모아 배치 발사
        // (실서버와 동일하게, 패턴 입력 창 중에도 이 자동 공격은 멈추지 않고 계속된다)
        this._fireFormationUpdate(this._buildFormationRoster());  // create()가 늦게 끝났을 경우 대비 재전송

        this._battleTick = setInterval(() => this._battleTickFn(), 500);
        this._timers.push(this._battleTick);

        if (this._activePattern) {
            // 스크라벤: 초 단위 상태머신(대기→텔레그래프/입력창→결과→반복)이 몬스터의
            // 일반 공격 타이밍까지 함께 관리한다 (몬스터 공격은 'wait' 구간에서만 발동)
            this._patternStage = 'wait';
            this._patternTimer = this._activePattern.pattern_interval_sec;
            this._monsterAttackIn = this._activePattern.attack_interval_sec;
            this._patternMasterTick = setInterval(() => this._scravenTick(), 1000);
            this._timers.push(this._patternMasterTick);
        } else {
            // 플러그: 패턴이 없어서 몬스터가 그냥 일정 주기로만 공격
            this._monsterTick = setInterval(() => this._monsterAttackFn(), 4000);
            this._timers.push(this._monsterTick);
        }

        // 안전장치: 층별로 정해둔 시간(_battleSafetyMs)이 지나도 승부가 안 나면 강제로
        // 몬스터를 쓰러뜨려서 데모가 끝없이 늘어지지 않게 함 (클릭을 전혀 안 해도 결국
        // 승리 화면을 보게 됨)
        this._safetyTimer = setTimeout(() => {
            if (this._battleRunning) {
                this.bossHp = 0;
                this._checkBattleEnd();
            }
        }, this._battleSafetyMs || 90000);
        this._timers.push(this._safetyTimer);
    }

    // ============ 3층 전용: 패턴 상태머신 (1초 틱) ============
    _scravenTick() {
        if (!this._battleRunning) return;

        if (this._patternStage === 'wait') {
            this._monsterAttackIn--;
            if (this._monsterAttackIn <= 0) {
                this._monsterAttackIn = this._activePattern.attack_interval_sec;
                this._monsterAttackFn();
            }
            this._patternTimer--;
            if (this._patternTimer <= 0) this._beginPattern();

        } else if (this._patternStage === 'window') {
            this._patternTimer--;
            this._firePatternTimer(Math.max(0, this._patternTimer));
            if (this._patternTimer <= 0) this._resolvePattern();

        } else if (this._patternStage === 'result') {
            this._patternTimer--;
            if (this._patternTimer <= 0) {
                this._patternStage = 'wait';
                this._patternTimer = this._activePattern.pattern_interval_sec;
            }
        }
    }

    _beginPattern() {
        const pat = this._activePattern;
        this._patternStage = 'window';
        this._patternTimer = pat.window_sec;
        this._patternGaugeTotal = 0;
        this._patternScoredUsers = new Set();
        this._patternMaxPossible = this._computePatternMax(pat);

        this._chatSystem('⚡ ' + pat.telegraph);
        this._firePatternTelegraph({
            telegraph: pat.telegraph,
            window: pat.window_sec,
            threshold: pat.success_threshold,
            telegraph_anim: pat.telegraph_anim,
            telegraph_sfx: pat.telegraph_sfx,
            telegraph_sfx_volume: pat.telegraph_sfx_volume,
            telegraph_loop_sound: pat.telegraph_loop_sound,
            telegraph_loop_sound_volume: pat.telegraph_loop_sound_volume,
            hints: this._computePatternHints(pat)
        });

        // 봇들도 실제 채팅처럼, 자기 역할의 "정답" 커맨드가 있으면 창 안에서 랜덤한
        // 타이밍에 제출한다 (일부러 오답을 내진 않음 - 데모가 매번 막히면 곤란하니까)
        this.bots.forEach(bot => {
            if (!bot.alive) return;
            const role = LGM_ROLES[bot.role];
            const candidates = [role.utilCmd, role.attackCmd].filter(Boolean);
            let bestCmd = null, bestScore = 0;
            candidates.forEach(c => { const s = pat.scores[c] || 0; if (s > bestScore) { bestScore = s; bestCmd = c; } });
            if (!bestCmd || Math.random() >= 0.7) return;

            const delay = 800 + Math.random() * Math.max(500, pat.window_sec * 1000 - 1500);
            this._t(() => {
                if (this._patternStage !== 'window') return;
                this._chat(bot.name, bestCmd);
                this._fireSkillUsed({ user_id: bot.user_id, command: bestCmd });
                this._applyPatternScore(bot, bestCmd);
            }, delay);
        });
    }

    // 이 패턴에서 각 역할이 낼 수 있는 커맨드 중 "가장 높은 양수 점수"만 힌트로 보여준다
    // (실서버와 동일 - 이 패턴에서 양수 옵션이 없는 역할(마법사/힐러)은 힌트 자체가 없음)
    _computePatternHints(pat) {
        const hints = [];
        Object.keys(LGM_ROLES).forEach(r => {
            const role = LGM_ROLES[r];
            const candidates = [role.utilCmd, role.attackCmd, r === 'healer' ? '/힐' : null].filter(Boolean);
            let bestCmd = null, bestScore = 0;
            candidates.forEach(c => { const s = pat.scores[c] || 0; if (s > bestScore) { bestScore = s; bestCmd = c; } });
            if (bestCmd) hints.push({ role: r, command: bestCmd });
        });
        return hints;
    }

    // max_possible = 생존 참가자 전원의 "역할별 최선의 양수 점수 x 등급 배율" 합
    _computePatternMax(pat) {
        let total = 0;
        this._allUnits().forEach(u => {
            if (!u.alive) return;
            const role = LGM_ROLES[u.role];
            const candidates = [role.utilCmd, role.attackCmd, u.role === 'healer' ? '/힐' : null].filter(Boolean);
            let best = 0;
            candidates.forEach(c => { const s = pat.scores[c] || 0; if (s > best) best = s; });
            total += best * LGM_GRADES[u.grade].multiplier;
        });
        return total;
    }

    _computeGauge() {
        if (!this._patternMaxPossible || this._patternMaxPossible <= 0) return 0;
        const raw = this._patternGaugeTotal / this._patternMaxPossible * 100;
        return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
    }

    // 유닛이 패턴 입력창 동안 커맨드를 냈을 때 게이지에 반영 (양수는 유저당 1회만,
    // 음수는 낼 때마다 계속 감점 - 실서버와 동일)
    _applyPatternScore(unit, command) {
        const pat = this._activePattern;
        if (!pat || this._patternStage !== 'window') return;

        const score = pat.scores[command] || 0;
        if (score > 0) {
            if (this._patternScoredUsers.has(unit.user_id)) return;
            this._patternScoredUsers.add(unit.user_id);
            this._patternGaugeTotal += score * LGM_GRADES[unit.grade].multiplier;
        } else if (score < 0) {
            this._patternGaugeTotal += score;
        } else {
            return;  // 이 패턴과 무관한 커맨드 - 게이지 변화 없음
        }

        const gauge = this._computeGauge();
        this._fireGaugeUpdate(gauge);

        // 성공선에 도달하면 남은 시간과 무관하게 즉시 파훼
        if (gauge >= pat.success_threshold) this._resolvePattern();
    }

    _resolvePattern() {
        if (this._patternStage !== 'window') return;  // 이미 판정됐으면 중복 방지
        const pat = this._activePattern;
        const gauge = this._computeGauge();
        const success = gauge >= pat.success_threshold;

        this._patternStage = 'result';
        this._patternTimer = 5;  // 실서버 PATTERN_RESULT_SEC

        if (success) {
            this._chatSystem('✅ 패턴 파훼 성공!');
            this._firePatternResult({
                success: true,
                gauge,
                text: '패턴을 파훼했다!',
                damage_pct: 0,
                damage: 0,
                success_anim: pat.success_anim,
                party_hp: this.partyHp,
                party_max_hp: this.partyMaxHp
            });
        } else {
            // 실패 피해 = 설정된 최대% x (1 - 게이지/100) - 게이지를 많이 채웠을수록 덜 아프다
            const basePct = pat.on_fail.power_damage_pct;
            const actualPct = basePct * (1 - gauge / 100);
            const damage = Math.round(this.partyMaxHp * (actualPct / 100));
            this.partyHp = Math.max(0, this.partyHp - damage);

            this._chatSystem('❌ 패턴 파훼 실패...');
            this._firePatternResult({
                success: false,
                gauge,
                text: '패턴을 막지 못했다!',
                damage_pct: Math.round(actualPct * 10) / 10,
                damage,
                resolve_anim: pat.resolve_anim,
                party_hp: this.partyHp,
                party_max_hp: this.partyMaxHp
            });
        }

        this._checkBattleEnd();
    }

    _rollDamage(grade, coef) {
        const base = 100 + Math.floor(Math.random() * 401);   // randint(100,500)
        const crit = Math.random() < 0.15;
        const dmg = base * LGM_GRADES[grade].multiplier * coef * (crit ? 2 : 1);
        return { damage: Math.floor(dmg), damage_type: crit ? 'critical' : 'normal' };
    }

    _battleTickFn() {
        if (!this._battleRunning) return;
        const attacks = [];
        const heals = [];

        this.bots.forEach(u => {
            if (!u.alive) return;
            u.nextAttackIn -= 0.5;
            if (u.nextAttackIn > 0) return;
            u.nextAttackIn = LGM_ATTACK_PERIODS[u.grade];

            if (u.role === 'healer' && Math.random() < 0.4 && this.partyHp < this.partyMaxHp) {
                // 데모 튜닝: 실서버 힐 공식은 인원이 많을 때를 전제로 한 값이라 소수 인원
                // 데모에선 너무 작게 느껴져서, 체감 있게 보이도록 등급 배율에 비례한
                // 고정 계수를 곱한 값을 사용한다 (실제 밸런스 공식이 아님)
                const amount = Math.round(LGM_GRADES[u.grade].multiplier * (8 + Math.random() * 6));
                this.partyHp = Math.min(this.partyMaxHp, this.partyHp + amount);
                u.totalHeal += amount;
                heals.push({ user_id: u.user_id, name: u.name, amount });
                this._chat(u.name, '/힐');
            } else {
                const role = LGM_ROLES[u.role];
                const { damage, damage_type } = this._rollDamage(u.grade, role.coef);
                this.bossHp = Math.max(0, this.bossHp - damage);
                u.totalDamage += damage;
                attacks.push({
                    user_id: u.user_id, name: u.name, role: u.role, grade: u.grade,
                    skill: role.attackLabel, damage, damage_type
                });
                this._chat(u.name, role.attackCmd);
            }
        });

        if (attacks.length || heals.length) {
            this._fireAttackBatch({
                attacks, heals,
                boss_hp: this.bossHp,
                party_hp: this.partyHp,
                party_max_hp: this.partyMaxHp
            });
        }

        this._checkBattleEnd();
    }

    _monsterAttackFn() {
        if (!this._battleRunning) return;
        let pct = this._monsterAttackPct;

        // 1층(플러그)에서만 쓰이는 단순화된 방어: 방어 버튼을 눌러뒀으면 이번 공격 피해를
        // 절반으로 줄인다. 3층(스크라벤)은 이 플래그를 아예 안 쓰고 진짜 패턴으로 방어한다
        if (this._shielded) {
            pct = Math.round(pct / 2 * 10) / 10;
            this._shielded = false;
            this._chatSystem('🛡️ 방어 태세 덕분에 피해가 절반으로 줄었다!');
        } else {
            this._chatSystem(this._monsterAttackChatText);
        }

        const damage = Math.round(this.partyMaxHp * (pct / 100));
        this.partyHp = Math.max(0, this.partyHp - damage);

        this._fireMonsterAttack({
            text: this._monsterAttackText,
            damage_pct: pct,
            damage,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        this._checkBattleEnd();
    }

    // 리뷰어(당신)가 스킬 버튼을 클릭했을 때
    _youAct(cmd) {
        if (!this._battleRunning || !this.you) return;
        const now = Date.now();
        if (now - this._lastClickAt < 700) return;  // 연타 방지 쿨타임
        this._lastClickAt = now;

        const role = LGM_ROLES[this.you.role];
        const patternWindowOpen = this._activePattern && this._patternStage === 'window';

        if (cmd === 'defend') {
            this._chat('당신', role.utilCmd, { you: true });

            if (this._activePattern) {
                // 3층: 실서버와 동일하게, 패턴 입력창이 열려 있을 때만 애니메이션+게이지 반영
                // (이 역할에게 지금 패턴이 정답/오답/무관일 수 있음)
                if (patternWindowOpen) {
                    this._fireSkillUsed({ user_id: this.you.user_id, command: role.utilCmd });
                    this._applyPatternScore(this.you, role.utilCmd);
                } else {
                    this._chatSystem('（지금은 패턴 입력 시간이 아니라 효과가 없습니다）');
                }
            } else {
                // 1층: 패턴이 없어서 대신 다음 몬스터 공격 피해를 절반으로 줄이는 단순 방어
                this._fireSkillUsed({ user_id: this.you.user_id, command: role.utilCmd });
                this._shielded = true;
                this._chatSystem('🛡️ 당신이 방어 태세를 취했다! 다음 공격 피해 감소');
            }
        } else if (cmd === 'heal') {
            const amount = Math.round(LGM_GRADES[this.you.grade].multiplier * (8 + Math.random() * 6));
            this.partyHp = Math.min(this.partyMaxHp, this.partyHp + amount);
            this.you.totalHeal += amount;
            this._chat('당신', '/힐', { you: true });
            this._fireAttackBatch({
                attacks: [],
                heals: [{ user_id: this.you.user_id, name: this.you.name, amount }],
                boss_hp: this.bossHp,
                party_hp: this.partyHp,
                party_max_hp: this.partyMaxHp
            });
            if (patternWindowOpen) this._applyPatternScore(this.you, '/힐');
        } else {
            const { damage, damage_type } = this._rollDamage(this.you.grade, role.coef);
            this.bossHp = Math.max(0, this.bossHp - damage);
            this.you.totalDamage += damage;
            this._chat('당신', role.attackCmd, { you: true });
            this._fireAttackBatch({
                attacks: [{
                    user_id: this.you.user_id, name: this.you.name, role: this.you.role,
                    grade: this.you.grade, skill: role.attackLabel, damage, damage_type
                }],
                heals: [],
                boss_hp: this.bossHp,
                party_hp: this.partyHp,
                party_max_hp: this.partyMaxHp
            });
            if (patternWindowOpen) this._applyPatternScore(this.you, role.attackCmd);
        }

        this._checkBattleEnd();
    }

    _buildRanking() {
        const all = this._allUnits();
        return all
            .map(u => ({
                name: u.name,
                role: u.role,
                grade: u.grade,
                is_heal: u.totalHeal > u.totalDamage,
                damage: Math.max(u.totalDamage, u.totalHeal)
            }))
            .sort((a, b) => b.damage - a.damage)
            .slice(0, 5)
            .map((r, i) => ({ ...r, rank: i + 1 }));
    }

    _checkBattleEnd() {
        if (!this._battleRunning) return;

        if (this.bossHp <= 0) {
            this._battleRunning = false;
            this._clearBattleTimers();
            if (window.DemoUI) window.DemoUI.hideSkillButton();

            if (this._currentFloor === 1) {
                // 1층(플러그) 클리어 - 실서버처럼 마지막 층이 아니면 boss_defeated로 다음
                // 층(탐험)까지만 안내하고, dungeon_clear는 진짜 마지막 층에서만 보낸다
                this._chatSystem('🏆 1층 클리어! 다음 층으로 이동합니다');
                this._fireBossDefeated({
                    floor: 1,
                    next_floor: 2,
                    ranking: this._buildRanking(),
                    fade_bgm_on_clear: true,
                    fade_bgm_duration_sec: 2
                });
                this._t(() => this._runExplore(), 4000);

            } else {
                // 3층(스크라벤) 클리어 - 이번 데모의 진짜 마지막 층
                this._chatSystem('🏆 던전 클리어!! 수고하셨습니다');
                this._fireDungeonClear({
                    dungeon_name: '어둠의 지하묘지 (데모)',
                    end_message: '데모 플레이를 완료했습니다! 실제 라이브 버전은 유튜브 채팅으로\n수십~수백 명이 함께 진행합니다.',
                    ranking: this._buildRanking(),
                    fade_bgm_on_clear: true,
                    fade_bgm_duration_sec: 2
                });
                this._t(() => {
                    if (window.DemoUI) window.DemoUI.showRestart();
                }, 4000);
            }

        } else if (this.partyHp <= 0) {
            this._battleRunning = false;
            this._clearBattleTimers();
            if (window.DemoUI) window.DemoUI.hideSkillButton();
            this._chatSystem('💀 파티 전멸... 다시 도전해보세요');

            this._firePartyWiped({ floor: this._currentFloor, ranking: this._buildRanking() });

            this._t(() => {
                if (window.DemoUI) window.DemoUI.showRestart();
            }, 3000);
        }
    }

    _clearBattleTimers() {
        clearInterval(this._battleTick);
        clearInterval(this._monsterTick);
        clearInterval(this._patternMasterTick);
        clearTimeout(this._safetyTimer);
    }
}

window.gameSocket = new LocalGameMaster();
