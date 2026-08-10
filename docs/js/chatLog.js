/**
 * ChatLog - demo.html 전용 가짜 유튜브 라이브 채팅 로그
 * 실제 게임은 시청자들이 유튜브 채팅에 /참가, /왼쪽, /강타 같은 명령어를 쳐서
 * 진행된다. 데모에서도 LocalGameMaster가 봇을 "행동"시킬 때마다 그 명령어를
 * 여기에도 같이 찍어서, 실제로 채팅으로 진행되는 라이브 게임처럼 보이게 한다.
 */
window.ChatLog = {
    el: null,
    _colors: ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6BCB77', '#4D96FF', '#C780FA', '#FF922B', '#38D9A9'],
    _colorMap: {},

    init() {
        this.el = document.getElementById('chat-messages');
    },

    _colorFor(name) {
        if (!this._colorMap[name]) {
            const idx = Object.keys(this._colorMap).length % this._colors.length;
            this._colorMap[name] = this._colors[idx];
        }
        return this._colorMap[name];
    },

    // 시청자(봇/당신)의 채팅 명령어 한 줄
    post(name, text, opts) {
        if (!this.el) return;
        opts = opts || {};
        const color = opts.you ? '#FFD700' : this._colorFor(name);

        const row = document.createElement('div');
        row.className = 'chat-msg' + (opts.you ? ' chat-you' : '');

        const avatar = document.createElement('span');
        avatar.className = 'chat-avatar';
        avatar.style.background = color;
        avatar.textContent = name.charAt(0);

        const nameEl = document.createElement('span');
        nameEl.className = 'chat-name';
        nameEl.style.color = color;
        nameEl.textContent = name + ':';

        const textEl = document.createElement('span');
        textEl.className = 'chat-text';
        textEl.textContent = text;

        row.appendChild(avatar);
        row.appendChild(nameEl);
        row.appendChild(textEl);
        this._append(row);
    },

    // 시스템 안내 문구 (페이즈 전환 등) - 가운데 정렬, 다른 스타일
    postSystem(text) {
        if (!this.el) return;
        const row = document.createElement('div');
        row.className = 'chat-system';
        row.textContent = text;
        this._append(row);
    },

    _append(row) {
        this.el.appendChild(row);
        while (this.el.children.length > 60) this.el.removeChild(this.el.firstChild);
        this.el.scrollTop = this.el.scrollHeight;
    },

    clear() {
        if (this.el) this.el.innerHTML = '';
    }
};

window.addEventListener('DOMContentLoaded', () => window.ChatLog.init());
