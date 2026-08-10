/**
 * WebSocket 통신 관리
 * 서버와 실시간 데이터 송수신
 */
class GameSocket {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.connect();
    }

    connect() {
        // Socket.IO 연결
        this.socket = io(window.location.origin, {
            transports: ['websocket', 'polling']
        });

        this.setupListeners();
    }

    setupListeners() {
        // 연결 성공
        this.socket.on('connect', () => {
            console.log('✅ 서버 연결 성공');
            this.connected = true;
            this.log('서버 연결됨');
        });

        // 연결 해제
        this.socket.on('disconnect', () => {
            console.log('❌ 서버 연결 해제');
            this.connected = false;
            this.log('서버 연결 해제');
        });

        // 게임 상태 수신
        this.socket.on('game_state', (data) => {
            console.log('📊 게임 상태:', data);
            window.gameState = data;
        });

        // 파티 통계 수신
        this.socket.on('party_stats', (data) => {
            console.log('👥 파티 통계:', data);
            window.partyStats = data;

            // LobbyScene에 업데이트
            if (window.game) {
                const scene = window.game.scene.getScene('LobbyScene');
                if (scene && scene.updatePartyStats) {
                    scene.updatePartyStats(data);
                }
            }
        });

        // 진형 로스터 (전투/탐험 씬 공용) - 항상 보관해뒀다가 씬 생성 시 재사용
        this.socket.on('formation_update', (data) => {
            window.formationRoster = data;
            const scene = this.getActiveScene();
            if (scene && scene.updateFormation) {
                scene.updateFormation(data);
            }
        });

        // 새 플레이어 참가 (로비=3x3 그리드 / 전투·탐험=신규 참가 카드 슬롯)
        this.socket.on('player_joined', (data) => {
            console.log('🎮 새 참가자:', data);
            this.log(`참가: ${data.name} (${data.grade_name} ${data.role_name})`);

            const scene = this.getActiveScene();
            if (scene && scene.addPlayer) {
                scene.addPlayer(data);
            }
        });

        // 최근 참가자 목록 (연결 시)
        this.socket.on('recent_joins', (data) => {
            console.log('📋 최근 참가자:', data);

            if (window.game) {
                const scene = window.game.scene.getScene('LobbyScene');
                if (scene && scene.loadRecentJoins) {
                    scene.loadRecentJoins(data);
                }
            }
        });

        // 타이머 업데이트 (현재 활성 씬으로 전달)
        this.socket.on('timer_update', (data) => {
            const scene = this.getActiveScene();
            if (scene && scene.updateTimer) {
                scene.updateTimer(data.timer, data.phase);
            }
        });

        // 로비 최소 인원 미달 - 모집 재시작 경고
        this.socket.on('lobby_insufficient', (data) => {
            console.log('⚠️ 인원 부족:', data);
            this.log(`인원 부족 (${data.current}/${data.required}) - 모집 재시작`);
            const scene = this.getScene('LobbyScene');
            if (scene && scene.showInsufficientWarning) {
                scene.showInsufficientWarning(data);
            }
        });

        // ===== 탐험 이벤트 =====
        this.socket.on('explore_event', (data) => {
            console.log('🧭 탐험 이벤트:', data);
            const scene = this.getScene('ExploreScene');
            if (scene && scene.showEvent) {
                scene.showEvent(data);
            } else {
                // 입장 연출(암전) 중이라 씬이 아직 없음 - 보관했다가 씬이 뜨면 전달
                this.pendingExploreEvent = data;
            }
        });

        this.socket.on('vote_update', (data) => {
            const scene = this.getScene('ExploreScene');
            if (scene && scene.updateVotes) {
                scene.updateVotes(data);
            }
        });

        this.socket.on('explore_result', (data) => {
            console.log('🎲 탐험 결과:', data);
            this.log(`탐험: ${data.choice} → ${data.correct ? '정답' : '오답'}`);
            const scene = this.getScene('ExploreScene');
            if (scene && scene.showResult) {
                scene.showResult(data);
            }
        });

        // 페이즈 변경 (서버가 씬 전환을 지휘)
        this.socket.on('phase_change', (data) => {
            console.log('🔄 페이즈 변경:', data);
            this.log(`페이즈: ${data.phase}`);

            // 페이즈가 바뀔 때마다 지금 재생 중인 곡의 반복을 꺼둔다 - 새 씬이 다른 곡을
            // play()하면 거기서 바로 교체되지만, 새 곡을 안 정한 씬(예: battle_bgm 미설정
            // 층, 탐험 씬)으로 넘어가도 최소한 지금 곡이 끝나면 멈추지 영원히 반복되진 않는다
            window.BgmManager.stopLooping();

            // 환경음(바람소리 등)은 BGM과 달리 페이즈가 바뀌는 즉시 끊는다 - 그 탐험 층에만
            // 딸린 소리라 다른 층/전투로 넘어가면서까지 이어질 이유가 없음. 새 탐험 층에
            // 자기 환경음이 있으면 그 씬의 create()가 알아서 다시 켠다
            window.AmbientManager.stop();

            // 탐험 페이즈가 아니게 되면 보관 중인 탐험 이벤트 폐기
            if (data.phase !== 'explore') {
                this.pendingExploreEvent = null;
            }

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
                // 일반 몬스터/보스 모두 BattleScene (보스는 패턴 UI 추가 동작)
                this.startWithEntryTransition('BattleScene', data);
            } else if (data.phase === 'lobby') {
                this.switchScene('LobbyScene');
            }
        });

        // 자동 전투 배치 (전투 틱마다 공격/힐 묶음 도착)
        this.socket.on('attack_batch', (data) => {
            const scene = this.getActiveScene();
            if (scene && scene.showAttackBatch) {
                scene.showAttackBatch(data);
            }
        });

        // 유틸 스킬 사용 (보스 패턴 입력 창에서의 /방어 /역산 /정화 /퇴격 등)
        // - 진형 스프라이트 애니메이션 + (지정돼 있으면) 스킬 전용 사운드 재생
        this.socket.on('skill_used', (data) => {
            const scene = this.getActiveScene();
            if (!scene) return;
            const skillLabel = (data.command || '').replace(/^\//, '');
            // self/boss VFX·사운드는 formation.playAttack() 내부에서 skill_vfx 설정에 따라
            // 각자의 발동 프레임에 자동 재생됨
            if (scene.formation) {
                scene.formation.playAttack(data.user_id, skillLabel);
            }
        });

        // 몬스터의 파티 공격
        this.socket.on('monster_attack', (data) => {
            const scene = this.getActiveScene();
            if (scene && scene.showMonsterAttack) {
                scene.showMonsterAttack(data);
            }
        });

        // 전투 승리 (결과 화면 → 서버가 다음 층으로 전환)
        this.socket.on('boss_defeated', (data) => {
            console.log('🎉 전투 승리:', data);
            this.log(`${data.floor}층 클리어!`);

            const scene = this.getActiveScene();
            if (scene && scene.showVictory) {
                scene.showVictory(data);
            }
        });

        // ===== 보스 패턴 =====
        this.socket.on('pattern_telegraph', (data) => {
            console.log('⚡ 패턴 텔레그래프:', data.telegraph);
            const scene = this.getActiveScene();
            if (scene && scene.showPatternTelegraph) {
                scene.showPatternTelegraph(data);
            }
        });

        this.socket.on('gauge_update', (data) => {
            const scene = this.getActiveScene();
            if (scene && scene.updateGauge) {
                scene.updateGauge(data.gauge);
            }
        });

        this.socket.on('pattern_timer', (data) => {
            const scene = this.getActiveScene();
            if (scene && scene.updatePatternTimer) {
                scene.updatePatternTimer(data.timer);
            }
        });

        this.socket.on('pattern_result', (data) => {
            console.log('⚡ 패턴 판정:', data.success ? '성공' : '실패', data.gauge + '%');
            this.log(`패턴 ${data.success ? '파훼!' : '실패'} (${data.gauge}%)`);
            const scene = this.getActiveScene();
            if (scene && scene.showPatternResult) {
                scene.showPatternResult(data);
            }
        });

        // 던전 정복! (마지막 층 클리어 → 서버가 로비로 리셋)
        this.socket.on('dungeon_clear', (data) => {
            console.log('🏆 던전 정복:', data);
            this.log(`${data.dungeon_name} 정복!`);

            const scene = this.getActiveScene();
            if (scene && scene.showConquered) {
                scene.showConquered(data);
            }
        });

        // 파티 전멸 (탐험/보스 어느 씬에서든 표시 → 서버가 로비로 리셋)
        this.socket.on('party_wiped', (data) => {
            console.log('💀 파티 전멸:', data);
            this.log(`${data.floor}층에서 전멸...`);

            const scene = this.getActiveScene();
            if (scene && scene.showDefeat) {
                scene.showDefeat(data);
            }
        });

        // YouTube 상태
        this.socket.on('youtube_status', (data) => {
            console.log('📺 YouTube:', data);
            this.log(`YouTube: ${data.status}`);
        });

        // 인스타그램 상태 (비공식)
        this.socket.on('instagram_status', (data) => {
            console.log('📸 Instagram:', data);
            this.log(`Instagram: ${data.status}${data.message ? ' - ' + data.message : ''}`);
        });

        // 채팅 봇 응답
        this.socket.on('chat_response', (data) => {
            console.log('💬 봇:', data.message);
            this.log(`봇: ${data.message}`);
        });

        // 슈퍼챗
        this.socket.on('superchat', (data) => {
            console.log('💎 슈퍼챗:', data);
            this.log(`슈퍼챗! ${data.name}: ${data.amount}원`);

            // 슈퍼챗 이펙트 표시
            if (window.game) {
                const scene = window.game.scene.getScene('LobbyScene');
                if (scene && scene.showSuperchatEffect) {
                    scene.showSuperchatEffect(data);
                }
            }
        });
    }

    // 씬 전환: 다른 활성 씬을 전부 정지시키고 시작
    // (Phaser의 game.scene.start는 이전 씬을 멈추지 않아서, 밑에 깔린 씬이
    //  전환 순간 잠깐 드러나는 문제를 막는다)
    switchScene(sceneKey, data) {
        if (!window.game) return;
        window.game.scene.getScenes(true).forEach(s => {
            if (s.scene.key !== sceneKey) {
                s.scene.stop();
            }
        });
        window.game.scene.start(sceneKey, data);
    }

    // 씬 전환 연출:
    // - 던전 입장 브리핑 화면이 떠 있으면 퇴장 연출(확대+암전) 후 전환 (던전 시작 시 1회)
    // - 그 외(층과 층 사이)는 짧은 암전(0.5초) 전환
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

    // 현재 활성(화면에 떠 있는) 씬 반환
    getActiveScene() {
        if (!window.game) return null;
        const scenes = window.game.scene.getScenes(true);
        return scenes.length > 0 ? scenes[0] : null;
    }

    // 특정 씬이 활성 상태일 때만 반환
    getScene(key) {
        if (!window.game) return null;
        const scene = window.game.scene.getScene(key);
        return (scene && scene.scene.isActive()) ? scene : null;
    }

    // YouTube 채팅 시작
    startYoutube(videoId) {
        this.socket.emit('start_youtube', { video_id: videoId });
    }

    // YouTube 채팅 중지
    stopYoutube() {
        this.socket.emit('stop_youtube');
    }

    // 인스타그램 라이브 댓글 시작 (비공식)
    startInstagram(username) {
        this.socket.emit('start_instagram', { username });
    }

    // 인스타그램 라이브 댓글 중지
    stopInstagram() {
        this.socket.emit('stop_instagram');
    }

    // 게임 리셋
    resetGame() {
        this.socket.emit('reset_game');
    }

    // 몬스터 등장 연출(배너+페이드인)이 끝났다는 신호 - 이때부터 서버가 전투 로직을 시작한다
    notifyBattleIntroDone(floor) {
        this.socket.emit('battle_intro_done', { floor });
    }

    // 디버그 로그
    log(msg) {
        if (typeof debugLog === 'function') {
            debugLog(msg);
        }
    }
}

// 전역 소켓 인스턴스 생성
window.gameSocket = new GameSocket();
