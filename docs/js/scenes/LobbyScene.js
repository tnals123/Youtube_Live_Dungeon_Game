/**
 * LobbyScene - Dungeon Lobby Screen
 * Fixed resolution: 1080x1920
 * Shows joining players in 3x3 grid
 */
class LobbyScene extends Phaser.Scene {
    constructor() {
        super({ key: 'LobbyScene' });

        // Fixed resolution
        this.W = 1080;
        this.H = 1920;

        // 전설 등급 등장 연출("고조→쿵") 중 회전+화이트아웃이 진행되는 시간(초).
        // tool.html 사운드 메이커의 전설 참가 사운드 미리보기(LEGENDARY_BUILDUP_SEC)와
        // 반드시 같은 값으로 맞춰야 사운드 편집 화면에서 본 타이밍이 실제 연출과 일치함
        this.LEGENDARY_BUILDUP_SEC = 3.4;
        // 전설 연출 총 길이(고조 + "쿵" 이후 셰이크/플래시/충격파 정착까지) - playLegendaryCardIn()의
        // 실제 후속 트윈들(최대 shake 400ms, 링 확산 지연 100+500ms)을 넉넉히 덮도록 여유를 둠
        this.LEGENDARY_TOTAL_MS = this.LEGENDARY_BUILDUP_SEC * 1000 + 800;
        // 모든 카드가 최소 이만큼은 자기 칸을 지키게 보장(참가자 폭주 중에도 자기 카드를 볼 수 있게) -
        // 전설 카드는 이보다 긴 LEGENDARY_TOTAL_MS가 적용되므로 자연히 이 값 이상 보장됨
        this.MIN_CARD_HOLD_MS = 4000;
        // 당장 교체 가능한(보호 기간이 끝난) 칸이 없을 때 대기하는 참가자 큐 - addPlayer() 참고
        this.joinQueue = [];

        this.slots = [];
        this.maxSlots = 9;
        this.timer = 60;
        this.partyStats = {
            total: 0,
            warrior: 0,
            archer: 0,
            mage: 0,
            healer: 0
        };

        // 테두리 색상
        this.gradeColors = {
            legendary: 0xFFC800,  // 황금색
            epic: 0x9B30FF,       // 네온 보라
            rare: 0x0078FF,       // 비비드 블루
            uncommon: 0x00C853,   // 네온 그린
            common: 0x787878      // 중간 회색
        };

        // 배경 색상 (80% 투명)
        this.gradeBgColors = {
            legendary: 0x4A3500,  // 어두운 금색
            epic: 0x2A003B,       // 어두운 보라
            rare: 0x001833,       // 어두운 남색
            uncommon: 0x00290A,   // 어두운 녹색
            common: 0x2D2D2D      // 진한 회색
        };

        // 파스텔 톤 색상 (직업명용)
        this.gradePastelColors = {
            legendary: '#FFE082',  // 연한 노랑
            epic: '#CE93D8',       // 연한 보라
            rare: '#90CAF9',       // 연한 파랑
            uncommon: '#A5D6A7',   // 연한 녹색
            common: '#BDBDBD'      // 연한 회색
        };

        this.roleEmojis = {
            warrior: '⚔️',
            archer: '🏹',
            mage: '🔮',
            healer: '💚'
        };
    }

    preload() {
        // 라벨 이미지
        this.load.image('label', 'assets/images/라벨.png');

        // 스톱워치 아이콘
        this.load.image('stopwatch', 'assets/images/스톱워치.png');

        // 배경 이미지
        this.load.image('background', 'assets/backgrounds/던전 background.png');

        // 전투 씬 에셋 미리 로딩 (씬 전환 시 빈 화면 방지)
        this.load.image('battle_bg_1', 'assets/backgrounds/1층.png');
        this.load.image('battle_bg_miniboss', 'assets/backgrounds/중간보스.png');
        this.load.image('battle_bg_boss', 'assets/backgrounds/보스방.png');
        this.load.image('monster_shadow', 'assets/images/그림자.png');
        Object.entries(window.SKILL_ICONS).forEach(([key, path]) => {
            this.load.image(key, path);
        });

        // 사운드: 로비 BGM + 던전 전체 사운드 파일 전부 미리 로딩
        // (game.js 부트스트랩에서 이미 받아둔 던전 전역 설정 사용)
        window.BgmManager.queueLoad(this, window.dungeonSounds.lobby_bgm);
        // 등급별 참가 카드 사운드 (등급마다 다른 효과음 지정 가능 - 던전 에디터에서 설정)
        ['legendary', 'epic', 'rare', 'uncommon', 'common'].forEach(grade => {
            window.SfxHelper.queueLoad(this, window.dungeonSounds[`join_sfx_${grade}`]);
        });
        (window.dungeonSoundFiles || []).forEach(f => window.SfxHelper.queueLoad(this, f));

        // 던전 입장 브리핑 씬 에셋 미리 로딩 (씬 전환 시 빈 화면 방지)
        this.load.image('entry_bg', 'assets/backgrounds/던전_입장.png');
        this.load.image('entry_scroll', 'assets/images/던집_입장_스크롤.png');
        this.load.image('entry_title', 'assets/images/던전_입장_타이틀.png');
        this.load.image('icon_warrior', 'assets/images/던전_입장_전사아이콘.png');
        this.load.image('icon_archer', 'assets/images/던전_입장_궁수아이콘.png');
        this.load.image('icon_mage', 'assets/images/던전_입장_법사아이콘.png');
        this.load.image('icon_healer', 'assets/images/던전_입장_힐러아이콘.png');

        // 전사 스프라이트 (등급별)
        this.load.image('warrior_common', 'assets/sprites/warrior/전사_일반.png');
        this.load.image('warrior_uncommon', 'assets/sprites/warrior/전사_고급.png');
        this.load.image('warrior_rare', 'assets/sprites/warrior/전사_희귀.png');
        this.load.image('warrior_epic', 'assets/sprites/warrior/전사_영웅.png');
        // this.load.image('warrior_legendary', 'assets/sprites/warrior/전사_전설.png');
        this.load.image('warrior_default', 'assets/sprites/warrior/전사_공통.png');

        // 궁수 스프라이트
        this.load.image('archer_default', 'assets/sprites/archer/궁수_공통.png');

        // 힐러 스프라이트
        this.load.image('healer_default', 'assets/sprites/healer/힐러_공통.png');

        // 마법사 스프라이트
        this.load.image('mage_default', 'assets/sprites/mage/마법사_공통.png');

        // 스프라이트시트 예시 (애니메이션용)
        // this.load.spritesheet('characters', 'assets/spritesheets/characters.png', {
        //     frameWidth: 64,
        //     frameHeight: 64
        // });
    }

    create() {
        // scene.start()는 씬 인스턴스를 재사용(생성자가 다시 안 돌아감)하므로, 로비를 여러 번
        // 재방문해도 이전 회차의 슬롯/대기열이 남아있지 않게 매번 확실히 비워두고 시작한다
        this.slots = [];
        this.joinQueue = [];

        // Background
        this.createBackground();

        // Header (title, timer, progress bar)
        this.createHeader();

        // Grid (3x3 slots)
        this.createGrid();

        // Footer (party stats)
        this.createFooter();

        // 로비 BGM 재생 (없으면 조용히 스킵)
        window.BgmManager.play(this, window.dungeonSounds.lobby_bgm, window.dungeonSounds.lobby_bgm_volume);

        console.log(`🎮 LobbyScene created (${this.W}x${this.H})`);
    }

    // 최소 인원 미달로 모집이 재시작될 때 - 경고 배너 잠깐 표시
    showInsufficientWarning(data) {
        this.warningText.setText(window.t('insufficientPlayers', data.current, data.required));

        // 평소 깜빡이는 참가 안내를 숨기고 그 자리에 경고 문구를 잠깐 표시
        this.tweens.killTweensOf(this.joinGroup);
        this.tweens.add({ targets: this.joinGroup, alpha: 0, duration: 250 });

        this.warningText.setAlpha(0);
        this.tweens.add({ targets: this.warningText, alpha: 1, duration: 250 });

        // 잠깐 보여준 뒤 다시 평소 참가 안내로 복귀 (그동안 서버는 이미 60초 모집을 재시작한 상태)
        this.time.delayedCall(3500, () => {
            this.tweens.add({
                targets: this.warningText,
                alpha: 0,
                duration: 250,
                onComplete: () => {
                    this.joinGroup.setAlpha(1);
                    this.startJoinBlink();
                }
            });
        });
    }

    createBackground() {
        // 배경 이미지 (화면에 맞게 조절)
        const bg = this.add.image(this.W / 2, this.H / 2, 'background');
        bg.setDisplaySize(this.W, this.H);  // 1080x1920에 맞춤
    }

    createHeader() {
        const centerX = this.W / 2;

        // Title label image
        this.labelImage = this.add.image(centerX, 95, 'label').setOrigin(0.5).setScale(0.7);

        // 라벨 위에 층수 텍스트
        this.floorText = this.add.text(centerX, 85, window.t('lobbyFloorTitle'), {
            fontSize: '45px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0.5);

        // Timer: 스톱워치 아이콘 + "던전 입장까지 n초" (컨테이너로 가운데 정렬)
        const timerY = 185;
        const iconGap = 10;  // 아이콘과 텍스트 사이 간격

        // 먼저 텍스트 생성하여 너비 측정
        this.timerLabel = this.add.text(0, 0, window.t('untilEntry'), {
            fontSize: '40px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0, 0.5);

        this.timerText = this.add.text(0, 0, window.t('secondsLabel', 60), {
            fontSize: '40px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 8
        }).setOrigin(0, 0.5);

        // 전체 너비 계산
        const iconWidth = 45;
        const totalWidth = iconWidth + iconGap + this.timerLabel.width + this.timerText.width;
        const startX = -totalWidth / 2;

        // 위치 재설정 (왼쪽부터 배치)
        this.stopwatchIcon = this.add.image(startX + iconWidth / 2, 0, 'stopwatch').setOrigin(0.5);
        this.stopwatchIcon.setDisplaySize(45, 53);

        this.timerLabel.setX(startX + iconWidth + iconGap);
        this.timerText.setX(startX + iconWidth + iconGap + this.timerLabel.width);

        // 컨테이너로 묶어서 가운데 배치
        this.timerContainer = this.add.container(centerX, timerY, [
            this.stopwatchIcon,
            this.timerLabel,
            this.timerText
        ]);

        // Progress bar settings
        const barWidth = 600;
        const barHeight = 35;
        const barRadius = 6;
        const barBorder = 4;
        const outerBorder = 4;  // 검은색 외곽 테두리
        const barX = centerX - barWidth / 2;
        const barY = 245 - barHeight / 2;

        // Progress bar background with double border (using Graphics)
        this.progressBarBg = this.add.graphics();
        // Outer black border
        this.progressBarBg.lineStyle(outerBorder, 0x000000, 1);
        this.progressBarBg.strokeRoundedRect(barX - outerBorder, barY - outerBorder, barWidth + outerBorder * 2, barHeight + outerBorder * 2, barRadius + 2);
        // Inner gray border
        this.progressBarBg.lineStyle(barBorder, 0x787878, 1);
        this.progressBarBg.strokeRoundedRect(barX, barY, barWidth, barHeight, barRadius);
        // Background fill
        this.progressBarBg.fillStyle(0x2D2D2D, 1);
        this.progressBarBg.fillRoundedRect(barX + barBorder/2, barY + barBorder/2, barWidth - barBorder, barHeight - barBorder, barRadius - 1);

        // Progress bar gradient fill
        const fillWidth = barWidth - barBorder * 2;
        const fillHeight = barHeight - barBorder * 2;
        const fillRadius = Math.max(barRadius - 2, 2);

        // Create gradient texture using Canvas
        const gradientCanvas = document.createElement('canvas');
        gradientCanvas.width = fillWidth;
        gradientCanvas.height = fillHeight;
        const ctx = gradientCanvas.getContext('2d');

        // Draw gradient
        const gradient = ctx.createLinearGradient(0, 0, fillWidth, 0);
        gradient.addColorStop(0, '#00FF00');    // Green (left)
        gradient.addColorStop(0.5, '#FFFF00');  // Yellow (middle)
        gradient.addColorStop(1, '#FF0000');    // Red (right)

        // Draw rounded rectangle with gradient
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(0, 0, fillWidth, fillHeight, fillRadius);
        ctx.fill();

        // Add texture to Phaser
        if (this.textures.exists('progressGradient')) {
            this.textures.remove('progressGradient');
        }
        this.textures.addCanvas('progressGradient', gradientCanvas);

        // Create progress bar image
        this.progressBarImage = this.add.image(
            barX + barBorder,
            barY + barBorder,
            'progressGradient'
        ).setOrigin(0, 0);

        // Store config for updates
        this.barConfig = {
            x: barX + barBorder,
            y: barY + barBorder,
            fullWidth: fillWidth,
            height: fillHeight,
            radius: fillRadius
        };

        // Smooth progress tracking
        this.currentProgress = 1;  // Current displayed progress (0-1)
        this.targetProgress = 1;   // Target progress to animate toward

        // Join instruction
        // Join instruction (two colors)
        const joinY = 320;

        this.joinText1 = this.add.text(0, 0, window.t('joinCmd'), {
            fontSize: '42px',
            fontFamily: 'SeoulNamsan',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0, 0.5);

        this.joinText2 = this.add.text(0, 0, window.t('joinInstructionSuffix'), {
            fontSize: '42px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0, 0.5);

        this.joinCountText = this.add.text(0, 0, '', {
            fontSize: '42px',
            fontFamily: 'SeoulNamsan',
            color: '#8FE3FF',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0, 0.5);

        // Group holding the normal (blinking) join instruction
        this.joinGroup = this.add.container(0, 0, [
            this.joinText1,
            this.joinText2,
            this.joinCountText
        ]);
        this.layoutJoinGroup();

        // Warning text shown temporarily in place of the join instruction
        this.warningText = this.add.text(0, 0, '', {
            fontSize: '36px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FF6B6B',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
            wordWrap: { width: 980 }
        }).setOrigin(0.5).setAlpha(0);

        // Container for centering and animation
        this.joinContainer = this.add.container(centerX, joinY, [
            this.joinGroup,
            this.warningText
        ]);

        this.updateJoinCount(0);
        this.startJoinBlink();
    }

    // Recompute the join instruction layout (joinText1 + joinText2 + joinCountText side by side)
    layoutJoinGroup() {
        const totalWidth = this.joinText1.width + this.joinText2.width + this.joinCountText.width;
        let x = -totalWidth / 2;
        this.joinText1.setX(x);
        x += this.joinText1.width;
        this.joinText2.setX(x);
        x += this.joinText2.width;
        this.joinCountText.setX(x);
    }

    // Update the live (현재/최소) suffix on the normal join instruction
    updateJoinCount(current) {
        const min = window.dungeonMinPlayers || 1;
        this.joinCountText.setText(window.t('minPlayersSuffix', current, min));
        this.layoutJoinGroup();
    }

    startJoinBlink() {
        this.tweens.killTweensOf(this.joinGroup);
        this.joinGroup.setAlpha(1);
        this.tweens.add({
            targets: this.joinGroup,
            alpha: 0.3,
            duration: 500,
            yoyo: true,
            repeat: -1
        });
    }

    createGrid() {
        const centerX = this.W / 2;
        const gridStartY = 530;  // 420 → 530 (헤더와 겹침 방지)
        const gridHeight = 950;

        // Slot dimensions
        const slotWidth = 320;
        const slotHeight = 300;
        const gapX = 20;
        const gapY = 20;

        // Calculate starting X to center the grid
        const totalGridWidth = slotWidth * 3 + gapX * 2;
        const startX = (this.W - totalGridWidth) / 2 + slotWidth / 2;

        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                const x = startX + col * (slotWidth + gapX);
                const y = gridStartY + row * (slotHeight + gapY);

                // Empty slot background
                const slotBg = this.add.rectangle(x, y, slotWidth, slotHeight, 0x2C3E50, 0.4);
                slotBg.setStrokeStyle(2, 0x34495E);

                this.slots.push({
                    x: x,
                    y: y,
                    width: slotWidth,
                    height: slotHeight,
                    occupied: false,
                    protectedUntil: 0,  // 이 시각까지는 교체 후보에서 제외 (showPlayerInSlot/flipSlotToPlayer가 설정)
                    container: null,
                    background: slotBg
                });
            }
        }
    }

    createFooter() {
        const centerX = this.W / 2;
        const panelTopY = 1355;  // 패널 상단 고정 위치

        // Party stats panel background (rounded)
        const panelWidth = 1000;
        const panelHeight = 215;
        const panelX = centerX - panelWidth / 2;
        const panelY = panelTopY;

        const panelBg = this.add.graphics();
        // Outer shadow/background
        panelBg.fillStyle(0x000000, 0.8);
        panelBg.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 6);
        // Inner background with border
        panelBg.fillStyle(0x1a1a2e, 1);
        panelBg.fillRoundedRect(panelX + 2, panelY + 2, panelWidth - 4, panelHeight - 4, 6);
        panelBg.lineStyle(4, 0x787878, 1);
        panelBg.strokeRoundedRect(panelX + 2, panelY + 2, panelWidth - 4, panelHeight - 4, 6);

        // Party stats title
        this.add.text(centerX, panelY + 35, window.t('partyStatusTitle'), {
            fontSize: '40px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 5
        }).setOrigin(0.5);

        // Content area Y position
        const contentY = panelY + 100;

        // Left side: Total count
        const leftX = centerX - 420;
        this.totalText = this.add.text(leftX, contentY, window.t('totalMembers', 0), {
            fontSize: '36px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF'
        }).setOrigin(0, 0.5);

        // Vertical divider
        this.add.rectangle(centerX - 210, contentY, 3, 50, 0x34495E);

        // Right side: Class stats with color coding
        const rightStartX = centerX - 170;
        const spacing = 95;

        // 색상 정의
        const classColors = {
            warrior: '#FFFFFF',   // 흰색
            archer: '#FFFFFF',    // 흰색
            mage: '#CE93D8',      // 연보라
            healer: '#A5D6A7'     // 연두
        };

        // 클래스별 텍스트 생성
        this.statTexts = {};

        // Warrior
        this.add.text(rightStartX, contentY, '⚔️', { fontSize: '36px' }).setOrigin(0, 0.5);
        this.statTexts.warrior = this.add.text(rightStartX + 45, contentY, '0', {
            fontSize: '36px', fontFamily: 'SeoulNamsan', color: classColors.warrior
        }).setOrigin(0, 0.5);

        // Archer
        this.add.text(rightStartX + spacing, contentY, '🏹', { fontSize: '36px' }).setOrigin(0, 0.5);
        this.statTexts.archer = this.add.text(rightStartX + spacing + 45, contentY, '0', {
            fontSize: '36px', fontFamily: 'SeoulNamsan', color: classColors.archer
        }).setOrigin(0, 0.5);

        // Mage
        this.add.text(rightStartX + spacing * 2, contentY, '🔮', { fontSize: '36px' }).setOrigin(0, 0.5);
        this.statTexts.mage = this.add.text(rightStartX + spacing * 2 + 45, contentY, '0', {
            fontSize: '36px', fontFamily: 'SeoulNamsan', color: classColors.mage
        }).setOrigin(0, 0.5);

        // Healer
        this.add.text(rightStartX + spacing * 3, contentY, '💚', { fontSize: '36px' }).setOrigin(0, 0.5);
        this.statTexts.healer = this.add.text(rightStartX + spacing * 3 + 45, contentY, '0', {
            fontSize: '36px', fontFamily: 'SeoulNamsan', color: classColors.healer
        }).setOrigin(0, 0.5);

        // Grade probability table (bottom right) - 등급 표시 이름이 언어별로 길이 차이가 커서
        // (예: "일반" vs "Common", "전설" vs "Legendary") 고정 x 오프셋 대신 실제 렌더된
        // 너비를 이어붙이며 배치하고, 그래도 패널을 벗어나면 행 전체를 한 번에 축소한다
        const probY = panelY + panelHeight - 30;
        const probStartX = centerX - 150;
        const probRightLimit = panelX + panelWidth - 20;
        const probFontSize = '30px';
        const percentColor = '#AAAAAA';
        const gradeGap = 10;    // 등급명 - 퍼센트 사이 간격
        const groupGap = 26;    // 등급 그룹끼리의 간격

        // 등급 색상 (테두리 색상과 동일)
        const gradeTextColors = {
            common: '#787878',
            uncommon: '#00C853',
            rare: '#0078FF',
            epic: '#9B30FF',
            legendary: '#FFC800'
        };
        const gradeProbs = [
            { grade: 'common', pct: '50%' },
            { grade: 'uncommon', pct: '30%' },
            { grade: 'rare', pct: '15%' },
            { grade: 'epic', pct: '4%' },
            { grade: 'legendary', pct: '1%' }
        ];

        const probContainer = this.add.container(0, 0);
        let cursorX = probStartX;
        gradeProbs.forEach(({ grade, pct }) => {
            const nameText = this.add.text(cursorX, probY, window.gradeName(grade), {
                fontSize: probFontSize, fontFamily: 'SeoulNamsan', color: gradeTextColors[grade]
            }).setOrigin(0, 0.5);
            probContainer.add(nameText);
            cursorX += nameText.width + gradeGap;

            const pctText = this.add.text(cursorX, probY, pct, {
                fontSize: probFontSize, fontFamily: 'SeoulNamsan', color: percentColor
            }).setOrigin(0, 0.5);
            probContainer.add(pctText);
            cursorX += pctText.width + groupGap;
        });

        const probTotalWidth = cursorX - groupGap - probStartX;
        const probAvailableWidth = probRightLimit - probStartX;
        if (probTotalWidth > probAvailableWidth) {
            // 컨테이너 스케일은 원점(0,0) 기준이라, 축소해도 행의 왼쪽 끝(x=probStartX)과
            // 세로 중심(y=probY)이 그대로 유지되도록 위치를 함께 보정한다 (좌표*(1-scale))
            const scale = probAvailableWidth / probTotalWidth;
            probContainer.setScale(scale);
            probContainer.setPosition(probStartX * (1 - scale), probY * (1 - scale));
        }

        // Bottom hint (패널 아래)
        this.add.text(centerX, panelY + panelHeight + 40, window.t('myInfoHint'), {
            fontSize: '36px',
            fontFamily: 'SeoulNamsan',
            color: '#888888'
        }).setOrigin(0.5);
    }

    // ============ Player Management ============
    // 카드는 시간이 지나도 저절로 사라지지 않는다. 9칸이 이미 꽉 찬 상태에서 새
    // 참가자가 들어오면, 가장 오래전에 표시된 카드를 뒤집어서 교체한다 - 단, 슬롯마다
    // protectedUntil(최소 보유 시간, 전설 카드는 연출이 끝날 때까지) 이전에는 교체 후보에서
    // 제외한다. 교체 가능한 칸이 하나도 없으면 대기열에 넣어뒀다가, 보호가 풀리는 칸이
    // 생기는 즉시 자동으로 배치한다 - 참가자가 아무리 몰려도 이미 나온 카드가 보호 시간
    // 전에 강제로 사라지는 일이 없다.
    addPlayer(data) {
        this.joinQueue.push(data);
        this.tryDrainQueue();
    }

    tryDrainQueue() {
        while (this.joinQueue.length > 0) {
            const emptySlot = this.slots.find(slot => !slot.occupied);
            if (emptySlot) {
                this.showPlayerInSlot(emptySlot, this.joinQueue.shift());
                continue;
            }

            const now = this.time.now;
            const eligible = this.slots.filter(slot => now >= slot.protectedUntil);
            if (eligible.length === 0) {
                // 아직 아무 칸도 보호가 안 풀림 - 가장 먼저 풀리는 시점에 다시 시도
                const soonest = this.slots.reduce((a, b) => (a.protectedUntil <= b.protectedUntil ? a : b));
                this.time.delayedCall(Math.max(0, soonest.protectedUntil - now) + 20, () => this.tryDrainQueue());
                return;
            }

            const oldestEligible = eligible.reduce((a, b) => (a.shownAt <= b.shownAt ? a : b));
            this.flipSlotToPlayer(oldestEligible, this.joinQueue.shift());
        }
    }

    // 슬롯 하나의 카드 내용을 생성 (스폰/교체 양쪽에서 공용으로 사용)
    // 카드 디자인 자체는 JoinCard.build (전투/탐험 카드 슬롯과 공용)
    buildPlayerCard(slot, data) {
        return window.JoinCard.build(
            this, slot.x, slot.y,
            slot.width - 10, slot.height - 10, data
        );
    }

    // 빈 슬롯에 카드가 새로 나타남 (페이드+확대 등장, 카드는 시간으로 사라지지 않음)
    // 전설 등급은 화면을 가리지 않고 카드 자체의 강한 등장 연출(골드 임팩트 팝)로 대신함
    showPlayerInSlot(slot, data) {
        slot.occupied = true;
        slot.shownAt = this.time.now;
        slot.protectedUntil = this.time.now + (data.grade === 'legendary' ? this.LEGENDARY_TOTAL_MS : this.MIN_CARD_HOLD_MS);

        const container = this.buildPlayerCard(slot, data);

        if (data.grade === 'legendary') {
            this.playLegendaryCardIn(container, slot);
        } else {
            this.playJoinSfx(data.grade);
            container.setAlpha(0);
            container.setScale(0.5);
            this.tweens.add({
                targets: container,
                alpha: 1,
                scale: 1,
                duration: 400,
                ease: 'Back.easeOut'
            });
        }

        slot.container = container;
    }

    // 9칸이 이미 꽉 찼을 때: 가장 오래된 카드를 뒤집어서 새 참가자로 교체
    flipSlotToPlayer(slot, data) {
        const oldContainer = slot.container;
        slot.shownAt = this.time.now;
        slot.protectedUntil = this.time.now + (data.grade === 'legendary' ? this.LEGENDARY_TOTAL_MS : this.MIN_CARD_HOLD_MS);

        this.tweens.add({
            targets: oldContainer,
            scaleX: 0,
            duration: 200,
            ease: 'Cubic.easeIn',
            onComplete: () => {
                oldContainer.destroy();

                const newContainer = this.buildPlayerCard(slot, data);
                slot.container = newContainer;

                if (data.grade === 'legendary') {
                    this.playLegendaryCardIn(newContainer, slot);
                } else {
                    this.playJoinSfx(data.grade);
                    newContainer.setScale(0, 1);  // 뒤집혀 닫힌 상태(옆에서 본 카드)에서 시작
                    this.tweens.add({
                        targets: newContainer,
                        scaleX: 1,
                        duration: 220,
                        ease: 'Back.easeOut'
                    });
                }
            }
        });
    }

    // 등급별 참가 카드 사운드 재생 (던전 에디터에서 등급마다 다르게 지정 가능).
    // 그 등급에 사운드가 안 정해져 있으면 SfxHelper.play가 조용히 무시함
    playJoinSfx(grade) {
        const key = `join_sfx_${grade}`;
        window.SfxHelper.play(this, window.dungeonSounds[key], window.dungeonSounds[`${key}_volume`]);
    }

    // 전설 등급 카드 등장 연출 ("고조 → 쿵") - 실제 카드(스프라이트/이름/등급 라벨)는 미리
    // 보여주지 않고, 정체를 가린 placeholder 카드가 세로축 기준으로 3D처럼 뒤집히며(가짜 3D
    // 플립) 점점 빨리 돌면서 점점 하얗게 밝아지다가(고조 구간, LEGENDARY_BUILDUP_SEC), 정점에서
    // 회전이 뚝 멈추고 화면 셰이크 + 화이트 플래시 + 골드 충격파 링과 함께 "쿵" — 그 순간에야
    // placeholder가 사라지고 진짜 카드가 드러난다.
    // 사운드는 tool.html 사운드 메이커의 전설 참가 사운드 미리보기(SM_FIELD_CONTEXT.legendary)에서
    // 이 타이밍을 그대로 보면서 맞출 수 있음 - 두 쪽의 LEGENDARY_BUILDUP_SEC은 항상 같은 값 유지.
    playLegendaryCardIn(container, slot) {
        this.playJoinSfx('legendary');

        const buildupMs = this.LEGENDARY_BUILDUP_SEC * 1000;
        const totalFlips = 4;  // 고조 구간 동안 도는 총 플립 횟수

        // 진짜 카드는 "쿵" 순간까지 완전히 숨겨둔다
        container.setAlpha(0);
        container.setScale(1);
        container.scaleX = 1;

        // 정체를 가린 placeholder 카드 - 어두운 골드 바탕. 이게 고조 구간 동안 대신 돌면서
        // 점점 하얗게 밝아진다 (진짜 카드는 그래픽/이미지/텍스트가 섞여있어 색을 직접 섞기
        // 번거롭지만, placeholder는 도형 하나라 채우기 색을 직접 보간하면 됨)
        const placeholder = this.add.container(slot.x, slot.y);
        const phBg = this.add.rectangle(0, 0, slot.width, slot.height, 0x4A3500, 1);
        phBg.setStrokeStyle(6, 0xFFC800, 1);
        placeholder.add(phBg);

        // 고조: 진행도(0~1)를 "처음부터 눈에 보이게 움직이면서 뒤로 갈수록 훨씬 빨라지는"
        // 곡선(easeAccel)으로 변환해서, 회전과 화이트아웃을 항상 같은 박자로 같이 몰아붙인다.
        // 순수 Cubic.easeIn(t³)은 초반 변화율이 0에 가까워서 "카드가 멀쩡히 다 나온 뒤에야
        // 그제서야 회전이 시작되는 것처럼" 보이는 문제가 있었음 - 그래서 처음부터 최소한의
        // 속도(15%)는 항상 나오게 선형 성분을 섞어준다.
        const easeAccel = p => 0.15 * p + 0.85 * p * p * p;
        const state = { p: 0 };
        this.tweens.add({
            targets: state,
            p: 1,
            duration: buildupMs,
            ease: 'Linear',
            onUpdate: () => {
                const eased = easeAccel(state.p);
                placeholder.scaleX = Math.cos(Phaser.Math.DegToRad(eased * totalFlips * 360));
                // 어두운 골드(0x4A3500 = 74,53,0)에서 흰색(255,255,255)으로 선형 보간 -
                // 최대 90%까지만 섞여서 마지막까지 살짝 골드빛이 남아있게 함
                const t = eased * 0.9;
                const r = Math.round(74 + (255 - 74) * t);
                const g = Math.round(53 + (255 - 53) * t);
                const b = Math.round(0 + 255 * t);
                phBg.setFillStyle(Phaser.Display.Color.GetColor(r, g, b));
            }
        });

        // 임팩트: placeholder를 지우고 그 자리에 진짜 카드를 즉시 드러낸다(화이트 플래시로
        // 전환을 가려줌) + 화면 셰이크 + 착지 튕김(스케일이 정면으로 정착) + 골드 충격파 링
        this.time.delayedCall(buildupMs, () => {
            placeholder.destroy();
            container.setAlpha(1);
            container.scaleX = 1;

            this.cameras.main.shake(400, 0.016);

            const flash = this.add.rectangle(slot.x, slot.y, slot.width, slot.height, 0xFFFFFF, 1);
            this.tweens.add({
                targets: flash,
                alpha: 0,
                duration: 220,
                ease: 'Cubic.easeOut',
                onComplete: () => flash.destroy()
            });

            container.setScale(1.15);
            this.tweens.add({
                targets: container,
                scale: 1,
                duration: 260,
                ease: 'Back.easeOut'
            });

            // 골드 충격파 링 2겹 - 카드 위치에서 바깥으로 확산 (화면 전체가 아니라 카드 주변만)
            const burstRadius = Math.max(slot.width, slot.height) * 0.9;
            [0, 100].forEach(delay => {
                this.time.delayedCall(delay, () => {
                    const ring = this.add.circle(slot.x, slot.y, 28, 0xFFD700, 0);
                    ring.setStrokeStyle(5, 0xFFD700, 1);
                    this.tweens.add({
                        targets: ring,
                        radius: burstRadius,
                        alpha: 0,
                        duration: 500,
                        ease: 'Cubic.easeOut',
                        onComplete: () => ring.destroy()
                    });
                });
            });
        });
    }

    // ============ UI Updates ============
    updateTimer(seconds) {
        this.timer = seconds;
        this.timerText.setText(window.t('secondsLabel', seconds));

        // Sync progress only if significantly out of sync (>2 seconds difference)
        const serverProgress = seconds / 60;
        const diff = Math.abs(this.currentProgress - serverProgress);
        if (diff > 2 / 60) {  // 2초 이상 차이날 때만 동기화
            this.currentProgress = serverProgress;
        }

        // Red text when low
        if (seconds <= 10) {
            this.timerText.setColor('#FF0000');
        } else {
            this.timerText.setColor('#FFD700');  // 황금색 유지
        }
    }

    updatePartyStats(stats) {
        this.partyStats = stats;
        this.totalText.setText(window.t('totalMembers', stats.total));
        this.statTexts.warrior.setText(stats.warrior.toString());
        this.statTexts.archer.setText(stats.archer.toString());
        this.statTexts.mage.setText(stats.mage.toString());
        this.statTexts.healer.setText(stats.healer.toString());
        this.updateJoinCount(stats.total);
    }

    loadRecentJoins(players) {
        // Clear existing
        this.slots.forEach(slot => {
            if (slot.container) {
                slot.container.destroy();
                slot.occupied = false;
                slot.container = null;
            }
        });

        // Show recent with delay
        players.forEach((player, index) => {
            if (index < this.maxSlots) {
                this.time.delayedCall(index * 200, () => {
                    this.addPlayer(player);
                });
            }
        });
    }

    update(time, delta) {
        // Continuous progress bar decrease
        if (this.progressBarImage && this.currentProgress > 0) {
            // 60초 동안 100% -> 0% (1초당 1/60 감소)
            // delta는 밀리초 단위
            const decreasePerMs = 1 / (60 * 1000);
            this.currentProgress -= decreasePerMs * delta;
            this.currentProgress = Math.max(0, this.currentProgress);

            // Update progress bar width using crop
            const cropWidth = Math.max(0, this.barConfig.fullWidth * this.currentProgress);
            this.progressBarImage.setCrop(0, 0, cropWidth, this.barConfig.height);
        }
    }
}
