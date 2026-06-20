// --- AI 陣営戦（赤軍 vs 青軍） ---
// 「召喚すると赤軍と青軍が左右から湧いて会戦＝近接で殴り合う」。地形は壊さない（侵食なし＝シンプルに戦うだけ）。
// プレイヤーの爆発（ミサイル/核/TNT等）でも倒せる（killAgentsInRadius を explode から呼ぶ）。
// 性能対策が肝（数百体でも軽い）なので以下を徹底:
//   ① 描画＝THREE.InstancedMesh（全ユニットを1ドローコール）＋ setColorAt で陣営色を per-instance 着色
//   ② 思考＝ラウンドロビン（1フレームに数体だけ「最寄りの敵を索敵」、残りは惰性で前進）
//   ③ 距離カリング＝ロード済み領域(VIEW_DIST)の外に出たユニットは消滅（落下し続ける無駄を防ぐ）
// 戦闘は近接melee のみ（核なし）。地形の掘削/破壊は一切しない（壁は1段差なら登り、それ以上は横へ回り込む）。

const AGENT_MAX = 260;            // 同時生存上限（描画/思考の予算上限）
const AGENT_WAVE = 28;            // 召喚1回で出す総数（赤14＋青14で会戦になる）
const AGENT_THINK_BUDGET = 14;    // 1フレームに「索敵」するユニット数（ラウンドロビン）
const AGENT_SPEED = 4.2;          // 水平移動速度
const AGENT_GRAVITY = 24.0;
const AGENT_H = 1.7;             // 見た目の高さ
let _agentDeathFxCD = 0;         // 戦死パフの throttle（大量死で破片スパイクを防ぐ）

// --- 陣営戦パラメータ ---
const AGENT_HP = 6;               // 各兵のHP
const AGENT_SIGHT = 64;           // 索敵半径（召喚時の左右間隔 ≤56 を見渡せる＝湧いた瞬間に進軍開始）
const AGENT_SIGHT2 = AGENT_SIGHT * AGENT_SIGHT;
const AGENT_ATK_RANGE = 1.7;      // 近接攻撃の射程（水平距離）
const AGENT_ATK_DMG = 2;          // 1撃のダメージ（HP6 ⇒ 3発で撃破）
const AGENT_ATK_CD = 0.5;         // 攻撃クールダウン（秒）

// 障害物回避: 進行方向(heading)が塞がれていたら、左右にこの角度オフセット順で候補を試し
// 最初に通れる方向へ動く＝壁際でその場ふらつき(つっかえ)せず必ず迂回して前進する。
// turnDir で各兵の「好む回り込み側」を分け、みんなが同じ側に寄って団子化するのを防ぐ。
const _AGENT_AVOID_R = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4];
const _AGENT_AVOID_L = [0, -0.5, 0.5, -1.0, 1.0, -1.6, 1.6, -2.4, 2.4];

// 陣営色（per-instance tint）。本体テクスチャを明るめグレーにしてあるので tint が鮮やかに乗る。
const _cRed = new THREE.Color(1.0, 0.22, 0.18);   // 赤軍
const _cBlue = new THREE.Color(0.30, 0.55, 1.0);  // 青軍
const _cWhite = new THREE.Color(1, 1, 1);          // 被弾フラッシュ
const _cTmp = new THREE.Color();

// 各エージェント: { x,y,z(float世界座標), vy, heading(ラジアン), grounded, turnDir(±1),
//                   faction(0=赤/1=青), hp, target(敵エージェント参照|null), atkCd, hitFlash, alive }
const agents = [];
let agentMesh = null;            // THREE.InstancedMesh
let _agentThinkPtr = 0;
const _agentDummy = new THREE.Object3D();

function createAgentTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#9aa0a8'; x.fillRect(0, 0, 32, 32);                 // 明るめの金属の胴体（陣営tintが鮮やかに乗る）
    x.fillStyle = '#6b7077'; for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 2, 32); // パネルライン
    // 軍隊っぽいヘルメット（上部にドーム＋暗いブリム）。tint で陣営色のヘルメットになる。
    x.fillStyle = '#5f656d'; x.fillRect(0, 0, 32, 9);                 // ヘルメットのドーム（胴体より暗い）
    x.fillStyle = '#2f3236'; x.fillRect(0, 9, 32, 2);                 // ブリム（縁の暗い線）
    x.fillStyle = '#ffffff'; x.fillRect(8, 14, 5, 5); x.fillRect(19, 14, 5, 5); // 光る目（ブリムの下・tintで陣営色）
    x.fillStyle = '#2b2d31'; x.fillRect(11, 23, 10, 3);              // 口（暗い線）
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

function initAgentMesh() {
    if (agentMesh) return;
    const geo = new THREE.BoxGeometry(0.7, AGENT_H, 0.7);
    const mat = new THREE.MeshLambertMaterial({ map: createAgentTexture() });
    agentMesh = new THREE.InstancedMesh(geo, mat, AGENT_MAX);
    agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    agentMesh.frustumCulled = false; // 自前で距離カリングするので常時描画（1ドローコール）
    // ⚠ instanceColor は count=0 にする前に AGENT_MAX サイズで明示確保する。r128 の setColorAt は
    //   「呼んだ瞬間の count」で Float32Array(3*count) を一度だけ確保し二度と作り直さない。count=0 で
    //   先に呼ぶと長さ0配列になり、以降の陣営色(赤/青tint)書き込みが全てサイレント無視される（敵対監査で発見）。
    agentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(AGENT_MAX * 3), 3);
    agentMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    agentMesh.count = 0;
    scene.add(agentMesh);
}

// 1体を生成して返す（summon と selftest が共用）。
function _makeAgent(x, y, z, faction, heading) {
    return {
        x: x, y: y, z: z, vy: 0,
        heading: (heading === undefined) ? Math.random() * Math.PI * 2 : heading,
        grounded: false, turnDir: Math.random() < 0.5 ? 1 : -1,
        faction: faction, hp: AGENT_HP, target: null,
        atkCd: Math.random() * AGENT_ATK_CD, hitFlash: 0, alive: true
    };
}

// プレイヤーの左右に赤軍・青軍を同時召喚＝中央で会戦になる。連打で増援（上限まで）。
function summonLegion() {
    initAgentMesh();
    const px = camera.position.x, pz = camera.position.z;
    let spawned = 0;
    const perSide = Math.floor(AGENT_WAVE / 2);
    for (let f = 0; f < 2; f++) {
        const baseAng = (f === 0) ? Math.PI : 0;   // 赤=西、青=東
        for (let i = 0; i < perSide && agents.length < AGENT_MAX; i++) {
            const ang = baseAng + (Math.random() - 0.5) * 1.2; // 自陣側の弧にばらける
            const r = 16 + Math.random() * 12;
            const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
            const top = columnTopY(Math.floor(x), Math.floor(z));
            const y = Math.max(top, SEA_LEVEL) + 1;
            // 初期向きは中央（敵陣）へ＝湧いた瞬間から進軍
            agents.push(_makeAgent(x, y, z, f, baseAng + Math.PI + (Math.random() - 0.5) * 0.4));
            spawned++;
        }
    }
    if (spawned > 0 && typeof playSound === 'function') playSound('ignite');
    return spawned;
}

function clearAgents() {
    agents.length = 0;
    if (agentMesh) agentMesh.count = 0;
}

// プレイヤーの爆発（ミサイル/核/TNT/ロケット等）が兵を巻き込んだら倒す。explode から呼ばれる。
// 半径内は即死（爆発は致死）。updateAgents が次フレームで除去＆破片パフを出す。
function killAgentsInRadius(cx, cy, cz, radius) {
    if (!agents.length) return 0;
    const r2 = radius * radius;
    let killed = 0;
    for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.alive) continue;
        const dx = a.x - cx, dy = a.y - cy, dz = a.z - cz;
        if (dx * dx + dy * dy + dz * dz <= r2) { a.hp = 0; a.alive = false; killed++; }
    }
    return killed;
}

function _agentSolid(x, y, z) {
    const t = getBlock(x, y, z);
    return t && !(BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide);
}

function updateAgents(delta) {
    if (!agentMesh || agents.length === 0) { if (agentMesh) agentMesh.count = 0; return; }
    if (_agentDeathFxCD > 0) _agentDeathFxCD -= delta;
    const dt = Math.min(delta, 0.05);
    const px = camera.position.x, pz = camera.position.z;
    const cull = VIEW_DIST * 16; // ロード済み領域の外に出たら消滅（getBlock=0 で落下し続ける無駄を防ぐ）

    // ① 索敵（ラウンドロビン）: 予算分だけ「最寄りの敵陣ユニット」を target に。敵が居なければ徘徊向きを散らす。
    const nThink = agents.length;
    const thinkN = Math.min(AGENT_THINK_BUDGET, nThink);
    for (let k = 0; k < thinkN; k++) {
        const a = agents[(_agentThinkPtr + k) % nThink];
        if (!a || !a.alive) continue;
        let best = null, bestD = AGENT_SIGHT2;
        for (let j = 0; j < nThink; j++) {
            const b = agents[j];
            if (!b || !b.alive || b.faction === a.faction) continue;
            const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
            const d = dx * dx + dz * dz + dy * dy * 0.5; // 縦は半分重み（高低差は越えやすい）
            if (d < bestD) { bestD = d; best = b; }
        }
        a.target = best;
        if (!best && Math.random() < 0.5) a.heading += (Math.random() - 0.5) * 1.6; // 敵不在＝ふらつき徘徊
    }
    _agentThinkPtr = (_agentThinkPtr + thinkN) % Math.max(1, nThink);

    // ② 移動＋戦闘（全エージェント・軽い処理）
    for (let i = agents.length - 1; i >= 0; i--) {
        const a = agents[i];
        // 戦死 / 距離カリング / 奈落落下で消滅（参照されても無効と分かるよう alive を倒してから splice）
        if (!a.alive || a.hp <= 0) {
            a.alive = false;
            if (_agentDeathFxCD <= 0 && typeof createBlockParticles === 'function') {
                _agentDeathFxCD = 0.08; createBlockParticles(a.x, a.y, a.z, BLOCKS.STONE, 2, 0.14);
            }
            agents.splice(i, 1); continue;
        }
        if (Math.abs(a.x - px) > cull || Math.abs(a.z - pz) > cull || a.y < worldBottomY + 1) {
            a.alive = false; agents.splice(i, 1); continue;
        }
        if (a.hitFlash > 0) a.hitFlash -= dt;
        if (a.atkCd > 0) a.atkCd -= dt;

        // 重力＋接地
        a.vy -= AGENT_GRAVITY * dt;
        if (a.vy < -45) a.vy = -45;
        const fx = Math.floor(a.x), fz = Math.floor(a.z);
        const below = Math.floor(a.y) - 1;
        a.grounded = false;
        if (a.vy <= 0 && _agentSolid(fx, below, fz)) {
            a.y = below + 1; a.vy = 0; a.grounded = true; // 足元ブロックの上に立つ
        } else {
            a.y += a.vy * dt;
        }

        // 敵を捕捉していれば、その方向を向く。射程内なら殴る（engaged＝前進せず白兵戦）。
        let tgt = a.target;
        if (tgt && (!tgt.alive || tgt.hp <= 0)) tgt = a.target = null;
        let engaged = false;
        if (tgt) {
            const dxt = tgt.x - a.x, dzt = tgt.z - a.z, dyt = tgt.y - a.y;
            const distH = Math.sqrt(dxt * dxt + dzt * dzt);
            a.heading = Math.atan2(dzt, dxt); // 敵を追尾（毎フレーム向き直し＝滑らかに追う）
            if (distH <= AGENT_ATK_RANGE && Math.abs(dyt) <= 2.2) {
                engaged = true;
                if (a.atkCd <= 0 && a.grounded) {
                    a.atkCd = AGENT_ATK_CD;
                    tgt.hp -= AGENT_ATK_DMG;
                    tgt.hitFlash = 0.2;
                    tgt.vy = Math.max(tgt.vy, 2.5);                 // 被弾で軽くのけぞる
                    const inv = 1 / (distH || 1);
                    tgt.x += dxt * inv * 0.1; tgt.z += dzt * inv * 0.1; // 小ノックバック
                }
            }
        }

        // 水平移動（接地時＆非engaged）。進行方向が塞がれていたら左右に振った候補から通れる方を選ぶ＝
        // 壁際でつっかえず必ず迂回。a.heading（＝敵/徘徊の向き＝顔の向き）は変えず、移動方向だけ振る。
        if (a.grounded && !engaged) {
            const fy = Math.floor(a.y);
            const offs = a.turnDir > 0 ? _AGENT_AVOID_R : _AGENT_AVOID_L;
            let moved = false;
            for (let o = 0; o < offs.length; o++) {
                const h = a.heading + offs[o];
                const hx = Math.cos(h), hz = Math.sin(h);
                const nx = a.x + hx * AGENT_SPEED * dt, nz = a.z + hz * AGENT_SPEED * dt;
                const bx = Math.floor(nx + hx * 0.4), bz = Math.floor(nz + hz * 0.4);
                if (!_agentSolid(bx, fy, bz)) { a.x = nx; a.z = nz; moved = true; break; }       // その方向は空いてる
                if (!_agentSolid(bx, fy + 1, bz) && !_agentSolid(bx, fy + 2, bz)) {              // 1段差は登る
                    a.y += 1; a.x = nx; a.z = nz; moved = true; break;
                }
            }
            // どの方向も塞がれている（穴/箱詰め）＝向きを反転して脱出を試みる
            if (!moved) { a.heading += Math.PI + (Math.random() - 0.5); a.turnDir = -a.turnDir; }
        }
    }

    // ③ インスタンス行列＋陣営色を書き込み（1ドローコール）
    const n = Math.min(agents.length, AGENT_MAX);
    for (let i = 0; i < n; i++) {
        const a = agents[i];
        _agentDummy.position.set(a.x, a.y - 0.5 + AGENT_H * 0.5, a.z); // 足元を地表に接地させる
        _agentDummy.rotation.set(0, -a.heading + Math.PI / 2, 0);
        _agentDummy.updateMatrix();
        agentMesh.setMatrixAt(i, _agentDummy.matrix);
        _cTmp.copy(a.faction === 0 ? _cRed : _cBlue);
        if (a.hitFlash > 0) _cTmp.lerp(_cWhite, Math.min(1, a.hitFlash * 4)); // 被弾で白フラッシュ
        agentMesh.setColorAt(i, _cTmp);
    }
    agentMesh.count = n;
    agentMesh.instanceMatrix.needsUpdate = true;
    if (agentMesh.instanceColor) agentMesh.instanceColor.needsUpdate = true;
}
