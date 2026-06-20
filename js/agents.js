// --- AI 陣営戦（赤軍 vs 青軍・銃で撃ち合い） ---
// 「召喚すると赤軍と青軍が左右から湧いて会戦＝銃で撃ち合う」。地形は壊さない（侵食なし）。
// プレイヤーの爆発（ミサイル/核/TNT等）でも倒せる（killAgentsInRadius を explode から呼ぶ）。
// 性能対策が肝（数百体でも軽い）:
//   ① 描画＝本体＋銃を各1つの THREE.InstancedMesh（合計2ドローコール）＋ setColorAt で陣営色
//   ② 思考＝ラウンドロビン（1フレームに数体だけ最寄り敵を索敵）
//   ③ 射撃＝ヒットスキャン（命中判定は即時）＋プールした曳光弾(tracer・LineSegments 1ドローコール)。
//      射線(LOS)判定の voxelRaycast は「発射クールダウン時だけ」走らせてレイ数を抑える。
//   ④ 距離カリング＝ロード済み領域(VIEW_DIST)の外のユニットは消滅。

const AGENT_MAX = 260;            // 同時生存上限
const AGENT_WAVE = 28;            // 召喚1回で出す総数（赤14＋青14）
const AGENT_THINK_BUDGET = 14;    // 1フレームに索敵するユニット数（ラウンドロビン）
const AGENT_SPEED = 4.2;          // 水平移動速度
const AGENT_GRAVITY = 24.0;
const AGENT_H = 1.7;             // 見た目の高さ
let _agentDeathFxCD = 0;         // 戦死パフの throttle

// --- 射撃パラメータ ---
const AGENT_HP = 6;               // 各兵のHP
const AGENT_SIGHT = 64;           // 索敵半径
const AGENT_SIGHT2 = AGENT_SIGHT * AGENT_SIGHT;
const AGENT_FIRE_RANGE = 20;      // 射撃の射程（これ以内＆LOSが通れば停止して撃つ）
const AGENT_FIRE_CD = 0.6;        // 発射間隔（秒・±ジッタ）
const AGENT_FIRE_DMG = 2;         // 命中1発のダメージ（HP6 ⇒ 3発で撃破）
const AGENT_ACCURACY = 0.55;      // 命中率（外れ弾も曳光弾だけ飛ぶ＝撃ち合いが長持ち＆賑やか）
const AGENT_LOS_RECHECK = 0.2;    // LOS が通らない時の再判定間隔（壁の陰なら前進して回り込む）

// 障害物回避: 進行方向が塞がれたら左右に角度を振った候補から通れる方へ＝壁際でつっかえず迂回。
const _AGENT_AVOID_R = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4];
const _AGENT_AVOID_L = [0, -0.5, 0.5, -1.0, 1.0, -1.6, 1.6, -2.4, 2.4];

// 陣営色（per-instance tint）。本体テクスチャを明るめグレーにしてあるので tint が鮮やかに乗る。
const _cRed = new THREE.Color(1.0, 0.22, 0.18);   // 赤軍
const _cBlue = new THREE.Color(0.30, 0.55, 1.0);  // 青軍
const _cWhite = new THREE.Color(1, 1, 1);          // 被弾フラッシュ
const _cTmp = new THREE.Color();

// LOS 判定用の使い回しベクトル（毎回 new しない＝GC回避）
const _losO = new THREE.Vector3();
const _losD = new THREE.Vector3();

// 各エージェント: { x,y,z, vy, heading, grounded, turnDir(±1),
//                   faction(0=赤/1=青), hp, target, fireCd, hasLos, hitFlash, alive }
const agents = [];
let agentMesh = null;            // 本体 InstancedMesh
let gunMesh = null;              // 銃 InstancedMesh
let _agentThinkPtr = 0;
const _agentDummy = new THREE.Object3D();
const _gunDummy = new THREE.Object3D();

// --- 曳光弾（tracer）プール: 全弾を1つの LineSegments で描く（1ドローコール） ---
const TRACER_MAX = 512;
const TRACER_LIFE = 0.09;        // 一瞬光って消える（秒）
const tracers = [];              // {x0,y0,z0,x1,y1,z1, life, r,g,b}
let tracerLines = null, tracerGeo = null;
const _tracerPos = new Float32Array(TRACER_MAX * 6);
const _tracerCol = new Float32Array(TRACER_MAX * 6);

function createAgentTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#9aa0a8'; x.fillRect(0, 0, 32, 32);                 // 明るめの金属の胴体
    x.fillStyle = '#6b7077'; for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 2, 32); // パネルライン
    // 軍隊っぽいヘルメット（上部にドーム＋暗いブリム）。tint で陣営色のヘルメットになる。
    x.fillStyle = '#5f656d'; x.fillRect(0, 0, 32, 9);                 // ヘルメットのドーム
    x.fillStyle = '#2f3236'; x.fillRect(0, 9, 32, 2);                 // ブリム
    x.fillStyle = '#ffffff'; x.fillRect(8, 14, 5, 5); x.fillRect(19, 14, 5, 5); // 光る目
    x.fillStyle = '#2b2d31'; x.fillRect(11, 23, 10, 3);              // 口
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

function initTracers() {
    if (tracerLines) return;
    tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(_tracerPos, 3));
    tracerGeo.setAttribute('color', new THREE.BufferAttribute(_tracerCol, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
    tracerLines = new THREE.LineSegments(tracerGeo, mat);
    tracerLines.frustumCulled = false;
    tracerGeo.setDrawRange(0, 0);
    scene.add(tracerLines);
}

function initAgentMesh() {
    if (agentMesh) return;
    // 本体
    const geo = new THREE.BoxGeometry(0.7, AGENT_H, 0.7);
    const mat = new THREE.MeshLambertMaterial({ map: createAgentTexture() });
    agentMesh = new THREE.InstancedMesh(geo, mat, AGENT_MAX);
    agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    agentMesh.frustumCulled = false; // 自前で距離カリング（1ドローコール）
    // ⚠ instanceColor は count=0 にする前に AGENT_MAX サイズで明示確保する。r128 の setColorAt は
    //   「呼んだ瞬間の count」で Float32Array(3*count) を一度だけ確保し作り直さない。count=0 で先に呼ぶと
    //   長さ0配列になり、以降の陣営色書き込みが全てサイレント無視される（敵対監査で発見）。
    agentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(AGENT_MAX * 3), 3);
    agentMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    agentMesh.count = 0;
    scene.add(agentMesh);
    // 銃（細長い箱・暗いガンメタル）
    const ggeo = new THREE.BoxGeometry(0.14, 0.14, 0.85);
    const gmat = new THREE.MeshLambertMaterial({ color: 0x26292e });
    gunMesh = new THREE.InstancedMesh(ggeo, gmat, AGENT_MAX);
    gunMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    gunMesh.frustumCulled = false;
    gunMesh.count = 0;
    scene.add(gunMesh);
    initTracers();
}

// 1体を生成して返す（summon と selftest が共用）。
function _makeAgent(x, y, z, faction, heading) {
    return {
        x: x, y: y, z: z, vy: 0,
        heading: (heading === undefined) ? Math.random() * Math.PI * 2 : heading,
        grounded: false, turnDir: Math.random() < 0.5 ? 1 : -1,
        faction: faction, hp: AGENT_HP, target: null,
        fireCd: Math.random() * AGENT_FIRE_CD, hasLos: false, hitFlash: 0, alive: true
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
            const ang = baseAng + (Math.random() - 0.5) * 1.2;
            const r = 16 + Math.random() * 12;
            const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
            const top = columnTopY(Math.floor(x), Math.floor(z));
            const y = Math.max(top, SEA_LEVEL) + 1;
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
    if (gunMesh) gunMesh.count = 0;
    tracers.length = 0;
    if (tracerGeo) tracerGeo.setDrawRange(0, 0);
}

// プレイヤーの爆発（ミサイル/核/TNT/ロケット等）が兵を巻き込んだら倒す。explode から呼ばれる。
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

// 射線（LOS）: 撃つ兵の銃口から敵の胸へ地形が遮っていないか。water は通す(hitWater=false)。
function _agentLOS(a, tgt) {
    const ox = a.x, oy = a.y + 0.95, oz = a.z;
    const ddx = tgt.x - ox, ddy = (tgt.y + 0.9) - oy, ddz = tgt.z - oz;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    if (dist < 0.001) return true;
    _losO.set(ox, oy, oz);
    _losD.set(ddx / dist, ddy / dist, ddz / dist);
    return !voxelRaycast(_losO, _losD, dist - 0.6, false); // 目標手前で打ち切り（目標自身のセルを誤検出しない）
}

// 1発撃つ: 命中率で当たり/外れ。当たりはダメージ＋目標へ曳光弾、外れは少しズレた点へ曳光弾。
function _agentFire(a, tgt) {
    const h = a.heading;
    const mx = a.x + Math.cos(h) * 0.7, my = a.y + 0.95, mz = a.z + Math.sin(h) * 0.7; // 銃口
    let ex, ey, ez;
    if (Math.random() < AGENT_ACCURACY) {
        tgt.hp -= AGENT_FIRE_DMG; tgt.hitFlash = 0.15;
        ex = tgt.x; ey = tgt.y + 0.9; ez = tgt.z;
    } else {
        ex = tgt.x + (Math.random() - 0.5) * 3.0; ey = tgt.y + 0.9 + (Math.random() - 0.5) * 1.6; ez = tgt.z + (Math.random() - 0.5) * 3.0;
    }
    addTracer(mx, my, mz, ex, ey, ez, a.faction);
}

function addTracer(x0, y0, z0, x1, y1, z1, faction) {
    if (tracers.length >= TRACER_MAX) tracers.shift(); // 上限超えたら古いのを捨てる
    // 陣営色の明るい曳光弾（赤軍=橙赤、青軍=シアン）
    const r = faction === 0 ? 1.0 : 0.45, g = faction === 0 ? 0.45 : 0.8, b = faction === 0 ? 0.2 : 1.0;
    tracers.push({ x0: x0, y0: y0, z0: z0, x1: x1, y1: y1, z1: z1, life: TRACER_LIFE, r: r, g: g, b: b });
}

function updateTracers(dt) {
    if (!tracerLines) return;
    for (let i = tracers.length - 1; i >= 0; i--) { if ((tracers[i].life -= dt) <= 0) tracers.splice(i, 1); }
    const n = Math.min(tracers.length, TRACER_MAX);
    for (let i = 0; i < n; i++) {
        const t = tracers[i], o = i * 6;
        _tracerPos[o] = t.x0; _tracerPos[o + 1] = t.y0; _tracerPos[o + 2] = t.z0;
        _tracerPos[o + 3] = t.x1; _tracerPos[o + 4] = t.y1; _tracerPos[o + 5] = t.z1;
        _tracerCol[o] = t.r; _tracerCol[o + 1] = t.g; _tracerCol[o + 2] = t.b;
        _tracerCol[o + 3] = t.r; _tracerCol[o + 4] = t.g; _tracerCol[o + 5] = t.b;
    }
    tracerGeo.setDrawRange(0, n * 2);
    tracerGeo.attributes.position.needsUpdate = true;
    tracerGeo.attributes.color.needsUpdate = true;
}

function updateAgents(delta) {
    const dt = Math.min(delta, 0.05);
    if (!agentMesh || agents.length === 0) { if (agentMesh) agentMesh.count = 0; if (gunMesh) gunMesh.count = 0; updateTracers(dt); return; }
    if (_agentDeathFxCD > 0) _agentDeathFxCD -= delta;
    const px = camera.position.x, pz = camera.position.z;
    const cull = VIEW_DIST * 16;

    // ① 索敵（ラウンドロビン）: 予算分だけ最寄りの敵陣ユニットを target に。敵不在は徘徊向きを散らす。
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
            const d = dx * dx + dz * dz + dy * dy * 0.5;
            if (d < bestD) { bestD = d; best = b; }
        }
        a.target = best;
        if (!best && Math.random() < 0.5) a.heading += (Math.random() - 0.5) * 1.6; // 敵不在＝ふらつき徘徊
    }
    _agentThinkPtr = (_agentThinkPtr + thinkN) % Math.max(1, nThink);

    // ② 移動＋射撃（全エージェント）
    for (let i = agents.length - 1; i >= 0; i--) {
        const a = agents[i];
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
        if (a.fireCd > 0) a.fireCd -= dt;

        // 重力＋接地
        a.vy -= AGENT_GRAVITY * dt;
        if (a.vy < -45) a.vy = -45;
        const fx = Math.floor(a.x), fz = Math.floor(a.z);
        const below = Math.floor(a.y) - 1;
        a.grounded = false;
        if (a.vy <= 0 && _agentSolid(fx, below, fz)) {
            a.y = below + 1; a.vy = 0; a.grounded = true;
        } else {
            a.y += a.vy * dt;
        }

        // 敵がいれば向き直す。射程内＆射線が通れば停止して撃つ(engaged)。射線が無ければ前進して回り込む。
        let tgt = a.target;
        if (tgt && (!tgt.alive || tgt.hp <= 0)) tgt = a.target = null;
        let engaged = false;
        if (tgt) {
            const dxt = tgt.x - a.x, dzt = tgt.z - a.z;
            const distH = Math.sqrt(dxt * dxt + dzt * dzt);
            a.heading = Math.atan2(dzt, dxt); // 敵を狙う（顔＝銃の向き）
            const inRange = distH <= AGENT_FIRE_RANGE;
            if (!inRange) { a.hasLos = false; }
            else if (a.fireCd <= 0) {
                // 発射クールダウン時だけ LOS を判定（レイ数を抑制）。通れば撃つ、通らなければ近く再判定。
                a.hasLos = _agentLOS(a, tgt);
                if (a.hasLos && a.grounded) { _agentFire(a, tgt); a.fireCd = AGENT_FIRE_CD * (0.7 + Math.random() * 0.6); }
                else { a.fireCd = AGENT_LOS_RECHECK; }
            }
            engaged = inRange && a.hasLos; // 射撃中は前進しない＝射程で撃ち合う
        }

        // 水平移動（接地時＆非engaged）。塞がれていたら左右に振った候補から通れる方へ＝迂回（つっかえ防止）。
        if (a.grounded && !engaged) {
            const fy = Math.floor(a.y);
            const offs = a.turnDir > 0 ? _AGENT_AVOID_R : _AGENT_AVOID_L;
            let moved = false;
            for (let o = 0; o < offs.length; o++) {
                const h = a.heading + offs[o];
                const hx = Math.cos(h), hz = Math.sin(h);
                const nx = a.x + hx * AGENT_SPEED * dt, nz = a.z + hz * AGENT_SPEED * dt;
                const bx = Math.floor(nx + hx * 0.4), bz = Math.floor(nz + hz * 0.4);
                if (!_agentSolid(bx, fy, bz)) { a.x = nx; a.z = nz; moved = true; break; }
                if (!_agentSolid(bx, fy + 1, bz) && !_agentSolid(bx, fy + 2, bz)) { a.y += 1; a.x = nx; a.z = nz; moved = true; break; }
            }
            if (!moved) { a.heading += Math.PI + (Math.random() - 0.5); a.turnDir = -a.turnDir; }
        }
    }

    // ③ 本体＋銃の行列、陣営色を書き込み（本体1＋銃1ドローコール）
    const n = Math.min(agents.length, AGENT_MAX);
    for (let i = 0; i < n; i++) {
        const a = agents[i];
        const h = a.heading, ry = Math.PI / 2 - h;
        _agentDummy.position.set(a.x, a.y - 0.5 + AGENT_H * 0.5, a.z);
        _agentDummy.rotation.set(0, ry, 0);
        _agentDummy.updateMatrix();
        agentMesh.setMatrixAt(i, _agentDummy.matrix);
        _cTmp.copy(a.faction === 0 ? _cRed : _cBlue);
        if (a.hitFlash > 0) _cTmp.lerp(_cWhite, Math.min(1, a.hitFlash * 4));
        agentMesh.setColorAt(i, _cTmp);
        // 銃を手元（前方やや下）に構える。長軸(+z)を heading 方向へ。
        _gunDummy.position.set(a.x + Math.cos(h) * 0.42, a.y + 0.85, a.z + Math.sin(h) * 0.42);
        _gunDummy.rotation.set(0, ry, 0);
        _gunDummy.updateMatrix();
        gunMesh.setMatrixAt(i, _gunDummy.matrix);
    }
    agentMesh.count = n; agentMesh.instanceMatrix.needsUpdate = true;
    if (agentMesh.instanceColor) agentMesh.instanceColor.needsUpdate = true;
    gunMesh.count = n; gunMesh.instanceMatrix.needsUpdate = true;

    updateTracers(dt);
}
