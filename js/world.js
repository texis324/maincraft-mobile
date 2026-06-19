// --- 5. World Generation（チャンクメッシュ化） ---
// blockData: すべての固体ブロック（地中の埋没ブロック含む）を type で保持＝衝突/爆破/採掘の真実。
// 描画は「世界を 16³ のチャンクに分割し、各チャンクの露出している面だけを 1 つの
// BufferGeometry にマージ」する方式。draw call が『ブロック数』から『チャンク数(数十)』に激減し、
// 一辺 128 でも 60fps を狙える。テクスチャは textures.js のアトラス（solidMaterial/waterMaterial）。
//
// 旧方式（1 ブロック = 1 THREE.Mesh）からの置き換え:
//   - blockMeshes 配列 / chunks(key->mesh) / sharedBlockGeometry は廃止。
//   - 採掘/設置/着弾のピッキングは intersectObjects ではなく voxelRaycast（DDA）。
//   - 衝突判定(physics.js)は元から blockData 参照なので無改修。

const blockData = {};                 // "x,y,z" -> type（固体の真実）
const CHUNK_SIZE = 16;
const chunkMeshes = {};               // "cx,cy,cz" -> { solid: Mesh|null, water: Mesh|null }
const dirtyChunks = new Set();        // 再構築が必要なチャンクキー
let bulkBuild = false;                // true の間 addBlock/removeBlock はメッシュ再構築をしない（生成/再生成用）

function getKey(x, y, z) { return `${x},${y},${z}`; }
function chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }
function chunkOf(x, y, z) {
    return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
}

// 面カリング用：その type が「隣の面を隠す不透明固体」か。
// 水は transparent+noCollide で非遮蔽。葉は BLOCK_PROPS にフラグが無い＝不透明扱い（旧仕様を踏襲）。
function isOpaque(type) {
    if (!type) return false;
    const p = BLOCK_PROPS[type];
    if (p && (p.transparent || p.noCollide)) return false;
    return true;
}

// selfType のブロックが (nx,ny,nz) 方向の面を描くべきか。
// ・ワールド底より下は遮蔽（裏面を描かない）
// ・隣が空気＝描く / 隣が不透明＝隠れる / 隣が同種の半透明(水-水)＝隠す / それ以外の半透明＝描く
function faceVisible(selfType, nx, ny, nz) {
    if (ny < worldBottomY) return false;
    const nt = blockData[getKey(nx, ny, nz)];
    if (!nt) return true;
    if (isOpaque(nt)) return false;
    if (nt === selfType) return false;
    return true;
}

// 立方体 6 面の定義。c=ローカル[0,1]の4隅、uv=各隅のタイル内UV(s,t)、slot=タイル種別、dir=外向き法線。
// 巻き順は addFace 内で法線から自動補正するので、ここでは UV の向き（高 Y にテクスチャ上端）だけ合わせる。
const FACE_LIST = [
    { dir: [1, 0, 0],  slot: 'side',   c: [[1,0,0],[1,0,1],[1,1,1],[1,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [-1, 0, 0], slot: 'side',   c: [[0,0,1],[0,0,0],[0,1,0],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, 1, 0],  slot: 'top',    c: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, -1, 0], slot: 'bottom', c: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, 0, 1],  slot: 'side',   c: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], uv: [[0,0],[1,0],[1,1],[0,1]] },
    { dir: [0, 0, -1], slot: 'side',   c: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], uv: [[0,0],[1,0],[1,1],[0,1]] }
];

// 4 隅を buffer へ。法線×外向きが負なら巻きを反転（表が外を向くよう自動補正）。
function addFace(buf, corners, uvs, dir) {
    const ax = corners[1][0] - corners[0][0], ay = corners[1][1] - corners[0][1], az = corners[1][2] - corners[0][2];
    const bx = corners[2][0] - corners[0][0], by = corners[2][1] - corners[0][1], bz = corners[2][2] - corners[0][2];
    const cxn = ay * bz - az * by, cyn = az * bx - ax * bz, czn = ax * by - ay * bx;
    let c = corners, u = uvs;
    if (cxn * dir[0] + cyn * dir[1] + czn * dir[2] < 0) {
        c = [corners[3], corners[2], corners[1], corners[0]];
        u = [uvs[3], uvs[2], uvs[1], uvs[0]];
    }
    const base = buf.v;
    for (let k = 0; k < 4; k++) {
        buf.pos.push(c[k][0], c[k][1], c[k][2]);
        buf.nor.push(dir[0], dir[1], dir[2]);
        buf.uv.push(u[k][0], u[k][1]);
    }
    buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    buf.v = base + 4;
}

// チャンク 1 つのジオメトリを作り直す。
// cells を渡すと「そのチャンクに実在するブロックだけ」を走査する（生成/再生成の高速パス）。
// 省略時は 16^3 を密に走査（採掘/設置/爆破の単一チャンク増分再構築用＝チャンク数が少ないので軽い）。
function buildChunk(ck, cells) {
    const old = chunkMeshes[ck];
    if (old) {
        if (old.solid) { scene.remove(old.solid); old.solid.geometry.dispose(); }
        if (old.water) { scene.remove(old.water); old.water.geometry.dispose(); }
    }

    const parts = ck.split(',');
    const cx = +parts[0], cy = +parts[1], cz = +parts[2];
    const bx0 = cx * CHUNK_SIZE, by0 = cy * CHUNK_SIZE, bz0 = cz * CHUNK_SIZE;

    const solid = { pos: [], nor: [], uv: [], idx: [], v: 0 };
    const water = { pos: [], nor: [], uv: [], idx: [], v: 0 };
    const stoneIdx = BLOCK_TILE_IDX[BLOCKS.STONE];

    // 1セル分の露出面をバッファへ積む
    function emitCell(x, y, z, t) {
        const isWater = (t === BLOCKS.WATER);
        const buf = isWater ? water : solid;
        const tiles = BLOCK_TILE_IDX[t] || stoneIdx;
        for (let f = 0; f < FACE_LIST.length; f++) {
            const F = FACE_LIST[f];
            const nx = x + F.dir[0], ny = y + F.dir[1], nz = z + F.dir[2];
            if (!faceVisible(t, nx, ny, nz)) continue;

            const rect = tileUV(tiles[F.slot]);
            const du = rect.u1 - rect.u0, dv = rect.vTop - rect.vBot;
            const corners = [], uvs = [];
            for (let k = 0; k < 4; k++) {
                const lx = F.c[k][0], ly = F.c[k][1], lz = F.c[k][2];
                // 水は高さ 0.8（上面 y+0.3・底 y-0.5）で旧来の「水面が少し低い」見た目を維持
                const wy = isWater ? (ly ? y + 0.3 : y - 0.5) : (y - 0.5 + ly);
                corners.push([x - 0.5 + lx, wy, z - 0.5 + lz]);
                uvs.push([rect.u0 + F.uv[k][0] * du, rect.vBot + F.uv[k][1] * dv]);
            }
            addFace(buf, corners, uvs, F.dir);
        }
    }

    if (cells) {
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            emitCell(c[0], c[1], c[2], c[3]);
        }
    } else {
        for (let x = bx0; x < bx0 + CHUNK_SIZE; x++) {
            for (let y = by0; y < by0 + CHUNK_SIZE; y++) {
                for (let z = bz0; z < bz0 + CHUNK_SIZE; z++) {
                    const t = blockData[getKey(x, y, z)];
                    if (t) emitCell(x, y, z, t);
                }
            }
        }
    }

    const entry = { solid: null, water: null };
    if (solid.v > 0) entry.solid = makeChunkMesh(solid, solidMaterial);
    if (water.v > 0) entry.water = makeChunkMesh(water, waterMaterial);

    if (entry.solid || entry.water) chunkMeshes[ck] = entry;
    else delete chunkMeshes[ck];
}

function makeChunkMesh(buf, material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
    g.setIndex(buf.idx);
    const mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = true;
    scene.add(mesh);
    return mesh;
}

// ブロック変更時に影響チャンクを dirty 化（境界面は隣チャンクにも属するので 6 近傍も）
function markDirty(x, y, z) {
    dirtyChunks.add(chunkOf(x, y, z));
    dirtyChunks.add(chunkOf(x + 1, y, z)); dirtyChunks.add(chunkOf(x - 1, y, z));
    dirtyChunks.add(chunkOf(x, y + 1, z)); dirtyChunks.add(chunkOf(x, y - 1, z));
    dirtyChunks.add(chunkOf(x, y, z + 1)); dirtyChunks.add(chunkOf(x, y, z - 1));
}

function flushDirtyChunks() {
    if (dirtyChunks.size === 0) return;
    for (const ck of dirtyChunks) buildChunk(ck);
    dirtyChunks.clear();
}

// blockData にあるブロックを含む全チャンクを一括構築（生成/再生成用）。
// 1パスでブロックをチャンク別に振り分け、各チャンクは実在セルだけを走査する（空セル総当たり回避）。
function buildAllChunks() {
    const groups = {};
    for (const key in blockData) {
        const p = key.split(',');
        const x = +p[0], y = +p[1], z = +p[2];
        const ck = chunkOf(x, y, z);
        (groups[ck] || (groups[ck] = [])).push([x, y, z, blockData[key]]);
    }
    for (const ck in groups) buildChunk(ck, groups[ck]);
    dirtyChunks.clear();
}

// プレイヤー設置・木・家など（データ登録＋メッシュ反映）
function addBlock(x, y, z, type) {
    const key = getKey(x, y, z);
    if (blockData[key]) return;
    blockData[key] = type;
    if (bulkBuild) return;
    markDirty(x, y, z);
    flushDirtyChunks();
}

// ブロック削除。defer=true なら即再構築せず dirty 化だけ（爆破の一括処理用）。
function removeBlock(x, y, z, defer) {
    const key = getKey(x, y, z);
    if (blockData[key] === undefined) return;
    delete blockData[key];
    if (bulkBuild) return;
    markDirty(x, y, z);
    if (!defer) flushDirtyChunks();
}

// 世界を空にする（再生成用。共有マテリアル/アトラスは破棄しない）
function clearWorld() {
    for (const ck in chunkMeshes) {
        const c = chunkMeshes[ck];
        if (c.solid) { scene.remove(c.solid); c.solid.geometry.dispose(); }
        if (c.water) { scene.remove(c.water); c.water.geometry.dispose(); }
        delete chunkMeshes[ck];
    }
    for (const k in blockData) delete blockData[k];
    dirtyChunks.clear();
}

// ============================================================
// 手続き地形生成（ノイズ・地層・裂け目）
// 外部ライブラリ無しの決定的バリューノイズ。worldSeed で再現性を持たせる。
// ============================================================
function getKey2(x, z) { return x + ',' + z; }

// 整数格子点のハッシュ -> [0,1)
function wnHash(ix, iy, iz, seed) {
    let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) +
            Math.imul(iz | 0, 2147483647) + Math.imul(seed | 0, 362437);
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
}
function wnSmooth(t) { return t * t * (3 - 2 * t); }

// 2D バリューノイズ [0,1)
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

// 3D バリューノイズ [0,1)（鉱石ポケットの配置用）
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

// fractal Brownian motion（2D・[0,1)）
function fbm2(x, z, seed, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * valueNoise2(x * freq, z * freq, seed + o * 1013);
        norm += amp;
        amp *= 0.5; freq *= 2.0;
    }
    return sum / norm;
}

// 列 (x,z) の地表高（整数Y）。worldSeed で決定。
function terrainHeightAt(x, z) {
    const hills = fbm2(x * 0.025, z * 0.025, worldSeed, 4);                       // 細かい起伏
    const mountains = fbm2(x * 0.008 + 99, z * 0.008 + 99, worldSeed + 7777, 3);  // 大地形（山/谷）
    const h = TERRAIN_BASE
        + (hills - 0.5) * 2 * TERRAIN_HILL_AMP
        + (mountains - 0.5) * 2 * TERRAIN_MTN_AMP;
    return Math.round(h);
}

// シード付きRNG（mulberry32）。裂け目の配置に使う（seedで再現可能）。
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// (x,y,z) と列の地表高 h からブロック種別（地層）を決める
function strataBlockAt(x, y, z, h) {
    const d = h - y;                       // 地表からの深さ（0=地表）
    const beach = (h <= SEA_LEVEL + 1);    // 海面近く＝砂浜/浅瀬の底

    if (d === 0) {                          // 地表
        if (h < SEA_LEVEL) return BLOCKS.SAND;   // 水没した湖底
        return beach ? BLOCKS.SAND : BLOCKS.GRASS;
    }
    if (d <= 3) {                           // 表土（土 or 砂岩）
        return beach ? BLOCKS.SANDSTONE : BLOCKS.DIRT;
    }
    if (y <= worldBottomY + 5) return BLOCKS.DEEPSLATE; // 最深部の深層岩

    // 石＋鉱石ポケット（花崗岩/閃緑岩/安山岩）
    const pocket = valueNoise3(x * 0.09, y * 0.09, z * 0.09, worldSeed + 31);
    if (pocket > 0.72) {
        const which = valueNoise3(x * 0.05, y * 0.05, z * 0.05, worldSeed + 53);
        if (which < 0.34) return BLOCKS.GRANITE;
        if (which < 0.67) return BLOCKS.DIORITE;
        return BLOCKS.ANDESITE;
    }
    return BLOCKS.STONE;
}

// 1本の裂け目（ravine）を彫る。蛇行しながら細く深いV字の溝を掘り、断面に地層を露出させる。
function carveRavine(rng) {
    const half = Math.floor(WORLD_SIZE / 2);
    let cx = (rng() * 2 - 1) * half * 0.5;
    let cz = (rng() * 2 - 1) * half * 0.5;
    let ang = rng() * Math.PI * 2;
    const steps = Math.floor(WORLD_SIZE * (0.8 + rng() * 0.6));
    const maxHalfW = 2.0 + rng() * 2.5;            // 横半幅の最大（中央で最大・端で細る）
    const maxDepth = 14 + Math.floor(rng() * 12);  // 深さ
    for (let s = 0; s < steps; s++) {
        const tt = s / steps;
        const taper = Math.sin(tt * Math.PI);      // 端で0・中央で1
        const halfW = 0.8 + maxHalfW * taper;
        const centerSurf = terrainHeightAt(Math.round(cx), Math.round(cz));
        const botY = Math.max(worldBottomY + 2, centerSurf - Math.floor(4 + maxDepth * taper));
        const px = -Math.sin(ang), pz = Math.cos(ang); // 進行方向に直交
        for (let w = -halfW; w <= halfW; w += 0.5) {
            const ix = Math.round(cx + px * w);
            const iz = Math.round(cz + pz * w);
            const colSurf = terrainHeightAt(ix, iz);   // 列ごとの天面（オーバーハング防止）
            const denom = Math.max(1, centerSurf - botY);
            // 水没列は水面(SEA_LEVEL)まで掘る。さもないと水の塊が宙に浮く（地面だけ消えて水が残る）
            const colTop = Math.max(colSurf + 1, SEA_LEVEL);
            for (let y = colTop; y >= botY; y--) {
                const yt = (y - botY) / denom;          // 0=底 1=天面
                const localW = halfW * (0.3 + 0.7 * Math.max(0, Math.min(1, yt))); // 深いほど狭まる
                if (Math.abs(w) <= localW) {
                    const k = getKey(ix, y, iz);
                    const t = blockData[k];
                    if (t && t !== BLOCKS.BEDROCK) delete blockData[k];
                }
            }
        }
        ang += (valueNoise2(s * 0.08, 50, worldSeed + 13) - 0.5) * 0.5; // 蛇行
        cx += Math.cos(ang);
        cz += Math.sin(ang);
        if (Math.abs(cx) > half - 2 || Math.abs(cz) > half - 2) break;
    }
}

// (x,z) 列の最上段の固体（非水）ブロックYを返す。無ければ worldBottomY。
function columnTopY(x, z) {
    for (let y = maxSurfaceY + 2; y > worldBottomY; y--) {
        const t = blockData[getKey(x, y, z)];
        if (t && !(BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide)) return y;
    }
    return worldBottomY;
}
// 乾いた陸地のスポーン地点を中央付近から渦巻き状に探し、プレイヤーを配置する。
// 中央が湖/裂け目だと水中に沈むので「海面以上の固体の天面」を最初に見つけた所へ。
function spawnPlayer() {
    const half = Math.floor(WORLD_SIZE / 2) - 2;
    let best = null, fallback = null;
    for (let r = 0; r <= half && !best; r++) {
        for (let dx = -r; dx <= r && !best; dx++) {
            for (let dz = -r; dz <= r && !best; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // リング外周だけ走査
                const top = columnTopY(dx, dz);
                if (top < SEA_LEVEL) continue;
                const tb = blockData[getKey(dx, top, dz)];
                if (tb === BLOCKS.WOOD || tb === BLOCKS.LEAVES) {  // 木/家の上は避ける
                    if (!fallback) fallback = { x: dx, z: dz, y: top };
                    continue;
                }
                best = { x: dx, z: dz, y: top }; // 自然な地面の上を優先
            }
        }
    }
    if (!best) best = fallback || { x: 0, z: 0, y: Math.max(columnTopY(0, 0), SEA_LEVEL) };
    camera.position.set(best.x, best.y + 2.6, best.z);
    controls.velocity.set(0, 0, 0);
}

let materialsReady = false;

function generateWorld() {
    if (!materialsReady) { initMaterials(); materialsReady = true; }
    clearWorld();

    if (!worldSeed) worldSeed = (Math.floor(Math.random() * 0x7fffffff)) || 12345;

    const offset = Math.floor(WORLD_SIZE / 2);

    // --- 1) 高さマップを先に算出（岩盤の底・スポーン・カリングの基準を決める） ---
    const heights = {};
    let minH = Infinity, maxH = -Infinity;
    for (let x = -offset; x < offset; x++) {
        for (let z = -offset; z < offset; z++) {
            const h = terrainHeightAt(x, z);
            heights[getKey2(x, z)] = h;
            if (h < minH) minH = h;
            if (h > maxH) maxH = h;
        }
    }
    const floorRef = Math.min(minH, SEA_LEVEL);          // 水没列も考慮
    worldBottomY = floorRef - 1 - WORLD_DEPTH;            // 岩盤は最深地表の更に下
    maxSurfaceY = Math.max(maxH, SEA_LEVEL);

    bulkBuild = true; // データだけ敷き詰め、最後に一括メッシュ化

    // --- 2) 固体データ（地層）を敷き詰める＋海面まで水で満たす ---
    for (let x = -offset; x < offset; x++) {
        for (let z = -offset; z < offset; z++) {
            const h = heights[getKey2(x, z)];
            blockData[getKey(x, worldBottomY, z)] = BLOCKS.BEDROCK;
            for (let y = worldBottomY + 1; y <= h; y++) {
                blockData[getKey(x, y, z)] = strataBlockAt(x, y, z, h);
            }
            if (h < SEA_LEVEL) {  // 海面以下の空気を水で満たす（谷＝湖/海）
                for (let y = h + 1; y <= SEA_LEVEL; y++) {
                    blockData[getKey(x, y, z)] = BLOCKS.WATER;
                }
            }
        }
    }

    // --- 3) 裂け目（ravine）を彫る ---
    const rng = makeRng((worldSeed ^ 0x9e3779b9) >>> 0);
    const ravineCount = Math.max(1, Math.round(WORLD_SIZE / 48)); // 32/64→1, 128→3 程度
    for (let r = 0; r < ravineCount; r++) carveRavine(rng);

    // --- 4) 木と家（地表高に合わせて配置。bulkBuild 中はデータ登録のみ） ---
    for (let x = -offset + 2; x < offset - 2; x++) {
        for (let z = -offset + 2; z < offset - 2; z++) {
            const h = heights[getKey2(x, z)];
            if (h < SEA_LEVEL + 1) continue;            // 水際/水没には生やさない
            if (blockData[getKey(x, h, z)] !== BLOCKS.GRASS) continue; // 草の上だけ（裂け目で消えた所も避ける）
            const nearHouse = (x >= 4 && x <= 10 && z >= 4 && z <= 10);
            if (!nearHouse && Math.random() < 0.03) createTree(x, h + 1, z);
        }
    }
    placeHouseOnTerrain(5, 5);

    bulkBuild = false;
    buildAllChunks(); // 露出面だけを各チャンクのメッシュへ一括マージ

    // ワールドサイズが変わった可能性があるので fog を新サイズで再設定
    applyFog();
}

// 家を地表に置く（5x5 の土台を平らに均してから建てる）
function placeHouseOnTerrain(hx, hz) {
    let baseY = terrainHeightAt(hx + 2, hz + 2);
    if (baseY < SEA_LEVEL) baseY = SEA_LEVEL;  // 水没地には海面まで土台を上げる
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            const x = hx + i, z = hz + j;
            for (let y = baseY + 1; y <= maxSurfaceY + 6; y++) delete blockData[getKey(x, y, z)]; // 上部を撤去
            for (let y = worldBottomY + 1; y <= baseY; y++) {
                if (!blockData[getKey(x, y, z)] || blockData[getKey(x, y, z)] === BLOCKS.WATER) {
                    blockData[getKey(x, y, z)] = (y === baseY ? BLOCKS.GRASS : BLOCKS.DIRT);
                }
            }
        }
    }
    createHouse(hx, baseY + 1, hz);
}

// スライダー値で世界を作り直し、プレイヤーを地上にリセット（新しい地形＝新シード）
function regenerateWorld() {
    worldSeed = 0; // 再生成のたびに新しい地形
    generateWorld();
    spawnPlayer();
    controls.isFlying = false;
    const fly = document.getElementById('fly-mode-indicator');
    if (fly) fly.style.display = 'none';
}

function createTree(x, y, z) {
    for (let i = 0; i < 4; i++) addBlock(x, y + i, z, BLOCKS.WOOD);
    for (let lx = x - 2; lx <= x + 2; lx++) {
        for (let lz = z - 2; lz <= z + 2; lz++) {
            for (let ly = y + 2; ly <= y + 3; ly++) {
                if (Math.abs(lx - x) === 2 && Math.abs(lz - z) === 2) continue;
                if (blockData[getKey(lx, ly, lz)]) continue;
                addBlock(lx, ly, lz, BLOCKS.LEAVES);
            }
        }
    }
    for (let lx = x - 1; lx <= x + 1; lx++) {
        for (let lz = z - 1; lz <= z + 1; lz++) {
            if (blockData[getKey(lx, y + 4, lz)]) continue;
            addBlock(lx, y + 4, lz, BLOCKS.LEAVES);
        }
    }
    addBlock(x, y + 5, z, BLOCKS.LEAVES);
}

function createHouse(x, y, z) {
    // Floor
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            addBlock(x + i, y, z + j, BLOCKS.WOOD);
        }
    }
    // Walls & Air
    for (let dy = 1; dy <= 3; dy++) {
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                if (i === 0 || i === 4 || j === 0 || j === 4) {
                    if (dy < 3 && i === 2 && j === 0) continue; // Door hole
                    if (dy === 2 && (i === 0 || i === 4) && j === 2) continue; // Window hole
                    addBlock(x + i, y + dy, z + j, BLOCKS.WOOD);
                }
            }
        }
    }
    // Roof
    for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
            addBlock(x + i, y + 4, z + j, BLOCKS.LEAVES);
        }
    }
}

// --- ボクセル DDA レイキャスト（採掘/設置/着弾のピッキング。メッシュ非依存） ---
// origin から dir 方向へ最大 maxDist まで進み、最初の固体セルを返す。
// hitWater=false なら水(noCollide)はすり抜ける（弾の着弾用）。
// 戻り値: { x,y,z, type, nx,ny,nz(命中面の外向き法線), dist } または null
function voxelRaycast(origin, dir, maxDist, hitWater) {
    // ★重要: ブロックは整数座標を「中心」に [N-0.5, N+0.5] を占める（描画 buildChunk の x-0.5+lx、
    // 衝突 physics.js の blockBox=[x-0.5,x+0.5] と同じ規約）。素朴な floor(origin) だとセルを
    // [N,N+1) として歩き、実ジオメトリと 0.5 ずれて採掘/設置/着弾が半ブロック狂う。
    // 原点を +0.5 してから floor すると セル番号 = round(world) となり中心規約に一致する。
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
    // 安全上限（無限ループ防止）
    for (let guard = 0; guard < 512; guard++) {
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
        } else if (tMaxY < tMaxZ) {
            y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
        } else {
            z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
        }
        if (t > maxDist) return null;
        const tp = blockData[getKey(x, y, z)];
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
