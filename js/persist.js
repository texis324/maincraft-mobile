// --- 設定の永続化（localStorage） ---
// 既存グローバルと衝突しないよう、内部識別子は PERSIST_ プレフィックスに統一。
// 公開するのは loadSettings() / saveSettings() の2関数のみ。
//
// 読み込み順: index.html で mobile.js の後・main.js の前に置くこと。
//  - WORLD_SIZE / WORLD_DEPTH は main.js の generateWorld() より前に確定する必要がある。
//  - mobileLookSensitivity は mobile.js の top-level let なので mobile.js の後でないと TDZ になる。
// DOM は body 末尾 <script> なので、この時点で全コントロールが存在する。

const PERSIST_KEY = 'maincraft_settings_v1';

// 値表示 <span> を持つスライダーの対応表（id : 値表示span id / なければ null）
const PERSIST_SLIDERS = [
    { id: 'sensitivity',       span: null },
    { id: 'touch-sensitivity', span: null },
    { id: 'rocket-power',      span: 'rocket-power-value' },
    { id: 'nuke-power',        span: 'nuke-power-value' },
    { id: 'hbomb-power',       span: 'hbomb-power-value' },
    { id: 'map-size',          span: 'map-size-value' },
    { id: 'map-depth',         span: 'map-depth-value' }
];

function persistGetEl(id) { return document.getElementById(id); }

function persistReadStore() {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[persist] read failed:', e);
        return null;
    }
}

// 現在の設定を localStorage に保存
function saveSettings() {
    try {
        const data = {
            // グローバル値（live で使われるもの）
            mouseSensitivity: mouseSensitivity,
            mobileLookSensitivity: (typeof mobileLookSensitivity !== 'undefined' ? mobileLookSensitivity : null),
            rocketPower: rocketPower,
            nukePower: nukePower,
            hbombPower: hbombPower,
            radiationDose: (typeof radiationDose !== 'undefined' ? radiationDose : 0), // ☢ 一生モノの被爆量
            VIEW_DIST: VIEW_DIST,
            WORLD_DEPTH: WORLD_DEPTH,
            worldSeed: worldSeed, // 同じ地形を再現するため（再生成で更新される）
            // スライダーの生 value（UI 復元用）
            sliders: {},
            invincible: (function() {
                const c = persistGetEl('invincible');
                return c ? !!c.checked : true;
            })()
        };
        PERSIST_SLIDERS.forEach(s => {
            const el = persistGetEl(s.id);
            if (el) data.sliders[s.id] = el.value;
        });
        localStorage.setItem(PERSIST_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('[persist] save failed:', e);
    }
}

// --- プレイヤー改変(editsByChunk)の localStorage 保存・復元（リロードを跨いで建造物/クレーターを残す） ---
// worldSeed に紐付け（別シードの世界には適用しない）。サイズ上限つき＝近い順に詰めて溢れたら遠方を捨てる。
const EDITS_KEY = 'maincraft_edits_v1';
const MAX_PERSIST_EDITS = 60000;   // localStorage(~5MB)に収まる範囲。設置/採掘の per-block edit 用
const MAX_PERSIST_EVENTS = 2000;   // 爆発イベント(クレーター)の保存上限。1件が軽いので多めでも安全
let _editSaveTimer = null;

function saveEditsToStore() {
    try {
        if (window.__selfTesting) return;           // 自己テスト中はlocalStorageを汚さない
        if (typeof editsByChunk === 'undefined') return;
        const pcx = Math.floor(camera.position.x / 16), pcz = Math.floor(camera.position.z / 16);
        const cks = Object.keys(editsByChunk);
        // 近い順＝プレイヤーの手元の建造物が上限で切られても残る
        cks.sort((a, b) => {
            const pa = a.split(','), pb = b.split(',');
            const da = (pa[0] - pcx) * (pa[0] - pcx) + (pa[2] - pcz) * (pa[2] - pcz);
            const db = (pb[0] - pcx) * (pb[0] - pcx) + (pb[2] - pcz) * (pb[2] - pcz);
            return da - db;
        });
        const out = {};
        let count = 0;
        for (let i = 0; i < cks.length; i++) {
            const e = editsByChunk[cks[i]];
            const n = Object.keys(e).length;
            if (count + n > MAX_PERSIST_EDITS) break;
            out[cks[i]] = e; count += n;
        }
        // 爆発イベント(クレーター)も保存。1件=数値5個と軽いので直近 MAX_PERSIST_EVENTS 件まで丸ごと。
        const evs = (typeof explosionEvents !== 'undefined') ? explosionEvents.slice(-MAX_PERSIST_EVENTS) : [];
        localStorage.setItem(EDITS_KEY, JSON.stringify({ seed: worldSeed, edits: out, events: evs }));
    } catch (e) {
        console.warn('[persist] edit save failed (容量超過等・セッション中はメモリに残る):', e);
    }
}

// 連続改変(採掘/爆破)で毎回保存しないようデバウンス。setBlock から呼ばれる。
function scheduleEditSave() {
    if (window.__selfTesting) return;               // 自己テスト中は保存しない
    if (_editSaveTimer) clearTimeout(_editSaveTimer);
    _editSaveTimer = setTimeout(saveEditsToStore, 1500);
}

// generateWorld() が seedHouse の後（＝clearWorld で消えた後）に呼ぶ。同じシードの時だけ復元。
function loadPersistedEdits() {
    try {
        if (typeof editsByChunk === 'undefined') return;
        const raw = localStorage.getItem(EDITS_KEY);
        if (!raw) return;
        const store = JSON.parse(raw);
        if (!store || store.seed !== worldSeed) return;                // 別シードには適用しない
        if (store.edits) {
            for (const ck in store.edits) {
                const e = store.edits[ck];
                const dst = editsByChunk[ck] || (editsByChunk[ck] = {});
                for (const key in e) dst[key] = e[key];
            }
        }
        // 爆発イベント(クレーター)を復元。チャンク生成時に再カーブされる。
        if (Array.isArray(store.events) && typeof explosionEvents !== 'undefined') {
            for (let i = 0; i < store.events.length; i++) explosionEvents.push(store.events[i]);
        }
    } catch (e) {
        console.warn('[persist] edit load failed:', e);
    }
}

// localStorage から復元 → グローバル代入 + DOM 同期
function loadSettings() {
    const data = persistReadStore();

    // 自動保存リスナーは保存データの有無に関わらず常に付ける
    persistAttachAutoSave();

    if (!data) return; // 初回起動: 既定値のまま

    // 1) スライダーの value と 値表示span を復元
    PERSIST_SLIDERS.forEach(s => {
        if (s.id === 'map-size' || s.id === 'map-depth') return; // マップ系は「適用済みの値」を権威にするので後で別処理
        const el = persistGetEl(s.id);
        if (!el) return;
        const v = data.sliders ? data.sliders[s.id] : undefined;
        if (v !== undefined && v !== null) {
            el.value = v;
            if (s.span) {
                const spanEl = persistGetEl(s.span);
                if (spanEl) spanEl.textContent = v;
            }
        }
    });

    // 2) #invincible チェックボックス（player.js が live で .checked を読むので復元で十分）
    const inv = persistGetEl('invincible');
    if (inv && typeof data.invincible === 'boolean') inv.checked = data.invincible;

    // 3) グローバルへ反映。
    //    スライダー value が復元できているものは『value から再計算』して
    //    既存リスナーと同じ係数を使い、UI とグローバルの整合を保つ。
    const sens = persistGetEl('sensitivity');
    if (sens) {
        mouseSensitivity = sens.value * 0.0005;
    } else if (typeof data.mouseSensitivity === 'number') {
        mouseSensitivity = data.mouseSensitivity;
    }

    const touch = persistGetEl('touch-sensitivity');
    if (typeof mobileLookSensitivity !== 'undefined') {
        if (touch) {
            mobileLookSensitivity = touch.value * 0.001;
        } else if (typeof data.mobileLookSensitivity === 'number') {
            mobileLookSensitivity = data.mobileLookSensitivity;
        }
    }

    const rp = persistGetEl('rocket-power');
    if (rp) rocketPower = parseInt(rp.value);
    else if (typeof data.rocketPower === 'number') rocketPower = data.rocketPower;

    const np = persistGetEl('nuke-power');
    if (np) nukePower = parseInt(np.value);
    else if (typeof data.nukePower === 'number') nukePower = data.nukePower;

    const hp = persistGetEl('hbomb-power');
    if (hp) hbombPower = parseInt(hp.value);
    else if (typeof data.hbombPower === 'number') hbombPower = data.hbombPower;

    if (typeof data.radiationDose === 'number') radiationDose = data.radiationDose; // ☢ 過去の被爆を復元

    // VIEW_DIST(描画距離) / WORLD_DEPTH は「再生成で実際に適用された値」を権威にする。
    // スライダーを動かしただけ(未適用)の生valueで復元すると不一致が起きるため、適用済み値を使う。
    if (typeof data.VIEW_DIST === 'number') VIEW_DIST = data.VIEW_DIST;
    if (typeof data.WORLD_DEPTH === 'number') WORLD_DEPTH = data.WORLD_DEPTH;
    // 保存した地形シードを復元（main.js の generateWorld より前＝同じ地形が再現される）
    if (typeof data.worldSeed === 'number') worldSeed = data.worldSeed;
    // スライダー位置と値表示を、実際の描画距離に合わせる（ドラッグだけの未適用位置は捨てる）
    const msEl = persistGetEl('map-size');
    if (msEl) { msEl.value = VIEW_DIST; const sp = persistGetEl('map-size-value'); if (sp) sp.textContent = VIEW_DIST; }
    const mdEl = persistGetEl('map-depth');
    if (mdEl) { mdEl.value = WORLD_DEPTH; const sp = persistGetEl('map-depth-value'); if (sp) sp.textContent = WORLD_DEPTH; }
}

// 主要コントロールに自動保存リスナーを付与（既存ファイルへのフック不要）
let PERSIST_AUTOSAVE_ATTACHED = false;
function persistAttachAutoSave() {
    if (PERSIST_AUTOSAVE_ATTACHED) return;
    PERSIST_AUTOSAVE_ATTACHED = true;

    // スライダー: 'input' でリアルタイム保存
    PERSIST_SLIDERS.forEach(s => {
        const el = persistGetEl(s.id);
        if (el) el.addEventListener('input', saveSettings);
    });

    // #invincible チェックボックス: 'change' で保存
    const inv = persistGetEl('invincible');
    if (inv) inv.addEventListener('change', saveSettings);

    // マップ再生成ボタン: 押下後に WORLD_SIZE/WORLD_DEPTH を保存
    const regen = persistGetEl('btn-regenerate');
    if (regen) regen.addEventListener('click', saveSettings);

    // リロード/閉じる直前に改変を確実に書き出す（デバウンス待ちの取りこぼし防止）
    window.addEventListener('beforeunload', saveEditsToStore);
}

// --- トップレベル即時実行（main.js の generateWorld より前に WORLD_SIZE/DEPTH を確定） ---
loadSettings();
