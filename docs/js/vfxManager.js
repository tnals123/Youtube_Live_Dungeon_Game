/**
 * VfxManager - 스킬 이펙트(VFX) 스프라이트시트 재생 공용 헬퍼
 *
 * 두 가지 에셋 형식을 지원한다:
 *  - 그리드(기본): assets/spritesheets/<역할>/vfx/<파일명>.png, frameSize(너비) x
 *    frameHeight(높이, 없으면 frameSize와 동일=정사각형)로 균일하게 자르는 스프라이트시트.
 *    프레임 재생 순서는 "열 우선"(왼쪽 열 위→아래로 다 채운 뒤 다음 열)을 기본으로 한다 -
 *    Phaser의 기본 스프라이트시트 슬라이싱은 행 우선이라 그대로 쓰면 순서가 뒤섞이므로,
 *    cols/rows로 열 우선 프레임 순서를 직접 계산해서 애니메이션을 만든다.
 *  - plist(cfg.plist === true): TexturePacker/cocos2d 아틀라스 - 프레임마다 크기/위치가
 *    제각각이라 균일한 그리드로 못 자른다. 몬스터(monsterAnim.js)와 동일한 방식으로,
 *    PNG는 통짜 이미지로 로드하고 같은 이름의 .plist를 파싱해서 프레임을 수동으로
 *    texture.add()+ setTrim()으로 등록한 뒤, 프레임 이름의 끝번호 순서대로 애니메이션을 만든다.
 */
window.VfxManager = {
    // 같은 파일이라도 자르는 크기/그리드가 다르면(예: self는 128, boss는 148로 같은 파일을
    // 다르게 씀) 완전히 다른 텍스처로 취급해야 한다 - 그래서 파일명뿐 아니라 실제 슬라이싱에
    // 영향을 주는 값(프레임 너비/높이)까지 키에 포함시킨다. 이걸 파일명만으로 캐싱하면
    // 먼저 로딩된 쪽의 프레임 크기가 그 파일을 쓰는 모든 곳에 그대로 덮어써져서, 나중에
    // 로딩된 쪽은 완전히 엉뚱한 크기로 잘려 재생이 깨진다(예전 버그).
    // plist 모드는 프레임 크기가 plist 안에 이미 고정돼 있어서 frameSize/frameHeight가
    // 무의미하므로 파일명만으로 키를 만든다.
    texKey(cfg) {
        if (cfg.plist) return `vfx_${cfg.file}_plist`;
        return `vfx_${cfg.file}_${cfg.frameSize || 128}x${cfg.frameHeight || cfg.frameSize || 128}`;
    },

    // 애니메이션도 마찬가지로 열/행/속도가 다르면 재생 순서·타이밍이 달라지므로 키에 포함
    animKey(cfg) {
        if (cfg.plist) return `vfxAnim_${cfg.file}_plist_${cfg.frameRate || 12}`;
        const w = cfg.frameSize || 128;
        const h = cfg.frameHeight || w;
        return `vfxAnim_${cfg.file}_${w}x${h}_${cfg.cols || 4}x${cfg.rows || 4}_${cfg.frameRate || 12}`;
    },

    // cfg.file("전사/vfx/fx_collision.png")과 같은 폴더, 같은 이름의 .plist 경로
    plistFile(cfg) {
        return cfg.file.replace(/\.[^.]+$/, '.plist');
    },

    // 씬 preload에서 호출 - cfg 없거나 file 없으면 조용히 무시
    queueLoad(scene, cfg) {
        if (!cfg || !cfg.file) return;
        const key = this.texKey(cfg);
        if (scene.textures.exists(key)) return;

        if (cfg.plist) {
            // 통짜 이미지로 로드 - 그리드로 자동 슬라이싱하지 않고, ensureAnim에서 plist를
            // 파싱해 프레임을 수동으로 등록한다 (monsterAnim.js와 동일한 패턴)
            scene.load.image(key, 'assets/spritesheets/' + encodeURI(cfg.file));
            if (!scene.cache.text.has(key + '_plist')) {
                scene.load.text(key + '_plist', 'assets/spritesheets/' + encodeURI(this.plistFile(cfg)));
            }
            return;
        }

        scene.load.spritesheet(key, 'assets/spritesheets/' + encodeURI(cfg.file), {
            frameWidth: cfg.frameSize,
            frameHeight: cfg.frameHeight || cfg.frameSize
        });
    },

    // 그리드(cols x rows)를 열 우선 순서로 훑는 실제 시트 프레임 번호 배열
    // (시트 자체는 행 우선으로 슬라이싱되므로, 열 우선 재생 순서 = row * cols + col)
    columnMajorFrames(cols, rows) {
        const order = [];
        for (let c = 0; c < cols; c++) {
            for (let r = 0; r < rows; r++) {
                order.push(r * cols + c);
            }
        }
        return order;
    },

    // plist 프레임 이름 끝의 숫자로 재생 순서를 정렬 ("fx_collisionsparks_012.png" → 12)
    // 숫자가 없으면 이름 사전순으로 밀려남
    frameNumSuffix(name) {
        const m = name.match(/(\d+)(?!.*\d)/);
        return m ? parseInt(m[1], 10) : Infinity;
    },

    // texture에 plist 프레임을 1회 등록(이미 등록돼 있으면 스킵) + 재생 순서 배열 반환.
    // monsterAnim.js의 setup()과 동일한 트림 처리 - 트림 없이 통짜 그리드로 내보낸
    // 소스라면 sourceW/H가 w/h와 같아서 setTrim이 자동으로 스킵된다.
    ensurePlistFrames(scene, cfg, texKey) {
        const texture = scene.textures.get(texKey);
        if (texture.frameTotal > 1) {
            // 이미 등록됨 - 캐시된 순서를 texture에 매달아뒀다가 재사용
            return texture._vfxFrameOrder || Object.keys(texture.frames).filter(k => k !== '__BASE');
        }

        const plistText = scene.cache.text.get(texKey + '_plist');
        if (!plistText) return [];

        let frames;
        try {
            frames = window.MonsterAnim.parsePlist(plistText);
        } catch (e) {
            console.error('[VfxManager] plist 파싱 실패:', cfg.file, e);
            return [];
        }

        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        Object.entries(frames).forEach(([frameName, f]) => {
            const frame = texture.add(frameName, 0, f.x, f.y, f.w, f.h);
            if (frame && f.sourceW && (f.sourceW !== f.w || f.sourceH !== f.h)) {
                frame.setTrim(f.sourceW, f.sourceH, f.destX, f.destY, f.w, f.h);
            }
        });

        const order = Object.keys(frames).sort((a, b) => this.frameNumSuffix(a) - this.frameNumSuffix(b));
        texture._vfxFrameOrder = order;
        return order;
    },

    ensureAnim(scene, cfg) {
        const key = this.animKey(cfg);
        if (scene.anims.exists(key)) return key;

        const texKey = this.texKey(cfg);

        if (cfg.plist) {
            const order = this.ensurePlistFrames(scene, cfg, texKey);
            if (order.length === 0) return key;
            scene.anims.create({
                key,
                frames: order.map(frameName => ({ key: texKey, frame: frameName })),
                frameRate: cfg.frameRate || 12,
                repeat: 0
            });
            return key;
        }

        const order = this.columnMajorFrames(cfg.cols || 4, cfg.rows || 4);
        scene.anims.create({
            key,
            frames: order.map(n => ({ key: texKey, frame: n })),
            frameRate: cfg.frameRate || 12,
            repeat: 0
        });
        return key;
    },

    // 캐스터 자신의 진형 유닛 컨테이너 기준으로 재생 (오프셋은 컨테이너 로컬 좌표).
    // depth: 'front'(유닛보다 앞) | 'behind'(유닛보다 뒤, 기본값)
    playOnUnit(scene, container, cfg) {
        if (!cfg || !cfg.file || !container) return;
        const texKey = this.texKey(cfg);
        if (!scene.textures.exists(texKey)) return;  // 로딩 안 됐으면 조용히 스킵

        const sprite = scene.add.sprite(cfg.offsetX || 0, cfg.offsetY || 0, texKey);
        sprite.setScale(cfg.scale || 1);

        if (cfg.depth === 'front') {
            container.add(sprite);       // 컨테이너 맨 뒤에 추가 = 맨 위(앞)에 렌더링
        } else {
            container.addAt(sprite, 0);  // 컨테이너 맨 앞에 추가 = 맨 아래(뒤)에 렌더링
        }

        sprite.play(this.ensureAnim(scene, cfg));
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
    },

    // 보스(몬스터) 위치 기준으로 재생 (월드 좌표 + 고정 오프셋 + 랜덤 지터).
    // cfg.offsetX/offsetY는 에디터 진형 미리보기의 보스 자리(curMonster의 실제 idle 프레임을
    // 실제 scale/y_offset으로 그림 - tool.html drawBossPlaceholder 참고)를 보면서 잡은 값이라
    // 실제 게임 위치와 일치한다.
    playOnBoss(scene, x, y, cfg) {
        if (!cfg || !cfg.file) return;
        const texKey = this.texKey(cfg);
        if (!scene.textures.exists(texKey)) return;

        const jitterX = cfg.randomOffsetX ? Phaser.Math.Between(-cfg.randomOffsetX, cfg.randomOffsetX) : 0;
        const jitterY = cfg.randomOffsetY ? Phaser.Math.Between(-cfg.randomOffsetY, cfg.randomOffsetY) : 0;

        const sprite = scene.add.sprite(
            x + (cfg.offsetX || 0) + jitterX,
            y + (cfg.offsetY || 0) + jitterY,
            texKey
        );
        sprite.setScale(cfg.scale || 1);
        sprite.setDepth(cfg.depth === 'front' ? 60 : 20);

        sprite.play(this.ensureAnim(scene, cfg));
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
    },

    // 캐스터 위치 → 보스 위치로 날아가며 재생 (전설 등급 전용 연출 등). 회전/늘리기 없이,
    // VFX 스프라이트 자체를 자기 애니메이션 재생 시간(scene.anims.get(animKey).duration)에
    // 맞춰 시작점에서 끝점까지 트윈으로 이동시킨다 - 정사각형 "터짐"류 이펙트를 그대로
    // 옮기는 방식이라 늘려서 찌그러뜨리지 않는다.
    // offsetX/offsetY는 시작·끝 두 지점 모두에 동일하게 더해져서 경로 전체를 평행이동하고,
    // randomOffsetX/Y(지터)는 boss 타겟과 동일하게 끝점(보스 쪽)에만 매번 랜덤하게 더해진다.
    playBeam(scene, startX, startY, endX, endY, cfg) {
        if (!cfg || !cfg.file) return;
        const texKey = this.texKey(cfg);
        if (!scene.textures.exists(texKey)) return;

        const jitterX = cfg.randomOffsetX ? Phaser.Math.Between(-cfg.randomOffsetX, cfg.randomOffsetX) : 0;
        const jitterY = cfg.randomOffsetY ? Phaser.Math.Between(-cfg.randomOffsetY, cfg.randomOffsetY) : 0;
        const ox = cfg.offsetX || 0, oy = cfg.offsetY || 0;

        const sprite = scene.add.sprite(startX + ox, startY + oy, texKey);
        sprite.setScale(cfg.scale || 1);
        // self/boss와 동일한 front/behind 관례(기본값=behind)를 따르되, 화면을 가로질러
        // 날아가는 연출이라 두 값 다 유닛/보스 VFX(60/20)보다 위에 오도록 잡았다
        sprite.setDepth(cfg.depth === 'front' ? 65 : 25);

        const animKey = this.ensureAnim(scene, cfg);
        sprite.play(animKey);

        const anim = scene.anims.get(animKey);
        const duration = (anim && anim.duration) || (1000 / (cfg.frameRate || 12)) * 4;

        scene.tweens.add({
            targets: sprite,
            x: endX + ox + jitterX,
            y: endY + oy + jitterY,
            duration,
            ease: 'Linear'
        });

        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
    },

    // 유닛(캐스터)이 이미 재생 중인 애니메이션(animKey)의 지정 프레임(cfg.triggerFrame,
    // 0-based, 기본 0=즉시)에 도달하는 순간 spawnFn()을 호출해 VFX를 발동시킨다.
    // 몬스터의 다단히트(getHitFrames/animationupdate) 방식과 동일한 기법.
    // 지정 프레임을 못 만나고 애니메이션이 끝나버리면(중간에 취소 등) 그냥 스킵 -
    // 데미지 등 핵심 로직과 무관한 연출이라 몬스터 쪽처럼 강제 발동시키지 않는다.
    playOnAnimFrame(scene, sprite, animKey, cfg, spawnFn) {
        const triggerFrame = cfg.triggerFrame || 0;

        if (triggerFrame <= 0) {
            spawnFn();
            return;
        }

        const handler = (anim, frame) => {
            if (anim.key !== animKey) return;
            if (frame.index - 1 === triggerFrame) {  // Phaser frame.index는 1부터 시작
                cleanup();
                spawnFn();
            }
        };
        const cleanup = () => {
            sprite.off('animationupdate', handler);
            sprite.off('animationcomplete', cleanup);
        };
        sprite.on('animationupdate', handler);
        sprite.once('animationcomplete', cleanup);
    }
};
