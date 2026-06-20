// --- AI破壊軍団（destruction legion） ---
// 「召喚すると世界をカオスに破壊する」ボクセル兵の群れ。性能対策が肝なので以下を徹底:
//   ① 描画＝THREE.InstancedMesh（全ユニットを1ドローコール・数百体でも軽い）
//   ② 思考＝ラウンドロビン（1フレームに数体だけ heading 更新、残りは惰性）
//   ③ 破壊＝遅延メッシュ（setBlockData+markDirty で dirty に積むだけ→main.js が予算で flush）。
//      edit は記録しない＝localStorage 肥大と再生成コストを避ける（破壊はライブ演出・リロードで世界が癒える）
//   ④ 距離カリング＝ロード済み領域(VIEW_DIST)の外に出たユニットは消滅（落下し続ける無駄を防ぐ）
// faction フィールドを持たせて将来の「陣営戦（赤軍 vs 青軍）」に拡張できる構造にしておく（v1は全員 faction 0）。

const AGENT_MAX = 260;            // 同時生存上限（描画/思考の予算上限）
const AGENT_WAVE = 28;            // 召喚1回で出す数
const AGENT_THINK_BUDGET = 14;    // 1フレームに「思考」するユニット数（ラウンドロビン）
const AGENT_SPEED = 4.2;          // 水平移動速度
const AGENT_GRAVITY = 24.0;
const AGENT_DIG_CD = 0.32;        // 破壊クールダウン（秒）
const AGENT_H = 1.7;             // 見た目の高さ
const AGENT_BLAST_CHANCE = 0.035; // 破壊時に稀に小爆発（チャオス演出）
let _agentBlastCD = 0;           // 小爆発のグローバルクールダウン（性能スパイク防止）

// 各エージェント: { x,y,z(float世界座標), vy, heading(ラジアン), grounded, digCd, digTarget, faction, hp }
const agents = [];
let agentMesh = null;            // THREE.InstancedMesh
let _agentThinkPtr = 0;
const _agentDummy = new THREE.Object3D();

function createAgentTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d');
    x.fillStyle = '#2b2f33'; x.fillRect(0, 0, 32, 32);                 // 暗い金属の胴体
    x.fillStyle = '#1a1c1f'; for (let i = 0; i < 32; i += 8) x.fillRect(i, 0, 2, 32); // パネルライン
    x.fillStyle = '#3a3f44'; x.fillRect(0, 0, 32, 6);                 // 肩
    x.fillStyle = '#ff1744'; x.fillRect(8, 11, 5, 5); x.fillRect(19, 11, 5, 5); // 赤く光る目
    x.fillStyle = '#7a0010'; x.fillRect(11, 20, 10, 3);              // 口（赤い線）
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
}

function initAgentMesh() {
    if (agentMesh) return;
    const geo = new THREE.BoxGeometry(0.7, AGENT_H, 0.7);
    const mat = new THREE.MeshLambertMaterial({ map: createAgentTexture() });
    agentMesh = new THREE.InstancedMesh(geo, mat, AGENT_MAX);
    agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    agentMesh.frustumCulled = false; // 自前で距離カリングするので常時描画（1ドローコール）
    agentMesh.count = 0;
    scene.add(agentMesh);
}

// プレイヤー周囲の地表に AGENT_WAVE 体を召喚（上限まで）。連打で増援できる。
function summonLegion() {
    initAgentMesh();
    const px = camera.position.x, pz = camera.position.z;
    let spawned = 0;
    for (let i = 0; i < AGENT_WAVE && agents.length < AGENT_MAX; i++) {
        const ang = (i / AGENT_WAVE) * Math.PI * 2 + Math.random() * 0.6;
        const r = 7 + Math.random() * 12;
        const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
        const top = columnTopY(Math.floor(x), Math.floor(z));
        const y = Math.max(top, SEA_LEVEL) + 1;
        agents.push({
            x: x, y: y, z: z, vy: 0,
            heading: Math.random() * Math.PI * 2,
            grounded: false, digCd: Math.random() * AGENT_DIG_CD, digTarget: null,
            faction: 0, hp: 3
        });
        spawned++;
    }
    if (spawned > 0 && typeof playSound === 'function') playSound('ignite');
    return spawned;
}

function clearAgents() {
    agents.length = 0;
    if (agentMesh) agentMesh.count = 0;
}

function _agentSolid(x, y, z) {
    const t = getBlock(x, y, z);
    return t && !(BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide);
}

// ライブ破壊（edit を記録しない＝肥大回避）。岩盤/空気/水は壊さない。
function _agentDestroy(x, y, z) {
    const t = getBlock(x, y, z);
    if (!t || t === BLOCKS.BEDROCK || (BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide)) return false;
    setBlockData(x, y, z, 0);
    markDirty(x, y, z);
    return true;
}

function updateAgents(delta) {
    if (!agentMesh || agents.length === 0) { if (agentMesh) agentMesh.count = 0; return; }
    if (_agentBlastCD > 0) _agentBlastCD -= delta;
    const dt = Math.min(delta, 0.05);
    const px = camera.position.x, pz = camera.position.z;
    const cull = VIEW_DIST * 16; // ロード済み領域の外に出たら消滅（getBlock=0 で落下し続ける無駄を防ぐ）

    // ① 思考（ラウンドロビン）: 予算分だけ heading を更新（残りは惰性）
    const thinkN = Math.min(AGENT_THINK_BUDGET, agents.length);
    for (let k = 0; k < thinkN; k++) {
        const a = agents[(_agentThinkPtr + k) % agents.length];
        if (a && Math.random() < 0.5) a.heading += (Math.random() - 0.5) * 1.6; // ふらつき徘徊（将来: 村/城/敵を狙う）
    }
    _agentThinkPtr = (_agentThinkPtr + thinkN) % Math.max(1, agents.length);

    // ② 移動＋破壊（全エージェント・軽い処理）
    for (let i = agents.length - 1; i >= 0; i--) {
        const a = agents[i];
        // 距離カリング / 奈落落下で消滅
        if (Math.abs(a.x - px) > cull || Math.abs(a.z - pz) > cull || a.y < worldBottomY + 1) {
            agents.splice(i, 1);
            continue;
        }

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

        // 水平移動（接地時のみ前進）。壁にぶつかったら段差は登り、壁は破壊対象にする。
        if (a.grounded) {
            const hx = Math.cos(a.heading), hz = Math.sin(a.heading);
            const nx = a.x + hx * AGENT_SPEED * dt;
            const nz = a.z + hz * AGENT_SPEED * dt;
            const bx = Math.floor(nx + hx * 0.4), bz = Math.floor(nz + hz * 0.4);
            const fy = Math.floor(a.y);
            if (_agentSolid(bx, fy, bz)) {
                // 進行先が壁: 1段差なら登る、それ以上なら破壊対象
                if (!_agentSolid(bx, fy + 1, bz) && !_agentSolid(bx, fy + 2, bz)) {
                    a.y += 1; a.x = nx; a.z = nz; // ステップアップ
                } else {
                    a.digTarget = [bx, fy, bz];
                    a.heading += (Math.random() - 0.5) * 0.8; // 少し向きを散らす（みんなで同じ壁に詰まらない）
                }
            } else {
                a.x = nx; a.z = nz;
            }
        }

        // ③ 破壊（クールダウン）。digTarget があればそれを、無ければ進行方向の足元/体の固体を壊す＝常に何か破壊
        a.digCd -= dt;
        if (a.digCd <= 0 && a.grounded) {
            a.digCd = AGENT_DIG_CD;
            let tx, ty, tz;
            if (a.digTarget) { tx = a.digTarget[0]; ty = a.digTarget[1]; tz = a.digTarget[2]; a.digTarget = null; }
            else {
                const hx = Math.cos(a.heading), hz = Math.sin(a.heading), fy = Math.floor(a.y);
                tx = Math.floor(a.x + hx); ty = fy; tz = Math.floor(a.z + hz);
                if (!_agentSolid(tx, ty, tz)) ty = fy - 1; // 前が空なら足元を掘る
            }
            if (_agentDestroy(tx, ty, tz)) {
                if (_agentBlastCD <= 0 && Math.random() < AGENT_BLAST_CHANCE) {
                    _agentBlastCD = 0.2; // グローバルCD＝小爆発のスパイク抑制
                    explode(tx, ty, tz, false, 3);
                }
            }
        }
    }

    // ④ インスタンス行列を書き込み（1ドローコール）
    const n = Math.min(agents.length, AGENT_MAX);
    for (let i = 0; i < n; i++) {
        const a = agents[i];
        _agentDummy.position.set(a.x, a.y - 0.5 + AGENT_H * 0.5, a.z); // 足元を地表に接地させる
        _agentDummy.rotation.set(0, -a.heading + Math.PI / 2, 0);
        _agentDummy.updateMatrix();
        agentMesh.setMatrixAt(i, _agentDummy.matrix);
    }
    agentMesh.count = n;
    agentMesh.instanceMatrix.needsUpdate = true;
}
