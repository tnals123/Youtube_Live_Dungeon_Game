/**
 * MonsterAnim - 몬스터 스프라이트 시트 + plist 자동 애니메이션 시스템
 *
 * 사용법:
 *   1. assets/monsters/ 에 "몬스터이름.png" + "몬스터이름.plist" 를 넣는다
 *   2. 던전 JSON의 battle.name (또는 battle.sprite) 과 파일명을 맞춘다
 *   3. 씬에서:
 *      - preload:  MonsterAnim.queueLoad(this, name)
 *      - create:   MonsterAnim.setup(this, name)  → true면 애니메이션 준비 완료
 *                  this.add.sprite(x, y, MonsterAnim.texKey(name)).play(MonsterAnim.animKey(name, 'idle'))
 *
 * plist는 cocos2d/TexturePacker 형식(format 2, 3)을 지원.
 * 프레임 이름에서 동작을 자동 분류: idle / attack / death (+ 이름에 숫자로 순서 결정)
 * 주의: TexturePacker에서 회전(rotation) 옵션은 꺼고 출력할 것 (Phaser 미지원)
 */
window.MonsterAnim = {
    path: 'assets/monsters/',

    // 기본 동작 선택 우선순위 (앞에 있는 토큰이 우선)
    // 예: attack과 hit이 둘 다 있으면 attack이 기본 공격, hit은 별도 그룹으로 남음
    ACTION_ALIASES: {
        idle: ['idle', 'stand', 'wait', 'breathing', 'breath'],
        attack: ['attack', 'atk', 'bite', 'strike', 'hit'],
        death: ['death', 'die', 'dead', 'down']
    },

    // 동작별 재생 설정
    ACTION_CONFIG: {
        idle: { frameRate: 8, repeat: -1 },
        attack: { frameRate: 10, repeat: 0 },
        death: { frameRate: 8, repeat: 0 }
    },

    texKey(name) {
        return 'monster_' + name;
    },

    // 프레임 이름에서 동작 토큰 추출: "neutral_critterd_attack_000.png" → "attack"
    // (확장자와 끝 번호를 떼고, 마지막 단어를 동작 이름으로 본다)
    actionToken(frameName) {
        let base = frameName.replace(/\.(png|jpg|jpeg|webp)$/i, '');
        base = base.replace(/[_\-\s]*\d+$/, '');
        const tokens = base.split(/[_\-\s]+/).filter(Boolean);
        return (tokens[tokens.length - 1] || 'etc').toLowerCase();
    },

    // 프레임들을 동작 토큰별로 분리 + idle/attack/death 기본 동작 결정
    // 반환: { tokens: {동작이름: [프레임...]}, canonical: {idle, attack, death} }
    groupFrames(frames) {
        const frameNum = n => {
            const m = n.match(/(\d+)(?!.*\d)/);
            return m ? parseInt(m[1]) : 0;
        };

        const tokens = {};
        Object.keys(frames).forEach(fn => {
            const t = this.actionToken(fn);
            (tokens[t] = tokens[t] || []).push(fn);
        });
        Object.values(tokens).forEach(list => list.sort((a, b) => frameNum(a) - frameNum(b)));

        const canonical = {};
        Object.entries(this.ACTION_ALIASES).forEach(([action, aliases]) => {
            for (const alias of aliases) {
                if (tokens[alias]) {
                    canonical[action] = tokens[alias];
                    break;
                }
            }
        });

        // 어떤 동작도 못 찾으면 전체 프레임을 idle로
        if (!canonical.idle) {
            const all = Object.values(tokens).flat();
            if (all.length > 0) canonical.idle = all;
        }

        return { tokens, canonical };
    },

    animKey(name, action) {
        return this.texKey(name) + '_' + action;
    },

    // ============ preload에서 호출 ============
    queueLoad(scene, name) {
        if (!name) return;
        const key = this.texKey(name);
        if (!scene.textures.exists(key)) {
            scene.load.image(key, this.path + name + '.png');
        }
        if (!scene.cache.text.has(key + '_plist')) {
            scene.load.text(key + '_plist', this.path + name + '.plist');
        }
        // 커스텀 클립 매니페스트 (없어도 됨 - 404는 무시)
        if (!scene.cache.json.has(key + '_manifest')) {
            scene.load.json(key + '_manifest', this.path + name + '.anim.json');
        }
    },

    // ============ preload에서 queueLoad들과 함께 1회 호출 ============
    // 매니페스트(anim.json)는 이 함수 호출 시점엔 아직 안 불러져 있어서
    // attack_sound 값을 미리 알 수 없다. 그래서 1차 로딩(png/plist/manifest)이
    // 끝나는 시점(load 'complete')을 기다렸다가, 그제서야 meta를 읽어
    // 사운드 파일들을 추가로 큐잉 + 재시작한다.
    // 이렇게 미리 안 해두면, 그 몬스터의 전투 화면에 처음 들어가는 순간에야
    // 사운드가 로딩되면서 화면 전환이 짧을 때(층 사이 이동 등) 회색 화면이 노출된다.
    queueSoundsAfterManifests(scene, names) {
        scene.load.once('complete', () => {
            const toLoad = new Set();
            names.forEach(name => {
                const meta = this.getMeta(scene, name);
                [meta.attack_sound, meta.death_sound, meta.hit_sound].forEach(snd => {
                    if (snd && !scene.cache.audio.exists('snd_' + snd)) {
                        toLoad.add(snd);
                    }
                });
            });

            if (toLoad.size > 0) {
                toLoad.forEach(snd => scene.load.audio('snd_' + snd, 'assets/sounds/' + snd));
                scene.load.start();  // 새로 큐잉된 파일 로딩 시작 (끝나야 create() 진행됨)
            }
        });
    },

    // ============ create에서 호출 - 애니메이션 준비 완료 여부 반환 ============
    setup(scene, name) {
        if (!name) return false;
        const key = this.texKey(name);

        // 파일 로드 실패 (png 또는 plist 없음)
        if (!scene.textures.exists(key) || !scene.cache.text.has(key + '_plist')) {
            return false;
        }

        // 이미 생성됨
        if (scene.anims.exists(this.animKey(name, 'idle'))) {
            return true;
        }

        try {
            const plistText = scene.cache.text.get(key + '_plist');
            const frames = this.parsePlist(plistText);
            if (!frames || Object.keys(frames).length === 0) {
                console.warn(`[MonsterAnim] ${name}: plist에서 프레임을 찾지 못함`);
                return false;
            }

            // 텍스처에 프레임 등록
            const texture = scene.textures.get(key);

            // 픽셀아트 유지: 확대 시 뿌옇게 번지지 않게 nearest 필터 적용
            texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

            let rotatedWarned = false;

            Object.entries(frames).forEach(([frameName, f]) => {
                if (f.rotated && !rotatedWarned) {
                    console.warn(`[MonsterAnim] ${name}: 회전된 프레임 발견 - TexturePacker에서 회전 옵션을 끄고 다시 출력하세요`);
                    rotatedWarned = true;
                }
                const frame = texture.add(frameName, 0, f.x, f.y, f.w, f.h);
                // 트리밍 정보 반영 (프레임별 크기 차이로 인한 떨림 방지)
                if (frame && f.sourceW && (f.sourceW !== f.w || f.sourceH !== f.h)) {
                    frame.setTrim(f.sourceW, f.sourceH, f.destX, f.destY, f.w, f.h);
                }
            });

            // 동작 토큰별로 정확히 분리 (attack/hit/run 등이 섞이지 않게)
            const grouped = this.groupFrames(frames);
            const canonical = grouped.canonical;

            // 기본 애니메이션 생성 (idle / attack / death - 우선순위로 선택된 동작)
            ['idle', 'attack', 'death'].forEach(action => {
                const list = canonical[action];
                if (!list || list.length === 0) return;

                const config = this.ACTION_CONFIG[action];
                scene.anims.create({
                    key: this.animKey(name, action),
                    frames: list.map(frameName => ({ key: key, frame: frameName })),
                    frameRate: config.frameRate,
                    repeat: config.repeat
                });
            });

            // 나머지 동작들도 토큰 이름 그대로 애니메이션 생성
            // (breathing, run, hit 등 - 패턴 모션이나 클립 재료로 사용 가능)
            Object.entries(grouped.tokens).forEach(([token, list]) => {
                const animKey = this.animKey(name, token);
                if (!scene.anims.exists(animKey) && list.length > 0) {
                    scene.anims.create({
                        key: animKey,
                        frames: list.map(frameName => ({ key: key, frame: frameName })),
                        frameRate: 8,
                        repeat: 0
                    });
                }
            });

            // 커스텀 클립 생성 (애니메이션 에디터 툴에서 저장한 <이름>.anim.json)
            let clipCount = 0;
            if (scene.cache.json.has(key + '_manifest')) {
                const manifest = scene.cache.json.get(key + '_manifest');
                const clips = (manifest && manifest.clips) || {};

                Object.entries(clips).forEach(([clipName, def]) => {
                    let list = [];
                    if (Array.isArray(def.frames)) {
                        // 프레임 이름 직접 지정
                        list = def.frames.filter(f => frames[f]);
                    } else if (def.use) {
                        // 기존 동작의 구간 잘라 쓰기: {use: "attack", range: [10, 19]}
                        const src = canonical[def.use] || grouped.tokens[def.use];
                        if (src) {
                            const [a, b] = def.range || [0, src.length - 1];
                            list = src.slice(a, b + 1);
                        }
                    }

                    if (list.length > 0 && !scene.anims.exists(this.animKey(name, clipName))) {
                        scene.anims.create({
                            key: this.animKey(name, clipName),
                            frames: list.map(frameName => ({ key: key, frame: frameName })),
                            frameRate: def.frameRate || 10,
                            repeat: def.repeat !== undefined ? def.repeat : 0
                        });
                        clipCount++;
                    }
                });
            }

            const tokenSummary = Object.entries(grouped.tokens)
                .map(([t, l]) => `${t}:${l.length}`).join(' ');
            console.log(`[MonsterAnim] ${name} 준비 완료 - ${tokenSummary} 커스텀클립:${clipCount}`);
            return scene.anims.exists(this.animKey(name, 'idle'));

        } catch (e) {
            console.error(`[MonsterAnim] ${name} plist 해석 실패:`, e);
            return false;
        }
    },

    // 특정 동작 애니메이션 존재 여부
    hasAnim(scene, name, action) {
        return scene.anims.exists(this.animKey(name, action));
    },

    // 몬스터 메타 정보 (타격 프레임, 사운드 등 - 에디터에서 설정)
    getMeta(scene, name) {
        const key = this.texKey(name) + '_manifest';
        if (scene.cache.json.has(key)) {
            return scene.cache.json.get(key).meta || {};
        }
        return {};
    },

    // ============ plist(XML) 파서 ============
    // 반환: { 프레임이름: {x, y, w, h, rotated, sourceW, sourceH, destX, destY} }
    parsePlist(xmlText) {
        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (doc.querySelector('parsererror')) {
            throw new Error('XML 파싱 오류');
        }

        const rootDict = doc.querySelector('plist > dict');
        if (!rootDict) throw new Error('plist 루트 dict 없음');

        const data = this.parseNode(rootDict);
        const framesDict = data.frames;
        if (!framesDict) throw new Error('frames 항목 없음');

        const parseRect = (s) => (s.match(/-?\d+\.?\d*/g) || []).map(Number);
        const result = {};

        Object.entries(framesDict).forEach(([frameName, f]) => {
            let x, y, w, h, rotated = false;
            let sourceW = 0, sourceH = 0, destX = 0, destY = 0;

            if (f.textureRect !== undefined) {
                // ── format 3
                [x, y, w, h] = parseRect(f.textureRect);
                rotated = !!f.textureRotated;

                if (f.spriteSourceSize) {
                    [sourceW, sourceH] = parseRect(f.spriteSourceSize);
                }
                if (f.spriteOffset) {
                    // cocos2d offset: 중심 기준, y는 위가 +
                    const [ox, oy] = parseRect(f.spriteOffset);
                    destX = (sourceW - w) / 2 + ox;
                    destY = (sourceH - h) / 2 - oy;
                }
            } else if (f.frame !== undefined) {
                // ── format 2
                [x, y, w, h] = parseRect(f.frame);
                rotated = !!f.rotated;

                if (f.sourceSize) {
                    [sourceW, sourceH] = parseRect(f.sourceSize);
                }
                if (f.sourceColorRect) {
                    [destX, destY] = parseRect(f.sourceColorRect);
                }
            } else {
                return; // 알 수 없는 형식의 항목은 건너뜀
            }

            result[frameName] = { x, y, w, h, rotated, sourceW, sourceH, destX, destY };
        });

        return result;
    },

    // plist XML 노드 → JS 객체 (재귀)
    parseNode(node) {
        switch (node.nodeName) {
            case 'dict': {
                const obj = {};
                const children = Array.from(node.children);
                for (let i = 0; i < children.length; i += 2) {
                    if (children[i].nodeName === 'key' && children[i + 1]) {
                        obj[children[i].textContent] = this.parseNode(children[i + 1]);
                    }
                }
                return obj;
            }
            case 'array':
                return Array.from(node.children).map(c => this.parseNode(c));
            case 'string':
                return node.textContent;
            case 'integer':
            case 'real':
                return parseFloat(node.textContent);
            case 'true':
                return true;
            case 'false':
                return false;
            default:
                return null;
        }
    }
};
