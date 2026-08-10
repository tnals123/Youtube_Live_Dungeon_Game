/**
 * JoinCard - 참가 카드 공용 빌더 + 전투/탐험용 카드 슬롯
 *
 * JoinCard.build(): 로비 3x3 그리드와 전투/탐험 카드 슬롯이 같은 디자인의
 * 카드를 쓰도록 카드 내용 생성을 한 곳으로 모음 (LobbyScene에서 추출).
 *
 * JoinCardSlot: 전투/탐험 씬의 신규 참가 카드 1칸.
 *  - 새 참가자가 오면 카드 표시, 최소 HOLD_MS 동안 고정
 *  - 고정 시간 안에 다음 참가자가 오면 큐에 쌓았다가 뒤집기로 교체
 *  - 참가가 몰리면 오래된 큐부터 버림 (진형 반영은 formation_update가 별도로 처리)
 */
window.JoinCard = {
    // 등급 색상 (LobbyScene과 동일)
    gradeColors: {
        legendary: 0xFFC800,
        epic: 0x9B30FF,
        rare: 0x0078FF,
        uncommon: 0x00C853,
        common: 0x787878
    },
    gradeBgColors: {
        legendary: 0x4A3500,
        epic: 0x2A003B,
        rare: 0x001833,
        uncommon: 0x00290A,
        common: 0x2D2D2D
    },
    gradePastelColors: {
        legendary: '#FFE082',
        epic: '#CE93D8',
        rare: '#90CAF9',
        uncommon: '#A5D6A7',
        common: '#BDBDBD'
    },
    roleEmojis: { warrior: '⚔️', archer: '🏹', mage: '🔮', healer: '💚' },

    // 카드 캐릭터 스프라이트 (로비에서 미리 로딩되지만, 방어적 재로딩)
    queueLoad(scene) {
        const files = {
            warrior_common: 'assets/sprites/warrior/전사_일반.png',
            warrior_uncommon: 'assets/sprites/warrior/전사_고급.png',
            warrior_rare: 'assets/sprites/warrior/전사_희귀.png',
            warrior_epic: 'assets/sprites/warrior/전사_영웅.png',
            warrior_default: 'assets/sprites/warrior/전사_공통.png',
            archer_default: 'assets/sprites/archer/궁수_공통.png',
            healer_default: 'assets/sprites/healer/힐러_공통.png',
            mage_default: 'assets/sprites/mage/마법사_공통.png'
        };
        Object.entries(files).forEach(([key, path]) => {
            if (!scene.textures.exists(key)) scene.load.image(key, path);
        });
    },

    /**
     * 카드 컨테이너 생성. (x, y)가 카드 중심, cardW/cardH는 카드 크기.
     * 반환된 컨테이너의 등장 연출(스케일/알파)은 호출부에서 담당.
     *
     * 로비 카드(310x290) 기준 디자인을 어떤 크기로든 그대로 그린다 -
     * 폰트·고정 오프셋은 크기 비율(k)만큼 축소되므로 작은 슬롯에서도 꽉 차게 나온다.
     */
    build(scene, x, y, cardW, cardH, data) {
        // 로비 카드(310x290) 대비 축소 비율 - 폰트/오프셋 스케일용
        const k = Math.min(cardW / 310, cardH / 290, 1);
        const px = v => Math.max(1, Math.round(v * k));

        const container = scene.add.container(x, y);
        const gradeColor = this.gradeColors[data.grade] || 0x787878;
        const gradeBgColor = this.gradeBgColors[data.grade] || 0x2D2D2D;
        const gradePastelColor = this.gradePastelColors[data.grade] || '#BDBDBD';
        const gradeColorHex = '#' + gradeColor.toString(16).padStart(6, '0');

        // ========== 1. 카드 배경 ==========
        const cardBg = scene.add.graphics();
        cardBg.fillStyle(gradeBgColor, 0.8);
        cardBg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 6);
        cardBg.lineStyle(Math.max(2, px(4)), gradeColor, 1);
        cardBg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 6);
        container.add(cardBg);

        // 전설 등급: 금색 파티클
        if (data.grade === 'legendary') {
            for (let i = 0; i < 10; i++) {
                const particle = scene.add.circle(
                    Phaser.Math.Between(-cardW / 2 + 20, cardW / 2 - 20),
                    Phaser.Math.Between(-cardH / 2 + 20, cardH / 2 - 20),
                    Phaser.Math.Between(3, 6),
                    0xFFD700,
                    0.8
                );
                container.add(particle);
                scene.tweens.add({
                    targets: particle,
                    y: particle.y - 60,
                    alpha: 0,
                    duration: 1500,
                    repeat: -1,
                    delay: i * 150
                });
            }
        }

        // ========== 2. 중앙: 캐릭터 ==========
        const charY = -px(10);
        const spriteKey = `${data.role}_${data.grade}`;
        const defaultKey = `${data.role}_default`;
        let character;
        let targetScale = 1;

        let useKey = null;
        if (scene.textures.exists(defaultKey)) {
            useKey = defaultKey;
        } else if (scene.textures.exists(spriteKey)) {
            useKey = spriteKey;
        }

        if (useKey) {
            character = scene.add.image(0, charY, useKey).setOrigin(0.5);
            const targetWidth = cardW * 0.42;
            const targetHeight = cardH * 0.56;
            targetScale = Math.min(targetWidth / character.width, targetHeight / character.height);
        } else {
            character = scene.add.text(0, charY, this.roleEmojis[data.role] || '❓', {
                fontSize: `${Math.round(cardH * 0.45)}px`
            }).setOrigin(0.5);
        }
        container.add(character);

        scene.tweens.add({
            targets: character,
            scale: { from: 0, to: targetScale },
            duration: 400,
            ease: 'Back.easeOut'
        });

        // ========== 3. 상단: 등급 라벨 ==========
        const gradeLabel = scene.add.text(0, -cardH / 2 + px(38), data.grade_name, {
            fontSize: `${px(40)}px`,
            fontFamily: 'DungGeunMo, monospace',
            color: gradeColorHex,
            stroke: '#000000',
            strokeThickness: px(5)
        }).setOrigin(0.5);
        container.add(gradeLabel);

        if (data.grade === 'legendary') {
            gradeLabel.setShadow(0, 0, '#FFC800', px(10), true, true);
        }

        // 기여도 보너스 (캐릭터 우측 하단)
        const bonusText = scene.add.text(cardW * 0.23, charY + cardH * 0.17, `+${data.multiplier}`, {
            fontSize: `${px(44)}px`,
            fontFamily: 'DungGeunMo, monospace',
            color: '#FFEB3B',
            stroke: '#000000',
            strokeThickness: px(5)
        }).setOrigin(0.5);
        container.add(bonusText);

        // ========== 4. 하단: 닉네임 + 직업 ==========
        let displayName = data.name;
        if (displayName.length > 8) {
            displayName = displayName.substring(0, 7) + '..';
        }

        const nameY = cardH / 2 - px(65);
        const nameText = scene.add.text(0, nameY, displayName, {
            fontSize: `${px(34)}px`,
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: px(5)
        }).setOrigin(0.5);
        container.add(nameText);

        const classText = scene.add.text(0, nameY + px(38), `${data.grade_name} ${data.role_name}`, {
            fontSize: `${px(28)}px`,
            fontFamily: 'SeoulNamsan',
            color: gradePastelColor,
            stroke: '#000000',
            strokeThickness: px(5)
        }).setOrigin(0.5);
        container.add(classText);

        return container;
    }
};

/**
 * 전투/탐험 씬의 신규 참가 카드 슬롯 (1칸)
 * config: { x, y, width, height, title }  - (x,y)는 슬롯 중심
 */
window.JoinCardSlot = class JoinCardSlot {
    static HOLD_MS = 4000;   // 카드 최소 고정 시간
    static MAX_QUEUE = 6;    // 참가 폭주 시 이 이상 밀리면 오래된 것부터 버림

    constructor(scene, config) {
        this.scene = scene;
        this.x = config.x;
        this.y = config.y;
        this.width = config.width;
        this.height = config.height;

        // 카드는 슬롯 프레임 안쪽에 딱 맞게 (프레임 테두리만큼 여백)
        this.cardW = this.width - 14;
        this.cardH = this.height - 14;

        this.queue = [];
        this.current = null;      // 표시 중인 카드 컨테이너
        this.shownAt = 0;
        this.flipTimer = null;
        this.destroyed = false;

        // 슬롯 프레임 (스킬 패널과 같은 톤)
        const frame = scene.add.graphics().setDepth(40);
        frame.fillStyle(0x2A2A2A, 0.92);
        frame.fillRoundedRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height, 10);
        frame.lineStyle(4, 0xFFD700, 1);
        frame.strokeRoundedRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height, 10);
        this.frame = frame;

        // 상단 배지: "신규 참가"
        this.badge = scene.add.text(this.x, this.y - this.height / 2 - 20, '🎉 신규 참가', {
            fontSize: '26px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(41);

        // 빈 슬롯 안내
        this.placeholder = scene.add.text(this.x, this.y, window.t('joinPrompt'), {
            fontSize: '30px',
            fontFamily: 'SeoulNamsanEB',
            color: '#888888',
            stroke: '#000000',
            strokeThickness: 4,
            align: 'center',
            lineSpacing: 10
        }).setOrigin(0.5).setDepth(41);

        scene.tweens.add({
            targets: this.placeholder,
            alpha: 0.35,
            duration: 800,
            yoyo: true,
            repeat: -1
        });
    }

    enqueue(data) {
        if (this.destroyed) return;
        this.queue.push(data);
        // 폭주 시 오래된 것부터 버림 (어차피 진형에는 전원 반영됨)
        while (this.queue.length > JoinCardSlot.MAX_QUEUE) {
            this.queue.shift();
        }
        this.tryShowNext();
    }

    tryShowNext() {
        if (this.destroyed || this.queue.length === 0) return;

        const now = this.scene.time.now;
        const heldFor = now - this.shownAt;

        // 표시 중인 카드가 최소 고정 시간을 못 채웠으면 남은 시간 후 재시도
        if (this.current && heldFor < JoinCardSlot.HOLD_MS) {
            if (!this.flipTimer) {
                this.flipTimer = this.scene.time.delayedCall(
                    JoinCardSlot.HOLD_MS - heldFor,
                    () => { this.flipTimer = null; this.tryShowNext(); }
                );
            }
            return;
        }

        const data = this.queue.shift();
        this.placeholder.setVisible(false);

        if (this.current) {
            this.flipTo(data);
        } else {
            this.spawnCard(data, true);
        }
    }

    spawnCard(data, popIn) {
        // 슬롯 실제 크기로 카드를 직접 그림 (폰트/오프셋은 build가 비율 축소)
        const container = window.JoinCard.build(
            this.scene, this.x, this.y,
            this.cardW, this.cardH, data
        );
        container.setDepth(41);
        this.current = container;
        this.shownAt = this.scene.time.now;

        if (popIn) {
            container.setAlpha(0).setScale(0.5);
            this.scene.tweens.add({
                targets: container,
                alpha: 1,
                scale: 1,
                duration: 400,
                ease: 'Back.easeOut'
            });
        } else {
            // 뒤집기 열림: 닫힌 상태(옆면)에서 시작
            container.setScale(0, 1);
            this.scene.tweens.add({
                targets: container,
                scaleX: 1,
                duration: 220,
                ease: 'Back.easeOut'
            });
        }

        // 큐가 남아 있으면 고정 시간 이후 다음 카드
        if (this.queue.length > 0) this.tryShowNext();
    }

    flipTo(data) {
        const old = this.current;
        this.scene.tweens.add({
            targets: old,
            scaleX: 0,
            duration: 200,
            ease: 'Cubic.easeIn',
            onComplete: () => {
                old.destroy();
                if (this.destroyed) return;
                this.spawnCard(data, false);
            }
        });
    }

    destroy() {
        this.destroyed = true;
        if (this.flipTimer) this.flipTimer.remove();
        if (this.current) this.current.destroy();
        this.frame.destroy();
        this.badge.destroy();
        this.placeholder.destroy();
    }
};
