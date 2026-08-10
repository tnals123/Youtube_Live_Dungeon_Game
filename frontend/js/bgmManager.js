/**
 * 사운드 재생 공용 헬퍼 (BgmManager + SfxHelper)
 *
 * 같은 파일이 BGM으로도, SFX로도 쓰일 수 있어서(예: 던전 전역 프리로드 목록은
 * 용도 구분 없이 파일명만 모아둠) 캐시 키를 'snd_' 하나로 통일한다.
 * 둘 중 아무 쪽으로든 한 번 로딩해두면 반대쪽에서도 그대로 재사용된다.
 *
 * Phaser의 SoundManager(this.sound)는 씬이 아니라 게임 전체에서 공유되는
 * 객체라, BgmManager도 게임 전역(window)에 하나만 둔다.
 */
function soundCacheKey(filename) {
    return 'snd_' + filename;
}

// 사운드 파일 하나 큐잉 (중복 로딩 방지, key 없으면 조용히 무시)
function queueSoundLoad(scene, filename) {
    if (!filename) return;
    const cacheKey = soundCacheKey(filename);
    if (scene.cache.audio.exists(cacheKey)) return;
    scene.load.audio(cacheKey, 'assets/sounds/' + filename);
}

window.BgmManager = {
    current: null,     // 현재 재생 중인 Sound 객체
    currentKey: null,  // 현재 재생 중인 트랙 파일명

    // filename: 사운드 파일명 (예: 'lobby.mp3'). null/undefined면 정지만 하고 끝.
    play(scene, filename, volume) {
        if (!filename) {
            this.stop();
            return;
        }

        // 이미 같은 곡이 재생 중이면 그대로 둔다 (씬 전환마다 끊기지 않게)
        if (this.currentKey === filename && this.current && this.current.isPlaying) {
            return;
        }

        this.stop();

        const cacheKey = soundCacheKey(filename);
        if (!scene.cache.audio.exists(cacheKey)) {
            console.warn(`[BgmManager] ${filename} 로딩 안 됨 - 재생 스킵`);
            return;
        }

        this.current = scene.sound.add(cacheKey, { loop: true, volume: volume != null ? volume : 0.4 });
        this.current.play();
        this.currentKey = filename;
    },

    stop() {
        if (this.current) {
            this.current.stop();
            this.current.destroy();
        }
        this.current = null;
        this.currentKey = null;
    },

    // 지금 재생 중인 곡의 반복을 끈다 - 즉시 끊지 않고 지금 재생 중인 구간은 끝까지
    // 자연스럽게 흘러간 뒤 처음으로 안 돌아가고 그대로 멈춤. 다음 씬이 play()로 새
    // 곡을 요청하면 그때 바로 교체되고, 새 곡을 안 정해서 이 곡이 계속 이어지는
    // 상황(예: battle_bgm 미설정 층, 탐험 씬)이어도 최소한 영원히 반복되진 않는다.
    stopLooping() {
        if (this.current) this.current.loop = false;
    },

    // 지금 재생 중인 곡을 durationMs에 걸쳐 서서히 볼륨을 낮추다가 완전히 멈춤
    // (보스/몬스터 처치 시 "옵션 켜짐"일 때 사용 - scene.tweens로 부드럽게 페이드)
    fadeOut(scene, durationMs = 1500) {
        if (!this.current) return;
        const sound = this.current;
        this.current = null;
        this.currentKey = null;
        scene.tweens.add({
            targets: sound,
            volume: 0,
            duration: durationMs,
            onComplete: () => sound.destroy()
        });
    },

    queueLoad(scene, filename) {
        queueSoundLoad(scene, filename);
    }
};

/**
 * AmbientManager - 배경음악(BgmManager)과 별개 채널로 동시에 겹쳐 재생되는 환경음
 * (바람소리/물소리 등 탐험 층 전용 루프) 전용 헬퍼. BgmManager와 완전히 똑같은 구조인데,
 * 굳이 따로 두는 이유는 이 둘이 서로 독립적으로 켜지고 꺼져야 하기 때문 -
 * 예: 탐험 층에서 나가면 환경음만 끊기고, 그 위에 깔려 있던 BGM은 계속 이어질 수 있다.
 */
window.AmbientManager = {
    current: null,
    currentKey: null,

    play(scene, filename, volume) {
        if (!filename) {
            this.stop();
            return;
        }
        if (this.currentKey === filename && this.current && this.current.isPlaying) {
            return;
        }
        this.stop();

        const cacheKey = soundCacheKey(filename);
        if (!scene.cache.audio.exists(cacheKey)) {
            console.warn(`[AmbientManager] ${filename} 로딩 안 됨 - 재생 스킵`);
            return;
        }

        this.current = scene.sound.add(cacheKey, { loop: true, volume: volume != null ? volume : 0.3 });
        this.current.play();
        this.currentKey = filename;
    },

    stop() {
        if (this.current) {
            this.current.stop();
            this.current.destroy();
        }
        this.current = null;
        this.currentKey = null;
    },

    queueLoad(scene, filename) {
        queueSoundLoad(scene, filename);
    }
};

/**
 * SfxHelper - 1회성 효과음(공격음, 텔레그래프음, 성공/실패음 등) 공용 헬퍼.
 * BGM과 달리 반복재생/전환 관리가 필요 없어 훨씬 단순하다.
 */
window.SfxHelper = {
    queueLoad(scene, filename) {
        queueSoundLoad(scene, filename);
    },

    // 즉시 재생 (로딩 안 됐으면 조용히 무시 - 게임이 절대 안 끊기게)
    // maxConcurrent: 이 사운드가 동시에 몇 개까지 겹쳐 재생될 수 있는지 상한.
    // 이미 그만큼 재생 중이면 이번 요청은 조용히 스킵 (다수 인원이 짧은 시간에
    // 같은 효과음을 터뜨릴 때 음량이 그대로 합산돼 과하게 커지는 걸 방지)
    play(scene, filename, volume, maxConcurrent) {
        if (!filename) return;
        const cacheKey = soundCacheKey(filename);
        if (!scene.cache.audio.exists(cacheKey)) {
            console.warn(`[SfxHelper] ${filename} 로딩 안 됨 - 재생 스킵`);
            return;
        }
        if (maxConcurrent) {
            const playing = scene.sound.getAll(cacheKey).filter(s => s.isPlaying).length;
            if (playing >= maxConcurrent) return;
        }
        scene.sound.play(cacheKey, { volume: volume != null ? volume : 0.7 });
    }
};
