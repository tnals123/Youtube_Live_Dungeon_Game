/**
 * BattleScene - 일반 몬스터 전투 화면 (1층 등)
 *
 * 레이아웃 (위→아래):
 *   육각 층 진행 맵 → 역할별 스킬 패널 → 몬스터 HP바(일자)
 *   → 몬스터 소개/스프라이트 → 팀 전체 HP바 → 전투 로그
 *
 * 몬스터는 임시로 이모지 사용 중.
 * 스프라이트 시트가 준비되면 preload에 spritesheet 로드 후
 * createMonster()의 이모지 부분만 sprite + play('idle')로 교체하면 됨.
 */

// 역할별 공격 사운드 중 실제로 재생할 후보 하나를 등급 전용 목록에서(없으면 공통 목록에서)
// 무작위로 고르고, 그 후보 인덱스에 저장된 볼륨까지 함께 반환한다.
// 볼륨은 후보 인덱스마다 독립 저장(던전 에디터 tool.html의 atkVolFor와 동일한 폴백 규칙:
// 그 등급에 값이 없으면 공통 등급 값으로, 그것도 없으면 기본값 0.7으로).
function pickRoleAtkSound(ds, sfxKey, grade) {
    const listFor = g => {
        const raw = (!g || g === 'common') ? ds[sfxKey] : ds[`${sfxKey}_${g}`];
        return Array.isArray(raw) ? raw : (raw ? [raw] : []);
    };
    const volFor = (g, index) => {
        const volKey = (!g || g === 'common') ? `${sfxKey}_volume` : `${sfxKey}_${g}_volume`;
        const raw = ds[volKey];
        // raw[index]가 숫자일 때만 유효값으로 취급 - 에디터에서 건드리지 않은 칸이
        // JSON 저장 시 null이 되는 경우가 있어서, null은 "값 없음"과 동일하게 폴백시킨다
        if (Array.isArray(raw) && typeof raw[index] === 'number') return raw[index];
        if (typeof raw === 'number') return raw;
        return g !== 'common' ? volFor('common', index) : 0.7;
    };
    const pickFrom = g => {
        const list = listFor(g);
        const indexes = [];
        list.forEach((f, i) => { if (f) indexes.push(i); });
        if (indexes.length === 0) return null;
        const idx = indexes[Math.floor(Math.random() * indexes.length)];
        return { file: list[idx], volume: volFor(g, idx) };
    };
    return pickFrom(grade) || (grade !== 'common' ? pickFrom('common') : null);
}

class BattleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BattleScene' });

        this.W = 1080;
        this.H = 1920;

        // ===== 레이아웃 값 (디버그 슬라이더로 조정 → 확정되면 여기 반영) =====
        this.MONSTER_Y = 1080;    // 몬스터 세로 위치
        this.BG_OFFSET_Y = -135;  // 배경 세로 오프셋 (음수 = 위로)
        this.BG_OVERSCAN = 400;   // 배경 세로 여유분 (오프셋 이동용)

        this.roleColors = {
            warrior: 0xBD5F55,
            archer: 0x527FA8,
            mage: 0xA547D3,
            healer: 0x85BD64
        };

        this.gradeColors = {
            legendary: '#FFD700',
            epic: '#9B59B6',
            rare: '#3498DB',
            uncommon: '#2ECC71',
            common: '#FFFFFF'
        };

        this.roleEmojis = {
            warrior: '⚔️', archer: '🏹', mage: '🔮', healer: '💚'
        };

        // 역할별 공격 사운드가 저장된 던전 전역 설정(window.dungeonSounds) 키
        this.roleAttackSfxKey = {
            warrior: 'warrior_attack_sfx', archer: 'archer_attack_sfx', mage: 'mage_attack_sfx'
        };

        // 역할별 스킬 (서버 ROLES.commands와 동일하게 유지, 언어별 이름/커맨드는 i18n.js
        // ROLE_SKILLS_I18N 참고 - 여기선 언어와 무관한 색상만 붙인다)
        // headerBg: 어두운 역할색 / headerText: 밝은 역할색 (목업 디자인)
        const roleColors = {
            warrior: { headerBg: 0x7A2020, headerText: '#FF5A4D' },
            archer: { headerBg: 0x1F4A2A, headerText: '#5DDB7A' },
            mage: { headerBg: 0x1F3A66, headerText: '#5B9BFF' },
            healer: { headerBg: 0x1F5A3A, headerText: '#66E699' }
        };
        this.roleSkills = window.roleSkillsHint().map(r => ({ ...r, ...roleColors[r.key] }));
    }

    init(data) {
        this.floor = data.floor || 1;
        this.floorTotal = data.floor_total || 3;
        this.battleType = data.battle_type || 'normal';
        this.monsterName = data.boss_name || (window.dungeonLanguage === 'en' ? 'Monster' : '몬스터');
        this.monsterEmoji = data.boss_emoji || '👾';
        // 등장 배너 전체 문구 (서버가 자동 생성 폴백까지 포함해서 보내줌)
        this.bannerText = data.banner_text || `${this.floor}층 : ${this.monsterName}`;
        this.introSec = data.intro_sec !== undefined ? data.intro_sec : 2;
        this.monsterSpriteName = data.boss_sprite || null;
        this.monsterIsSprite = false;
        this.monsterBaseScale = 1;
        this.attackAnimIndex = -1;  // 공격 모션 로테이션 인덱스
        this.monsterHp = data.boss_hp || 100000;
        this.monsterMaxHp = data.boss_max_hp || 100000;
        this.partyHp = data.party_hp || 10000;
        this.partyMaxHp = data.party_max_hp || 10000;
        this.battleBgm = data.battle_bgm || null;  // 이 층 전용 BGM (없으면 이전 곡 유지)
        this.battleBgmVolume = data.battle_bgm_volume;
    }

    preload() {
        // 로비에서 미리 로딩되지만, 혹시 빠진 경우 대비 폴백 로드
        if (!this.textures.exists('battle_bg_1')) {
            this.load.image('battle_bg_1', 'assets/backgrounds/1층.png');
        }
        if (!this.textures.exists('battle_bg_miniboss')) {
            this.load.image('battle_bg_miniboss', 'assets/backgrounds/중간보스.png');
        }
        if (!this.textures.exists('battle_bg_boss')) {
            this.load.image('battle_bg_boss', 'assets/backgrounds/보스방.png');
        }
        Object.entries(window.SKILL_ICONS).forEach(([key, path]) => {
            if (!this.textures.exists(key)) {
                this.load.image(key, path);
            }
        });

        // 진형 유닛 스프라이트 + 참가 카드 캐릭터
        window.FormationView.queueLoad(this);
        window.JoinCard.queueLoad(this);

        // 몬스터 스프라이트 시트 + plist (브리핑 씬에서 미리 로딩됨, 폴백용)
        window.MonsterAnim.queueLoad(this, this.monsterSpriteName);

        // 몬스터 공격/피격/처치 사운드 (매니페스트가 이미 로딩된 경우, 방어적 재로딩)
        const meta = window.MonsterAnim.getMeta(this, this.monsterSpriteName);
        window.SfxHelper.queueLoad(this, meta.attack_sound);
        window.SfxHelper.queueLoad(this, meta.death_sound);
        window.SfxHelper.queueLoad(this, meta.hit_sound);
        window.SfxHelper.queueLoad(this, meta.attack_hit_sound);
        // 모션별 공격 사운드 (attack1/attack2 등 커스텀 공격 모션 전용 - 없으면 위 attack_sound로 폴백)
        Object.values(meta.attack_sound_by_motion || {}).forEach(f => window.SfxHelper.queueLoad(this, f));

        // 역할별 공격 사운드 (던전 전역 설정) - 등급별로 다를 수 있어서 5등급 전부 미리 로딩
        // (어느 등급의 공격이 틱마다 올지 미리 알 수 없음). 등급 전용 사운드가 없으면
        // 기본(일반) 사운드로 재생 시점에 자동 폴백. 한 등급에 여러 사운드(랜덤 후보)가
        // 등록돼 있을 수 있어서 배열이면 전부 로딩.
        Object.keys(this.roleAttackSfxKey).forEach(role => {
            const baseKey = this.roleAttackSfxKey[role];
            Object.keys(window.FormationView.GRADE_FOLDER).forEach(grade => {
                const key = grade === 'common' ? baseKey : `${baseKey}_${grade}`;
                const val = window.dungeonSounds[key];
                if (Array.isArray(val)) {
                    val.forEach(f => window.SfxHelper.queueLoad(this, f));
                } else {
                    window.SfxHelper.queueLoad(this, val);
                }
            });
        });

        // 스킬 VFX + 스킬별 전용 사운드 (던전 전역 설정 - 방어적 재로딩)
        // self(자기 자신)/boss(보스)/beam(캐스터→보스로 날아가는 VFX) 각각 등급별로
        // 독립적인 VFX 파일 + 사운드를 가질 수 있음
        Object.values(window.skillVfx || {}).forEach(entry => {
            ['self', 'boss', 'beam'].forEach(slot => {
                const gradeMap = entry[slot];
                if (!gradeMap) return;
                Object.values(gradeMap).forEach(cfg => {
                    if (!cfg) return;
                    window.VfxManager.queueLoad(this, cfg);
                    window.SfxHelper.queueLoad(this, cfg.sound);
                });
            });
        });

        // 몬스터 그림자 PNG (없으면 타원 폴백)
        if (!this.textures.exists('monster_shadow')) {
            this.load.image('monster_shadow', 'assets/images/그림자.png');
        }

        // 이 층 BGM + 던전 전역 결과 사운드 (방어적 재로딩)
        window.BgmManager.queueLoad(this, this.battleBgm);
        window.SfxHelper.queueLoad(this, window.dungeonSounds.floor_clear_sfx);
        window.SfxHelper.queueLoad(this, window.dungeonSounds.defeat_sfx);
        window.SfxHelper.queueLoad(this, window.dungeonSounds.conquered_sfx);
    }

    create() {
        // 암전에서 페이드 인
        this.cameras.main.fadeIn(700, 0, 0, 0);

        // 이 층 BGM (설정 안 됐으면 직전 곡이 자연스럽게 이어짐)
        if (this.battleBgm) {
            window.BgmManager.play(this, this.battleBgm, this.battleBgmVolume);
        }

        const centerX = this.W / 2;

        // 배경: 전투 타입별 (일반=1층.png / 미니보스=중간보스.png / 보스=보스방.png)
        // 세로 오버스캔: 오프셋으로 위아래 이동해도 빈 공간이 안 생기게 크게 그림
        const bgByType = {
            normal: 'battle_bg_1',
            miniboss: 'battle_bg_miniboss',
            boss: 'battle_bg_boss'
        };
        let bgKey = bgByType[this.battleType] || 'battle_bg_1';
        if (!this.textures.exists(bgKey)) bgKey = 'battle_bg_1';
        if (!this.textures.exists(bgKey)) bgKey = 'background';
        const bgH = this.H + this.BG_OVERSCAN;
        const bgW = this.W * (bgH / this.H);  // 비율 유지 (좌우는 살짝 잘림)
        this.bg = this.add.image(centerX, this.H / 2 + this.BG_OFFSET_Y, bgKey);
        this.bg.setDisplaySize(bgW, bgH);

        // 1. 육각 층 진행 맵
        this.createFloorMap(centerX, 100);

        // 1.5 안내 문구 (층 맵과 스킬 패널 사이)
        this.createAnnouncement(centerX, 196);

        // 2. 역할별 스킬 패널
        this.createSkillPanel(centerX, 252);

        // 3. 몬스터 HP바 (스킬 패널 아래 일자)
        this.createMonsterHpBar(centerX, 560);

        // 4. 몬스터
        this.createMonster(centerX, this.MONSTER_Y);

        // 5. 팀 전체 HP바 (몬스터 아래)
        this.createPartyHpBar(centerX, 1290);

        // 6. 파티 진형 (전사 2줄 → 궁수 2줄 → 마법사 2줄 → 힐러 1줄, 앞줄=고등급)
        // 맨 앞줄 이름표 맨 위가 전투력 바 밑에서 10px 아래에 오도록 topY(전사 1줄 발밑 y)를 역산
        const formationScale = 1.80;
        const formationNameSize = 23;
        // 역할마다 스프라이트 크기가 달라서 이름표 위치도 역할별로 따로 (동작별 오프셋 탭의
        // "역할 선택" 드롭다운으로 조정한 값)
        const formationNameOffsets = { warrior: -80, archer: -80, mage: -80, healer: -33 };
        const hpBarBottom = this.partyHpBarConfig.y + this.partyHpBarConfig.height;
        const formationPadding = 10;
        const formationTopY = hpBarBottom + formationPadding +
            window.FormationView.warriorTopMargin(formationScale, formationNameSize, formationNameOffsets.warrior);

        this.formation = new window.FormationView(this, {
            centerX: centerX,
            topY: formationTopY,
            unitGap: 84,
            rowGaps: { warrior: 60, archer: 70, mage: 65 },     // 각 역할 자체의 앞줄↔뒷줄 간격
            blockGaps: { archer: 90, mage: 25, healer: 140 },   // 이전 역할 마지막 줄 → 이 역할 첫 줄 간격
            scale: formationScale,
            nameSize: formationNameSize,
            nameMaxLen: 4,
            nameOffsetY: formationNameOffsets,
            // 몬스터 전용 VFX 오프셋(에디터 진형 탭) - 몬스터 스프라이트 자체(this.monsterY)는
            // 안 건드리고, 보스/빔 VFX가 붙는 기준점에만 더한다. 몬스터마다 스프라이트 비율이
            // 달라서, 한 몬스터 기준으로 맞춘 개별 VFX 오프셋이 다른 몬스터엔 안 맞을 때 씀
            getBossPos: () => {
                const meta = this.monsterMeta || {};
                const globalOy = meta.vfx_offset_enabled ? (meta.vfx_offset_y || 0) : 0;
                return { x: this.W / 2, y: this.monsterY + globalOy };
            }
        });

        // 6.5 보스 패턴 UI (텔레그래프 + 파훼 게이지, 평소엔 숨김)
        this.createPatternUI(centerX);

        // 7. 몬스터 소개 연출
        this.showMonsterIntro();

        console.log(`⚔️ BattleScene 생성 (${this.floor}층 - ${this.monsterName})`);
    }

    // ============ 1. 육각 층 진행 맵 ============
    createFloorMap(centerX, y) {
        const hexRadius = 48;
        const gap = 24;
        const count = this.floorTotal;
        const totalWidth = count * (hexRadius * 2) + (count - 1) * gap;
        const startX = centerX - totalWidth / 2 + hexRadius;

        // 연결선 (뒤에 깔기)
        const line = this.add.graphics();
        line.lineStyle(6, 0x333333, 1);
        line.beginPath();
        line.moveTo(startX, y);
        line.lineTo(startX + (count - 1) * (hexRadius * 2 + gap), y);
        line.strokePath();

        for (let i = 0; i < count; i++) {
            const floorNum = i + 1;
            const hx = startX + i * (hexRadius * 2 + gap);

            const isCleared = floorNum < this.floor;
            const isCurrent = floorNum === this.floor;
            const isNext = floorNum === this.floor + 1;

            // 상태별 색상
            let fillColor, borderColor, labelColor;
            if (isCleared) {
                fillColor = 0x2A4A2A; borderColor = 0x4CAF50; labelColor = '#4CAF50';
            } else if (isCurrent) {
                fillColor = 0x3A3A1A; borderColor = 0xFFD700; labelColor = '#FFD700';
            } else {
                fillColor = 0x1A1A1A; borderColor = 0x444444; labelColor = '#666666';
            }

            this.drawHex(hx, y, hexRadius, fillColor, borderColor, isCurrent ? 6 : 4);

            // 라벨: 클리어 ✓, 현재/다음 층수, 그 너머 ?
            let label;
            if (isCleared) label = '✓';
            else if (isCurrent || isNext) label = `${floorNum}F`;
            else label = '?';

            this.add.text(hx, y, label, {
                fontSize: isCurrent ? '38px' : '32px',
                fontFamily: 'SeoulNamsanEB',
                color: labelColor,
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(0.5);

            // 현재 층 강조 (펄스)
            if (isCurrent) {
                const glow = this.add.graphics();
                glow.lineStyle(3, 0xFFD700, 0.6);
                this.strokeHexPath(glow, hx, y, hexRadius + 8);
                this.tweens.add({
                    targets: glow,
                    alpha: { from: 0.8, to: 0.2 },
                    duration: 800,
                    yoyo: true,
                    repeat: -1
                });
            }
        }
    }

    drawHex(x, y, r, fillColor, borderColor, borderWidth) {
        const g = this.add.graphics();
        g.fillStyle(fillColor, 0.92);
        this.fillHexPath(g, x, y, r);
        g.lineStyle(borderWidth, borderColor, 1);
        this.strokeHexPath(g, x, y, r);
        return g;
    }

    hexPoints(x, y, r) {
        // 플랫탑 육각형 (윗변이 평평)
        const pts = [];
        for (let i = 0; i < 6; i++) {
            const angle = Phaser.Math.DegToRad(60 * i);
            pts.push({ x: x + r * Math.cos(angle), y: y + r * Math.sin(angle) });
        }
        return pts;
    }

    fillHexPath(g, x, y, r) {
        const pts = this.hexPoints(x, y, r);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => g.lineTo(p.x, p.y));
        g.closePath();
        g.fillPath();
    }

    strokeHexPath(g, x, y, r) {
        const pts = this.hexPoints(x, y, r);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => g.lineTo(p.x, p.y));
        g.closePath();
        g.strokePath();
    }

    // ============ 1.5 안내 문구 (몬스터 등장 시 페이드인) ============
    createAnnouncement(centerX, y) {
        this.announceText = this.add.text(centerX, y,
            window.t('monsterAppeared'), {
            fontSize: '30px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFE9C9',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center'
        }).setOrigin(0.5);

        // 등장 연출 전까지 숨김
        this.announceText.setAlpha(0);
    }

    showAnnouncement() {
        // 페이드인 후 은은한 깜빡임 시작
        this.tweens.add({
            targets: this.announceText,
            alpha: 1,
            duration: 600,
            onComplete: () => {
                this.tweens.add({
                    targets: this.announceText,
                    alpha: { from: 1, to: 0.55 },
                    duration: 900,
                    yoyo: true,
                    repeat: -1
                });
            }
        });
    }

    // 안내 문구 교체 (전투 이벤트에 따라 갱신용)
    announce(text, color) {
        if (!this.announceText) return;
        this.announceText.setText(text);
        if (color) this.announceText.setColor(color);
    }

    // ============ 2. 역할별 스킬 패널 (목업 디자인) ============
    // 짙은 회색 외곽 패널 > 역할색 헤더 바 > 스킬 버튼(아이콘 슬롯 + 스킬명)
    createSkillPanel(centerX, topY) {
        const colWidth = 204;
        const colGap = 8;
        const totalWidth = 5 * colWidth + 4 * colGap;
        const startX = centerX - totalWidth / 2;

        const headerHeight = 48;
        const buttonHeight = 82;
        const pad = 8;          // 패널 내부 여백
        const panelHeight = headerHeight + pad + buttonHeight + pad + buttonHeight + pad;

        this.roleSkills.forEach((role, i) => {
            const x = startX + i * (colWidth + colGap);

            // ── 외곽 패널 (짙은 회색 + 어두운 테두리)
            const panel = this.add.graphics();
            panel.fillStyle(0x3A3A3A, 0.96);
            panel.fillRoundedRect(x, topY, colWidth, panelHeight, 10);
            panel.lineStyle(4, 0x1C1C1C, 1);
            panel.strokeRoundedRect(x, topY, colWidth, panelHeight, 10);

            // ── 헤더 바 (어두운 역할색, 상단 모서리만 둥글게)
            const header = this.add.graphics();
            header.fillStyle(role.headerBg, 1);
            header.fillRoundedRect(x + 3, topY + 3, colWidth - 6, headerHeight,
                { tl: 8, tr: 8, bl: 0, br: 0 });

            this.add.text(x + colWidth / 2, topY + 3 + headerHeight / 2, role.name, {
                fontSize: '30px',
                fontFamily: 'SeoulNamsanEB',
                color: role.headerText,
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(0.5);

            // ── 스킬 버튼 2개
            role.skills.forEach((skill, j) => {
                const bx = x + pad;
                const by = topY + 3 + headerHeight + pad + j * (buttonHeight + pad);
                const bw = colWidth - pad * 2;

                // 버튼 배경 (어두운 바탕 + 밝은 회색 테두리)
                const btn = this.add.graphics();
                btn.fillStyle(0x242424, 1);
                btn.fillRoundedRect(bx, by, bw, buttonHeight, 8);
                btn.lineStyle(3, 0x6A6A6A, 1);
                btn.strokeRoundedRect(bx, by, bw, buttonHeight, 8);

                // 아이콘 슬롯 (왼쪽 정사각)
                const iconSize = buttonHeight - 16;
                const ix = bx + 8;
                const iy = by + 8;

                const iconBg = this.add.graphics();
                iconBg.fillStyle(0x151515, 1);
                iconBg.fillRoundedRect(ix, iy, iconSize, iconSize, 6);
                iconBg.lineStyle(2, 0x000000, 1);
                iconBg.strokeRoundedRect(ix, iy, iconSize, iconSize, 6);

                // 스킬 아이콘 (iconKey는 언어와 무관하게 항상 한국어 기준 - 로드 실패 시 이모지 폴백)
                if (this.textures.exists(skill.iconKey)) {
                    this.add.image(ix + iconSize / 2, iy + iconSize / 2, skill.iconKey)
                        .setDisplaySize(iconSize - 4, iconSize - 4);
                } else {
                    this.add.text(ix + iconSize / 2, iy + iconSize / 2, skill.icon, {
                        fontSize: '40px'
                    }).setOrigin(0.5);
                }

                // 스킬명 (크림색, 아이콘 오른쪽 영역 중앙) - 언어별로 길이가 크게 달라서(예:
                // "/힐" vs "/fireball") 고정 폰트 크기 대신 가용 너비에 맞춰 최대한 크게 채운다
                const textX = ix + iconSize + (bw - iconSize - 16) / 2;
                const maxLabelWidth = bw - iconSize - 16;
                const skillLabel = this.add.text(textX, by + buttonHeight / 2, skill.cmd, {
                    fontSize: '28px',
                    fontFamily: 'SeoulNamsanEB',
                    color: '#EBD9A8',
                    stroke: '#000000',
                    strokeThickness: 4
                }).setOrigin(0.5);
                if (skillLabel.width > maxLabelWidth) {
                    skillLabel.setScale(maxLabelWidth / skillLabel.width);
                }
            });
        });

        // ── 5번째 칸: 신규 참가 카드 슬롯 (행인 패널이 있던 위치)
        const slotX = startX + this.roleSkills.length * (colWidth + colGap);
        this.joinCardSlot = new window.JoinCardSlot(this, {
            x: slotX + colWidth / 2,
            y: topY + panelHeight / 2,
            width: colWidth,
            height: panelHeight
        });
    }

    // 전투 중 신규 참가 → 카드 슬롯에 표시 (진형 반영은 formation_update가 담당)
    addPlayer(data) {
        if (this.joinCardSlot) this.joinCardSlot.enqueue(data);
    }

    // ============ 3. 몬스터 HP바 (등장 연출 시 페이드인) ============
    createMonsterHpBar(centerX, y) {
        const barWidth = 900;
        const barHeight = 44;

        this.monsterHpUI = this.add.container(0, 0);
        this.monsterHpUI.setAlpha(0);

        const bg = this.add.graphics();
        bg.fillStyle(0x1a1a1a, 0.9);
        bg.fillRoundedRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight, 8);
        bg.lineStyle(4, 0x000000, 1);
        bg.strokeRoundedRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight, 8);
        this.monsterHpUI.add(bg);

        this.monsterHpFill = this.add.graphics();
        this.monsterHpUI.add(this.monsterHpFill);
        this.monsterHpBarConfig = {
            x: centerX - barWidth / 2,
            y: y - barHeight / 2,
            width: barWidth,
            height: barHeight
        };

        this.monsterHpText = this.add.text(centerX, y, '', {
            fontSize: '26px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);
        this.monsterHpUI.add(this.monsterHpText);

        this.updateMonsterHp(this.monsterHp);
    }

    updateMonsterHp(hp) {
        this.monsterHp = hp;
        const ratio = Math.max(0, hp / this.monsterMaxHp);
        const cfg = this.monsterHpBarConfig;

        this.monsterHpFill.clear();
        if (ratio > 0) {
            const color = ratio > 0.5 ? 0xE53935 : (ratio > 0.25 ? 0xFF7043 : 0xFFAB00);
            this.monsterHpFill.fillStyle(color, 1);
            this.monsterHpFill.fillRoundedRect(
                cfg.x + 4, cfg.y + 4, (cfg.width - 8) * ratio, cfg.height - 8, 6
            );
        }

        this.monsterHpText.setText(
            `${this.formatNumber(this.monsterHp)} / ${this.formatNumber(this.monsterMaxHp)}  (${Math.round(ratio * 100)}%)`
        );
    }

    // ============ 4. 몬스터 ============
    MONSTER_TARGET_HEIGHT = 400;  // 몬스터 표시 높이 (px)

    createMonster(centerX, y) {
        const name = this.monsterSpriteName;
        this.monsterMeta = window.MonsterAnim.getMeta(this, name);
        const meta = this.monsterMeta;

        // 에디터에서 설정한 배치값 적용
        this.monsterY = y + (meta.y_offset || 0);
        // 그림자 (몬스터보다 먼저 그려서 밑에 깔림, 등장 전 숨김)
        this.monsterShadow = null;
        this.monsterShadowAlpha = 0;
        const shadowScale = meta.shadow_scale || 0;
        if (shadowScale > 0) {
            const shadowW = 300 * shadowScale;
            const shadowY = this.monsterY + (meta.shadow_y !== undefined ? meta.shadow_y : 160);

            if (this.textures.exists('monster_shadow')) {
                const tex = this.textures.get('monster_shadow').getSourceImage();
                const aspect = tex.height / tex.width;
                this.monsterShadow = this.add.image(centerX, shadowY, 'monster_shadow')
                    .setDisplaySize(shadowW, shadowW * aspect);
                this.monsterShadowAlpha = 0.8;
            } else {
                // 그림자 PNG 없으면 타원으로 폴백
                this.monsterShadow = this.add.ellipse(centerX, shadowY, shadowW, shadowW * 0.3, 0x000000, 0.4);
                this.monsterShadowAlpha = 1;
            }
            this.monsterShadow.setAlpha(0);
        }

        // 스프라이트 시트 + plist가 있으면 애니메이션 몬스터, 없으면 이모지 폴백
        if (name && window.MonsterAnim.setup(this, name)) {
            this.monsterIsSprite = true;

            // 대기 모션 (에디터에서 설정, 없으면 기본 idle)
            this.idleAnimName =
                (meta.idle_anim && window.MonsterAnim.hasAnim(this, name, meta.idle_anim))
                    ? meta.idle_anim : 'idle';

            this.monsterSprite = this.add.sprite(centerX, this.monsterY, window.MonsterAnim.texKey(name));
            this.playIdle();

            // 목표 높이 x 에디터 배율로 스케일
            this.monsterBaseScale =
                (this.MONSTER_TARGET_HEIGHT / this.monsterSprite.height) * (meta.scale || 1);
            this.monsterSprite.setScale(this.monsterBaseScale);
        } else {
            this.monsterIsSprite = false;
            this.monsterBaseScale = 1;

            this.monsterSprite = this.add.text(centerX, this.monsterY, this.monsterEmoji, {
                fontSize: '230px'
            }).setOrigin(0.5);

            // 이모지는 숨쉬기 트윈으로 대기 연출
            this.startBreathingTween();
        }

        // 등장 연출(소개 문구 후 페이드인) 전까지 숨김
        this.monsterSprite.setAlpha(0);
    }

    startBreathingTween() {
        this.tweens.add({
            targets: this.monsterSprite,
            scaleX: { from: 1, to: 1.04 },
            scaleY: { from: 1, to: 0.97 },
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    // 대기 모션 재생 (설정된 모션을 무한 반복으로)
    playIdle() {
        if (!this.monsterIsSprite || !this.monsterSprite.active) return;
        const key = window.MonsterAnim.animKey(this.monsterSpriteName, this.idleAnimName || 'idle');
        this.monsterSprite.play({ key: key, repeat: -1 });
    }

    // 일반 공격 모션 목록 (에디터 설정, 유효한 것만. 없으면 기본 attack)
    getAttackAnims() {
        const meta = this.monsterMeta || {};
        let list = (Array.isArray(meta.attack_anims) && meta.attack_anims.length > 0)
            ? meta.attack_anims
            : (meta.attack_anim ? [meta.attack_anim] : ['attack']);

        list = list.filter(a => window.MonsterAnim.hasAnim(this, this.monsterSpriteName, a));
        return list.length > 0 ? list : ['attack'];
    }

    // 이번에 실제로 재생될 공격 모션(anim) 전용 사운드가 에디터에 지정돼 있으면 그걸,
    // 없으면 기존처럼 몬스터 전체 공통 attack_sound로 폴백 (attack1/attack2처럼 여러 공격
    // 모션을 로테이션/랜덤으로 쓰는 몬스터가 모션마다 다른 타격음을 낼 수 있게)
    getAttackSoundFor(anim) {
        const meta = this.monsterMeta || {};
        const byMotion = meta.attack_sound_by_motion || {};
        if (anim && byMotion[anim]) {
            const volByMotion = meta.attack_sound_by_motion_volume || {};
            return { file: byMotion[anim], volume: volByMotion[anim] };
        }
        return { file: meta.attack_sound, volume: meta.attack_sound_volume };
    }

    // 모션별 타격 프레임 목록 (구버전 단일 값 호환) - 데미지/흔들림/화면 붉어짐 발동 시점
    getHitFrames(animName) {
        const meta = this.monsterMeta || {};
        const hits = meta.anim_hits && meta.anim_hits[animName];
        if (hits && hits.length > 0) return hits;

        if (Number.isInteger(meta.attack_hit_frame)) {
            const legacy = (Array.isArray(meta.attack_anims) && meta.attack_anims[0])
                || meta.attack_anim || 'attack';
            if (animName === legacy) return [meta.attack_hit_frame];
        }
        return [];
    }

    // 모션별 "타격 효과음" 전용 프레임 목록 - 데미지 타격 프레임(getHitFrames)과는
    // 완전히 별개로 지정 가능 (예: 데미지는 17프레임, 효과음은 16프레임에 미리 재생)
    getSoundHitFrames(animName) {
        const meta = this.monsterMeta || {};
        const hits = meta.sound_hits && meta.sound_hits[animName];
        return (hits && hits.length > 0) ? hits : [];
    }

    // 히트스탑: 짧게 시간을 얼려서 타격감 강조 (트윈+몬스터 애니메이션 정지 후 재개)
    hitStop(ms = 100) {
        this.tweens.pauseAll();
        if (this.monsterSprite && this.monsterSprite.anims) {
            this.monsterSprite.anims.pause();
        }
        this.time.delayedCall(ms, () => {
            this.tweens.resumeAll();
            if (this.monsterSprite && this.monsterSprite.anims) {
                this.monsterSprite.anims.resume();
            }
        });
    }

    // 파훼 성공 VFX: 몬스터 위치에서 금색 확산 링 + 플래시
    showBreakSuccessVFX() {
        const cx = this.W / 2;
        const cy = this.monsterY;

        const ring = this.add.circle(cx, cy, 60, 0xFFD700, 0);
        ring.setStrokeStyle(10, 0xFFD700, 1);
        ring.setScale(0.3);
        ring.setDepth(65);
        this.tweens.add({
            targets: ring,
            scale: 3.2,
            alpha: 0,
            duration: 480,
            ease: 'Cubic.easeOut',
            onComplete: () => ring.destroy()
        });

        const flash = this.add.rectangle(cx, cy, 700, 700, 0xFFFFFF, 0.55).setDepth(64);
        this.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 220,
            onComplete: () => flash.destroy()
        });
    }

    // 타격 연출 (흔들림 + 붉은 플래시) - 다단히트 시 매 타격마다.
    // 공격 사운드(attack_sound)는 여기 안 넣음 - 타격 판정과 무관하게 공격 애니메이션이
    // 시작되는 순간 한 번만 재생되어야 해서 showMonsterAttack()에서 별도로 재생함.
    // 타격 효과음(attack_hit_sound)도 여기 안 넣음 - 데미지 타격 프레임과는 별개의
    // 자기 프레임(getSoundHitFrames)에서 playWithHitFrames()가 독립적으로 재생함.
    monsterHitFx() {
        this.cameras.main.shake(300, 0.01);

        const vignette = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xFF0000, 0.18);
        this.tweens.add({
            targets: vignette,
            alpha: 0,
            duration: 400,
            onComplete: () => vignette.destroy()
        });
    }

    // 모션 재생 + 지정된 타격 프레임마다 콜백 발동.
    // onFirstHit: 첫 타격 1회 (데미지 수치/HP 반영용), onEachHit: 매 타격 (흔들림 등 연출용).
    // 타격 효과음(attack_hit_sound)은 데미지 타격 프레임과 완전히 별개인 자기 프레임에서
    // 재생됨 - 예: 데미지는 17프레임인데 효과음은 16프레임에 미리 울리게 지정 가능.
    playWithHitFrames(animName, onFirstHit, onEachHit, fallbackMs) {
        let firstDone = false;
        const fireFirst = () => {
            if (!firstDone) {
                firstDone = true;
                if (onFirstHit) onFirstHit();
            }
        };
        const playSoundHit = () => {
            const meta = this.monsterMeta || {};
            window.SfxHelper.play(this, meta.attack_hit_sound, meta.attack_hit_sound_volume);
        };

        const played = this.playMonsterAnim(animName, true);
        const hitFrames = this.getHitFrames(animName);
        const soundFrames = this.getSoundHitFrames(animName);
        const hitSet = new Set(hitFrames);
        const soundSet = new Set(soundFrames);

        // 프레임이 하나도 안 정해져 있으면(구버전 호환) 재생 시작 즉시 발동
        const damageImmediate = hitFrames.length === 0;
        const soundImmediate = soundFrames.length === 0;

        if (!played) {
            fireFirst();
            if (onEachHit) onEachHit();
            if (soundImmediate) playSoundHit();
            return;
        }

        if (damageImmediate) { fireFirst(); if (onEachHit) onEachHit(); }
        if (soundImmediate) playSoundHit();

        if (damageImmediate && soundImmediate) return;  // 둘 다 즉시 처리했으니 더 들을 것 없음

        const key = window.MonsterAnim.animKey(this.monsterSpriteName, animName);

        // 0번 프레임 타격/사운드는 재생 시작 즉시
        if (!damageImmediate && hitSet.has(0)) { fireFirst(); if (onEachHit) onEachHit(); }
        if (!soundImmediate && soundSet.has(0)) playSoundHit();

        const handler = (anim, frame) => {
            if (anim.key !== key) return;
            const idx = frame.index - 1;  // Phaser frame.index는 1부터
            if (!damageImmediate && hitSet.has(idx)) {
                fireFirst();
                if (onEachHit) onEachHit();
            }
            if (!soundImmediate && soundSet.has(idx)) playSoundHit();
        };
        this.monsterSprite.on('animationupdate', handler);

        // 종료/안전장치: 핸들러 해제 + 미발동 시 데미지 반영 보장
        const cleanup = () => {
            this.monsterSprite.off('animationupdate', handler);
            fireFirst();
        };
        this.monsterSprite.once('animationcomplete', cleanup);
        this.time.delayedCall(fallbackMs || 3000, cleanup);
    }

    // 몬스터 애니메이션 재생 (없으면 무시), 끝나면 대기 모션 복귀
    playMonsterAnim(action, backToIdle) {
        if (!this.monsterIsSprite) return false;
        const name = this.monsterSpriteName;
        if (!window.MonsterAnim.hasAnim(this, name, action)) return false;

        this.monsterSprite.play(window.MonsterAnim.animKey(name, action));
        if (backToIdle) {
            this.monsterSprite.once('animationcomplete', () => this.playIdle());
        }
        return true;
    }

    // ============ 5. 파티 전투력 바 ============
    // 전투력이 깎이면 모두의 공격력이 비례해서 감소 (하한 30%)
    createPartyHpBar(centerX, y) {
        const barWidth = 800;
        const barHeight = 46;

        this.partyHpUI = this.add.container(0, 0);
        this.partyHpUI.setAlpha(0);

        this.partyHpUI.add(this.add.text(centerX - barWidth / 2 - 16, y, '⚡', {
            fontSize: '40px'
        }).setOrigin(1, 0.5));

        const bg = this.add.graphics();
        bg.fillStyle(0x1a1a1a, 0.9);
        bg.fillRoundedRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight, 8);
        bg.lineStyle(4, 0x000000, 1);
        bg.strokeRoundedRect(centerX - barWidth / 2, y - barHeight / 2, barWidth, barHeight, 8);
        this.partyHpUI.add(bg);

        this.partyHpFill = this.add.graphics();
        this.partyHpUI.add(this.partyHpFill);
        this.partyHpBarConfig = {
            x: centerX - barWidth / 2,
            y: y - barHeight / 2,
            width: barWidth,
            height: barHeight
        };

        this.partyHpText = this.add.text(centerX, y, '', {
            fontSize: '26px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);
        this.partyHpUI.add(this.partyHpText);

        this.updatePartyHp(this.partyHp, this.partyMaxHp);
    }

    updatePartyHp(hp, maxHp) {
        this.partyHp = hp;
        this.partyMaxHp = maxHp || this.partyMaxHp;

        const ratio = Math.max(0, this.partyHp / this.partyMaxHp);
        const cfg = this.partyHpBarConfig;

        this.partyHpFill.clear();
        if (ratio > 0) {
            const color = ratio > 0.5 ? 0x2ECC71 : (ratio > 0.25 ? 0xFFAA00 : 0xFF3333);
            this.partyHpFill.fillStyle(color, 1);
            this.partyHpFill.fillRoundedRect(
                cfg.x + 4, cfg.y + 4, (cfg.width - 8) * ratio, cfg.height - 8, 6
            );
        }

        const pct = Math.round(ratio * 100);
        this.partyHpText.setText(window.t('partyPower',
            Math.round(this.partyHp).toLocaleString(),
            Math.round(this.partyMaxHp).toLocaleString(),
            pct
        ));
    }

    // ============ 6. 파티 진형 ============
    updateFormation(roster) {
        if (this.formation) this.formation.setRoster(roster);
    }

    // ============ 6.5 보스 패턴 UI ============
    // 정답 커맨드는 절대 표시하지 않는다 - 게이지의 "반응"으로만 파훼법을 찾게 한다
    createPatternUI(centerX) {
        this.patternThreshold = 70;
        this.currentGauge = 0;

        this.patternContainer = this.add.container(centerX, 690);
        this.patternContainer.setDepth(60);
        this.patternContainer.setVisible(false);

        // 패널 배경(프레임) - 파훼 성공 시 게이지와 함께 즉시 사라지고
        // 성공 문구만 남긴다 (참조 보관용으로 this에 저장)
        this.patternFrameBg = this.add.graphics();
        this.patternFrameBg.fillStyle(0x000000, 0.72);
        this.patternFrameBg.fillRoundedRect(-500, -100, 1000, 230, 14);
        this.patternFrameBg.lineStyle(4, 0xAA3333, 1);
        this.patternFrameBg.strokeRoundedRect(-500, -100, 1000, 230, 14);
        this.patternContainer.add(this.patternFrameBg);

        // 텔레그래프 / 결과 텍스트
        this.patternText = this.add.text(0, -42, '', {
            fontSize: '30px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFAAAA',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
            wordWrap: { width: 940 },
            lineSpacing: 6
        }).setOrigin(0.5);
        this.patternContainer.add(this.patternText);

        // 역할별 정답 커맨드 힌트 - 에디터에서 "힌트 표시"를 켠 패턴만 서버가 hints를 채워
        // 보내준다(showPatternTelegraph에서 세팅). 꺼진 패턴은 빈 문자열이라 아무것도 안 보임 -
        // 정답을 절대 노출하지 않는 기존 원칙은 패턴별 선택 사항으로 그대로 유지된다.
        this.patternHintText = this.add.text(0, 12, '', {
            fontSize: '32px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFE082',
            stroke: '#000000',
            strokeThickness: 5,
            align: 'center',
            wordWrap: { width: 940 }
        }).setOrigin(0.5);
        this.patternContainer.add(this.patternHintText);

        // 파훼 게이지 - 별도 컨테이너로 묶어서, 성공 순간 결과 문구와 별개로
        // 즉시 사라지게 한다 (게이지는 진행 중임을 보여주는 용도라 파훼되면 볼일이 없다)
        const gw = 700, gh = 34;
        this.gaugeCfg = { x: -gw / 2, y: 30, w: gw, h: gh };
        this.gaugeGroup = this.add.container(0, 0);
        this.patternContainer.add(this.gaugeGroup);

        const gaugeBg = this.add.graphics();
        gaugeBg.fillStyle(0x22222C, 1);
        gaugeBg.fillRoundedRect(this.gaugeCfg.x, this.gaugeCfg.y, gw, gh, 8);
        gaugeBg.lineStyle(3, 0x000000, 1);
        gaugeBg.strokeRoundedRect(this.gaugeCfg.x, this.gaugeCfg.y, gw, gh, 8);
        this.gaugeGroup.add(gaugeBg);

        this.gaugeFill = this.add.graphics();
        this.gaugeGroup.add(this.gaugeFill);

        this.thresholdMarker = this.add.graphics();
        this.gaugeGroup.add(this.thresholdMarker);

        this.gaugeText = this.add.text(gw / 2 + 14, this.gaugeCfg.y + gh / 2, '0%', {
            fontSize: '30px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0, 0.5);
        this.gaugeGroup.add(this.gaugeText);

        this.gaugeGroup.add(this.add.text(this.gaugeCfg.x, this.gaugeCfg.y + gh + 28, window.t('breakGauge'), {
            fontSize: '22px',
            fontFamily: 'SeoulNamsan',
            color: '#AAAAAA',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0, 0.5));

        this.patternTimerText = this.add.text(gw / 2, this.gaugeCfg.y + gh + 28, '', {
            fontSize: '28px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FFD700',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(1, 0.5);
        this.gaugeGroup.add(this.patternTimerText);
    }

    showPatternTelegraph(data) {
        // "준비 모션"이 보이는 입력 창 동안 반복 재생되는 배경음 (텔레그래프 시작 순간 1회만
        // 재생되는 telegraph_sfx와 별개) - 환경음 채널 재사용, 결과가 나오면 자동으로 멈춤
        if (data.telegraph_loop_sound) {
            window.AmbientManager.play(this, data.telegraph_loop_sound, data.telegraph_loop_sound_volume);
        } else {
            window.AmbientManager.stop();
        }
        this.patternThreshold = data.threshold || 70;

        this.patternContainer.setVisible(true);
        this.patternContainer.setAlpha(0);
        this.tweens.add({ targets: this.patternContainer, alpha: 1, duration: 300 });

        // 이전 패턴에서 성공 즉시 숨겼을 수 있으니 게이지·프레임 다시 표시
        this.gaugeGroup.setVisible(true);
        this.gaugeGroup.setAlpha(1);
        this.patternFrameBg.setVisible(true);
        this.patternFrameBg.setAlpha(1);

        this.patternText.setText(data.telegraph);
        this.patternText.setColor('#FFAAAA');
        const hintLine = this.buildPatternHintLine(data.hints);
        this.patternHintText.setText(hintLine);
        this.patternHintText.setVisible(true);

        // 텔레그래프 문구가 짧아서 1줄이든 길어서 2줄로 줄바꿈되든, 힌트가 있든 없든
        // 매번 실제 렌더된 높이를 보고 다시 배치한다 - 안 그러면 문구 길이에 따라
        // 힌트/게이지 바가 텔레그래프와 겹치거나 서로 붙어버린다
        const telegraphBottom = this.patternText.y + this.patternText.height / 2;
        let nextY;
        if (hintLine) {
            this.patternHintText.setY(telegraphBottom + 26);
            nextY = this.patternHintText.y + this.patternHintText.height / 2;
        } else {
            nextY = telegraphBottom;
        }
        this.gaugeGroup.setY(Math.max(0, (nextY + 18) - this.gaugeCfg.y));

        this.updateGauge(0);
        this.updatePatternTimer(data.window);

        // 성공선 마커
        const c = this.gaugeCfg;
        const tx = c.x + c.w * (this.patternThreshold / 100);
        this.thresholdMarker.clear();
        this.thresholdMarker.lineStyle(4, 0xFFD700, 1);
        this.thresholdMarker.beginPath();
        this.thresholdMarker.moveTo(tx, c.y - 7);
        this.thresholdMarker.lineTo(tx, c.y + c.h + 7);
        this.thresholdMarker.strokePath();

        // 텔레그래프 모션 (에디터 클립) + 긴장 흔들림 + 경고 사운드
        if (data.telegraph_anim) {
            this.playMonsterAnim(data.telegraph_anim, false);
        }
        this.cameras.main.shake(200, 0.004);
        window.SfxHelper.play(this, data.telegraph_sfx, data.telegraph_sfx_volume);
    }

    // 힌트가 꺼진 패턴은 서버가 hints를 아예 빈 배열로 보내므로 여기선 빈 문자열만 반환 -
    // 정답을 숨기는 기존 원칙은 그대로 유지되고, 힌트를 켠 패턴만 이 줄이 채워진다
    buildPatternHintLine(hints) {
        if (!hints || !hints.length) return '';
        return hints.map(h => {
            const icon = h.role ? (this.roleEmojis[h.role] || '') : '👥';
            return `${icon} ${h.command}`;
        }).join('   ');
    }

    updateGauge(gauge) {
        this.currentGauge = gauge;
        const c = this.gaugeCfg;
        const overLine = gauge >= this.patternThreshold;

        this.gaugeFill.clear();
        if (gauge > 0) {
            this.gaugeFill.fillStyle(overLine ? 0x2ECC71 : 0xE0703A, 1);
            this.gaugeFill.fillRoundedRect(
                c.x + 3, c.y + 3, (c.w - 6) * (gauge / 100), c.h - 6, 6
            );
        }

        this.gaugeText.setText(`${gauge}%`);
        this.gaugeText.setColor(overLine ? '#2ECC71' : '#FFFFFF');
    }

    updatePatternTimer(sec) {
        this.patternTimerText.setText(window.t('countdownSec', sec));
        this.patternTimerText.setColor(sec <= 5 ? '#FF4444' : '#FFD700');
    }

    showPatternResult(data) {
        window.AmbientManager.stop();  // 입력 창이 끝났으니 준비 모션 배경음도 같이 멈춤
        this.updateGauge(data.gauge);
        this.patternTimerText.setText('');
        this.patternHintText.setVisible(false);  // 입력 창이 끝났으니 힌트는 더 볼 일 없음

        if (data.success) {
            this.updatePartyHp(data.party_hp, data.party_max_hp);
            this.patternText.setText(window.t('patternSuccess', data.gauge, data.text));
            this.patternText.setColor('#66FF88');
            window.SfxHelper.play(this, data.success_sfx, data.success_sfx_volume);

            // 파훼된 순간 게이지·패널 프레임은 볼일이 없으니 즉시 사라지고
            // 성공 문구만 남긴다
            this.tweens.add({
                targets: [this.gaugeGroup, this.patternFrameBg],
                alpha: 0,
                duration: 200,
                onComplete: () => {
                    this.gaugeGroup.setVisible(false);
                    this.patternFrameBg.setVisible(false);
                }
            });

            // 성공 시 경직(그로기) 모션 먼저 재생: 1회 재생 후 마지막 프레임에서 멈춰서
            // 경직 시간(결과 표시) 동안 그대로 유지, 끝나면 대기 모션 복귀
            if (data.success_anim && this.playMonsterAnim(data.success_anim, false)) {
                this.stunned = true;
            }

            // 파훼 성공 연출: 몬스터 위치 VFX + 화면 셰이크 + 히트스탑
            // (그로기 모션 재생 직후에 걸어야 그 모션도 함께 얼어붙는 타격감이 남)
            this.showBreakSuccessVFX();
            this.cameras.main.shake(300, 0.014);
            this.hitStop(120);
        } else {
            this.patternText.setText(window.t('patternFail', data.gauge, data.text));
            this.patternText.setColor('#FF6666');
            window.SfxHelper.play(this, data.fail_sfx, data.fail_sfx_volume);

            // 판정 모션 (없으면 일반 공격 모션 폴백) + 타격 프레임마다 연출 (다단히트)
            const resolveAnim = data.resolve_anim || this.getAttackAnims()[0];

            // 공격 사운드는 타격 판정과 무관하게 공격 모션이 시작되는 이 순간 한 번만 재생
            // (resolveAnim 전용 사운드가 지정돼 있으면 그걸, 없으면 기본 attack_sound)
            const atkSound = this.getAttackSoundFor(resolveAnim);
            window.SfxHelper.play(this, atkSound.file, atkSound.volume);
            this.playWithHitFrames(
                resolveAnim,
                () => {
                    this.updatePartyHp(data.party_hp, data.party_max_hp);
                    if (this.formation) this.formation.playHitReaction(data.damage_pct);
                },
                () => this.monsterHitFx(),
                3500
            );
        }

        // 결과 표시 후 페이드아웃 (서버 result 5초에 맞춤)
        this.time.delayedCall(4300, () => {
            if (this.patternContainer.visible) {
                this.tweens.add({
                    targets: this.patternContainer,
                    alpha: 0,
                    duration: 400,
                    onComplete: () => this.patternContainer.setVisible(false)
                });
            }

            // 경직 종료 - 대기 모션 복귀
            if (this.stunned) {
                this.stunned = false;
                this.playIdle();
            }
        });
    }

    // ============ 7. 몬스터 등장 시퀀스 ============
    // 에디터에서 정한 등장 배너 문구(전체 자유 입력) → 몬스터+그림자 페이드인 → 안내 문구 페이드인
    showMonsterIntro() {
        const banner = this.add.container(this.W / 2, 720);
        banner.setDepth(60);

        const bg = this.add.rectangle(0, 0, 1080, 130, 0x000000, 0.75);
        banner.add(bg);

        const text = this.add.text(0, 0, this.bannerText, {
            fontSize: '48px',
            fontFamily: 'SeoulNamsanEB',
            color: '#FF6B6B',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center'
        }).setOrigin(0.5);
        banner.add(text);

        banner.setAlpha(0);
        this.tweens.add({
            targets: banner,
            alpha: 1,
            duration: 500,
            delay: 700,
            hold: this.introSec * 1000,   // 에디터에서 설정한 배너 유지 시간
            yoyo: true,
            onComplete: () => {
                banner.destroy();
                this.fadeInMonster();
            }
        });
    }

    fadeInMonster() {
        // 몬스터 페이드인 - 다 끝나야 몬스터가 실제로 화면에 등장한 것이므로,
        // 이 시점에 서버로 알려서 그때부터 공격/패턴 등 전투 로직이 돌게 한다
        // (서버가 고정된 초를 추측해서 기다리면 로딩/전환 지연에 따라 연출이 끝나기도
        // 전에 몬스터가 공격하는 문제가 생길 수 있어서, 실제 연출 완료 신호로 동기화)
        this.tweens.add({
            targets: this.monsterSprite,
            alpha: 1,
            duration: 800,
            ease: 'Power1',
            onComplete: () => window.gameSocket.notifyBattleIntroDone(this.floor)
        });

        // 그림자도 함께
        if (this.monsterShadow) {
            this.tweens.add({
                targets: this.monsterShadow,
                alpha: this.monsterShadowAlpha,
                duration: 800,
                ease: 'Power1'
            });
        }

        // 몬스터 HP바 + 전투력 게이지 페이드인
        this.tweens.add({
            targets: [this.monsterHpUI, this.partyHpUI],
            alpha: 1,
            duration: 800,
            ease: 'Power1'
        });

        // "몬스터가 나타났습니다!" 안내 문구 페이드인
        this.showAnnouncement();
    }

    // ============ 서버 이벤트 ============
    // 전투 틱마다 도착하는 공격/힐 묶음 (자동 전투 루프)
    showAttackBatch(data) {
        this.updateMonsterHp(data.boss_hp);
        if (data.party_hp !== undefined) {
            this.updatePartyHp(data.party_hp, data.party_max_hp);
        }

        const attacks = data.attacks || [];
        const heals = data.heals || [];

        // 공격 사운드: 스킬 전용 사운드(skill_vfx[스킬].self.sound)가 지정돼 있으면 그게 이
        // 스킬의 "기본 공격음" 역할을 대신하므로 역할 공통 공격 사운드로는 폴백하지 않음 -
        // 실제 재생은 formation.playAttack() 안에서 그 스킬의 VFX 발동 프레임과 정확히
        // 같은 타이밍에 이뤄짐(아래 attacks.slice(...) 루프. boss.sound가 있으면 그것도
        // 같이, 보스 VFX 발동 프레임에 맞춰 재생됨).
        // 폴백 시엔 등급 전용 있으면 그걸, 여러 개면 랜덤 하나. 인원이 많아 한 틱에 몰려도,
        // 사운드별 최대 동시 재생 수를 넘으면 그 이상은 조용히 스킵돼서 음량이 과하게 커지지 않는다
        attacks.forEach(a => {
            const skillCfg = (window.skillVfx || {})[a.skill];
            if (skillCfg && skillCfg.self && skillCfg.self.sound) return;
            const sfxKey = this.roleAttackSfxKey[a.role];
            if (!sfxKey) return;
            const ds = window.dungeonSounds;
            const picked = pickRoleAtkSound(ds, sfxKey, a.grade || 'common');
            if (!picked) return;
            window.SfxHelper.play(this, picked.file, picked.volume, ds[sfxKey + '_max']);
        });

        // 개별 연출 상한 (인원이 많으면 한 틱에 수백 건이 올 수 있음)
        const SHOW_MAX = 10;
        attacks.slice(0, SHOW_MAX).forEach((a, i) => {
            // 같은 틱의 공격들을 시간차로 흩뿌려 자연스럽게
            this.time.delayedCall(i * 70, () => {
                if (!this.formation) return;
                this.formation.playAttack(a.user_id, a.skill);

                // 보통은 타격이 1번(애니메이션의 "타격 프레임"에 맞춰 데미지 숫자를 그만큼
                // 늦춰서 띄움)이지만, 보스 VFX에 다단 타격 프레임(hitFrames)이 설정돼
                // 있으면 그 프레임 수만큼 여러 번 - 이땐 총 데미지를 그 수만큼 나눠서
                // 각 타격 시점마다 따로 띄운다(정수 반올림 나머지는 앞쪽 타격부터 +1씩
                // 배분해서 합이 항상 정확히 원래 데미지와 같게 함)
                const delays = this.formation.getAttackHitDelays(a.user_id, a.skill);
                const portions = this.splitDamage(a.damage, delays.length);
                delays.forEach((delayMs, hitIdx) => {
                    this.time.delayedCall(delayMs, () => {
                        this.spawnDamageText({ ...a, damage: portions[hitIdx] });
                        // 몬스터 피격 연출(흔들림+번쩍임)도 이 틱의 첫 공격자 기준으로, 그
                        // 공격이 실제로 맞는 타격 프레임(들)에 맞춰 재생 - 예전엔 틱이
                        // 도착하자마자 지연 없이 바로 터져서, 저격처럼 타격 프레임이 늦게
                        // 오는 스킬은 화살이 맞기도 전에 몬스터가 먼저 흔들리는 것처럼 보였다
                        if (i === 0) this.triggerMonsterHitFx();
                    });
                });

                // 전설 등급 등 특별 연출용 - 보스 VFX에 hitStopFrames가 설정돼 있으면(다단
                // 타격 hitFrames와 별개로 지정 가능), 그 VFX 자기 프레임에 도달하는 시점마다
                // 잠깐 정지(히트스탑)+화면 흔들림을 터뜨려 타격감을 강조. 이 틱의 첫 공격자
                // 기준으로만(여러 명이 겹쳐도 화면이 과하게 여러 번 얼어붙지 않게)
                if (i === 0) {
                    const hitStop = this.formation.getAttackHitStopDelays(a.user_id, a.skill);
                    if (hitStop) {
                        // 안 정했으면(undefined) 기존 기본값(정지 120ms · 셰이크 300ms/강도
                        // 0.014, 패턴 파훼 성공 연출과 동일값) 그대로 - 에디터에서 VFX별로
                        // 이 값들을 직접 조절 가능
                        const shakeMs = hitStop.shakeMs !== undefined ? hitStop.shakeMs : 300;
                        const shakeIntensity = hitStop.shakeIntensity !== undefined ? hitStop.shakeIntensity : 0.014;
                        const stopMs = hitStop.hitStopMs !== undefined ? hitStop.hitStopMs : 120;
                        hitStop.delays.forEach(delayMs => {
                            this.time.delayedCall(delayMs, () => {
                                this.cameras.main.shake(shakeMs, shakeIntensity);
                                this.hitStop(stopMs);
                            });
                        });
                    }
                }
            });
        });

        // 상한 초과분은 합산 데미지 하나로 표시
        const rest = attacks.slice(SHOW_MAX);
        if (rest.length > 0) {
            const total = rest.reduce((sum, a) => sum + a.damage, 0);
            this.spawnDamageText({
                name: window.t('others', rest.length),
                damage: total,
                damage_type: 'normal',
                grade: 'common'
            });
        }

        // 힐: 공격 애니메이션(힐러 attack 시트 재사용) + self/boss VFX·사운드는 playAttack()
        // 내부에서 skill_vfx['힐'] 설정에 따라 각자의 발동 프레임에 자동 재생됨 + 합산 회복량 플로팅
        heals.forEach(h => {
            if (!this.formation) return;
            this.formation.playAttack(h.user_id, '힐');
        });
        const healTotal = heals.reduce((sum, h) => sum + h.amount, 0);
        if (healTotal > 0) {
            const text = this.add.text(this.W / 2, 1240, `💚 +${Math.round(healTotal * 10) / 10}`, {
                fontSize: '36px',
                fontFamily: 'SeoulNamsanEB',
                color: '#2ECC71',
                stroke: '#000000',
                strokeThickness: 5
            }).setOrigin(0.5).setDepth(70);
            this.tweens.add({
                targets: text,
                y: text.y - 60, alpha: 0,
                duration: 1800,
                onComplete: () => text.destroy()
            });
        }
    }

    // 총 데미지를 hits개로 쪼갠 정수 배열 반환 (합이 항상 정확히 total과 같음) - 나머지를
    // 앞쪽 타격부터 1씩 배분(예: 100을 3으로 나누면 [34,33,33]). 다단 타격 보스 VFX용
    splitDamage(total, hits) {
        if (hits <= 1) return [total];
        const base = Math.floor(total / hits);
        const remainder = total - base * hits;
        return Array.from({ length: hits }, (_, i) => base + (i < remainder ? 1 : 0));
    }

    // 몬스터 피격 연출(흔들림 + 흰색 번쩍 + 피격 사운드) - showAttackBatch가 그 틱 첫
    // 공격자의 실제 타격 프레임 시점에 맞춰 1회 호출한다. 그 사이 몬스터가 죽어서 사라졌을
    // 수 있으니(딜레이 도중 처치) active 체크 후 스킵
    triggerMonsterHitFx() {
        if (!this.monsterSprite || !this.monsterSprite.active) return;

        if (this.monsterMeta && this.monsterMeta.hit_sound) {
            window.SfxHelper.play(this, this.monsterMeta.hit_sound, this.monsterMeta.hit_sound_volume);
        }
        this.tweens.add({
            targets: this.monsterSprite,
            x: { from: this.W / 2 - 14, to: this.W / 2 + 14 },
            duration: 50,
            yoyo: true,
            repeat: 2,
            onComplete: () => { if (this.monsterSprite.active) this.monsterSprite.x = this.W / 2; }
        });

        if (this.monsterIsSprite) {
            this.monsterSprite.setTintFill(0xFFFFFF);
            this.time.delayedCall(70, () => {
                if (this.monsterSprite.active) this.monsterSprite.clearTint();
            });
        }
    }

    // 몬스터 주변 랜덤 위치에 "ㅇㅇㅇ의 강타! -10" 플로팅 텍스트
    spawnDamageText(data) {
        const ox = Phaser.Math.Between(-180, 180);
        const oy = Phaser.Math.Between(-60, 220);  // 몬스터 중심보다 살짝 아래쪽 영역
        const isCrit = data.damage_type === 'critical';

        const label = data.skill
            ? window.t('skillDamageLabel', data.name, window.skillLabelDisplay(data.skill), this.formatNumber(data.damage))
            : `${data.name} -${this.formatNumber(data.damage)}`;

        const text = this.add.text(this.W / 2 + ox, this.monsterY + oy, label, {
            fontSize: isCrit ? '44px' : '34px',
            fontFamily: 'SeoulNamsanEB',
            color: isCrit ? '#FFD700' : (this.gradeColors[data.grade] || '#FFFFFF'),
            stroke: '#000000',
            strokeThickness: isCrit ? 7 : 5
        }).setOrigin(0.5).setDepth(70);

        this.tweens.add({
            targets: text,
            y: text.y - 90,
            alpha: 0,
            duration: 2600,
            ease: 'Power1',
            onComplete: () => text.destroy()
        });
    }

    showMonsterAttack(data) {
        const applyDamage = () => {
            this.updatePartyHp(data.party_hp, data.party_max_hp);
            if (this.formation) this.formation.playHitReaction(data.damage_pct);

            // 전투력 바 위로 피해량 플로팅
            const text = this.add.text(this.W / 2, 1240, `🩸 -${data.damage} (-${data.damage_pct}%)`, {
                fontSize: '38px',
                fontFamily: 'SeoulNamsanEB',
                color: '#FF6B6B',
                stroke: '#000000',
                strokeThickness: 5
            }).setOrigin(0.5).setDepth(70);
            this.tweens.add({
                targets: text,
                y: text.y - 60, alpha: 0,
                duration: 2000,
                onComplete: () => text.destroy()
            });
        };

        // 공격 모션 선택: 에디터에서 등록한 목록을 로테이션 또는 랜덤으로
        const anims = this.getAttackAnims();
        const mode = (this.monsterMeta && this.monsterMeta.attack_anim_mode) || 'rotation';

        let anim;
        if (mode === 'random') {
            anim = anims[Math.floor(Math.random() * anims.length)];
        } else {
            this.attackAnimIndex = (this.attackAnimIndex + 1) % anims.length;
            anim = anims[this.attackAnimIndex];
        }

        // 공격 사운드는 타격 판정과 무관하게 공격 애니메이션이 시작되는 이 순간 한 번만 재생
        // (에디터 사운드 메이커 미리보기와 동일하게 - 소리와 애니메이션이 같은 시점에 시작)
        // anim 전용 사운드가 지정돼 있으면 그걸, 없으면 기본 attack_sound로 폴백
        const atkSound = this.getAttackSoundFor(anim);
        window.SfxHelper.play(this, atkSound.file, atkSound.volume);

        // 타격 프레임마다 연출, 첫 타격에 데미지 반영 (다단히트 지원)
        this.playWithHitFrames(anim, applyDamage, () => this.monsterHitFx(), 2500);
    }

    // 몬스터가 죽는 연출이 끝난 뒤 콜백 실행.
    // death 애니메이션이 있으면 재생 완료(animationcomplete)까지 기다리고,
    // 없으면 쓰러지는 트윈이 끝날 때까지 기다린다 - 결과 화면이 죽는 연출과
    // 동시에 뜨지 않고, 다 죽은 뒤에 뜨도록 순서를 보장한다.
    playDeathThenShow(onDone) {
        this.monsterSprite.off('animationcomplete');

        const meta = window.MonsterAnim.getMeta(this, this.monsterSpriteName);
        window.SfxHelper.play(this, meta.death_sound, meta.death_sound_volume);

        if (this.monsterIsSprite && window.MonsterAnim.hasAnim(this, this.monsterSpriteName, 'death')) {
            this.monsterSprite.play(window.MonsterAnim.animKey(this.monsterSpriteName, 'death'));
            this.monsterSprite.once('animationcomplete', onDone);
        } else {
            // 애니메이션 없으면(또는 이모지 폴백) 쓰러지는 연출로 대체
            this.tweens.add({
                targets: this.monsterSprite,
                alpha: 0.3,
                angle: 90,
                y: this.monsterY + 80,
                duration: 600,
                ease: 'Power2',
                onComplete: onDone
            });
        }
    }

    // ============ 결과 오버레이 ============
    showVictory(data) {
        window.AmbientManager.stop();  // 패턴 대기 중 사운드가 게임 전역 채널이라 씬 넘어가기 전에 확실히 정리
        if (data.fade_bgm_on_clear) window.BgmManager.fadeOut(this, (data.fade_bgm_duration_sec || 1.5) * 1000);
        // 클리어 사운드는 죽는 애니메이션이 끝나고 결과 화면이 뜨는 순간 재생 (몬스터가
        // 처치된 즉시가 아니라, 실제로 화면에 클리어 UI가 나타나는 타이밍에 맞춤)
        this.playDeathThenShow(() => {
            window.SfxHelper.play(this, window.dungeonSounds.floor_clear_sfx, window.dungeonSounds.floor_clear_sfx_volume);
            this.showResultOverlay({
                title: window.t('floorClear', data.floor),
                titleColor: '#FFD700',
                footer: window.t('movingToNextFloor', data.next_floor),
                ranking: data.ranking
            });
        });
    }

    showDefeat(data) {
        window.AmbientManager.stop();
        window.SfxHelper.play(this, window.dungeonSounds.defeat_sfx, window.dungeonSounds.defeat_sfx_volume);
        this.showResultOverlay({
            title: window.t('wipedOnFloor', data.floor),
            titleColor: '#FF6B6B',
            footer: window.t('backToLobby'),
            ranking: data.ranking
        });
    }

    showConquered(data) {
        window.AmbientManager.stop();
        if (data.fade_bgm_on_clear) window.BgmManager.fadeOut(this, (data.fade_bgm_duration_sec || 1.5) * 1000);
        // 던전 정복 사운드는 죽는 애니메이션이 끝나고 결과/기여도 화면이 뜨는 순간 재생
        this.playDeathThenShow(() => {
            window.SfxHelper.play(this, window.dungeonSounds.conquered_sfx, window.dungeonSounds.conquered_sfx_volume);
            // end_message: 에디터에서 특정 층에 "조기 종료" + 커스텀 문구를 설정해뒀을 때
            // (예: 테스트 빌드 안내). 있으면 "정복!!" 대신 그 문구를 그대로 보여준다.
            this.showResultOverlay({
                title: data.end_message || window.t('dungeonConquered', data.dungeon_name),
                titleColor: '#FFD700',
                titleFontSize: data.end_message ? '42px' : '64px',
                footer: data.end_message ? window.t('backToLobby') : window.t('congratsBackToLobby'),
                ranking: data.ranking
            });
        });
    }

    showResultOverlay({ title, titleColor, footer, ranking, titleFontSize }) {
        const overlay = this.add.rectangle(540, 960, 1080, 1920, 0x000000, 0.85);
        overlay.setDepth(100);

        const container = this.add.container(540, 960);
        container.setDepth(101);

        // titleFontSize: 기본 "🏆 정복!!" 류의 짧은 타이틀은 64px 그대로, 조기 종료 커스텀
        // 문구처럼 한 문장짜리 긴 텍스트가 올 수도 있어 wordWrap + 작은 폰트를 선택적으로 허용
        const titleText = this.add.text(0, -450, title, {
            fontSize: titleFontSize || '64px',
            fontFamily: 'SeoulNamsanEB',
            color: titleColor,
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
            wordWrap: { width: 950 }
        }).setOrigin(0.5);
        container.add(titleText);

        const rankTitle = this.add.text(0, -320, window.t('damageRankingTitle'), {
            fontSize: '40px',
            fontFamily: 'SeoulNamsan',
            color: '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 4
        }).setOrigin(0.5);
        container.add(rankTitle);

        const medals = ['🥇', '🥈', '🥉'];

        (ranking || []).slice(0, 5).forEach((r, i) => {
            const medal = medals[i] || `${r.rank}.`;
            const emoji = this.roleEmojis[r.role] || '';
            // 힐러가 딜보다 힐량이 더 크면 힐량으로 표시(is_heal) - 딜 0으로 묻히지 않게
            const suffix = r.is_heal ? ' 💚 회복' : '';
            const line = `${medal} ${emoji} ${r.name}  ${this.formatNumber(r.damage)}${suffix}`;

            const rankText = this.add.text(0, -230 + i * 70, line, {
                fontSize: i === 0 ? '44px' : '36px',
                fontFamily: 'SeoulNamsan',
                color: i === 0 ? '#FFD700' : '#FFFFFF',
                stroke: '#000000',
                strokeThickness: 4
            }).setOrigin(0.5);
            container.add(rankText);
        });

        const footerText = this.add.text(0, 250, footer, {
            fontSize: '36px',
            fontFamily: 'SeoulNamsan',
            color: '#AAAAAA'
        }).setOrigin(0.5);
        container.add(footerText);

        this.tweens.add({
            targets: footerText,
            alpha: 0.3,
            duration: 600,
            yoyo: true,
            repeat: -1
        });

        container.setScale(0.8);
        container.setAlpha(0);
        this.tweens.add({
            targets: container,
            scale: 1,
            alpha: 1,
            duration: 400,
            ease: 'Back.easeOut'
        });
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toLocaleString();
    }
}
