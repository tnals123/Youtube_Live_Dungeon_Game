/**
 * FormationView - 역할군 진형 표시 (BattleScene / ExploreScene 공용)
 *
 * 전열: 전사 / 중열: 궁수(좌)+마법사(우) / 후열: 힐러
 * 서버의 formation_update 페이로드(역할별 등급순 상위 N명 + overflow 수)를 그대로 렌더링.
 * 슬롯 배정·정렬은 전부 서버(formation_payload)가 담당한다.
 *
 * 스프라이트는 두 종류가 섞여 있다:
 *  - 시트 애니메이션 역할(SHEET_ROLES): 전사/궁수/마법사 - 역할별 idle/attack/... 스프라이트시트 + Phaser 애니메이션
 *  - 나머지 역할(힐러): assets/sprites/<역할>/<역할>_<등급>.png 정적 이미지 (등급 파일 없으면 아래 등급 → _공통 폴백)
 * 시트 애니메이션 에셋이 추가되는 역할은 SHEET_ROLES에 등록하면 자동으로 시트 방식으로 전환된다.
 */
window.FormationView = class FormationView {

    // 시트 애니메이션이 준비된 역할. 역할마다 동작(action) 종류와 프레임 크기가 다 달라서
    // (예: 궁수 idle은 80px인데 attack/hit/roll은 64px, 마법사 fireball/magic_up은 128px)
    // 액션별로 파일·프레임 크기를 따로 갖고 있다.
    //
    // offsetX/offsetY/scaleMul: 툴(tool.html "동작별 오프셋" 섹션)에서 직접 눈으로 맞춰서
    // 받은 값. 지정 안 하면 0/0/1 (idle과 같은 위치·크기). idle 프레임과 캔버스 내 그림
    // 위치/크기가 동작마다 달라서(예: 마법사 캐스팅 모션은 팔이 더 넓게 그려짐) 이 보정이
    // 없으면 공격할 때 캐릭터가 커지거나 작아지거나 위치가 튀어 보인다.
    //
    // skillAnimMap: 서버가 보내는 스킬 라벨(공격 스킬은 attack_batch의 skill 필드,
    // 유틸 스킬은 skill_used의 command에서 '/'를 뗀 값) → 재생할 action 매핑.
    // 매핑에 없으면 'attack' 액션으로 폴백(없으면 무시하고 트윈 폴백).
    static SHEET_ROLES = {
        warrior: {
            basePath: 'assets/spritesheets/전사',
            baseScale: 2.2,
            graded: true,  // 등급별 폴더(일반/고급/희귀/에픽/전설)에서 로딩
            actions: {
                idle:   { file: 'idle.png',   frameSize: 64, frameRate: 8,  repeat: -1, scaleMul: 1.10 },
                attack: { file: 'attack.png', frameSize: 64, frameRate: 12, repeat: 0, scaleMul: 1.10 }
                // hit 프레임 없음 - 마법사/힐러/궁수처럼 playHit이 틴트 플래시로 대체
            },
            skillAnimMap: { '강타': 'attack' }
        },
        archer: {
            basePath: 'assets/spritesheets/궁수',
            baseScale: 2.2,
            graded: true,  // 등급별 폴더(일반/고급/희귀/에픽/전설)에서 로딩
            actions: {
                idle:   { file: 'idle.png',   frameSize: 80, frameRate: 8,  repeat: -1, scaleMul: 0.85 },
                attack: { file: 'attack.png', frameSize: 64, frameRate: 15, repeat: 0, offsetY: -57, scaleMul: 0.85, hitFrame: 12 },
                roll:   { file: 'roll.png',   frameSize: 64, frameRate: 14, repeat: 0, offsetY: -57, scaleMul: 0.85 }
                // hit 프레임 없음 - 마법사/힐러처럼 playHit이 틴트 플래시로 대체
            },
            skillAnimMap: { '저격': 'attack', '퇴격': 'roll' }
        },
        mage: {
            basePath: 'assets/spritesheets/마법사',
            baseScale: 2.2,
            graded: true,  // 등급별 폴더(일반/고급/희귀/에픽/전설)에서 로딩
            actions: {
                idle:     { file: 'idle.png',            frameSize: 64,  frameRate: 8,  repeat: -1, scaleMul: 0.85 },
                fireball: { file: 'attack_fireball.png', frameSize: 128, frameRate: 14, repeat: 0, offsetY: 99, scaleMul: 0.85, hitFrame: 6 },
                magic_up: { file: 'attack_magic.png',    frameSize: 128, frameRate: 12, repeat: 0, offsetX: -3, offsetY: 84, scaleMul: 0.85 }
                // hit 프레임 없음 - playHit이 알아서 틴트 플래시로 대체
            },
            skillAnimMap: { '파이어볼': 'fireball', '역산': 'magic_up' }
        },
        healer: {
            basePath: 'assets/spritesheets/힐러',
            baseScale: 1,
            graded: true,  // 등급별 폴더(일반/고급/희귀/에픽/전설)에서 로딩
            actions: {
                idle:   { file: 'Idle.png',   frameSize: 40, frameRate: 8,  repeat: -1, offsetY: -114, scaleMul: 1.65 },
                attack: { file: 'attack.png', frameSize: 40, frameRate: 12, repeat: 0,  offsetY: -114, scaleMul: 1.65 }
                // hit 프레임 없음 - playHit이 알아서 틴트 플래시로 대체
            },
            skillAnimMap: { '힐': 'attack', '정화': 'attack' }
        }
    };

    // 실제로 존재하는 파일 목록 (파일 추가 시 여기에만 등록하면 됨) - 시트가 없는 역할용
    static UNIT_FILES = {};

    static ROLE_KO = { warrior: '전사', archer: '궁수', mage: '마법사', healer: '힐러' };
    static GRADE_KO = { common: '일반', uncommon: '고급', rare: '희귀', epic: '영웅', legendary: '전설' };
    // 등급별 스프라이트 폴더명 (assets/spritesheets/<역할>/<폴더>/) - GRADE_KO와 별개
    // (화면 표시는 "영웅"이지만 에셋 폴더명은 "에픽"이라 폴더 매핑은 따로 둔다)
    static GRADE_FOLDER = { common: '일반', uncommon: '고급', rare: '희귀', epic: '에픽', legendary: '전설' };
    // 등급 파일이 없을 때 폴백 순서 (자기 등급부터 아래로)
    static GRADE_DESC = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

    static GRADE_COLORS = {
        legendary: '#FFC800',
        epic: '#CE93D8',
        rare: '#90CAF9',
        uncommon: '#A5D6A7',
        common: '#E0E0E0'
    };

    // 역할별 "한 줄" 정원 - 서버(server.py FORMATION_SLOTS)와 반드시 일치해야 함.
    // 전사/궁수/마법사는 줄이 여러 개(ROLE_ROWS)라 총 정원 = 이 값 × 줄 수.
    static ROW_COUNTS = { warrior: 12, archer: 11, mage: 12, healer: 12 };
    // 역할별 줄 수 (전사·궁수·마법사 2줄, 힐러 1줄)
    static ROLE_ROWS = { warrior: 2, archer: 2, mage: 2, healer: 1 };
    // 앞에서부터 쌓이는 순서 - 전사 2줄 → 궁수 2줄 → 마법사 2줄 → 힐러 1줄
    static ROLE_ORDER = ['warrior', 'archer', 'mage', 'healer'];

    // 씬 preload에서 호출 - 존재하는 유닛 이미지/스프라이트시트 전부 로드
    static queueLoad(scene) {
        Object.entries(FormationView.UNIT_FILES).forEach(([role, variants]) => {
            const roleKo = FormationView.ROLE_KO[role];
            variants.forEach(v => {
                const key = `unit_${role}_${v}`;
                if (!scene.textures.exists(key)) {
                    scene.load.image(key, `assets/sprites/${role}/${roleKo}_${v}.png`);
                }
            });
        });

        Object.entries(FormationView.SHEET_ROLES).forEach(([role, cfg]) => {
            // graded 역할은 등급별 폴더 전부, 아니면 grade 없이 기존 방식대로 1세트만 로딩
            // (지금은 4역할 전부 graded지만, 새 역할이 등급 스프라이트 없이 추가될 수도 있어 유지)
            const grades = cfg.graded ? Object.keys(FormationView.GRADE_FOLDER) : [null];
            grades.forEach(grade => {
                Object.entries(cfg.actions).forEach(([action, a]) => {
                    const key = FormationView.sheetKey(role, action, grade);
                    if (!scene.textures.exists(key)) {
                        scene.load.spritesheet(key, FormationView.spritePath(role, action, grade), {
                            frameWidth: a.frameSize,
                            frameHeight: a.frameSize
                        });
                    }
                });
            });
        });
    }

    static hasSheet(role) {
        return !!FormationView.SHEET_ROLES[role];
    }

    // graded 역할이면 <basePath>/<등급폴더>/<file>, 아니면 기존처럼 <basePath>/<file>
    static spritePath(role, action, grade) {
        const cfg = FormationView.SHEET_ROLES[role];
        const a = cfg.actions[action];
        if (cfg.graded) {
            const folder = FormationView.GRADE_FOLDER[grade] || FormationView.GRADE_FOLDER.common;
            return `${cfg.basePath}/${folder}/${a.file}`;
        }
        return `${cfg.basePath}/${a.file}`;
    }

    // grade는 graded 역할일 때만 키에 포함됨 - 호출부는 항상 유닛의 grade를 넘기면 되고,
    // graded가 아닌 역할이면 여기서 알아서 무시된다
    static sheetKey(role, action, grade) {
        const cfg = FormationView.SHEET_ROLES[role];
        return cfg.graded ? `sheet_${role}_${grade}_${action}` : `sheet_${role}_${action}`;
    }

    static animKey(role, action, grade) {
        const cfg = FormationView.SHEET_ROLES[role];
        return cfg.graded ? `${role}_${grade}_${action}` : `${role}_${action}`;
    }

    // 전열(전사) 이름표 맨 위 ~ topY(발밑) 사이 거리(px). 씬에서 "이 UI 아래에 진형이
    // 시작하게" 배치할 topY를 역산할 때 씀 (spawnUnit의 스프라이트/이름표 배치 공식과
    // 반드시 같이 맞출 것 - 스프라이트 높이는 idle 프레임 크기 * baseScale * idle의 scaleMul * scale,
    // 이름표는 스프라이트 위 nameOffsetY만큼 띄우고 폰트 한 줄 높이만큼 더 올라감)
    static warriorTopMargin(scale, nameSize, nameOffsetY) {
        const w = FormationView.SHEET_ROLES.warrior;
        const idleCfg = w.actions.idle;
        const spriteH = idleCfg.frameSize * w.baseScale * (idleCfg.scaleMul || 1) * scale;
        const lineH = nameSize * 1.2; // Phaser 기본 텍스트 한 줄 높이 근사치
        return spriteH + nameOffsetY + lineH;
    }

    // 씬당(역할+등급 조합마다) 1회만 애니메이션 등록 (텍스처 로드 완료 후 - create()에서
    // 호출되게 spawnUnit에서 지연 생성). graded가 아닌 역할은 grade가 키에 안 들어가서
    // 사실상 한 번만 등록됨.
    static ensureAnims(scene, role, grade) {
        const idleKey = FormationView.animKey(role, 'idle', grade);
        if (scene.anims.exists(idleKey)) return;

        Object.entries(FormationView.SHEET_ROLES[role].actions).forEach(([action, a]) => {
            const texKey = FormationView.sheetKey(role, action, grade);
            scene.textures.get(texKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
            scene.anims.create({
                key: FormationView.animKey(role, action, grade),
                frames: scene.anims.generateFrameNumbers(texKey, {}),
                frameRate: a.frameRate,
                repeat: a.repeat
            });
        });
    }

    // 액션별로 툴에서 눈으로 맞춘 오프셋/크기 배율(offsetX/offsetY/scaleMul, 없으면 0/0/1)을
    // 그대로 적용. 위치는 컨테이너 기준 로컬 좌표라 스케일과 무관하게 순수 px 이동.
    static applySheetTransform(sprite, role, action, sceneScale) {
        const cfg = FormationView.SHEET_ROLES[role];
        const a = cfg.actions[action];
        sprite.setScale(cfg.baseScale * sceneScale * (a.scaleMul || 1));
        sprite.x = a.offsetX || 0;
        sprite.y = a.offsetY || 0;
    }

    // 그 액션이 시작한 시점부터 "타격 프레임"(hitFrame, 없으면 0=즉시)까지 걸리는 시간(ms).
    // 데미지 숫자·보스 피격 이펙트를 애니메이션의 실제 타격 순간에 맞춰 늦춰서 띄울 때 씀.
    static getHitDelayMs(role, action) {
        const cfg = FormationView.SHEET_ROLES[role];
        const a = cfg && cfg.actions[action];
        if (!a) return 0;
        const frame = a.hitFrame || 0;
        const frameRate = a.frameRate || 12;
        return Math.round((frame / frameRate) * 1000);
    }

    // 보스 VFX 자체에 다단 타격 프레임(bossCfg.hitFrames, 예: [3,7,11])이 설정돼 있으면,
    // 그 각각이 실제로 터지는 시점(ms, 공격 시작 기준)을 계산해서 배열로 반환 - 없으면 null
    // (호출부가 getHitDelayMs 기반 단일 타격으로 폴백). VFX는 캐스터 애니메이션의
    // triggerFrame 시점에 스폰되고 그 뒤로는 VFX 자기 frameRate로 재생되므로, 두 구간을
    // 이어붙여 계산한다 - 둘 다 고정 속도라 실제 이벤트를 기다릴 필요 없이 미리 계산 가능
    // (getHitDelayMs와 동일한 방식, 몬스터 쪽 anim_hits와 같은 발상)
    static getBossVfxHitDelaysMs(role, action, bossCfg) {
        return FormationView.getBossVfxFrameDelaysMs(role, action, bossCfg, bossCfg && bossCfg.hitFrames);
    }

    // 보스 VFX 자체의 임의 프레임 목록(frames, 예: bossCfg.hitFrames 또는 hitStopFrames)이
    // 실제로 도달하는 시점(ms, 공격 시작 기준) 배열을 계산 - 없으면 null.
    // getBossVfxHitDelaysMs와 같은 계산을 히트스탑 프레임에도 재사용하려고 공용화함
    static getBossVfxFrameDelaysMs(role, action, bossCfg, frames) {
        if (!bossCfg || !Array.isArray(frames) || frames.length === 0) return null;
        const cfg = FormationView.SHEET_ROLES[role];
        const a = cfg && cfg.actions[action];
        const casterFrameRate = (a && a.frameRate) || 12;
        const triggerDelayMs = ((bossCfg.triggerFrame || 0) / casterFrameRate) * 1000;
        const vfxFrameRate = bossCfg.frameRate || 12;
        return frames.map(f => Math.round(triggerDelayMs + (f / vfxFrameRate) * 1000));
    }

    // 역할+등급 → 사용할 텍스처 키 (등급 파일 없으면 아래 등급 → 공통 폴백)
    static texKey(role, grade) {
        const files = FormationView.UNIT_FILES[role] || [];
        const startIdx = FormationView.GRADE_DESC.indexOf(grade);
        for (let i = startIdx; i < FormationView.GRADE_DESC.length; i++) {
            const ko = FormationView.GRADE_KO[FormationView.GRADE_DESC[i]];
            if (files.includes(ko)) return `unit_${role}_${ko}`;
        }
        return `unit_${role}_공통`;
    }

    /**
     * config:
     *   centerX    - 진형 가로 중심
     *   topY       - 맨 앞줄(전사 1줄) 발밑 y
     *   unitGap    - 같은 줄 안에서 유닛 사이 가로 간격(px)
     *   rowGaps    - { warrior, archer, mage } 그 역할 자체의 앞줄↔뒷줄 세로 간격(힐러는 1줄이라 없음)
     *   blockGaps  - { archer, mage, healer } 바로 앞 역할의 마지막 줄 ↔ 이 역할의 첫 줄 세로 간격
     *   scale      - 유닛 스프라이트 배율
     *   nameSize   - 이름표 폰트 크기(px 숫자)
     *   nameMaxLen - 이름표 최대 글자 수 (넘으면 ".."로 축약)
     *   nameOffsetY- 이름표와 스프라이트 머리 사이 여백(px). { warrior, archer, mage, healer }
     *                역할별 객체(권장) 또는 숫자 하나(전 역할 동일 적용, 구버전 호환)
     */
    constructor(scene, config = {}) {
        this.scene = scene;
        this.centerX = config.centerX ?? 540;
        this.topY = config.topY ?? 1500;
        this.unitGap = config.unitGap ?? 122;
        this.rowGaps = { warrior: 90, archer: 90, mage: 90, ...(config.rowGaps || {}) };
        this.blockGaps = { archer: 150, mage: 150, healer: 150, ...(config.blockGaps || {}) };
        this.scale = config.scale ?? 1.1;
        this.nameSize = config.nameSize ?? 20;
        this.nameMaxLen = config.nameMaxLen ?? 8;
        // 역할마다 스프라이트 크기가 달라서(특히 마법사) 이름표 위치도 역할별로 따로 조절
        // 가능해야 함 - 숫자 하나만 오면(구버전 호환) 전 역할에 동일 적용
        this.nameOffsetY = typeof config.nameOffsetY === 'number'
            ? { warrior: config.nameOffsetY, archer: config.nameOffsetY, mage: config.nameOffsetY, healer: config.nameOffsetY }
            : { warrior: 8, archer: 8, mage: 8, healer: 8, ...(config.nameOffsetY || {}) };
        // 보스 타겟 VFX용 - 몬스터 월드 좌표를 얻는 함수 (BattleScene에서만 제공, ExploreScene 등엔 없음)
        this.getBossPos = config.getBossPos || null;

        this.root = scene.add.container(0, 0).setDepth(30);
        this.units = new Map();          // user_id -> { container, role, grade, sprite }
        this.overflowTexts = {};         // role -> text
        this.destroyed = false;

        this.roleRowYs = this.computeRoleRowYs();

        // 마지막으로 받은 로스터가 있으면 즉시 반영
        if (window.formationRoster) {
            this.setRoster(window.formationRoster);
        }
    }

    // 역할별로 그 역할의 각 줄이 위치할 y좌표 배열을 미리 계산 (전사 2줄 → 궁수 2줄 →
    // 마법사 2줄 → 힐러 1줄, 앞 역할의 마지막 줄에서 blockGaps만큼 띄우고 시작)
    computeRoleRowYs() {
        const result = {};
        let y = this.topY;
        FormationView.ROLE_ORDER.forEach((role, idx) => {
            if (idx > 0) y += this.blockGaps[role] ?? 150;
            const rows = FormationView.ROLE_ROWS[role];
            const ys = [];
            for (let r = 0; r < rows; r++) {
                if (r > 0) y += this.rowGaps[role] ?? 90;
                ys.push(y);
            }
            result[role] = ys;
        });
        return result;
    }

    // 한 클러스터(n개, 중심 cx) 안에서 index번째 유닛의 x - unitGap 간격으로 중심 정렬
    static clusterX(cx, n, index, gap) {
        return cx - ((n - 1) * gap) / 2 + index * gap;
    }

    // 역할별 슬롯 좌표 계산. index는 그 역할 전체(줄 수 x 한 줄 정원) 기준 순번 -
    // 앞줄부터 채우고(등급 높은 순), 앞줄이 다 차면 다음 줄로 넘어감
    slotPos(role, index) {
        const perRow = FormationView.ROW_COUNTS[role];
        const rowIdx = Math.floor(index / perRow);
        const posInRow = index % perRow;
        const y = this.roleRowYs[role][rowIdx];
        const x = FormationView.clusterX(this.centerX, perRow, posInRow, this.unitGap);
        return { x, y };
    }

    // 역할별 overflow 뱃지 위치 (그 역할 마지막 줄의 마지막 슬롯 바로 오른쪽)
    overflowPos(role) {
        const perRow = FormationView.ROW_COUNTS[role];
        const totalCap = perRow * FormationView.ROLE_ROWS[role];
        const last = this.slotPos(role, totalCap - 1);
        return { x: last.x + this.unitGap * 0.65, y: last.y - 20 };
    }

    setRoster(roster) {
        if (this.destroyed) return;
        const seen = new Set();

        Object.entries(roster).forEach(([role, info]) => {
            (info.units || []).forEach((u, i) => {
                seen.add(u.user_id);
                const pos = this.slotPos(role, i);
                const existing = this.units.get(u.user_id);

                if (existing) {
                    // 등급이 바뀔 일은 없지만 슬롯 이동은 트윈으로
                    this.scene.tweens.add({
                        targets: existing.container,
                        x: pos.x, y: pos.y,
                        duration: 350, ease: 'Power2'
                    });
                    existing.container.setAlpha(u.alive ? 1 : 0.35);
                } else {
                    this.spawnUnit(u, role, pos);
                }
            });

            // overflow 뱃지
            const n = info.overflow || 0;
            const op = this.overflowPos(role);
            if (!this.overflowTexts[role]) {
                this.overflowTexts[role] = this.scene.add.text(op.x, op.y, '', {
                    fontSize: '24px',
                    fontFamily: 'SeoulNamsanEB',
                    color: '#CCCCCC',
                    stroke: '#000000',
                    strokeThickness: 4
                }).setOrigin(0, 0.5);
                this.root.add(this.overflowTexts[role]);
            }
            this.overflowTexts[role].setText(n > 0 ? `+${n}` : '');
        });

        // 로스터에서 사라진 유닛(슬롯에서 밀려남) 제거
        this.units.forEach((unit, uid) => {
            if (!seen.has(uid)) {
                this.units.delete(uid);
                this.scene.tweens.add({
                    targets: unit.container,
                    alpha: 0, scale: 0.7,
                    duration: 300,
                    onComplete: () => unit.container.destroy()
                });
            }
        });
    }

    spawnUnit(u, role, pos) {
        const container = this.scene.add.container(pos.x, pos.y);
        const useSheet = FormationView.hasSheet(role);

        let sprite;
        if (useSheet) {
            FormationView.ensureAnims(this.scene, role, u.grade);
            sprite = this.scene.add.sprite(0, 0, FormationView.sheetKey(role, 'idle', u.grade)).setOrigin(0.5, 1);
            FormationView.applySheetTransform(sprite, role, 'idle', this.scale);
            sprite.play(FormationView.animKey(role, 'idle', u.grade));
        } else {
            const key = FormationView.texKey(role, u.grade);
            if (this.scene.textures.exists(key)) {
                sprite = this.scene.add.image(0, 0, key).setOrigin(0.5, 1).setScale(this.scale);
            } else {
                // 이미지 로드 실패 폴백: 역할 이모지
                const emoji = { warrior: '⚔️', archer: '🏹', mage: '🔮', healer: '💚' }[role] || '❓';
                sprite = this.scene.add.text(0, 0, emoji, { fontSize: '64px' }).setOrigin(0.5, 1);
            }
        }
        container.add(sprite);

        // 이름표 (스프라이트 위, 등급색) - 최대 길이 넘으면 ".."로 축약
        let displayName = u.name;
        if (displayName.length > this.nameMaxLen) {
            displayName = displayName.substring(0, this.nameMaxLen - 1) + '..';
        }
        const spriteH = sprite.displayHeight || 90;
        const nameOffsetY = this.nameOffsetY[role] ?? 8;
        // sprite.y(그 액션의 offsetY) 보정: 스프라이트 프레임 안 여백 때문에 캐릭터를
        // 위/아래로 밀어놓은 역할(예: 힐러 offsetY:-114)은 이만큼 이름표도 같이 옮겨야
        // 캐릭터를 따라간다 - 컨테이너 원점(발밑) 기준으로만 계산하면 스프라이트가
        // 옮겨간 만큼 이름표가 어긋난다 (에디터 미리보기는 이 보정을 이미 포함해서 계산함)
        const name = this.scene.add.text(0, sprite.y - spriteH - nameOffsetY, displayName, {
            fontSize: `${this.nameSize}px`,
            fontFamily: 'SeoulNamsan',
            color: FormationView.GRADE_COLORS[u.grade] || '#FFFFFF',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5, 1);
        container.add(name);

        this.root.add(container);

        // 등장 팝 연출
        container.setScale(0.3).setAlpha(0);
        this.scene.tweens.add({
            targets: container,
            scale: 1, alpha: u.alive ? 1 : 0.35,
            duration: 350, ease: 'Back.easeOut'
        });

        // idle 숨쉬기 (유닛마다 위상 다르게) - 시트 유닛은 idle 애니메이션 자체가 모션이라 생략
        if (!useSheet) {
            this.scene.tweens.add({
                targets: sprite,
                y: -4,
                duration: 900 + Math.random() * 400,
                delay: Math.random() * 600,
                yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
            });
        }

        this.units.set(u.user_id, { container, sprite, role, grade: u.grade, useSheet });
    }

    // self/boss 슬롯(등급별 컨테이너)에서 이 유닛의 등급에 맞는 실제 VFX 설정을 뽑아냄 -
    // 그 등급에 값이 있으면 그걸, 없으면 "common"(일반 등급)으로 폴백 (에디터 tool.html의
    // resolveVfxForPreview와 동일한 규칙)
    static resolveVfxForGrade(slotContainer, grade) {
        if (!slotContainer) return null;
        const g = slotContainer[grade];
        if (g && (g.file || g.sound)) return g;
        const common = slotContainer.common;
        return (common && (common.file || common.sound)) ? common : null;
    }

    // 시트 유닛: 지정 액션이 그 역할에 있으면 1회 재생 후 idle로 복귀. 없으면 false
    // vfxEntry(에디터 skill_vfx[스킬] 전체)가 있으면 .self/.boss 각각 독립적으로(그리고
    // 각각 캐스터 등급에 맞게) 자기 발동 프레임(triggerFrame, 기본 0=시작 즉시)에 VFX +
    // 그 사운드를 같이 터뜨린다 - self는 유닛 자신 기준, boss는 몬스터 위치 기준. 사운드가
    // 파일 없이 지정돼 있어도(VFX 없이 소리만) 같은 타이밍에 재생됨.
    playSheetAction(unit, action, vfxEntry) {
        const cfg = FormationView.SHEET_ROLES[unit.role];
        if (!cfg.actions[action]) return false;

        FormationView.applySheetTransform(unit.sprite, unit.role, action, this.scale);
        const animKey = FormationView.animKey(unit.role, action, unit.grade);
        unit.sprite.play(animKey);

        const selfCfg = FormationView.resolveVfxForGrade(vfxEntry && vfxEntry.self, unit.grade);
        if (selfCfg) {
            window.VfxManager.playOnAnimFrame(this.scene, unit.sprite, animKey, selfCfg, () => {
                if (selfCfg.file) window.VfxManager.playOnUnit(this.scene, unit.container, selfCfg);
                window.SfxHelper.play(this.scene, selfCfg.sound, selfCfg.sound_volume, selfCfg.sound_max);
            });
        }

        const bossCfg = FormationView.resolveVfxForGrade(vfxEntry && vfxEntry.boss, unit.grade);
        if (bossCfg && this.getBossPos) {
            window.VfxManager.playOnAnimFrame(this.scene, unit.sprite, animKey, bossCfg, () => {
                if (bossCfg.file) {
                    const pos = this.getBossPos();
                    window.VfxManager.playOnBoss(this.scene, pos.x, pos.y, bossCfg);
                }
                window.SfxHelper.play(this.scene, bossCfg.sound, bossCfg.sound_volume, bossCfg.sound_max);
            });
        }

        // 빔: 이 캐스터 유닛 위치(container.x/y - root가 (0,0)에 고정이라 이미 화면 절대좌표)에서
        // 보스 위치까지 날아가는 VFX (전설 등급 전용 연출 등 - 회전/늘리기 없이 트윈 이동)
        const beamCfg = FormationView.resolveVfxForGrade(vfxEntry && vfxEntry.beam, unit.grade);
        if (beamCfg && this.getBossPos) {
            window.VfxManager.playOnAnimFrame(this.scene, unit.sprite, animKey, beamCfg, () => {
                if (beamCfg.file) {
                    const pos = this.getBossPos();
                    window.VfxManager.playBeam(this.scene, unit.container.x, unit.container.y, pos.x, pos.y, beamCfg);
                }
                window.SfxHelper.play(this.scene, beamCfg.sound, beamCfg.sound_volume, beamCfg.sound_max);
            });
        }

        unit.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            if (!unit.sprite.active) return;
            FormationView.applySheetTransform(unit.sprite, unit.role, 'idle', this.scale);
            unit.sprite.play(FormationView.animKey(unit.role, 'idle', unit.grade));
        });
        return true;
    }

    // 공격/스킬 모션. skillLabel로 그 역할의 스킬→액션 매핑을 찾아 재생: 던전 에디터의
    // skill_vfx[skillLabel].action(있으면 우선) → SHEET_ROLES.skillAnimMap(코드 기본값) →
    // 'attack'(최종 폴백). skill_vfx에 vfx 설정이 있으면 지정 프레임에 VFX도 함께 재생.
    // 시트가 없거나 해당 액션이 없는 역할은 전방(위쪽) 찌르기 트윈으로 대체.
    // 반환값: 그 액션의 타격 프레임까지 걸리는 시간(ms) - 데미지 숫자를 그 시점에 맞춰
    // 띄우고 싶은 호출부(BattleScene)가 이 값만큼 delayedCall로 늦추면 됨. 트윈 폴백은 0.
    playAttack(userId, skillLabel) {
        const unit = this.units.get(userId);
        if (!unit || this.destroyed) return 0;

        const vfxEntry = window.skillVfx && window.skillVfx[skillLabel];

        if (unit.useSheet) {
            const cfg = FormationView.SHEET_ROLES[unit.role];
            const action = (vfxEntry && vfxEntry.action)
                || (cfg.skillAnimMap && cfg.skillAnimMap[skillLabel])
                || 'attack';
            if (this.playSheetAction(unit, action, vfxEntry)) {
                return FormationView.getHitDelayMs(unit.role, action);
            }
        }
        this.scene.tweens.add({
            targets: unit.container,
            y: unit.container.y - 22,
            duration: 110,
            yoyo: true,
            ease: 'Power2'
        });
        return 0;
    }

    // showAttackBatch()가 데미지 숫자를 몇 번, 언제 띄울지 결정하는 데 씀 (playAttack()과는
    // 별개 - 그쪽은 실제 연출을 "트리거"만 하고, 이건 그 타이밍을 순수 계산만 함).
    // 보스 VFX에 다단 타격 프레임(hitFrames)이 설정돼 있으면 그 프레임들의 실제 발동
    // 시점 배열을, 없으면 캐스터 공격 애니메이션의 단일 타격 프레임 시점 하나짜리 배열을
    // 반환(기존 동작과 동일 - 항상 최소 1개는 들어있음)
    getAttackHitDelays(userId, skillLabel) {
        const resolved = this.resolveBossCfgFor(userId, skillLabel);
        if (!resolved) return [0];
        const { role, action, bossCfg } = resolved;
        const multi = FormationView.getBossVfxHitDelaysMs(role, action, bossCfg);
        return multi || [FormationView.getHitDelayMs(role, action)];
    }

    // showAttackBatch()가 히트스탑+화면 셰이크를 몇 번, 언제 터뜨릴지 결정하는 데 씀.
    // 기본은 꺼짐(hitStopEnabled 체크박스) - 켜져 있어야만, 그리고 hitStopFrames가
    // 설정돼 있어야만 실제로 발동. 프레임 목록이 남아있어도 체크가 꺼져 있으면 무시해서,
    // 특별히 켠 스킬/등급(전설 필살기 등)에만 적용되고 나머지는 절대 발동 안 함
    getAttackHitStopDelays(userId, skillLabel) {
        const resolved = this.resolveBossCfgFor(userId, skillLabel);
        if (!resolved) return null;
        const { role, action, bossCfg } = resolved;
        if (!bossCfg || !bossCfg.hitStopEnabled) return null;
        const delays = FormationView.getBossVfxFrameDelaysMs(role, action, bossCfg, bossCfg.hitStopFrames);
        if (!delays) return null;
        return {
            delays,
            hitStopMs: bossCfg.hitStopMs,
            shakeMs: bossCfg.shakeMs,
            shakeIntensity: bossCfg.shakeIntensity
        };
    }

    // getAttackHitDelays/getAttackHitStopDelays 공용 - 유닛/액션/등급에 맞는 보스 VFX 설정을 찾음
    resolveBossCfgFor(userId, skillLabel) {
        const unit = this.units.get(userId);
        if (!unit || !unit.useSheet) return null;

        const cfg = FormationView.SHEET_ROLES[unit.role];
        const vfxEntry = window.skillVfx && window.skillVfx[skillLabel];
        const action = (vfxEntry && vfxEntry.action)
            || (cfg.skillAnimMap && cfg.skillAnimMap[skillLabel])
            || 'attack';
        const bossCfg = FormationView.resolveVfxForGrade(vfxEntry && vfxEntry.boss, unit.grade);
        return { unit, role: unit.role, action, bossCfg };
    }

    // 피격 모션. 시트에 hit 액션이 있으면 재생, 없는 역할(마법사 등)이나 정적 이미지
    // 역할(힐러)은 붉은 틴트 플래시 + 흔들림으로 대체
    playHit(userId) {
        const unit = this.units.get(userId);
        if (!unit || this.destroyed) return false;

        if (unit.useSheet && this.playSheetAction(unit, 'hit')) return true;

        const sprite = unit.sprite;
        if (sprite.setTintFill) {
            sprite.setTintFill(0xFF4444);
            this.scene.time.delayedCall(120, () => { if (sprite.active) sprite.clearTint(); });
        }
        this.scene.tweens.add({
            targets: unit.container,
            x: unit.container.x - 6,
            duration: 40, yoyo: true, repeat: 3
        });
        return true;
    }

    // 몬스터가 파티를 공격했을 때: 전 역할군 중 랜덤 5~10명이 피격 리액션
    // (데미지 비율이 클수록 반응하는 인원도 많아짐)
    playHitReaction(damagePct = 20) {
        const MIN_COUNT = 5, MAX_COUNT = 10, REF_PCT = 35;
        const ratio = Phaser.Math.Clamp((damagePct || 0) / REF_PCT, 0, 1);
        const count = Math.round(MIN_COUNT + (MAX_COUNT - MIN_COUNT) * ratio);

        const ids = Array.from(this.units.keys());
        Phaser.Utils.Array.Shuffle(ids);
        ids.slice(0, count).forEach(uid => this.playHit(uid));
    }

    destroy() {
        this.destroyed = true;
        this.root.destroy(true);
        this.units.clear();
    }
};
