// --- 5. World Generation（無限ワールド / チャンク Uint8Array / ストリーミング） ---
// ★大改造（無限ワールド化）:
//   旧: blockData["x,y,z"]=type の単一巨大オブジェクト（固定 WORLD_SIZE の箱）。
//   新: 世界を 16³ チャンクに分け、各チャンクは Uint8Array(16³) を持つ。プレイヤー周囲
//       (VIEW_DIST チャンク) だけを動的生成し、遠方は破棄＝メモリ青天井を回避し無限に歩ける。
//   地形は terrainHeightAt/strataBlockAt が位置非依存＆決定的(worldSeed)なので、どの順序で
//   生成しても同じ世界になる。プレイヤーの改変は worldEdits(疎なマップ)に記録し、チャンクが
//   再生成されても再適用される（アンロード→再ロードで建造物が消えない）。
//   描画は従来どおり「露出面だけを 1 つの BufferGeometry にマージ」＋アトラス
//   (solidMaterial/waterMaterial)。さらに頂点カラーで AO(角の陰)＋天空光(地下を暗く)を焼く。

// ---- チャンクストア ----
const CHUNK_VOL = CS * CS * CS;
const chunks = {};                    // "cx,cy,cz" -> { cx,cy,cz, data:Uint8Array, generated, solid:Mesh|null, water:Mesh|null }
const dirtyChunks = new Set();        // 再メッシュが必要なチャンクキー
// プレイヤー/爆破の改変＝チャンク再生成でも保持。チャンク別索引にして「生成時に全edit走査」を回避
// （大爆発で数万 edit 溜まっても、生成は自チャンク分だけ見る）。editsByChunk[ck] = { "x,y,z": type }
const editsByChunk = {};
function recordEdit(x, y, z, type) {
    const ck = chunkOf(x, y, z);
    (editsByChunk[ck] || (editsByChunk[ck] = {}))[getKey(x, y, z)] = type;
}

// ---- 爆発イベント（大爆発の永続化を「掘削edit数万」→「イベント1件」に圧縮） ----
// 原爆/水爆は1発で約10万ブロックを撤去する。これを per-block edit で記録すると (1)記録が重い
// (2)localStorage上限(MAX_PERSIST_EDITS)を超えてクレーターがリロードで欠ける。そこで「爆発1件」を
// {cx,cy,cz,R,isBomb} として記録し、チャンク生成時に explode と同じ式で再カーブして復元する。
// 形状(お椀/真球・深さ上限)は決定的なので完全再現される。
const explosionEvents = [];
function recordExplosionEvent(cx, cy, cz, R, isBomb) {
    explosionEvents.push({ cx: cx, cy: cy, cz: cz, R: R, isBomb: isBomb });
}
// 1チャンクに、重なる全爆発イベントを再カーブで適用（generateChunk から block-edit より前に呼ぶ）。
// explode の掘削と同じ「下半分=お椀/それ以外=真球」「岩盤は残す」を局所インデックスで再現。
// 爆風なぎ倒しの「地表より上を撤去する高さ」。クレーター外周の環状帯[1.35R,2.0R]で内端→外端に減衰。
// live と再生成で同じ式＝リロードしても同じ倒れ方になる（決定的）。
const FLATTEN_R0 = 1.35, FLATTEN_R1 = 2.0;
function blastFlattenHeight(r, R) {
    const fr0 = R * FLATTEN_R0, fr1 = R * FLATTEN_R1;
    if (r < fr0 || r > fr1) return 0;
    const tt = 1 - (r - fr0) / (fr1 - fr0);          // 内端1→外端0
    return Math.max(1, Math.round(Math.min(16, R * 0.3) * tt));
}

function applyExplosionEventsToChunk(ch) {
    if (explosionEvents.length === 0) return;
    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    const bx1 = bx0 + CS - 1, by1 = by0 + CS - 1, bz1 = bz0 + CS - 1;
    const data = ch.data;
    for (let i = 0; i < explosionEvents.length; i++) {
        const ev = explosionEvents[i];
        const R = ev.R, R2 = R * R;
        const fr1 = R * FLATTEN_R1;                    // 影響最大半径（なぎ倒し含む）
        if (ev.cx + fr1 < bx0 || ev.cx - fr1 > bx1 || ev.cz + fr1 < bz0 || ev.cz - fr1 > bz1) continue;

        // --- クレーター（お椀状に掘る・このchunkのY範囲に掛かる時だけ） ---
        const Rv2 = (R * (ev.isBomb ? 0.4 : 1.0)) ** 2;
        const bottomY = Math.max(worldBottomY + 1, Math.floor(ev.cy) - Math.min(R, 30));
        if (!(ev.cy + R < by0 || bottomY > by1)) {
            const lx0 = Math.max(0, Math.ceil(ev.cx - R) - bx0), lx1 = Math.min(CS - 1, Math.floor(ev.cx + R) - bx0);
            const lyLo = Math.max(bottomY, Math.ceil(ev.cy - R));
            const ly0 = Math.max(0, lyLo - by0), ly1 = Math.min(CS - 1, Math.floor(ev.cy + R) - by0);
            for (let lx = lx0; lx <= lx1; lx++) {
                const dx = (bx0 + lx) - ev.cx, dx2 = dx * dx;
                if (dx2 > R2) continue;
                for (let ly = ly0; ly <= ly1; ly++) {
                    const dy = (by0 + ly) - ev.cy;
                    const maxDz2 = (ev.isBomb && dy < 0) ? R2 * (1 - (dy * dy) / Rv2) - dx2 : R2 - dx2 - dy * dy;
                    if (maxDz2 < 0) continue;
                    const dzMax = Math.sqrt(maxDz2);
                    const wzlo = Math.max(bz0, Math.ceil(ev.cz - dzMax)), wzhi = Math.min(bz1, Math.floor(ev.cz + dzMax));
                    for (let wz = wzlo; wz <= wzhi; wz++) {
                        const idx = (ly * CS + (wz - bz0)) * CS + lx;
                        const t = data[idx];
                        if (t && t !== BLOCKS.BEDROCK) data[idx] = 0; // 岩盤は残す
                    }
                }
            }
        }

        // --- 爆風なぎ倒し（クレーター外周で地表より上の構造物を撤去・原爆/水爆のみ） ---
        if (ev.isBomb) {
            const fr02 = (R * FLATTEN_R0) ** 2, fr12 = fr1 * fr1;
            const fx0 = Math.max(bx0, Math.ceil(ev.cx - fr1)), fx1 = Math.min(bx1, Math.floor(ev.cx + fr1));
            const fz0 = Math.max(bz0, Math.ceil(ev.cz - fr1)), fz1 = Math.min(bz1, Math.floor(ev.cz + fr1));
            for (let wx = fx0; wx <= fx1; wx++) {
                const dx = wx - ev.cx, dx2 = dx * dx;
                for (let wz = fz0; wz <= fz1; wz++) {
                    const dz = wz - ev.cz, r2 = dx2 + dz * dz;
                    if (r2 < fr02 || r2 > fr12) continue;
                    const surf = terrainHeightAt(wx, wz);
                    const yhi = Math.min(by1, surf + blastFlattenHeight(Math.sqrt(r2), R));
                    let wy = Math.max(by0, surf + 1);
                    for (; wy <= yhi; wy++) {
                        const idx = ((wy - by0) * CS + (wz - bz0)) * CS + (wx - bx0);
                        const t = data[idx];
                        if (t && t !== BLOCKS.BEDROCK) data[idx] = 0;
                    }
                }
            }
        }
    }
}

function getKey(x, y, z) { return x + ',' + y + ',' + z; }
function chunkKey(cx, cy, cz) { return cx + ',' + cy + ',' + cz; }
function chunkCoord(v) { return Math.floor(v / CS); }
function chunkOf(x, y, z) { return chunkKey(chunkCoord(x), chunkCoord(y), chunkCoord(z)); }
function localIdx(lx, ly, lz) { return (ly * CS + lz) * CS + lx; }

// getBlock 高速化: 直前にアクセスしたチャンクをキャッシュ（AO/天空光スキャンは同一チャンク連続が多い）。
let _gcx = 2147483647, _gcy = 0, _gcz = 0, _gch = null;
function _invalidateGetCache() { _gcx = 2147483647; _gch = null; }

// (x,y,z) のブロック種別。未生成チャンク/空気は 0。
function getBlock(x, y, z) {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(z / CS);
    if (cx !== _gcx || cy !== _gcy || cz !== _gcz) {
        _gcx = cx; _gcy = cy; _gcz = cz;
        _gch = chunks[chunkKey(cx, cy, cz)] || null;
    }
    const ch = _gch;
    if (!ch || !ch.generated) return 0;
    return ch.data[((y - cy * CS) * CS + (z - cz * CS)) * CS + (x - cx * CS)];
}

// 面カリング用：その type が「隣の面を隠す不透明固体」か。水・noCollide は非遮蔽。
function isOpaque(type) {
    if (!type) return false;
    const p = BLOCK_PROPS[type];
    if (p && (p.transparent || p.noCollide)) return false;
    return true;
}
function isOpaqueAt(x, y, z) { return isOpaque(getBlock(x, y, z)); }

// selfType のブロックが (nx,ny,nz) 方向の面を描くべきか。
function faceVisible(selfType, nx, ny, nz) {
    if (ny < worldBottomY) return false;
    const nt = getBlock(nx, ny, nz);
    if (!nt) return true;
    if (isOpaque(nt)) return false;
    if (nt === selfType) return false;
    return true;
}

// ============================================================
// メッシュ生成（露出面マージ＋頂点カラーで AO・天空光）
// ============================================================
const FACE_LIST = [
    { dir: [1, 0, 0],  slot: 'side',   c: [[1,0,0],[1,0,1],[1,1,1],[1,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [-1, 0, 0], slot: 'side',   c: [[0,0,1],[0,0,0],[0,1,0],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, 1, 0],  slot: 'top',    c: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, -1, 0], slot: 'bottom', c: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, 0, 1],  slot: 'side',   c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, 0, -1], slot: 'side',   c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] }
];

// --- 頂点ライティング ---
// AO=角の陰（本家のスムースライティング）。各頂点で、面の外側プレーンにある「辺2隣＋対角」
// の埋まり具合から 0..3 の暗さを決める。激安で立体感が劇的に増す。
const AO_SHADE = [0.42, 0.62, 0.80, 1.0];
function aoLevel(s1, s2, c) { if (s1 && s2) return 0; return 3 - (s1 + s2 + c); }
// 天空光: そのセルの真上に不透明ブロックがどれだけ積もっているかで減光（地下・洞窟・裂け目の底が暗くなる）。
// 横方向に伝播しない簡易版だが「掘っても明るすぎる」を最安で解消する。開けた空の下は 1.0。
const SKY_SCAN = 18, SKY_DARK_AT = 7, SKY_MIN = 0.16;
function cellSky(x, y, z) {
    let cnt = 0;
    for (let dy = 1; dy <= SKY_SCAN; dy++) {
        if (isOpaqueAt(x, y + dy, z)) { cnt++; if (cnt >= SKY_DARK_AT) break; }
    }
    if (cnt === 0) return 1.0;
    return 1 - (cnt / SKY_DARK_AT) * (1 - SKY_MIN);
}

// 4 隅を buffer へ。法線×外向きが負なら巻きを反転。col は各隅の明度(0..1)。
function addFace(buf, corners, uvs, dir, cols) {
    const ax = corners[1][0] - corners[0][0], ay = corners[1][1] - corners[0][1], az = corners[1][2] - corners[0][2];
    const bx = corners[2][0] - corners[0][0], by = corners[2][1] - corners[0][1], bz = corners[2][2] - corners[0][2];
    const cxn = ay * bz - az * by, cyn = az * bx - ax * bz, czn = ax * by - ay * bx;
    let c = corners, u = uvs, g = cols;
    if (cxn * dir[0] + cyn * dir[1] + czn * dir[2] < 0) {
        c = [corners[3], corners[2], corners[1], corners[0]];
        u = [uvs[3], uvs[2], uvs[1], uvs[0]];
        if (cols) g = [cols[3], cols[2], cols[1], cols[0]];
    }
    const base = buf.v;
    for (let k = 0; k < 4; k++) {
        buf.pos.push(c[k][0], c[k][1], c[k][2]);
        buf.nor.push(dir[0], dir[1], dir[2]);
        buf.uv.push(u[k][0], u[k][1]);
        if (buf.col) { const s = g[k]; buf.col.push(s, s, s); }
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    buf.v = base + 4;
}

function makeChunkMesh(buf, material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    if (buf.col && buf.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
    g.setIndex(buf.idx);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = true;
    scene.add(mesh);
    return mesh;
}

// チャンク 1 つのジオメトリを作り直す（実在セルだけ走査）。
function buildChunk(ck) {
    const ch = chunks[ck];
    if (!ch) return;
    if (ch.solid) { scene.remove(ch.solid); ch.solid.geometry.dispose(); ch.solid = null; }
    if (ch.water) { scene.remove(ch.water); ch.water.geometry.dispose(); ch.water = null; }
    if (!ch.generated) return;

    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    const data = ch.data;
    const solid = { pos: [], nor: [], uv: [], col: [], idx: [], v: 0 };
    const water = { pos: [], nor: [], uv: [], idx: [], v: 0 };
    const stoneIdx = BLOCK_TILE_IDX[BLOCKS.STONE];

    for (let ly = 0; ly < CS; ly++) {
        for (let lz = 0; lz < CS; lz++) {
            for (let lx = 0; lx < CS; lx++) {
                const t = data[localIdx(lx, ly, lz)];
                if (!t) continue;
                const x = bx0 + lx, y = by0 + ly, z = bz0 + lz;
                const isWater = (t === BLOCKS.WATER);
                const buf = isWater ? water : solid;
                const tiles = BLOCK_TILE_IDX[t] || stoneIdx;
                let sky = -1; // 遅延算出: 露出面が1つも無い埋設セルでは cellSky を一切呼ばない（深い世界の要）

                for (let f = 0; f < 6; f++) {
                    const F = FACE_LIST[f];
                    const nx = x + F.dir[0], ny = y + F.dir[1], nz = z + F.dir[2];
                    if (!faceVisible(t, nx, ny, nz)) continue;

                    const rect = tileUV(tiles[F.slot]);
                    const du = rect.u1 - rect.u0, dv = rect.vTop - rect.vBot;
                    const corners = [], uvs = [], cols = isWater ? null : [];
                    if (cols && sky < 0) sky = cellSky(x, y, z); // 最初の可視面でだけ算出
                    for (let k = 0; k < 4; k++) {
                        const lxx = F.c[k][0], lyy = F.c[k][1], lzz = F.c[k][2];
                        const wy = isWater ? (lyy ? y + 0.3 : y - 0.5) : (y - 0.5 + lyy);
                        corners.push([x - 0.5 + lxx, wy, z - 0.5 + lzz]);
                        uvs.push([rect.u0 + F.uv[k][0] * du, rect.vBot + F.uv[k][1] * dv]);
                        if (cols) cols.push(sky * cornerAO(x, y, z, F.dir, lxx, lyy, lzz));
                    }
                    addFace(buf, corners, uvs, F.dir, cols);
                }
            }
        }
    }

    if (solid.v > 0) ch.solid = makeChunkMesh(solid, solidMaterial);
    if (water.v > 0) ch.water = makeChunkMesh(water, waterMaterial);
}

// AO 用の遮蔽判定。未生成チャンクのセルは「不透明」とみなす＝境界の隅が明るく浮く継ぎ目を防ぐ
// （隣チャンクが後でロードされても 6面 dirty では対角は再メッシュされないため。暗めに倒すと自然な陰に見える）。
function aoSolid(x, y, z) {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(z / CS);
    const ch = chunks[chunkKey(cx, cy, cz)];
    if (!ch || !ch.generated) return true;
    return isOpaque(ch.data[((y - cy * CS) * CS + (z - cz * CS)) * CS + (x - cx * CS)]);
}
// 面の外側プレーンで、この隅(lxx,lyy,lzz)に接する辺2隣＋対角の埋まり具合から AO 明度を返す。
function cornerAO(x, y, z, dir, lxx, lyy, lzz) {
    // 面の外側1層へ進む基準
    const ox = x + dir[0], oy = y + dir[1], oz = z + dir[2];
    // 隅の符号（-1 or +1）を面プレーン上の2軸について求める
    let u, v; // 面に平行な2つの軸（単位ベクトル）と、その隅方向の符号
    if (dir[0] !== 0) { u = [0, lyy ? 1 : -1, 0]; v = [0, 0, lzz ? 1 : -1]; }
    else if (dir[1] !== 0) { u = [lxx ? 1 : -1, 0, 0]; v = [0, 0, lzz ? 1 : -1]; }
    else { u = [lxx ? 1 : -1, 0, 0]; v = [0, lyy ? 1 : -1, 0]; }
    const s1 = aoSolid(ox + u[0], oy + u[1], oz + u[2]) ? 1 : 0;
    const s2 = aoSolid(ox + v[0], oy + v[1], oz + v[2]) ? 1 : 0;
    const c  = aoSolid(ox + u[0] + v[0], oy + u[1] + v[1], oz + u[2] + v[2]) ? 1 : 0;
    return AO_SHADE[aoLevel(s1, s2, c)];
}

// ブロック変更時に影響チャンクを dirty 化（境界面は隣チャンクにも属するので 6 近傍も）
function markDirty(x, y, z) {
    dirtyChunks.add(chunkOf(x, y, z));
    dirtyChunks.add(chunkOf(x + 1, y, z)); dirtyChunks.add(chunkOf(x - 1, y, z));
    dirtyChunks.add(chunkOf(x, y + 1, z)); dirtyChunks.add(chunkOf(x, y - 1, z));
    dirtyChunks.add(chunkOf(x, y, z + 1)); dirtyChunks.add(chunkOf(x, y, z - 1));
}
function markChunkAndNeighborsDirty(cx, cy, cz) {
    dirtyChunks.add(chunkKey(cx, cy, cz));
    dirtyChunks.add(chunkKey(cx + 1, cy, cz)); dirtyChunks.add(chunkKey(cx - 1, cy, cz));
    dirtyChunks.add(chunkKey(cx, cy + 1, cz)); dirtyChunks.add(chunkKey(cx, cy - 1, cz));
    dirtyChunks.add(chunkKey(cx, cy, cz + 1)); dirtyChunks.add(chunkKey(cx, cy, cz - 1));
}

// dirty チャンクを再メッシュ。limit を渡すとその数だけ（ストリーミング中の予算制御）。未生成は捨てる。
function flushDirtyChunks(limit) {
    if (dirtyChunks.size === 0) return;
    let n = 0;
    for (const ck of dirtyChunks) {
        const ch = chunks[ck];
        if (ch && ch.generated) buildChunk(ck);
        dirtyChunks.delete(ck);
        if (limit !== undefined && ++n >= limit) return;
    }
}

// ---- 書き込み（プレイヤー設置/採掘/爆破・worldEdits に記録して永続化） ----
function setBlockData(x, y, z, type) {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(z / CS);
    const ck = chunkKey(cx, cy, cz);
    let ch = chunks[ck];
    if (!ch) ch = ensureChunk(cx, cy, cz);     // 未生成域への改変＝先に生成してから書く
    else if (!ch.generated) generateChunk(ch);
    ch.data[((y - cy * CS) * CS + (z - cz * CS)) * CS + (x - cx * CS)] = type;
    _invalidateGetCache();
}

function setBlock(x, y, z, type, defer) {
    setBlockData(x, y, z, type);
    recordEdit(x, y, z, type);                 // 0=撤去も記録（再生成で再適用される）
    if (typeof scheduleEditSave === 'function') scheduleEditSave(); // localStorage へデバウンス保存
    markDirty(x, y, z);
    if (!defer) flushDirtyChunks();
}

function addBlock(x, y, z, type) {
    if (getBlock(x, y, z)) return;
    setBlock(x, y, z, type, false);
}
function removeBlock(x, y, z, defer) {
    if (getBlock(x, y, z) === 0) return;
    setBlock(x, y, z, 0, defer);
}

// 爆発が未生成/アンロード済みチャンクに当たった時用。チャンクを生成せず（＝遠方でフリーズしない）
// 「自然地形なら固体だったはず」のセルだけ撤去 edit を記録＝後でそのチャンクが生成された時に
// クレーターが復元する。ロード済みなら何もしない（その場合は通常の removeBlock 経路が処理済み）。
function carveUnloaded(x, y, z) {
    const ch = chunks[chunkOf(x, y, z)];
    if (ch && ch.generated) return;
    if (y > worldBottomY && y <= terrainHeightAt(x, z)) recordEdit(x, y, z, 0); // 岩盤(worldBottomY)は残す
}

// 世界を空にする（再生成用。共有マテリアル/アトラスは破棄しない）
function clearWorld() {
    for (const ck in chunks) {
        const ch = chunks[ck];
        if (ch.solid) { scene.remove(ch.solid); ch.solid.geometry.dispose(); }
        if (ch.water) { scene.remove(ch.water); ch.water.geometry.dispose(); }
        delete chunks[ck];
    }
    for (const k in editsByChunk) delete editsByChunk[k];
    explosionEvents.length = 0;
    dirtyChunks.clear();
    _invalidateGetCache();
}

// ============================================================
// 手続き地形（決定的ノイズ・地層・領域決定的な裂け目）
// ============================================================
function wnHash(ix, iy, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) +
            Math.imul(iz | 0, 2147483647) + Math.imul(seed | 0, 362437);
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
}
function wnSmooth(t) { return t * t * (3 - 2 * t); }

function valueNoise2(x, z, seed) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const v00 = wnHash(x0, 0, z0, seed),     v10 = wnHash(x0 + 1, 0, z0, seed);
    const v01 = wnHash(x0, 0, z0 + 1, seed), v11 = wnHash(x0 + 1, 0, z0 + 1, seed);
    const sx = wnSmooth(fx), sz = wnSmooth(fz);
    const a = v00 + (v10 - v00) * sx;
    const b = v01 + (v11 - v01) * sx;
    return a + (b - a) * sz;
}

function valueNoise3(x, y, z, seed) {
    const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const sx = wnSmooth(fx), sy = wnSmooth(fy), sz = wnSmooth(fz);
    const c000 = wnHash(x0, y0, z0, seed),     c100 = wnHash(x0 + 1, y0, z0, seed);
    const c010 = wnHash(x0, y0 + 1, z0, seed), c110 = wnHash(x0 + 1, y0 + 1, z0, seed);
    const c001 = wnHash(x0, y0, z0 + 1, seed),     c101 = wnHash(x0 + 1, y0, z0 + 1, seed);
    const c011 = wnHash(x0, y0 + 1, z0 + 1, seed), c111 = wnHash(x0 + 1, y0 + 1, z0 + 1, seed);
    const x00 = c000 + (c100 - c000) * sx, x10 = c010 + (c110 - c010) * sx;
    const x01 = c001 + (c101 - c001) * sx, x11 = c011 + (c111 - c011) * sx;
    const y0v = x00 + (x10 - x00) * sy, y1v = x01 + (x11 - x01) * sy;
    return y0v + (y1v - y0v) * sz;
}

function fbm2(x, z, seed, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise2(x * freq, z * freq, seed + o * 1013);
        norm += amp;
        amp *= 0.5; freq *= 2.0;
    }
    return sum / norm;
}

// 列 (x,z) の地表高（整数Y）。worldSeed で決定・位置非依存＝無限ワールドの土台。
function terrainHeightAt(x, z) {
    const hills = fbm2(x * 0.025, z * 0.025, worldSeed, 4);                       // 細かい起伏
    const mountains = fbm2(x * 0.008 + 99, z * 0.008 + 99, worldSeed + 7777, 3);  // 山/谷
    const continent = fbm2(x * 0.0022 + 311, z * 0.0022 + 311, worldSeed + 4242, 2); // 大陸スケール
    const h = TERRAIN_BASE
        + (hills - 0.5) * 2 * TERRAIN_HILL_AMP
        + (mountains - 0.5) * 2 * TERRAIN_MTN_AMP
        + (continent - 0.5) * 2 * TERRAIN_CONT_AMP;
    return Math.round(h);
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// (x,y,z) と列の地表高 h からブロック種別（地層）
function strataBlockAt(x, y, z, h) {
    const d = h - y;
    const beach = (h <= SEA_LEVEL + 1);
    if (d === 0) {
        if (h < SEA_LEVEL) return BLOCKS.SAND;
        return beach ? BLOCKS.SAND : BLOCKS.GRASS;
    }
    if (d <= 3) return beach ? BLOCKS.SANDSTONE : BLOCKS.DIRT;
    if (y <= worldBottomY + 5) return BLOCKS.DEEPSLATE;
    const pocket = valueNoise3(x * 0.09, y * 0.09, z * 0.09, worldSeed + 31);
    if (pocket > 0.72) {
        const which = valueNoise3(x * 0.05, y * 0.05, z * 0.05, worldSeed + 53);
        if (which < 0.34) return BLOCKS.GRANITE;
        if (which < 0.67) return BLOCKS.DIORITE;
        return BLOCKS.ANDESITE;
    }
    return BLOCKS.STONE;
}

// ---- 領域決定的な裂け目（ravine） ----
// 世界を RAVINE_REGION ごとに区切り、各領域がハッシュで 0/1 本の裂け目を持つ。経路は決定的に
// 生成し、各チャンクは「自分に重なる経路の区間だけ」を彫る＝生成順に依存しない無限の裂け目。
const RAVINE_REGION = 176;
const RAVINE_REGION_PROB = 0.55;
const RAVINE_DEPTH_MIN = 26, RAVINE_DEPTH_VAR = 30; // 本家並みに深く（旧 14+12 → 大幅増）
const _ravineCache = {};               // "rgx,rgz" -> {path, minX,maxX,minZ,maxZ} | null

function ravineForRegion(rgx, rgz) {
    const rk = rgx + ',' + rgz;
    if (rk in _ravineCache) return _ravineCache[rk];
    const rng = mulberry32((wnHash(rgx, 777, rgz, worldSeed ^ 0x9e3779b9) * 4294967296) >>> 0);
    if (rng() > RAVINE_REGION_PROB) { _ravineCache[rk] = null; return null; }
    let cx = rgx * RAVINE_REGION + RAVINE_REGION * (0.2 + rng() * 0.6);
    let cz = rgz * RAVINE_REGION + RAVINE_REGION * (0.2 + rng() * 0.6);
    let ang = rng() * Math.PI * 2;
    const steps = 70 + Math.floor(rng() * 60);
    const maxHalfW = 2.5 + rng() * 3.0;
    const maxDepth = RAVINE_DEPTH_MIN + Math.floor(rng() * RAVINE_DEPTH_VAR);
    const path = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let s = 0; s < steps; s++) {
        const tt = s / steps;
        const taper = Math.sin(tt * Math.PI);
        const halfW = 0.8 + maxHalfW * taper;
        const centerSurf = terrainHeightAt(Math.round(cx), Math.round(cz));
        const botY = Math.max(worldBottomY + 2, centerSurf - Math.floor(6 + maxDepth * taper));
        path.push({ cx: cx, cz: cz, ang: ang, halfW: halfW, botY: botY, centerSurf: centerSurf });
        const m = halfW + 1;
        if (cx - m < minX) minX = cx - m; if (cx + m > maxX) maxX = cx + m;
        if (cz - m < minZ) minZ = cz - m; if (cz + m > maxZ) maxZ = cz + m;
        ang += (valueNoise2(s * 0.08, rgx * 7 + rgz * 13, worldSeed + 13) - 0.5) * 0.5;
        cx += Math.cos(ang); cz += Math.sin(ang);
    }
    const r = { path: path, minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
    _ravineCache[rk] = r;
    return r;
}

// チャンク ch のセル(data)に、近傍領域の裂け目を彫る（空気=0 にする）。
function carveRavinesInChunk(ch) {
    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    const bx1 = bx0 + CS - 1, by1 = by0 + CS - 1, bz1 = bz0 + CS - 1;
    const crgx = Math.floor((bx0 + CS / 2) / RAVINE_REGION);
    const crgz = Math.floor((bz0 + CS / 2) / RAVINE_REGION);
    for (let rgx = crgx - 1; rgx <= crgx + 1; rgx++) {
        for (let rgz = crgz - 1; rgz <= crgz + 1; rgz++) {
            const rav = ravineForRegion(rgx, rgz);
            if (!rav) continue;
            if (rav.maxX < bx0 || rav.minX > bx1 || rav.maxZ < bz0 || rav.minZ > bz1) continue;
            const path = rav.path;
            for (let s = 0; s < path.length; s++) {
                const st = path[s];
                const px = -Math.sin(st.ang), pz = Math.cos(st.ang);
                const denom = Math.max(1, st.centerSurf - st.botY);
                for (let w = -st.halfW; w <= st.halfW; w += 0.5) {
                    const ix = Math.round(st.cx + px * w);
                    const iz = Math.round(st.cz + pz * w);
                    if (ix < bx0 || ix > bx1 || iz < bz0 || iz > bz1) continue;
                    const colSurf = terrainHeightAt(ix, iz);
                    const colTop = Math.max(colSurf + 1, SEA_LEVEL);
                    const yHi = Math.min(colTop, by1);
                    const yLo = Math.max(st.botY, by0);
                    const aw = Math.abs(w);
                    for (let y = yHi; y >= yLo; y--) {
                        const yt = (y - st.botY) / denom;
                        const localW = st.halfW * (0.3 + 0.7 * Math.max(0, Math.min(1, yt)));
                        if (aw <= localW) {
                            const idx = ((y - by0) * CS + (iz - bz0)) * CS + (ix - bx0);
                            const t = ch.data[idx];
                            if (t && t !== BLOCKS.BEDROCK) ch.data[idx] = 0;
                        }
                    }
                }
            }
        }
    }
}

// ---- 決定的な木 ----
const TREE_MARGIN = 2;
function houseZone(x, z) { return (x >= 3 && x <= 11 && z >= 3 && z <= 11); }
function treeAt(wx, wz) {
    if (houseZone(wx, wz)) return false;
    if (villageMask(wx, wz) >= VILLAGE_THRESHOLD) return false; // 村ゾーンには木を生やさない（家と干渉防止）
    const h = terrainHeightAt(wx, wz);
    if (h < SEA_LEVEL + 1) return false;
    if (strataBlockAt(wx, h, wz, h) !== BLOCKS.GRASS) return false;
    return wnHash(wx, 4321, wz, worldSeed + 99) < 0.03;
}
function forEachTreeBlock(x, y, z, cb) { // y=幹の最下段(地表+1)
    for (let i = 0; i < 4; i++) cb(x, y + i, z, BLOCKS.WOOD);
    for (let lx = x - 2; lx <= x + 2; lx++)
        for (let lz = z - 2; lz <= z + 2; lz++)
            for (let ly = y + 2; ly <= y + 3; ly++) {
                if (Math.abs(lx - x) === 2 && Math.abs(lz - z) === 2) continue;
                cb(lx, ly, lz, BLOCKS.LEAVES);
            }
    for (let lx = x - 1; lx <= x + 1; lx++)
        for (let lz = z - 1; lz <= z + 1; lz++) cb(lx, y + 4, lz, BLOCKS.LEAVES);
    cb(x, y + 5, z, BLOCKS.LEAVES);
}
function placeTreesInChunk(ch) {
    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    const bx1 = bx0 + CS - 1, by1 = by0 + CS - 1, bz1 = bz0 + CS - 1;
    for (let wx = bx0 - TREE_MARGIN; wx <= bx1 + TREE_MARGIN; wx++) {
        for (let wz = bz0 - TREE_MARGIN; wz <= bz1 + TREE_MARGIN; wz++) {
            if (!treeAt(wx, wz)) continue;
            const base = terrainHeightAt(wx, wz) + 1;
            forEachTreeBlock(wx, base, wz, (bx, by, bz, type) => {
                if (bx < bx0 || bx > bx1 || by < by0 || by > by1 || bz < bz0 || bz > bz1) return;
                const idx = ((by - by0) * CS + (bz - bz0)) * CS + (bx - bx0);
                if (ch.data[idx] === 0) ch.data[idx] = type; // 空気だけに（幹/既存を侵食しない）
            });
        }
    }
}

// --- 村（標的になる建物群）。グリッド上のアンカーに家を建て、低周波ノイズで「村ゾーン」に集める。
//     チャンクごとに独立計算（決定的）＝チャンク境界をまたぐ家も継ぎ目なく出る（木と同じ方式）。
const VILLAGE_GRID = 11;            // 家アンカーの間隔（家7幅＋通路）
const HOUSE_HW = 3;                 // 家の半径（footprint 7x7）
const VILLAGE_MARGIN = HOUSE_HW + 1;
const VILLAGE_THRESHOLD = 0.62;     // villageMask がこれ以上の所だけ村ゾーン
function villageMask(x, z) { return fbm2(x * 0.006 + 555, z * 0.006 + 555, worldSeed + 321, 2); }
// (ax,az) に家を建てるか。建てるなら {gy,wallH} を返す。すべて決定的。
function houseAt(ax, az) {
    if (villageMask(ax, az) < VILLAGE_THRESHOLD) return null;
    if (wnHash(ax, 222, az, worldSeed + 71) > 0.72) return null;        // 村ゾーン内でも一部は空き地(通路/広場)
    const gy = terrainHeightAt(ax, az);
    if (gy < SEA_LEVEL + 1) return null;                                // 水辺は除外
    if (strataBlockAt(ax, gy, az, gy) !== BLOCKS.GRASS) return null;    // 草地だけ
    let mn = gy, mx = gy;                                               // footprint が平らか（傾斜地は除外）
    for (let i = 0; i < 4; i++) {
        const dx = (i & 1) ? HOUSE_HW : -HOUSE_HW, dz = (i & 2) ? HOUSE_HW : -HOUSE_HW;
        const h = terrainHeightAt(ax + dx, az + dz); if (h < mn) mn = h; if (h > mx) mx = h;
    }
    if (mx - mn > 2) return null;
    return { gy: gy, wallH: 3 + Math.floor(wnHash(ax, 333, az, worldSeed + 91) * 2) }; // 壁の高さ3..4
}
function forEachHouseBlock(ax, gy, az, wallH, cb) {
    const hw = HOUSE_HW, floorY = gy, roofY = floorY + wallH + 1;
    const doorSide = Math.floor(wnHash(ax, 444, az, worldSeed + 13) * 4); // 0:-x 1:+x 2:-z 3:+z
    for (let lx = ax - hw; lx <= ax + hw; lx++) {
        for (let lz = az - hw; lz <= az + hw; lz++) {
            cb(lx, floorY, lz, BLOCKS.WOOD);          // 床
            cb(lx, roofY, lz, BLOCKS.STONE);          // 屋根（石＝木壁とのコントラスト）
            const onEdge = (lx === ax - hw || lx === ax + hw || lz === az - hw || lz === az + hw);
            if (!onEdge) { for (let by = floorY + 1; by <= roofY - 1; by++) cb(lx, by, lz, 0); continue; } // 内部は空洞に
            for (let by = floorY + 1; by <= floorY + wallH; by++) {
                if (by <= floorY + 2) {               // ドア（選ばれた辺の中央・下2マスを開ける）
                    if (doorSide === 0 && lx === ax - hw && lz === az) continue;
                    if (doorSide === 1 && lx === ax + hw && lz === az) continue;
                    if (doorSide === 2 && lz === az - hw && lx === ax) continue;
                    if (doorSide === 3 && lz === az + hw && lx === ax) continue;
                }
                cb(lx, by, lz, BLOCKS.WOOD);          // 壁
            }
        }
    }
}
function placeVillagesInChunk(ch) {
    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    const bx1 = bx0 + CS - 1, by1 = by0 + CS - 1, bz1 = bz0 + CS - 1;
    const ax0 = Math.floor((bx0 - VILLAGE_MARGIN) / VILLAGE_GRID) * VILLAGE_GRID; // 届きうるグリッド点のみ
    const az0 = Math.floor((bz0 - VILLAGE_MARGIN) / VILLAGE_GRID) * VILLAGE_GRID;
    for (let ax = ax0; ax <= bx1 + VILLAGE_MARGIN; ax += VILLAGE_GRID) {
        for (let az = az0; az <= bz1 + VILLAGE_MARGIN; az += VILLAGE_GRID) {
            const house = houseAt(ax, az);
            if (!house) continue;
            forEachHouseBlock(ax, house.gy, az, house.wallH, (bx, by, bz, type) => {
                if (bx < bx0 || bx > bx1 || by < by0 || by > by1 || bz < bz0 || bz > bz1) return;
                ch.data[((by - by0) * CS + (bz - bz0)) * CS + (bx - bx0)] = type; // 上書き（地形の上に建てる）
            });
        }
    }
}

// このチャンクの edit を再適用（プレイヤー改変/家の永続）。自チャンク分だけ見る＝高速。
function applyEditsToChunk(ch) {
    const e = editsByChunk[chunkKey(ch.cx, ch.cy, ch.cz)];
    if (!e) return;
    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    for (const key in e) {
        const p = key.split(',');
        const x = +p[0], y = +p[1], z = +p[2];
        ch.data[((y - by0) * CS + (z - bz0)) * CS + (x - bx0)] = e[key];
    }
}

// ---- チャンク生成 ----
function generateChunk(ch) {
    const bx0 = ch.cx * CS, by0 = ch.cy * CS, bz0 = ch.cz * CS;
    const data = ch.data;
    for (let lz = 0; lz < CS; lz++) {
        for (let lx = 0; lx < CS; lx++) {
            const wx = bx0 + lx, wz = bz0 + lz;
            const h = terrainHeightAt(wx, wz);
            for (let ly = 0; ly < CS; ly++) {
                const wy = by0 + ly;
                let t = 0;
                if (wy < worldBottomY) t = 0;
                else if (wy === worldBottomY) t = BLOCKS.BEDROCK;
                else if (wy <= h) t = strataBlockAt(wx, wy, wz, h);
                else if (wy <= SEA_LEVEL) t = BLOCKS.WATER;
                data[localIdx(lx, ly, lz)] = t;
            }
        }
    }
    carveRavinesInChunk(ch);
    placeVillagesInChunk(ch);        // 村（家）。木より前＝村ゾーンに木を生やさない
    placeTreesInChunk(ch);
    applyExplosionEventsToChunk(ch); // 爆発イベントを再カーブ（block-edit より前＝後から建てた物が上書きで残る）
    applyEditsToChunk(ch);
    ch.generated = true;
    _invalidateGetCache();
}

// チャンクを作って生成。生成後は自分＋6近傍を dirty 化（境界面の再カリング）。
function ensureChunk(cx, cy, cz) {
    const ck = chunkKey(cx, cy, cz);
    let ch = chunks[ck];
    if (ch && ch.generated) return ch;
    if (!ch) {
        ch = { cx: cx, cy: cy, cz: cz, data: new Uint8Array(CHUNK_VOL), generated: false, solid: null, water: null };
        chunks[ck] = ch;
    }
    generateChunk(ch);
    markChunkAndNeighborsDirty(cx, cy, cz);
    return ch;
}

function unloadChunk(ck) {
    const ch = chunks[ck];
    if (!ch) return;
    if (ch.solid) { scene.remove(ch.solid); ch.solid.geometry.dispose(); }
    if (ch.water) { scene.remove(ch.water); ch.water.geometry.dispose(); }
    delete chunks[ck];
    dirtyChunks.delete(ck);
    _invalidateGetCache();
}

// ---- ストリーミング ----
let _minCY = -6, _maxCY = 4;
const LOAD_DEPTH = 72;          // 各列で地表からこの深さまでは常時ロード（深い裂け目も見えるように）
const UNLOAD_MARGIN = 2;        // 水平のアンロード余白（ヒステリシス）
const GEN_BUDGET = 4;           // 1フレームに生成するチャンク上限
const MESH_BUDGET = 6;          // 1フレームに再メッシュするチャンク上限（移動中の追いつき優先）
const MESH_CATCHUP = 14;        // バックログが多い時(大爆発直後等)の上限。フリーズしない範囲で速く消化
const MESH_CATCHUP_AT = 40;     // dirty がこの数を超えたら CATCHUP 予算に切替
const MAX_VIEW = 16;            // VIEW_DIST の上限（スパイラル事前計算用）
let _spiral = null;
let _lastPcx = 2147483647, _lastPcy = 0, _lastPcz = 0; // 直近のプレイヤーチャンク
let _streamSettled = false;    // 視界内が全て生成済み＝今フレームの生成走査をスキップ

function buildSpiral() {
    const arr = [];
    for (let dx = -MAX_VIEW; dx <= MAX_VIEW; dx++)
        for (let dz = -MAX_VIEW; dz <= MAX_VIEW; dz++)
            arr.push({ dx: dx, dz: dz, cheb: Math.max(Math.abs(dx), Math.abs(dz)), d2: dx * dx + dz * dz });
    arr.sort((a, b) => a.d2 - b.d2);
    _spiral = arr;
}

// その列(チャンク)で常時ロードする垂直チャンク範囲 [cyBot, cyTop]
function columnLoadRange(ccx, ccz) {
    const surf = terrainHeightAt(ccx * CS + (CS >> 1), ccz * CS + (CS >> 1));
    const top = Math.max(surf, SEA_LEVEL) + 8;
    const bot = surf - LOAD_DEPTH;
    let cyTop = Math.floor(top / CS), cyBot = Math.floor(bot / CS);
    if (cyTop > _maxCY) cyTop = _maxCY;
    if (cyBot < _minCY) cyBot = _minCY;
    return [cyBot, cyTop];
}

// プレイヤー周囲の未生成チャンクを近い順に生成し、遠方をアンロード。
function streamWorld(px, py, pz) {
    if (!_spiral) buildSpiral();
    const pcx = Math.floor(px / CS), pcy = Math.floor(py / CS), pcz = Math.floor(pz / CS);
    const moved = (pcx !== _lastPcx || pcy !== _lastPcy || pcz !== _lastPcz);
    if (moved) _streamSettled = false;
    if (!moved && _streamSettled) return;   // 視界内は全生成済み＆移動無し＝走査スキップ（定常の空回り回避）
    _lastPcx = pcx; _lastPcy = pcy; _lastPcz = pcz;

    let gen = 0, pending = false;
    for (let i = 0; i < _spiral.length && !pending; i++) {
        const o = _spiral[i];
        if (o.cheb > VIEW_DIST) break;
        const ccx = pcx + o.dx, ccz = pcz + o.dz;
        const range = columnLoadRange(ccx, ccz);
        let cyLo = range[0], cyHi = range[1];
        // プレイヤーの上下も追加（掘り下げ/上昇で周囲が見えるように）
        if (pcy - 1 < cyLo) cyLo = Math.max(_minCY, pcy - 1);
        if (pcy + 1 > cyHi) cyHi = Math.min(_maxCY, pcy + 1);
        // 上(地表)から下へ＝予算制限下でも見える地表/近景が先に出現する
        for (let ccy = cyHi; ccy >= cyLo; ccy--) {
            const ch = chunks[chunkKey(ccx, ccy, ccz)];
            if (!ch || !ch.generated) {
                if (gen >= GEN_BUDGET) { pending = true; break; }
                ensureChunk(ccx, ccy, ccz); gen++;
            }
        }
    }
    _streamSettled = !pending;                // 走査が予算で打ち切られず完了＝視界内は全生成済み
    if (moved) _streamUnload(pcx, pcy, pcz);  // アンロードはチャンクを跨いだ時だけ（全チャンク走査の節約）
}
function _streamUnload(pcx, pcy, pcz) {
    const far = VIEW_DIST + UNLOAD_MARGIN;
    for (const ck in chunks) {
        const ch = chunks[ck];
        if (Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)) > far) { unloadChunk(ck); continue; }
        // 垂直: 列のロード範囲＋プレイヤー近傍(±2のヒステリシス)から外れた深部/高所を破棄（掘り下げ後の漏れ防止）
        const range = columnLoadRange(ch.cx, ch.cz);
        if (ch.cy < Math.min(range[0], pcy - 2) || ch.cy > Math.max(range[1], pcy + 2)) unloadChunk(ck);
    }
    // ravine キャッシュの遠方領域を刈る（無限探索でのメモリリーク防止）
    const rfar = Math.ceil((far * CS) / RAVINE_REGION) + 2;
    const prgx = Math.floor((pcx * CS) / RAVINE_REGION), prgz = Math.floor((pcz * CS) / RAVINE_REGION);
    for (const rk in _ravineCache) {
        const c = rk.indexOf(',');
        if (Math.abs(+rk.slice(0, c) - prgx) > rfar || Math.abs(+rk.slice(c + 1) - prgz) > rfar) delete _ravineCache[rk];
    }
}

// (x,z) 列の最上段の固体（非水）ブロックYを返す。無ければ worldBottomY。
function columnTopY(x, z) {
    for (let y = maxSurfaceY + 2; y > worldBottomY; y--) {
        const t = getBlock(x, y, z);
        if (t && !(BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide)) return y;
    }
    return worldBottomY;
}

// 乾いた陸地のスポーン地点を中央付近から渦巻き状に探す（スポーン周辺は生成済み前提）。
function spawnPlayer() {
    let best = null, fallback = null;
    for (let r = 0; r <= 24 && !best; r++) {
        for (let dx = -r; dx <= r && !best; dx++) {
            for (let dz = -r; dz <= r && !best; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                const top = columnTopY(dx, dz);
                if (top < SEA_LEVEL) continue;
                const tb = getBlock(dx, top, dz);
                if (tb === BLOCKS.WOOD || tb === BLOCKS.LEAVES) {
                    if (!fallback) fallback = { x: dx, z: dz, y: top };
                    continue;
                }
                best = { x: dx, z: dz, y: top };
            }
        }
    }
    if (!best) best = fallback || { x: 0, z: 0, y: Math.max(columnTopY(0, 0), SEA_LEVEL) };
    camera.position.set(best.x, best.y + 2.6, best.z);
    controls.velocity.set(0, 0, 0);
}

// ---- 開始時の家を worldEdits に焼く（決定的な位置・永続） ----
function seedHouse() {
    const hx = 5, hz = 5;
    let baseY = terrainHeightAt(hx + 2, hz + 2);
    if (baseY < SEA_LEVEL) baseY = SEA_LEVEL;
    const edit = (x, y, z, t) => { recordEdit(x, y, z, t); };
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            const x = hx + i, z = hz + j;
            for (let y = baseY + 1; y <= baseY + 8; y++) edit(x, y, z, 0);        // 上を空ける
            for (let y = baseY - 4; y <= baseY; y++) edit(x, y, z, y === baseY ? BLOCKS.GRASS : BLOCKS.DIRT); // 平らな土台
        }
    }
    seedHouseStructure(hx, baseY + 1, hz, edit);
}
function seedHouseStructure(x, y, z, edit) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) edit(x + i, y, z + j, BLOCKS.WOOD); // 床
    for (let dy = 1; dy <= 3; dy++) {
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                if (i === 0 || i === 4 || j === 0 || j === 4) {
                    if (dy < 3 && i === 2 && j === 0) continue;                 // ドア
                    if (dy === 2 && (i === 0 || i === 4) && j === 2) continue;  // 窓
                    edit(x + i, y + dy, z + j, BLOCKS.WOOD);
                }
            }
        }
    }
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) edit(x + i, y + 4, z + j, BLOCKS.LEAVES); // 屋根
}

// ---- 起動/再生成 ----
let materialsReady = false;
const BOOT_RADIUS = 2; // 起動時に同期生成する水平半径（残りはストリーミング）

function recomputeVerticalBounds() {
    worldBottomY = SEA_LEVEL - 1 - WORLD_DEPTH;
    // 地表の理論最大高 = 中心(TERRAIN_BASE) + 全振幅。最高峰がチャンク垂直範囲(maxCY)から
    // こぼれてクリップされないよう余白を足す（TERRAIN_BASE 基準・SEA_LEVEL 基準ではない）。
    maxSurfaceY = TERRAIN_BASE + TERRAIN_HILL_AMP + TERRAIN_MTN_AMP + TERRAIN_CONT_AMP + 8;
    _minCY = Math.floor(worldBottomY / CS);
    _maxCY = Math.floor(maxSurfaceY / CS);
}

function generateWorld() {
    if (!materialsReady) { initMaterials(); materialsReady = true; }
    clearWorld();
    for (const k in _ravineCache) delete _ravineCache[k]; // シード/深さ変更で裂け目も作り直し
    _streamSettled = false; _lastPcx = 2147483647;        // 次フレームで必ず再ストリーミング

    if (!worldSeed) worldSeed = (Math.floor(Math.random() * 0x7fffffff)) || 12345;
    recomputeVerticalBounds();
    seedHouse(); // worldEdits に家を焼く（生成時に適用される）
    if (typeof loadPersistedEdits === 'function') loadPersistedEdits(); // 保存済み改変を復元（同シードのみ）

    if (!_spiral) buildSpiral();
    // スポーン周辺を同期生成（足元の地面＋近景）。残りは animate の streamWorld が埋める。
    for (let i = 0; i < _spiral.length; i++) {
        const o = _spiral[i];
        if (o.cheb > BOOT_RADIUS) break;
        const range = columnLoadRange(o.dx, o.dz);
        for (let ccy = range[0]; ccy <= range[1]; ccy++) ensureChunk(o.dx, ccy, o.dz);
    }
    flushDirtyChunks(); // 起動チャンクを一括メッシュ化
    applyFog();
}

function regenerateWorld() {
    worldSeed = 0;                 // 新シード
    generateWorld();
    spawnPlayer();
    controls.isFlying = false;
    const fly = document.getElementById('fly-mode-indicator');
    if (fly) fly.style.display = 'none';
}

// --- ボクセル DDA レイキャスト（採掘/設置/着弾のピッキング。メッシュ非依存） ---
// ★座標規約: ブロックは整数座標を「中心」に [N-0.5,N+0.5] を占める。origin+0.5 してから floor で
//   セル番号=round(world) となり中心規約に一致（この +0.5 を壊すと全ピッキングが半ブロック狂う）。
function voxelRaycast(origin, dir, maxDist, hitWater) {
    const ox = origin.x + 0.5, oy = origin.y + 0.5, oz = origin.z + 0.5;
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dir.x > 0 ? 1 : (dir.x < 0 ? -1 : 0);
    const stepY = dir.y > 0 ? 1 : (dir.y < 0 ? -1 : 0);
    const stepZ = dir.z > 0 ? 1 : (dir.z < 0 ? -1 : 0);
    const tDeltaX = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDeltaY = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDeltaZ = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : (stepX < 0 ? (ox - x) * tDeltaX : Infinity);
    let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : (stepY < 0 ? (oy - y) * tDeltaY : Infinity);
    let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : (stepZ < 0 ? (oz - z) * tDeltaZ : Infinity);

    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let guard = 0; guard < 512; guard++) {
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
        } else if (tMaxY < tMaxZ) {
            y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
        } else {
            z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
        }
        if (t > maxDist) return null;
        const tp = getBlock(x, y, z);
        if (tp) {
            if (!hitWater) {
                const p = BLOCK_PROPS[tp];
                if (p && p.noCollide) continue;
            }
            return { x: x, y: y, z: z, type: tp, nx: nx, ny: ny, nz: nz, dist: t };
        }
    }
    return null;
}
