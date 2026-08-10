/**
 * ExploreScene - 던전 탐험 화면
 * 갈림길/상자 등 선택지 이벤트를 투표로 진행
 * (정답은 서버만 알고 있음 - 화면에는 절대 표시하지 않는다)
 */
class ExploreScene extends Phaser.Scene {
    constructor() {
        super({ key: 'ExploreScene' });

        this.W = 1080;
        this.H = 1920;
    }

    init(data) {
        this.floor = data.floor || 1;
        // 상단 배너 전체 문구 (서버가 자동 생성 폴백까지 포함해서 보내줌)
        this.bannerText = data.banner_text || window.t('exploreDefaultBanner', this.floor);
        this.partyHp = data.party_hp || 0;
        this.partyMaxHp = data.party_max_hp || 1;

        // 이 층 전용 BGM(battle_bgm과 동일 개념 - 없으면 이전 곡 유지) +
        // BGM과 별개 채널로 동시에 깔리는 환경음(바람소리/물소리 등 루프)
        this.exploreBgm = data.bgm || null;
        this.exploreBgmVolume = data.bgm_volume;
        this.ambientSound = data.ambient_sound || null;
        this.ambientSoundVolume = data.ambient_sound_volume;

        this.currentOptions = [];
        this.optionBars = [];
        this.resultContainer = null;
        this.lastVoteTotal = 0;  // 투표 사운드 - 총 득표수가 늘어났을 때만 재생하기 위한 기준값
    }

    preload() {
        // 로비(LobbyScene)에서 이미 로드한 'background' 텍스처를 재사용.
        // 씬 시작마다 새로 로딩하면 전환 순간 빈 화면이 생긴다.
        if (!this.textures.exists('background')) {
            this.load.image('background', 'assets/backgrounds/던전 background.png');
        }

        // 진형 유닛 스프라이트 + 참가 카드 캐릭터
        window.FormationView.queueLoad(this);
        window.JoinCard.queueLoad(this);

        window.BgmManager.queueLoad(this, this.exploreBgm);
        window.AmbientManager.queueLoad(this, this.ambientSound);
    }

    create() {
        const centerX = this.W / 2;

        // 암전에서 페이드 인 (던전 입장 연출과 연결)
        this.cameras.main.fadeIn(700, 0, 0, 0);

        // 이 층에 전용 BGM이 지정돼 있으면 교체(없으면 이전 곡 그대로 유지 - battle_bgm과
        // 동일한 규칙). 환경음은 이 층에 지정된 게 없으면 확실히 꺼서, 이전 탐험 층의
        // 바람소리 등이 계속 안 이어지게 함
        if (this.exploreBgm) {
            window.BgmManager.play(this, this.exploreBgm, this.exploreBgmVolume);
        }
        if (this.ambientSound) {
            window.AmbientManager.play(this, this.ambientSound, this.ambientSoundVolume);
        } else {
            window.AmbientManager.stop();
        }

        // 배경
        const bg = this.add.image(centerX, this.H / 2, 'background');
        bg.setDisplaySize(this.W, this.H);

        // 어둡게 오버레이 (텍스트 가독성)
        this.add.rectangle(centerX, this.H / 2, this.W, this.H, 0x000000, 0.45);

        // ===== 상단: 층 정보 (에디터에서 정한 전체 배너 문구) =====
        this.add.text(centerX, 90, this.bannerText, {
            fontSize: '52px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);

        // ===== 파티 HP 바 =====
        this.createPartyHpBar(centerX, 180);

        // ===== 이벤트 문구 패널 =====
        const panelY = 480;
        const panelBg = this.add.graphics();
        panelBg.fillStyle(0x000000, 0.75);
        panelBg.fillRoundedRect(centerX - 480, panelY - 160, 960, 320, 12);
        panelBg.lineStyle(4, 0x8B7355, 1);
        panelBg.strokeRoundedRect(centerX - 480, panelY - 160, 960, 320, 12);

        this.promptText = this.add.text(centerX, panelY, '', {
            fontSize: '42px',
            fontFamily: 'SeoulNamsan',
            color: '#FFE9C9',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
            wordWrap: { width: 880 },
            lineSpacing: 14
        }).setOrigin(0.5);

        // ===== 타이머 =====
        this.timerText = this.add.text(centerX, 720, '', {
            fontSize: '46px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        // ===== 투표 안내 =====
        this.guideText = this.add.text(centerX, 800, window.t('voteGuide'), {
            fontSize: '34px',
            fontFamily: 'SeoulNamsan',
            color: '#AAAAAA',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        this.tweens.add({
            targets: this.guideText,
            alpha: 0.4,
            duration: 700,
            yoyo: true,
            repeat: -1
        });

        // ===== 투표 막대 컨테이너 =====
        this.optionsContainer = this.add.container(0, 0);

        // ===== 파티 진형 (BattleScene과 동일한 크기/위치 - topY는 BattleScene의
        // 파티 HP바(y:1290, height:46) 기준 계산 결과를 그대로 사용) =====
        const formationScale = 1.80;
        const formationNameSize = 23;
        const formationNameOffsets = { warrior: -80, archer: -80, mage: -80, healer: -33 };
        const battleHpBarBottom = 1290 - 23 + 46;
        const formationPadding = 10;
        const formationTopY = battleHpBarBottom + formationPadding +
            window.FormationView.warriorTopMargin(formationScale, formationNameSize, formationNameOffsets.warrior);

        this.formation = new window.FormationView(this, {
            centerX: centerX,
            topY: formationTopY,
            unitGap: 84,
            rowGaps: { warrior: 60, archer: 70, mage: 65 },
            blockGaps: { archer: 90, mage: 25, healer: 140 },
            scale: formationScale,
            nameSize: formationNameSize,
            nameMaxLen: 4,
            nameOffsetY: formationNameOffsets
        });

        // 입장 연출 중에 도착해서 보관해둔 탐험 이벤트가 있으면 즉시 표시
        if (window.gameSocket && window.gameSocket.pendingExploreEvent) {
            const pending = window.gameSocket.pendingExploreEvent;
            window.gameSocket.pendingExploreEvent = null;
            this.showEvent(pending);
        }

        console.log(`🧭 ExploreScene 생성 (${this.floor}층)`);
    }

    // ============ 파티 진형 ============
    updateFormation(roster) {
        if (this.formation) this.formation.setRoster(roster);
    }

    // ============ 파티 HP 바 ============
    createPartyHpBar(centerX, y) {
        const barWidth = 700;
        const barHeight = 42;

        this.add.text(centerX - barWidth / 2 - 20, y, '⚡', {
            fontSize: '38px'
        }).setOrigin(1, 0.5);

        // 배경
        const hpBg = this.add.graphics();
        hpBg.fillStyle(0x2D2D2D, 1);
        hpBg.fillRoundedRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight, 8);
        hpBg.lineStyle(4, 0x000000, 1);
        hpBg.strokeRoundedRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight, 8);

        // 채움 바
        this.hpBarFill = this.add.graphics();
        this.hpBarX = centerX - barWidth / 2;
        this.hpBarY = y - barHeight / 2;
        this.hpBarWidth = barWidth;
        this.hpBarHeight = barHeight;

        // HP 텍스트
        this.hpText = this.add.text(centerX, y, '', {
            fontSize: '28px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);

        this.updatePartyHp(this.partyHp, this.partyMaxHp);
    }

    updatePartyHp(hp, maxHp) {
        this.partyHp = hp;
        this.partyMaxHp = maxHp || 1;

        const ratio = Math.max(0, this.partyHp / this.partyMaxHp);
        const color = ratio > 0.5 ? 0x2ECC71 : (ratio > 0.25 ? 0xFFAA00 : 0xFF3333);

        this.hpBarFill.clear();
        if (ratio > 0) {
            this.hpBarFill.fillStyle(color, 1);
            this.hpBarFill.fillRoundedRect(
                this.hpBarX + 4, this.hpBarY + 4,
                (this.hpBarWidth - 8) * ratio, this.hpBarHeight - 8, 6
            );
        }

        this.hpText.setText(window.t('partyPowerSimple',
            Math.round(this.partyHp).toLocaleString(),
            Math.round(this.partyMaxHp).toLocaleString()
        ));
    }

    // ============ 이벤트 표시 ============
    showEvent(data) {
        // 이전 결과 정리
        if (this.resultContainer) {
            this.resultContainer.destroy();
            this.resultContainer = null;
        }

        this.currentOptions = data.options;
        this.updatePartyHp(data.party_hp, data.party_max_hp);

        // 문구 페이드인
        this.promptText.setText(data.prompt);
        this.promptText.setAlpha(0);
        this.tweens.add({ targets: this.promptText, alpha: 1, duration: 500 });

        this.updateTimer(data.timer);
        this.guideText.setVisible(true);

        // 투표 막대 생성
        this.createOptionBars(data.options);

        // 정답/오답 사운드 방어적 재로딩 - 결과가 나오는 순간(showResult)에 처음 로딩을
        // 시작하면 늦어서 소리가 안 들릴 수 있어, 투표 창이 열리는 지금 미리 받아둔다
        // (어느 쪽이 정답 사운드인지는 알 수 없게 서버가 섞어서 보내줌 - preload_sfx 참고)
        this.queuePreloadSfx(data.preload_sfx);
    }

    queuePreloadSfx(filenames) {
        if (!filenames || !filenames.length) return;
        let queued = false;
        filenames.forEach(f => {
            if (!f) return;
            const cacheKey = 'snd_' + f;
            if (this.cache.audio.exists(cacheKey)) return;
            this.load.audio(cacheKey, 'assets/sounds/' + f);
            queued = true;
        });
        if (queued) this.load.start();
    }

    createOptionBars(options) {
        this.optionsContainer.removeAll(true);
        this.optionBars = [];

        const centerX = this.W / 2;
        const barWidth = 860;
        const barHeight = 130;
        const startY = 980;
        const gap = 40;

        const colors = [0x2A94E0, 0xD74339, 0x85BD64, 0xA547D3];

        options.forEach((option, i) => {
            const y = startY + i * (barHeight + gap);

            // 배경
            const bg = this.add.graphics();
            bg.fillStyle(0x1a1a2e, 0.9);
            bg.fillRoundedRect(centerX - barWidth / 2, y, barWidth, barHeight, 12);
            bg.lineStyle(5, 0x555555, 1);
            bg.strokeRoundedRect(centerX - barWidth / 2, y, barWidth, barHeight, 12);
            this.optionsContainer.add(bg);

            // 득표 채움 바
            const fill = this.add.graphics();
            this.optionsContainer.add(fill);

            // 커맨드 텍스트
            const label = this.add.text(centerX - barWidth / 2 + 40, y + barHeight / 2, option, {
                fontSize: '52px',
                fontFamily: 'SeoulNamsanEB',
                color: '#FFD700',
                stroke: '#000000',
                strokeThickness: 6
            }).setOrigin(0, 0.5);
            this.optionsContainer.add(label);

            // 득표수 텍스트
            const countText = this.add.text(centerX + barWidth / 2 - 40, y + barHeight / 2, '0표', {
                fontSize: '44px',
                fontFamily: 'SeoulNamsan',
                color: '#FFFFFF',
                stroke: '#000000',
                strokeThickness: 5
            }).setOrigin(1, 0.5);
            this.optionsContainer.add(countText);

            this.optionBars.push({
                option: option,
                fill: fill,
                countText: countText,
                x: centerX - barWidth / 2,
                y: y,
                width: barWidth,
                height: barHeight,
                color: colors[i % colors.length],
                displayRatio: 0,   // 지금 화면에 그려져 있는 비율(트윈으로 목표 비율까지 부드럽게 이동)
                fillTween: null
            });
        });

        this.lastVoteTotal = 0;

        // 등장 애니메이션
        this.optionsContainer.setAlpha(0);
        this.tweens.add({ targets: this.optionsContainer, alpha: 1, duration: 400 });
    }

    // bar.displayRatio(0~1) 값 그대로 채움 바를 그림 - 트윈 onUpdate와 초기 그리기 공용
    drawBarFill(bar) {
        bar.fill.clear();
        if (bar.displayRatio > 0) {
            bar.fill.fillStyle(bar.color, 0.55);
            bar.fill.fillRoundedRect(
                bar.x + 5, bar.y + 5,
                (bar.width - 10) * bar.displayRatio, bar.height - 10, 10
            );
        }
    }

    // ============ 투표 현황 업데이트 ============
    // 득표가 들어올 때마다 막대가 "띡" 하고 순간이동하지 않고, 물이 차오르듯 지금 값에서
    // 목표 비율까지 부드럽게 트윈으로 이동한다 - 여러 선택지가 동시에 움직이면서
    // 경쟁하는 느낌을 살림. 득표수 텍스트 자체는 그대로 즉시 갱신(숫자는 정확히 보여야 함).
    updateVotes(data) {
        const counts = data.counts || {};
        const voted = data.voted || 0;
        const totalVotes = Math.max(1, voted);

        // 총 득표수가 늘어났을 때만(줄어들 일은 없지만 안전하게 >로) 투표 사운드 재생
        if (voted > this.lastVoteTotal) {
            window.SfxHelper.play(this, window.dungeonSounds.vote_sfx, window.dungeonSounds.vote_sfx_volume);
        }
        this.lastVoteTotal = voted;

        this.optionBars.forEach(bar => {
            const n = counts[bar.option] || 0;
            const ratio = n / totalVotes;

            if (bar.fillTween) bar.fillTween.stop();
            bar.fillTween = this.tweens.add({
                targets: bar,
                displayRatio: ratio,
                duration: 400,
                ease: 'Cubic.easeOut',
                onUpdate: () => this.drawBarFill(bar)
            });
            bar.countText.setText(window.t('votesSuffix', n));
        });
    }

    // ============ 결과 표시 ============
    showResult(data) {
        this.guideText.setVisible(false);
        this.timerText.setText('');
        window.SfxHelper.play(this, data.sfx, data.sfx_volume);
        if (data.fade_bgm_on_clear) window.BgmManager.fadeOut(this, (data.fade_bgm_duration_sec || 1.5) * 1000);

        // 최종 득표 반영
        this.updateVotes({ counts: data.counts, voted: Object.values(data.counts || {}).reduce((a, b) => a + b, 0) });

        // 선택된 막대 강조 / 나머지 어둡게
        this.optionBars.forEach(bar => {
            if (bar.option !== data.choice) {
                bar.fill.setAlpha(0.25);
                bar.countText.setAlpha(0.4);
            }
        });

        const centerX = this.W / 2;
        this.resultContainer = this.add.container(centerX, 780);
        this.resultContainer.setDepth(50);

        // 판정 배너
        const bannerColor = data.correct ? '#2ECC71' : '#FF4444';
        const bannerText = data.correct ? window.t('resultCorrect') : window.t('resultWrong');

        const banner = this.add.text(0, -60, bannerText, {
            fontSize: '58px',
            fontFamily: 'SeoulNamsanEB',
            color: bannerColor,
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);
        this.resultContainer.add(banner);

        // 결과 문구
        const outcome = this.add.text(0, 30, data.text, {
            fontSize: '38px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
            wordWrap: { width: 880 }
        }).setOrigin(0.5);
        this.resultContainer.add(outcome);

        // 피해 표시
        if (data.damage_pct > 0) {
            const dmg = this.add.text(0, 110, window.t('powerLoss', data.damage, data.damage_pct), {
                fontSize: '46px',
                fontFamily: 'SeoulNamsanEB',
                color: '#FF4444',
                stroke: '#000000',
                strokeThickness: 6
            }).setOrigin(0.5);
            this.resultContainer.add(dmg);

            // 화면 흔들림
            this.cameras.main.shake(400, 0.012);
        }

        // 보상 표시
        if (data.reward) {
            const reward = this.add.text(0, 110, '🎁 버프 획득!', {
                fontSize: '46px',
                fontFamily: 'SeoulNamsanEB',
                color: '#FFD700',
                stroke: '#000000',
                strokeThickness: 6
            }).setOrigin(0.5);
            this.resultContainer.add(reward);
        }

        // 등장 애니메이션
        this.resultContainer.setScale(0.7);
        this.resultContainer.setAlpha(0);
        this.tweens.add({
            targets: this.resultContainer,
            scale: 1,
            alpha: 1,
            duration: 350,
            ease: 'Back.easeOut'
        });

        // 파티 HP 반영
        this.updatePartyHp(data.party_hp, data.party_max_hp);
    }

    // ============ 타이머 ============
    updateTimer(seconds) {
        if (this.resultContainer) return;  // 결과 표시 중엔 숨김

        this.timerText.setText(window.t('countdownSec', seconds));
        this.timerText.setColor(seconds <= 5 ? '#FF4444' : '#FFD700');

        if (seconds <= 5 && seconds > 0) {
            this.tweens.add({
                targets: this.timerText,
                scale: { from: 1.25, to: 1 },
                duration: 250
            });
        }
    }

    // ============ 전멸 ============
    showDefeat(data) {
        const overlay = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0.85);
        overlay.setDepth(100);

        const container = this.add.container(this.W / 2, this.H / 2);
        container.setDepth(101);

        const title = this.add.text(0, -100, window.t('wipedOnFloor', data.floor), {
            fontSize: '64px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FF6B6B',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        container.add(title);

        const footer = this.add.text(0, 50, window.t('backToLobby'), {
            fontSize: '36px',
            fontFamily: 'SeoulNamsan',
            color: '#AAAAAA'
        }).setOrigin(0.5);
        container.add(footer);

        this.tweens.add({
            targets: footer,
            alpha: 0.3,
            duration: 600,
            yoyo: true,
            repeat: -1
        });
    }
}
