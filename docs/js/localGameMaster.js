/**
 * LocalGameMaster - 서버 없이 혼자 플레이하는 데모용 "가짜 게임 마스터"
 *
 * 실제 게임은 backend/server.py가 Socket.IO로 이벤트를 내려보내고, 프론트는
 * GameSocket(socket.js)이 그걸 받아 각 씬(LobbyScene/DungeonEntryScene/
 * ExploreScene/BattleScene)의 메서드를 호출하는 구조다. 이 클래스는 실제 서버
 * 접속 없이 window.gameSocket 자리에 대신 들어가서, 같은 이벤트들을 정해진
 * 각본(로비 → 던전 입장 → 탐험 갈림길 → 1층 전투 → 클리어)에 맞춰 스스로
 * 만들어 씬에 흘려보낸다. 씬 코드는 실제 서버가 보낸 건지 여기서 만든 건지
 * 구분하지 못한다 (socket.js와 동일한 공개 인터페이스를 흉내냄).
 *
 * 데모 범위: 1층은 보스 패턴(QTE) 없는 "일반 전투"라 가장 단순하게 재현
 * 가능해서 골랐다. 탐험 갈림길은 실제 2층 데이터를 재사용한다.
 * 데미지 공식은 server.py의 공식을 최대한 그대로 따르되, 인원이 훨씬 적은
 * 1인 데모에 맞게 파티 최대HP·회복량 등 일부 상수만 데모용으로 조정했다
 * (주석에 "데모 튜닝"이라고 표시).
 */

// ============ 게임 상수 (backend/server.py의 ROLES/GRADES/ATTACK_SKILLS와 동일) ============
const LGM_ROLES = {
    warrior: { name: '전사', emoji: '⚔️', weight: 35, attackCmd: '/강타', attackLabel: '강타', coef: 1.2 },
    archer:  { name: '궁수', emoji: '🏹', weight: 30, attackCmd: '/저격', attackLabel: '저격', coef: 1.2 },
    mage:    { name: '마법사', emoji: '🔮', weight: 20, attackCmd: '/파이어볼', attackLabel: '파이어볼', coef: 1.3 },
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
        this._voteCounts = {};
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

    _fireMonsterAttack(data) {
        this._safe('monster_attack', () => {
            const scene = this.getActiveScene();
            if (scene && scene.showMonsterAttack) scene.showMonsterAttack(data);
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
        this._fireTimerUpdate(8, 'lobby');

        // 등급은 데모가 재밌게 느껴지도록 희귀 이상만 나오게 살짝 편향
        this.you = lgmMakeUnit('당신', 'demo_you', null, lgmWeightedPick({
            legendary: LGM_GRADES.legendary, epic: LGM_GRADES.epic, rare: LGM_GRADES.rare
        }));

        const botCount = 6;
        const shuffledNames = [...LGM_BOT_NAMES].sort(() => Math.random() - 0.5).slice(0, botCount);
        this.bots = shuffledNames.map((name, i) => lgmMakeUnit(name, 'demo_bot_' + i));

        // 다른 시청자(봇)들은 곧바로 채팅으로 참가하기 시작 - 화면이 살아있다는 걸 바로 보여줌
        const joinYou = () => {
            if (this._youJoined) return;
            this._youJoined = true;
            this._firePlayerJoined(this.you);
            this._firePartyStats(this._computePartyStats());
            if (window.DemoUI) window.DemoUI.hideJoinButton();
        };

        if (window.DemoUI) window.DemoUI.showJoinButton(joinYou);

        for (let i = 0; i < this.bots.length; i++) {
            this._firePlayerJoined(this.bots[i]);
            this._firePartyStats(this._computePartyStats());
            await this._sleep(550);
        }

        for (let t = 7; t >= 0; t--) {
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
        this._firePhaseChange({
            phase: 'dungeon',
            floor: 1,
            party_stats: this._computePartyStats(),
            total_power: this._computeTotalPower(),
            mvp_candidates: this._computeMvpCandidates(),
            monsters: ['플러그']   // 1층 몬스터 스프라이트 미리 로딩용
        });

        // 진형 로스터도 같이 흘려보내 브리핑 화면 이후 씬들이 바로 참조할 수 있게 함
        this._fireFormationUpdate(this._buildFormationRoster());

        await this._sleep(6000);  // 실제 서버 DUNGEON_ENTRY_SEC(8초)와 비슷하게 맞춘 연출 대기

        this._runExplore();
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

    // ============ 3. 탐험 갈림길 (실제 2층 데이터 재사용) ============
    async _runExplore() {
        this.partyMaxHp = 3500;
        this.partyHp = 3500;

        this._firePhaseChange({
            phase: 'explore',
            floor: 1,
            banner_text: '갈림길 탐험',
            ambient_sound: '던전소리1.wav',
            ambient_sound_volume: 0.76,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        await this._sleep(500);
        this._fireFormationUpdate(this._buildFormationRoster());
        await this._sleep(300);
        this._fireFormationUpdate(this._buildFormationRoster());  // create()가 늦게 끝났을 경우 대비 재전송

        this._exploreResolved = false;
        this._exploreOptions = ['/왼쪽', '/오른쪽'];
        this._voteCounts = { '/왼쪽': 0, '/오른쪽': 0 };

        this._fireExploreEvent({
            floor: 1,
            type: 'fork',
            prompt: '갈림길이 나타났다.\n왼쪽에서 바람소리가, 오른쪽에서 물소리가 들린다.',
            options: this._exploreOptions,
            timer: 15,
            preload_sfx: ['5.wav', '바닥무너짐1.wav'],
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        if (window.DemoUI) window.DemoUI.showExploreChoice(this._exploreOptions, (choice) => this._resolveExplore(choice));

        for (let t = 14; t >= 0 && !this._exploreResolved; t--) {
            this._fireTimerUpdate(t, 'explore');
            await this._sleep(1000);
            if (this._exploreResolved) return;
        }

        // 시간 초과 시 정답으로 자동 처리 (혼자 구경만 해도 데모가 자연스럽게 이어지도록)
        if (!this._exploreResolved) this._resolveExplore('/왼쪽');
    }

    _resolveExplore(choice) {
        if (this._exploreResolved) return;
        this._exploreResolved = true;
        if (window.DemoUI) window.DemoUI.hideExploreChoice();

        const correct = choice === '/왼쪽';
        // 나머지 참가자들의 표는 그럴듯하게 당신 쪽으로 쏠리게 채움 (실제론 다수결 투표)
        const total = 1 + this.bots.length;
        const majority = Math.max(1, Math.round(total * 0.7));
        this._voteCounts = {
            '/왼쪽': choice === '/왼쪽' ? majority : total - majority,
            '/오른쪽': choice === '/오른쪽' ? majority : total - majority
        };

        const outcome = correct
            ? { text: '안전한 길이다. 파티가 조용히 전진한다.', damage_pct: 0, sfx: '5.wav' }
            : { text: '바닥이 무너진다! 함정이다!', damage_pct: 10, sfx: '바닥무너짐1.wav' };

        const damage = Math.round(this.partyMaxHp * (outcome.damage_pct / 100));
        this.partyHp = Math.max(0, this.partyHp - damage);

        this._fireExploreResult({
            choice: choice,
            correct: correct,
            text: outcome.text,
            damage_pct: outcome.damage_pct,
            damage: damage,
            reward: null,
            counts: this._voteCounts,
            sfx: outcome.sfx,
            fade_bgm_on_clear: true,
            fade_bgm_duration_sec: 3,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        this._t(() => this._runBattle(), 4500);
    }

    _t(fn, delay) {
        const id = setTimeout(fn, delay);
        this._timers.push(id);
        return id;
    }

    // ============ 4. 1층 전투 (일반 전투 - 보스 패턴 없음) ============
    async _runBattle() {
        this.bossMaxHp = 200000;
        this.bossHp = this.bossMaxHp;

        this._firePhaseChange({
            phase: 'boss',
            battle_type: 'normal',
            floor: 2,
            floor_total: 2,
            boss_name: '플러그',
            boss_emoji: '🐀',
            boss_sprite: '플러그',
            banner_text: '2층 : 플러그의 습격!',
            intro_sec: 2,
            battle_bgm: 'theme/012 Thunderwave Cave (PMD Blue Rescue Team OST).mp3',
            battle_bgm_volume: 0.45,
            boss_hp: this.bossHp,
            boss_max_hp: this.bossMaxHp,
            party_hp: this.partyHp,
            party_max_hp: this.partyMaxHp
        });

        await this._sleep(300);
        this._fireFormationUpdate(this._buildFormationRoster());
        // BattleScene이 몬스터 등장 연출을 끝내면 notifyBattleIntroDone()을 호출해서
        // 실제 전투 루프(_startBattleLoop)를 시작시킨다
    }

    _startBattleLoop() {
        if (this._battleRunning) return;
        this._battleRunning = true;
        this._battleStartedAt = Date.now();

        if (window.DemoUI) window.DemoUI.showSkillButton(this.you, (cmd) => this._youAct(cmd));

        // 봇들의 자동 공격 - COMBAT_TICK(0.5초)마다 각자의 공격 주기가 찬 봇들을 모아 배치 발사
        this._fireFormationUpdate(this._buildFormationRoster());  // create()가 늦게 끝났을 경우 대비 재전송

        this._battleTick = setInterval(() => this._battleTickFn(), 500);
        this._timers.push(this._battleTick);

        // 몬스터의 파티 공격 - attack_interval_sec(4초)마다 1회
        this._monsterTick = setInterval(() => this._monsterAttackFn(), 4000);
        this._timers.push(this._monsterTick);

        // 안전장치: 90초가 지나도 승부가 안 나면 강제로 몬스터를 쓰러뜨려서 데모가
        // 끝없이 늘어지지 않게 함 (클릭을 전혀 안 해도 결국 승리 화면을 보게 됨)
        this._safetyTimer = setTimeout(() => {
            if (this._battleRunning) {
                this.bossHp = 0;
                this._checkBattleEnd();
            }
        }, 90000);
        this._timers.push(this._safetyTimer);
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
            } else {
                const role = LGM_ROLES[u.role];
                const { damage, damage_type } = this._rollDamage(u.grade, role.coef);
                this.bossHp = Math.max(0, this.bossHp - damage);
                u.totalDamage += damage;
                attacks.push({
                    user_id: u.user_id, name: u.name, role: u.role, grade: u.grade,
                    skill: role.attackLabel, damage, damage_type
                });
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
        const pct = 6.7; // no_heal_wipe_sec(60) / attack_interval_sec(4) = 15회 → 100/15 ≈ 6.7%
        const damage = Math.round(this.partyMaxHp * (pct / 100));
        this.partyHp = Math.max(0, this.partyHp - damage);

        this._fireMonsterAttack({
            text: '플러그가 전기를 내뿜습니다!',
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

        if (cmd === 'heal') {
            const amount = Math.round(LGM_GRADES[this.you.grade].multiplier * (8 + Math.random() * 6));
            this.partyHp = Math.min(this.partyMaxHp, this.partyHp + amount);
            this.you.totalHeal += amount;
            this._fireAttackBatch({
                attacks: [],
                heals: [{ user_id: this.you.user_id, name: this.you.name, amount }],
                boss_hp: this.bossHp,
                party_hp: this.partyHp,
                party_max_hp: this.partyMaxHp
            });
        } else {
            const { damage, damage_type } = this._rollDamage(this.you.grade, role.coef);
            this.bossHp = Math.max(0, this.bossHp - damage);
            this.you.totalDamage += damage;
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

            // 실서버는 "마지막 층 클리어"일 때 boss_defeated 대신 dungeon_clear를
            // 단독으로 보낸다(결과 화면이 두 번 겹쳐 뜨지 않게). 데모는 층이 하나뿐이라
            // 이 전투가 곧 마지막 층이므로 dungeon_clear만 보낸다.
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

        } else if (this.partyHp <= 0) {
            this._battleRunning = false;
            this._clearBattleTimers();
            if (window.DemoUI) window.DemoUI.hideSkillButton();

            this._firePartyWiped({ floor: 2, ranking: this._buildRanking() });

            this._t(() => {
                if (window.DemoUI) window.DemoUI.showRestart();
            }, 3000);
        }
    }

    _clearBattleTimers() {
        clearInterval(this._battleTick);
        clearInterval(this._monsterTick);
        clearTimeout(this._safetyTimer);
    }
}

window.gameSocket = new LocalGameMaster();
