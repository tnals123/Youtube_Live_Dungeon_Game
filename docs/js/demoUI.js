/**
 * DemoUI - demo.html 전용 조작 버튼 바
 * Phaser 캔버스 위에 그리지 않고, 캔버스 아래 별도 DOM 영역에 버튼을 띄운다.
 * (캔버스는 FIT 스케일로 크기가 계속 바뀌므로, 그 위에 정확히 겹치는 버튼을
 * 만드는 것보다 이 방식이 훨씬 안정적이다)
 */
window.DemoUI = {
    el: null,

    init() {
        this.el = document.getElementById('demo-controls');
    },

    hideAll() {
        if (!this.el) return;
        this.el.innerHTML = '';
        this.el.classList.remove('visible');
    },

    _show(html) {
        if (!this.el) return;
        this.el.innerHTML = html;
        this.el.classList.add('visible');
    },

    showExploreChoice(options, onChoose) {
        this._show(`
            <div class="demo-hint">🧭 어느 쪽으로 갈까요? 직접 골라보세요</div>
            <div class="demo-btn-row">
                ${options.map(opt => `<button class="demo-btn demo-btn-choice" data-opt="${opt}">${opt === '/왼쪽' ? '⬅️ 왼쪽' : '➡️ 오른쪽'}</button>`).join('')}
            </div>
        `);
        this.el.querySelectorAll('.demo-btn-choice').forEach(btn => {
            btn.addEventListener('click', () => {
                this.el.querySelectorAll('.demo-btn-choice').forEach(b => b.disabled = true);
                onChoose(btn.dataset.opt);
            });
        });
    },

    hideExploreChoice() {
        if (this.el && this.el.querySelector('.demo-btn-choice')) this.hideAll();
    },

    showSkillButton(you, onAct) {
        const role = you.role;
        const buttons = role === 'healer'
            ? [{ label: '💚 힐 사용', act: 'heal' }, { label: '🌿 정화 사용', act: 'attack' }]
            : [{ label: `${{warrior:'🗡️',archer:'🎯',mage:'🔥'}[role]} ${{warrior:'강타',archer:'저격',mage:'파이어볼'}[role]} 사용`, act: 'attack' }];

        this._show(`
            <div class="demo-hint">당신은 <b>${you.grade_name} ${you.role_name}</b>입니다! 버튼을 눌러 몬스터를 공격하세요</div>
            <div class="demo-btn-row">
                ${buttons.map((b, i) => `<button class="demo-btn demo-btn-skill" data-act="${b.act}">${b.label}</button>`).join('')}
            </div>
        `);
        this.el.querySelectorAll('.demo-btn-skill').forEach(btn => {
            btn.addEventListener('click', () => onAct(btn.dataset.act));
        });
    },

    hideSkillButton() {
        if (this.el && this.el.querySelector('.demo-btn-skill')) this.hideAll();
    },

    showRestart() {
        this._show(`
            <div class="demo-hint">데모 플레이가 끝났습니다</div>
            <div class="demo-btn-row">
                <button class="demo-btn demo-btn-restart">🔁 다시 플레이</button>
            </div>
        `);
        this.el.querySelector('.demo-btn-restart').addEventListener('click', () => {
            window.gameSocket.restart();
        });
    }
};

window.addEventListener('DOMContentLoaded', () => window.DemoUI.init());
