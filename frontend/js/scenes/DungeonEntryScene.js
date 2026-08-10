/**
 * DungeonEntryScene - 던전 입장 브리핑 화면
 * 참여 모집 종료 후 표시되는 화면
 */
class DungeonEntryScene extends Phaser.Scene {
    constructor() {
        super({ key: 'DungeonEntryScene' });

        this.W = 1080;
        this.H = 1920;
    }

    init(data) {
        // 서버 phase_change에서 전달받은 데이터
        this.floor = data.floor || 1;
        this.monsters = data.monsters || [];

        // 퇴장 연출 상태
        this.exitStarted = false;
        this.exitDone = false;
        this.pendingScene = null;
        this.partyStats = data.partyStats || {
            total: 0,
            warrior: 0,
            archer: 0,
            mage: 0,
            healer: 0
        };
        this.totalPower = data.totalPower || 0;
        this.mvpCandidates = data.mvpCandidates || [];
    }

    preload() {
        // 던전의 모든 몬스터 스프라이트 미리 로딩 (층 전환 시 공백 방지)
        this.monsters.forEach(name => window.MonsterAnim.queueLoad(this, name));
        // 각 몬스터의 공격/처치 사운드도 미리 로딩 (전투 화면 첫 진입 시 회색 화면 방지)
        window.MonsterAnim.queueSoundsAfterManifests(this, this.monsters);

        // 브리핑 BGM (방어적 재로딩 - 로비에서 이미 로딩됐을 것)
        window.BgmManager.queueLoad(this, window.dungeonSounds.entry_bgm);

        // 스킬 VFX 스프라이트시트도 미리 로딩 (전투 화면 첫 진입 시 회색 화면 방지)
        Object.values(window.skillVfx || {}).forEach(cfg => window.VfxManager.queueLoad(this, cfg));

        // 배경
        this.load.image('entry_bg', 'assets/backgrounds/던전_입장.png');
        // 스크롤
        this.load.image('entry_scroll', 'assets/images/던집_입장_스크롤.png');
        // 타이틀
        this.load.image('entry_title', 'assets/images/던전_입장_타이틀.png');
        // 직업 아이콘
        this.load.image('icon_warrior', 'assets/images/던전_입장_전사아이콘.png');
        this.load.image('icon_archer', 'assets/images/던전_입장_궁수아이콘.png');
        this.load.image('icon_mage', 'assets/images/던전_입장_법사아이콘.png');
        this.load.image('icon_healer', 'assets/images/던전_입장_힐러아이콘.png');
    }

    create() {
        const centerX = this.W / 2;
        const centerY = this.H / 2;

        // 브리핑 BGM (설정 안 됐으면 로비 BGM이 자연스럽게 이어짐)
        if (window.dungeonSounds.entry_bgm) {
            window.BgmManager.play(this, window.dungeonSounds.entry_bgm, window.dungeonSounds.entry_bgm_volume);
        }

        // 1. 배경 레이어
        this.createBackground(centerX, centerY);

        // 2. 스크롤 컨테이너
        this.createScroll(centerX, centerY);

        // 3. 타이틀
        this.createTitle(centerX);

        // 4. 카운트다운 메시지 (타이틀과 스크롤 사이)
        this.createCountdownMessage(centerX);

        // 5. 스크롤 내부 콘텐츠
        this.createContent(centerX, centerY);

        // 입장 애니메이션 시작
        this.playEntryAnimation();
    }

    createBackground(centerX, centerY) {
        // 배경 이미지
        this.bg = this.add.image(centerX, centerY, 'entry_bg');
        this.bg.setDisplaySize(this.W, this.H);

        // 화면에 꽉 차는 기준 스케일 (숨쉬기/확대 연출의 기준점)
        this.bgBaseScaleX = this.bg.scaleX;
        this.bgBaseScaleY = this.bg.scaleY;

        // 미세한 줌인 애니메이션 (긴장감) - 기준 스케일 상대값으로
        this.tweens.add({
            targets: this.bg,
            scaleX: { from: this.bgBaseScaleX, to: this.bgBaseScaleX * 1.05 },
            scaleY: { from: this.bgBaseScaleY, to: this.bgBaseScaleY * 1.05 },
            duration: 10000,
            ease: 'Sine.easeInOut',
            repeat: -1,
            yoyo: true
        });
    }

    createScroll(centerX, centerY) {
        // 스크롤 이미지 (중앙에서 60px 아래)
        this.scroll = this.add.image(centerX, centerY + 60, 'entry_scroll');
        this.scroll.setScale(1.3);  // 필요시 크기 조정

        // 스크롤 위치 저장 (콘텐츠 배치용)
        this.scrollY = centerY + 60;
        this.scrollTop = this.scrollY - (this.scroll.displayHeight / 2);
    }

    createTitle(centerX) {
        // 타이틀 (스크롤 위쪽)
        this.title = this.add.image(centerX, 130, 'entry_title');
        this.title.setScale(0.5);
    }

    createCountdownMessage(centerX) {
        // 카운트다운 컨테이너 (타이틀과 스크롤 사이)
        this.countdownContainer = this.add.container(centerX, 270);

        // 메시지 텍스트
        this.countdownText = this.add.text(0, 5, '', {
            fontSize: '32px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center'
        }).setOrigin(0.5);

        // 카운트 숫자
        this.countdownNumber = this.add.text(0, 95, '', {
            fontSize: '64px',
            fontFamily: 'SeoulNamsan',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.countdownContainer.add([this.countdownText, this.countdownNumber]);
        this.countdownContainer.setAlpha(0);
    }

    createContent(centerX, centerY) {
        // 스크롤 내부 콘텐츠 배치 (하드코딩 - 스크롤 이미지 갈색 영역에 맞춤)
        // 스크롤 중심: this.scrollY, 스케일: 1.3
        const scrollCenterY = this.scrollY;

        // === A. 상단 박스: TOTAL POWER (스크롤 상단 갈색 영역) ===
        this.createTotalPower(centerX, scrollCenterY - 480);

        // === B. 중단 박스: CLASS BREAKDOWN (스크롤 중간 갈색 영역) ===
        this.createClassBreakdown(centerX, scrollCenterY - 250);

        // === C. 하단 박스: MVP 후보 (스크롤 하단 갈색 영역) ===
        this.createMVPSection(centerX, scrollCenterY + 180);
    }

    createTotalPower(centerX, y) {
        // 컨테이너로 묶어서 애니메이션 적용
        this.totalPowerContainer = this.add.container(centerX, y);

        // 라벨
        const label = this.add.text(0, -75, 'TOTAL POWER', {
            fontSize: '45px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);

        // 큰 숫자 (롤링 애니메이션)
        this.powerText = this.add.text(0, 30, '0', {
            fontSize: '72px',
            fontFamily: 'SeoulNamsan',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        this.totalPowerContainer.add([label, this.powerText]);
        this.totalPowerContainer.setAlpha(0);
    }

    createClassBreakdown(centerX, startY) {
        // 컨테이너로 묶어서 애니메이션 적용
        this.classContainer = this.add.container(centerX, startY);

        // 라벨
        const label = this.add.text(0, -72, window.t('classBreakdown'), {
            fontSize: '40px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);
        this.classContainer.add(label);

        const classes = [
            { key: 'warrior', name: window.roleName('warrior'), icon: 'icon_warrior', color: 0xBD5F55, darkColor: 0x6B241E, barColor: 0xD74339, bar3DColor: 0xAA2A2B, count: this.partyStats.warrior },
            { key: 'archer', name: window.roleName('archer'), icon: 'icon_archer', color: 0x527FA8, darkColor: 0x254463, barColor: 0x2A94E0, bar3DColor: 0x2A69B9, count: this.partyStats.archer },
            { key: 'mage', name: window.roleName('mage'), icon: 'icon_mage', color: 0xA547D3, darkColor: 0x4A2060, barColor: 0xA547D3, bar3DColor: 0x6E3498, count: this.partyStats.mage },
            { key: 'healer', name: window.roleName('healer'), icon: 'icon_healer', color: 0x85BD64, darkColor: 0x145530, barColor: 0x85BD64, bar3DColor: 0x417837, count: this.partyStats.healer }
        ];

        const rowHeight = 100;
        const barMaxWidth = 410;
        const total = this.partyStats.total || 1;
        this.classBars = [];

        classes.forEach((cls, index) => {
            const rowY = index * rowHeight;
            const leftX = -220;

            // 아이콘 테두리 박스 (클래스 어두운 색 내부 + 클래스 색상 테두리 + 검은 외곽 테두리 + 둥근 모서리)
            const iconBoxSize = 80;
            const iconBoxGraphics = this.add.graphics();
            // 내부 채우기
            iconBoxGraphics.fillStyle(cls.darkColor, 1);
            iconBoxGraphics.fillRoundedRect(leftX - iconBoxSize/2, rowY - iconBoxSize/2, iconBoxSize, iconBoxSize, 6);
            // 외곽 검은 테두리 (바깥쪽)
            iconBoxGraphics.lineStyle(4, 0x222222, 1);
            iconBoxGraphics.strokeRoundedRect(leftX - iconBoxSize/2 - 4, rowY - iconBoxSize/2 - 4, iconBoxSize + 8, iconBoxSize + 8, 8);
            // 클래스 색상 테두리
            iconBoxGraphics.lineStyle(6, cls.color, 1);
            iconBoxGraphics.strokeRoundedRect(leftX - iconBoxSize/2, rowY - iconBoxSize/2, iconBoxSize, iconBoxSize, 6);
            this.classContainer.add(iconBoxGraphics);

            // 아이콘
            const icon = this.add.image(leftX, rowY, cls.icon);
            icon.setDisplaySize(70, 70);
            this.classContainer.add(icon);

            // 게이지 시작 위치 (아이콘 + 20px padding)
            const barX = leftX + iconBoxSize/2 + 20;
            const barHeight = 59;
            const bar3DHeight = 15;  // 하단 입체감 높이

            // 게이지 배경 + 테두리
            const barBgGraphics = this.add.graphics();
            barBgGraphics.fillStyle(0x2D2E40, 1);
            barBgGraphics.fillRoundedRect(barX, rowY - barHeight/2, barMaxWidth, barHeight, 6);
            barBgGraphics.lineStyle(4, 0x2A0000, 1);
            barBgGraphics.strokeRoundedRect(barX, rowY - barHeight/2, barMaxWidth, barHeight, 6);
            this.classContainer.add(barBgGraphics);

            // 비율 바 (입체감 있는 게이지)
            const ratio = cls.count / total;
            const barWidth = barMaxWidth * ratio;
            if (barWidth > 0) {
                const barGraphics = this.add.graphics();
                // 저장할 데이터
                barGraphics.targetWidth = barWidth;
                barGraphics.barX = barX;
                barGraphics.barY = rowY - barHeight/2;
                barGraphics.barHeight = barHeight;
                barGraphics.bar3DHeight = bar3DHeight;
                barGraphics.barColor = cls.barColor;
                barGraphics.bar3DColor = cls.bar3DColor;
                this.classBars.push(barGraphics);
                this.classContainer.add(barGraphics);
            }

            // 직업명: N명 (게이지 안에 텍스트)
            const nameText = this.add.text(barX + 15, rowY, window.t('classCount', cls.name, cls.count), {
                fontSize: '28px',
                fontFamily: 'SeoulNamsan',
                color: '#FFFFFF',
                stroke: '#000000',
                strokeThickness: 3
            }).setOrigin(0, 0.5);
            this.classContainer.add(nameText);
        });

        this.classContainer.setAlpha(0);
    }

    createMVPSection(centerX, y) {
        // 컨테이너로 묶어서 애니메이션 적용
        this.mvpContainer = this.add.container(centerX, y);

        // MVP 타이틀 (메달 + 텍스트 + 메달)
        const medalLeft = this.add.text(-155, 0, '🎖️', {
            fontSize: '45px'
        }).setOrigin(0.5);

        const title = this.add.text(0, 0, window.t('mvpCandidates'), {
            fontSize: '45px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 5
        }).setOrigin(0.5);

        const medalRight = this.add.text(155, 0, '🎖️', {
            fontSize: '45px'
        }).setOrigin(0.5);

        this.mvpContainer.add([medalLeft, title, medalRight]);

        // MVP 후보 목록 (등급 순으로 정렬) - job/grade는 서버가 원본 키(warrior/legendary 등)로
        // 보내주므로, 정렬은 언어와 무관하게 항상 이 키 기준으로 하고 표시만 로컬라이즈한다
        const gradeOrder = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };

        let candidates = this.mvpCandidates.length > 0
            ? [...this.mvpCandidates].sort((a, b) => {
                const gradeA = typeof a === 'string' ? 999 : (gradeOrder[a.grade] ?? 999);
                const gradeB = typeof b === 'string' ? 999 : (gradeOrder[b.grade] ?? 999);
                return gradeA - gradeB;
            })
            : [{ name: window.t('noParticipants'), job: '', grade: '' }];

        candidates.slice(0, 6).forEach((candidate, index) => {
            // candidate가 문자열이면 객체로 변환
            const info = typeof candidate === 'string'
                ? { name: candidate, job: '', grade: '' }
                : candidate;

            // 이름 (직업/등급) 형식
            const displayText = info.job && info.grade
                ? `${info.name} (${window.roleName(info.job)}/${window.gradeName(info.grade)})`
                : info.name;

            const nameText = this.add.text(0, 60 + (index * 50), displayText, {
                fontSize: '36px',
                fontFamily: 'SeoulNamsan',
                color: '#FFE082',
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(0.5);
            this.mvpContainer.add(nameText);
        });

        this.mvpContainer.setAlpha(0);
    }

    playEntryAnimation() {
        // 타이틀 등장 애니메이션
        this.title.setAlpha(0);
        this.title.setScale(0.3);
        this.tweens.add({
            targets: this.title,
            alpha: 1,
            scale: 0.5,
            duration: 500,
            ease: 'Back.easeOut'
        });

        // 스크롤 등장 애니메이션
        this.scroll.setAlpha(0);
        this.scroll.setY(this.scrollY + 100);
        this.tweens.add({
            targets: this.scroll,
            alpha: 1,
            y: this.scrollY,
            duration: 600,
            delay: 300,
            ease: 'Back.easeOut'
        });

        // === 스크롤 내부 콘텐츠 순차 등장 ===

        // 1. TOTAL POWER 섹션 등장 (스크롤 완료 후)
        this.totalPowerContainer.setY(this.totalPowerContainer.y - 20);
        this.time.delayedCall(900, () => {
            this.tweens.add({
                targets: this.totalPowerContainer,
                alpha: 1,
                y: this.totalPowerContainer.y + 20,
                duration: 400,
                ease: 'Power2'
            });
            // 숫자 롤링 시작
            this.time.delayedCall(200, () => {
                this.animatePowerNumber();
            });
        });

        // 2. CLASS BREAKDOWN 섹션 등장
        this.classContainer.setY(this.classContainer.y - 20);
        this.time.delayedCall(1200, () => {
            this.tweens.add({
                targets: this.classContainer,
                alpha: 1,
                y: this.classContainer.y + 20,
                duration: 400,
                ease: 'Power2'
            });
            // 바 애니메이션 시작
            this.time.delayedCall(200, () => {
                this.animateClassBars();
            });
        });

        // 3. MVP 섹션 등장
        this.mvpContainer.setY(this.mvpContainer.y - 20);
        this.time.delayedCall(1600, () => {
            this.tweens.add({
                targets: this.mvpContainer,
                alpha: 1,
                y: this.mvpContainer.y + 20,
                duration: 400,
                ease: 'Power2'
            });
        });

        // 4. 카운트다운 시작 (모든 콘텐츠 등장 후)
        this.time.delayedCall(2500, () => {
            this.startCountdown();
        });
    }

    startCountdown() {
        let countdown = 3;

        // 메시지 표시
        this.countdownText.setText(window.t('dungeonEntryCountdown', countdown));
        this.countdownNumber.setText(countdown);

        // 페이드인
        this.tweens.add({
            targets: this.countdownContainer,
            alpha: 1,
            duration: 300,
            ease: 'Power2'
        });

        // 카운트다운 타이머
        this.time.addEvent({
            delay: 1000,
            repeat: 2,
            callback: () => {
                countdown--;
                if (countdown > 0) {
                    this.countdownNumber.setText(countdown);
                    this.countdownText.setText(window.t('dungeonEntryCountdown', countdown));

                    // 숫자 펄스 애니메이션
                    this.tweens.add({
                        targets: this.countdownNumber,
                        scale: { from: 1.3, to: 1 },
                        duration: 300,
                        ease: 'Back.easeOut'
                    });
                } else {
                    // 입장 연출 시작 (씬 전환은 서버 phase_change와 핸드셰이크)
                    this.countdownNumber.setText(window.t('entryExclaim'));
                    this.countdownText.setText(window.t('dungeonDoorOpening'));
                    this.tweens.add({
                        targets: this.countdownNumber,
                        scale: { from: 1.5, to: 1 },
                        duration: 300,
                        ease: 'Back.easeOut'
                    });

                    this.time.delayedCall(800, () => {
                        this.playExitTransition();
                    });
                }
            }
        });
    }

    animatePowerNumber() {
        const targetPower = this.totalPower;
        let currentPower = 0;

        this.tweens.addCounter({
            from: 0,
            to: targetPower,
            duration: 1500,
            ease: 'Power2',
            onUpdate: (tween) => {
                currentPower = Math.floor(tween.getValue());
                this.powerText.setText(currentPower.toLocaleString());
            }
        });
    }

    // ============ 던전 입장 퇴장 연출 ============
    // 1) 스크롤과 내용물이 위로 빠짐 → 2) 배경이 입구(중앙 검은 부분)로 확대
    // → 3) 암전 → 4) 서버 phase_change 데이터로 다음 씬 시작 (다음 씬에서 페이드 인)
    playExitTransition() {
        if (this.exitStarted) return;
        this.exitStarted = true;

        // 1. 스크롤 + 내용물 위로 치우기
        const upTargets = [
            this.scroll,
            this.title,
            this.countdownContainer,
            this.totalPowerContainer,
            this.classContainer,
            this.mvpContainer
        ].filter(t => t);

        upTargets.forEach(target => {
            this.tweens.killTweensOf(target);
            this.tweens.add({
                targets: target,
                y: target.y - this.H,
                duration: 700,
                ease: 'Cubic.easeIn'
            });
        });

        // 2. 배경 확대 (입구 속으로 빨려들어가는 느낌)
        // 확대 기준점: 중앙보다 살짝 위 (던전 입구 위치)
        // 숨쉬기 트윈이 멈춘 "현재 크기"에서 끊김 없이 이어서 확대한다
        const ZOOM_FOCUS_Y = 0.40;  // 0.5=정중앙, 작을수록 위쪽
        this.tweens.killTweensOf(this.bg);

        // 원점 변경 시 현재 표시 크기를 기준으로 위치 보정 (화면상 이동 없음)
        const shift = this.bg.displayHeight * (ZOOM_FOCUS_Y - 0.5);
        this.bg.setOrigin(0.5, ZOOM_FOCUS_Y);
        this.bg.y += shift;

        // 대기 없이 현재 스케일 → 기준 스케일 x3 으로 바로 이어서 확대
        this.tweens.add({
            targets: this.bg,
            scaleX: this.bgBaseScaleX * 3,
            scaleY: this.bgBaseScaleY * 3,
            duration: 2200,
            ease: 'Cubic.easeIn'
        });

        // 3. 확대가 어느 정도 진행되면 암전 (페이드 아웃)
        const blackout = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0x000000, 0);
        blackout.setDepth(200);

        this.tweens.add({
            targets: blackout,
            fillAlpha: 1,
            duration: 700,
            delay: 1500,
            onComplete: () => {
                // 완전 암전 상태로 0.5초 더 유지한 뒤 다음 씬 시작 (전환이 너무 급하지 않게)
                this.time.delayedCall(500, () => {
                    this.exitDone = true;
                    this.tryStartPendingScene();
                });
            }
        });
    }

    // 서버 phase_change 수신 시 socket.js가 호출
    // 연출이 끝나기 전이면 데이터를 들고 있다가 암전 완료 후 전환
    transitionTo(sceneKey, data) {
        this.pendingScene = { key: sceneKey, data: data };

        if (!this.exitStarted) {
            // 서버가 먼저 도착한 경우(스킵 등) - 즉시 연출 시작
            this.playExitTransition();
        }
        this.tryStartPendingScene();
    }

    tryStartPendingScene() {
        if (!this.exitDone || !this.pendingScene) return;

        const { key, data } = this.pendingScene;
        this.pendingScene = null;

        // 다음 씬을 뒤에서 미리 켜서(로딩~create까지) 완성될 때까지 이 씬의
        // 블랙아웃이 화면을 계속 덮고 있다가, 다 그려진 뒤에야 이 씬을 정지해서
        // 블랙아웃을 걷는다 - 로딩 중 잠깐 비는 화면(회색 프레임)이 노출되지 않게
        this.scene.launch(key, data);
        this.scene.bringToTop();

        this.scene.get(key).events.once('create', () => {
            this.scene.stop();
        });
    }

    animateClassBars() {
        if (!this.classBars) return;

        this.classBars.forEach((barGraphics, index) => {
            this.time.delayedCall(index * 150, () => {
                this.tweens.addCounter({
                    from: 0,
                    to: barGraphics.targetWidth,
                    duration: 800,
                    ease: 'Power2',
                    onUpdate: (tween) => {
                        const currentWidth = tween.getValue();
                        if (currentWidth < 1) return;

                        barGraphics.clear();

                        const x = barGraphics.barX;
                        const y = barGraphics.barY;
                        const h = barGraphics.barHeight;
                        const h3D = barGraphics.bar3DHeight;

                        // 메인 색상 (상단 부분)
                        barGraphics.fillStyle(barGraphics.barColor, 1);
                        barGraphics.fillRoundedRect(x, y, currentWidth, h - h3D, { tl: 6, tr: 6, bl: 0, br: 0 });

                        // 입체감 색상 (하단 부분)
                        barGraphics.fillStyle(barGraphics.bar3DColor, 1);
                        barGraphics.fillRoundedRect(x, y + h - h3D, currentWidth, h3D, { tl: 0, tr: 0, bl: 6, br: 6 });

                        // 옆쪽 테두리 (입체감 색상)
                        barGraphics.lineStyle(6, barGraphics.bar3DColor, 1);
                        // 왼쪽 테두리
                        barGraphics.beginPath();
                        barGraphics.moveTo(x + 3, y + 6);
                        barGraphics.lineTo(x + 3, y + h - 6);
                        barGraphics.strokePath();
                        // 오른쪽 테두리
                        barGraphics.beginPath();
                        barGraphics.moveTo(x + currentWidth - 3, y + 6);
                        barGraphics.lineTo(x + currentWidth - 3, y + h - 6);
                        barGraphics.strokePath();
                    }
                });
            });
        });
    }
}
