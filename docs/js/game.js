/**
 * Phaser Game Configuration
 * Dungeon Raid - YouTube Live Interactive Game
 *
 * Game resolution: 1080x1920 (fixed)
 * Display: scales to fit container
 */

// Fixed game resolution (9:16 vertical)
const GAME_WIDTH = 1080;
const GAME_HEIGHT = 1920;

// Game configuration
const config = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    scene: [LobbyScene, DungeonEntryScene, ExploreScene, BattleScene],
    scale: {
        mode: Phaser.Scale.FIT,        // Fit to container, maintain aspect ratio
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    render: {
        pixelArt: false,
        antialias: true
    }
};

// 스킬 아이콘 (키 → 파일 경로)
window.SKILL_ICONS = {
    'skill_강타': 'assets/skillIcon/전사 공격 아이콘.png',
    'skill_방어': 'assets/skillIcon/전사 방어 아이콘.png',
    'skill_저격': 'assets/skillIcon/궁수 저격 아이콘.png',
    'skill_퇴격': 'assets/skillIcon/궁수 퇴격 아이콘.png',
    'skill_파이어볼': 'assets/skillIcon/법사 파이어볼 아이콘.png',
    'skill_역산': 'assets/skillIcon/법사 역산 아이콘.png',
    'skill_힐': 'assets/skillIcon/힐러 치유 아이콘.png',
    'skill_정화': 'assets/skillIcon/힐러 정화 아이콘.png'
};

// Global state
window.gameState = {
    phase: 'lobby',
    timer: 60,
    floor: 1
};

window.partyStats = {
    total: 0,
    warrior: 0,
    archer: 0,
    mage: 0,
    healer: 0
};

// Game resolution info
window.GAME_WIDTH = GAME_WIDTH;
window.GAME_HEIGHT = GAME_HEIGHT;

// 던전 전역 설정 (로비 BGM 등) - 기본값. 실제 값은 아래에서 서버로부터 받아 덮어씀
window.dungeonSounds = {};
window.dungeonMinPlayers = 1;
window.dungeonSoundFiles = [];
window.skillVfx = {};
window.dungeonLanguage = 'ko';

// Start game when page loads (폰트 로딩 + 던전 전역 설정 로딩 후)
window.addEventListener('load', () => {
    console.log(`🎮 Dungeon Raid - 폰트/던전 설정 로딩 중...`);

    const fontsReady = document.fonts.ready;
    // 실서버(Flask)가 있으면 /api/dungeon_meta로 받고, 없는 정적 배포(GitHub Pages의
    // demo.html 등)에서는 이 fetch가 404/네트워크 에러로 실패하므로 미리 만들어둔
    // 정적 사본(assets/demo/dungeon_meta.json)으로 폴백한다
    const metaReady = fetch('/api/dungeon_meta')
        .then(r => { if (!r.ok) throw new Error('no /api/dungeon_meta (static hosting)'); return r.json(); })
        // 캐시 버스터(?v=타임스탬프) - GitHub Pages/브라우저가 이 정적 JSON을 오래 캐싱해두면
        // 던전 설정(언어·사운드 목록 등)을 고쳐도 한동안 예전 값이 계속 나올 수 있어서 방지
        .catch(() => fetch('assets/demo/dungeon_meta.json?v=' + Date.now()).then(r => r.json()))
        .then(meta => {
            window.dungeonSounds = meta.sounds || {};
            window.dungeonMinPlayers = meta.min_players || 1;
            window.dungeonSoundFiles = meta.sound_files || [];
            window.skillVfx = meta.skill_vfx || {};
            window.dungeonLanguage = meta.language || 'ko';
        })
        .catch(err => {
            console.warn('[Boot] 던전 설정 로딩 실패 (사운드 없이 진행):', err);
        });

    // 폰트 + 던전 설정 둘 다 준비된 후 게임 시작
    // (로비 씬이 preload()에서 window.dungeonSounds.lobby_bgm을 바로 참조하므로 먼저 와 있어야 함)
    Promise.all([fontsReady, metaReady]).then(() => {
        console.log(`✅ 준비 완료`);
        console.log(`🎮 Dungeon Raid Starting... (${GAME_WIDTH}x${GAME_HEIGHT})`);
        window.game = new Phaser.Game(config);
        if (document.hidden) window.game.sound.mute = true;
    });
});

// 탭이 백그라운드에 가 있는 동안에도 서버 이벤트(공격/몬스터 공격 등)는 계속 도착해서 쌓이고,
// 탭으로 돌아오는 순간 그게 한꺼번에 처리되며 사운드가 전부 겹쳐 터지는 문제 방지.
//
// 탭이 숨겨져 있는 동안 Phaser의 내부 시계(scene.time, requestAnimationFrame 기반)는 멈추지만
// 소켓 메시지 핸들러(showAttackBatch 등)는 rAF와 무관하게 계속 실행돼서, 각 공격 틱마다
// 예약해두는 this.time.delayedCall들이 "재생 대기" 상태로 계속 쌓인다. 탭이 다시 보이는
// 순간 시계가 재개되면 밀려있던 delayedCall이 전부 한꺼번에(같은 프레임에서) 발동돼
// 사운드가 무더기로 시작된다 - 음소거만으로는 안 막아지는 이유는, 이 사운드들이 음소거
// 중에도 일단 "재생 시작"은 되어 버려서(그냥 무음으로 재생 중) unmute 하는 순간 그때까지
// 재생 중이던 소리들이 한꺼번에 들리게 되기 때문. 그래서 unmute 직전에 그 사이 몰래
// 재생되기 시작한 효과음들을 전부 끊어버린 뒤에야 음소거를 푼다.
// BGM(BgmManager.current)은 stopAll()로 같이 끊기면 알탭할 때마다 처음부터 다시 재생돼
// 버려서 제외하고, 나머지(효과음)만 골라서 끊는다.
function stopBacklogSfx() {
    if (!window.game || !window.game.sound) return;
    const bgm = window.BgmManager && window.BgmManager.current;
    window.game.sound.sounds.forEach(s => {
        if (s !== bgm && s.isPlaying) s.stop();
    });
}

let _unmuteTimer = null;
document.addEventListener('visibilitychange', () => {
    if (!window.game || !window.game.sound) return;
    clearTimeout(_unmuteTimer);
    if (document.hidden) {
        window.game.sound.mute = true;
        stopBacklogSfx();  // 숨겨지는 순간 재생 중이던 효과음도 정리
    } else {
        _unmuteTimer = setTimeout(() => {
            // 밀려있던 delayedCall들이 몰아서 발동되며 (무음으로) 재생을 시작해뒀을 수
            // 있는 효과음들을 전부 끊어낸 다음에 음소거를 푼다 - 그래야 그 백로그가 갑자기
            // 한꺼번에 들리지 않고, 이 시점 이후 정상적으로 도착하는 소리만 들린다
            stopBacklogSfx();
            if (window.game && window.game.sound) window.game.sound.mute = false;
        }, 500);
    }
});
