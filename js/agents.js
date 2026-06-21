// --- AI 陣営戦（赤軍 vs 青軍・銃で撃ち合い） ---
// 「召喚すると赤軍と青軍が左右から湧いて会戦＝銃で撃ち合う」。地形は壊さない（侵食なし）。
// プレイヤーの爆発（ミサイル/核/TNT等）でも倒せる（killAgentsInRadius を explode から呼ぶ）。
// 性能対策が肝（数百体でも軽い）:
//   ① 描画＝本体＋銃を各1つの THREE.InstancedMesh（合計2ドローコール）＋ setColorAt で陣営色
//   ② 思考＝ラウンドロビン（1フレームに数体だけ最寄り敵を索敵）
//   ③ 射撃＝ヒットスキャン（命中判定は即時）＋プールした曳光弾(tracer・LineSegments 1ドローコール)。
//      射線(LOS)判定の voxelRaycast は「発射クールダウン時だけ」走らせてレイ数を抑える。
//   ④ 距離カリング＝ロード済み領域(VIEW_DIST)の外のユニットは消滅。

const AGENT_MAX = 800;            // 同時生存上限（大規模戦争・連打で増援して埋める）
const AGENT_WAVE = 80;            // 召喚1回で出す総数（赤40＋青40）
const AGENT_THINK_BUDGET = 24;    // 1フレームに索敵するユニット数（ラウンドロビン）
const AGENT_SPEED = 4.2;          // 水平移動速度
const AGENT_GRAVITY = 24.0;
const AGENT_H = 1.7;             // 見た目の高さ
let _agentDeathFxCD = 0;         // 戦死パフの throttle
// 敵が全滅して（＝1陣営だけ残って）この秒数たったら、勝者軍を自動で消去する（残党が邪魔なので）。
const AGENT_DESPAWN_DELAY = 10;
let _battleOverTimer = 0;

// --- 射撃パラメータ ---
const AGENT_HP = 6;               // 各兵のHP
const AGENT_SIGHT = 90;           // 索敵半径（大規模で広く展開しても全員が敵を見つけて収束するよう広め）
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
const TRACER_MAX = 1024;
const TRACER_LIFE = 0.09;        // 一瞬光って消える（秒）
const tracers = [];              // {x0,y0,z0,x1,y1,z1, life, r,g,b}
let tracerLines = null, tracerGeo = null;
const _tracerPos = new Float32Array(TRACER_MAX * 6);
const _tracerCol = new Float32Array(TRACER_MAX * 6);

// --- 死体（corpse）プール: 戦死した兵を倒れたスラブとして残す（戦争っぽさ）。1ドローコール ---
const CORPSE_MAX = 500;          // 上限（超えたら古いのから消える）
const corpses = [];              // {x,y,z,faction,yaw}
let corpseMesh = null, _corpsesDirty = false;
const _corpseDummy = new THREE.Object3D();
let _agentShotSndCD = 0;         // 銃声のグローバル間引き（大量同時発射で playSound を呼びすぎない）

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
    // 死体（倒れた兵のスラブ・暗い陣営色）。死亡時にだけ書き換える（毎フレームは触らない）。
    const cgeo = new THREE.BoxGeometry(0.75, 0.4, 1.5);
    const cmat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    corpseMesh = new THREE.InstancedMesh(cgeo, cmat, CORPSE_MAX);
    corpseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    corpseMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CORPSE_MAX * 3), 3);
    corpseMesh.frustumCulled = false;
    corpseMesh.count = 0;
    scene.add(corpseMesh);
    initTracers();
}

// 戦死した兵を死体として残す（カリング/奈落落下では残さない＝実際に倒された時だけ）。
function addCorpse(x, y, z, faction) {
    if (corpses.length >= CORPSE_MAX) corpses.shift();
    corpses.push({ x: x, y: y, z: z, faction: faction, yaw: Math.random() * Math.PI * 2 });
    _corpsesDirty = true;
}

function rebuildCorpses() {
    if (!corpseMesh || !_corpsesDirty) return; // 死体が増減した時だけ作り直す
    const n = Math.min(corpses.length, CORPSE_MAX);
    for (let i = 0; i < n; i++) {
        const c = corpses[i];
        _corpseDummy.position.set(c.x, c.y + 0.2, c.z); // 地面に伏せる（スラブ高0.4）
        _corpseDummy.rotation.set(0, c.yaw, 0);
        _corpseDummy.updateMatrix();
        corpseMesh.setMatrixAt(i, _corpseDummy.matrix);
        _cTmp.copy(c.faction === 0 ? _cRed : _cBlue).multiplyScalar(0.42); // 暗い陣営色＝死体
        corpseMesh.setColorAt(i, _cTmp);
    }
    corpseMesh.count = n;
    corpseMesh.instanceMatrix.needsUpdate = true;
    if (corpseMesh.instanceColor) corpseMesh.instanceColor.needsUpdate = true;
    _corpsesDirty = false;
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

// 1陣営だけをプレイヤー周囲に召喚（既定: 赤=西寄り/青=東寄りの弧に展開）。
// これで「片方だけ増やす」＝負けてる側だけ増援できる＝リスポーンキル(敵陣のど真ん中に湧いて即死)を避けられる。
// onWest を明示すると湧く方角を上書きできる（summonLegion が地形の有利不利を陣営に偏らせないために使う）。
function summonFaction(faction, onWest) {
    initAgentMesh();
    const px = camera.position.x, pz = camera.position.z;
    const perSide = Math.floor(AGENT_WAVE / 2); // 1陣営40体
    const west = (onWest === undefined) ? (faction === 0) : onWest;
    const baseAng = west ? Math.PI : 0;   // 西=π / 東=0
    let spawned = 0;
    for (let i = 0; i < perSide && agents.length < AGENT_MAX; i++) {
        const ang = baseAng + (Math.random() - 0.5) * 1.6;
        const r = 18 + Math.random() * 26; // 自陣側に広く展開（大軍が密集しすぎないよう）
        const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
        const top = columnTopY(Math.floor(x), Math.floor(z));
        const y = Math.max(top, SEA_LEVEL) + 1;
        agents.push(_makeAgent(x, y, z, faction, baseAng + Math.PI + (Math.random() - 0.5) * 0.4));
        spawned++;
    }
    if (spawned > 0 && typeof playSound === 'function') playSound('ignite');
    return spawned;
}

// プレイヤーの左右に赤軍・青軍を同時召喚＝中央で会戦（SUMMONER アイテム・selftest が使用）。
// どちらの陣営が西/東に湧くかを毎回ランダム化＝地形の有利不利が常に同じ陣営(赤)に偏らないように。
// （戦闘ロジック自体は対称＝平地では均衡。勝者は湧いた方角の地形差で決まりがちなので、それを散らす）
function summonLegion() {
    const redWest = Math.random() < 0.5;
    return summonFaction(0, redWest) + summonFaction(1, !redWest);
}

function clearAgents() {
    agents.length = 0;
    if (agentMesh) agentMesh.count = 0;
    if (gunMesh) gunMesh.count = 0;
    corpses.length = 0;
    if (corpseMesh) corpseMesh.count = 0;
    _corpsesDirty = false;
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
    // 銃声: プレイヤー近く(60ブロック以内)の発射だけ、グローバル間引きで鳴らす（大量発射でスパムしない）。
    if (_agentShotSndCD <= 0 && typeof playSound === 'function') {
        const ddx = a.x - camera.position.x, ddz = a.z - camera.position.z;
        if (ddx * ddx + ddz * ddz < 3600) { _agentShotSndCD = 0.045; playSound('gunshot'); }
    }
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
    if (!agentMesh || agents.length === 0) { if (agentMesh) agentMesh.count = 0; if (gunMesh) gunMesh.count = 0; rebuildCorpses(); updateTracers(dt); return; }
    if (_agentDeathFxCD > 0) _agentDeathFxCD -= delta;
    if (_agentShotSndCD > 0) _agentShotSndCD -= delta;
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
            addCorpse(a.x, a.y, a.z, a.faction); // 戦死＝死体を残す（戦争っぽさ）
            if (_agentDeathFxCD <= 0 && typeof createBlockParticles === 'function') {
                _agentDeathFxCD = 0.08; createBlockParticles(a.x, a.y, a.z, BLOCKS.STONE, 2, 0.14);
            }
            agents.splice(i, 1); continue;
        }
        if (Math.abs(a.x - px) > cull || Math.abs(a.z - pz) > cull || a.y < worldBottomY + 1) {
            a.alive = false; agents.splice(i, 1); continue; // カリング/奈落は死体を残さない
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

    // ③ 本体＋銃の行列、陣営色を書き込み（本体1＋銃1ドローコール）。ついでに陣営の生存を集計。
    const n = Math.min(agents.length, AGENT_MAX);
    let sawF0 = false, sawF1 = false;
    for (let i = 0; i < n; i++) {
        const a = agents[i];
        if (a.faction === 0) sawF0 = true; else sawF1 = true;
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

    // 敵が全滅して1陣営だけ残ったら、DESPAWN_DELAY 秒後に勝者軍を自動消去（残党が邪魔なので）。
    // 両陣営そろっている／空ならタイマーをリセット（増援召喚で敵が戻れば即リセット）。
    if (n > 0 && !(sawF0 && sawF1)) {
        _battleOverTimer += dt;
        if (_battleOverTimer >= AGENT_DESPAWN_DELAY) { clearAgents(); _battleOverTimer = 0; }
    } else {
        _battleOverTimer = 0;
    }

    rebuildCorpses(); // 死体が増減した時だけ作り直す（毎フレームはノーオペ）
    updateTracers(dt);
}
