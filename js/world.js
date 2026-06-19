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

// チャンク 1 つのジオメトリを作り直す
function buildChunk(ck) {
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

    for (let x = bx0; x < bx0 + CHUNK_SIZE; x++) {
        for (let y = by0; y < by0 + CHUNK_SIZE; y++) {
            for (let z = bz0; z < bz0 + CHUNK_SIZE; z++) {
                const t = blockData[getKey(x, y, z)];
                if (!t) continue;
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

// blockData にあるブロックを含む全チャンクを一括構築（生成/再生成用）
function buildAllChunks() {
    const set = new Set();
    for (const key in blockData) {
        const p = key.split(',');
        set.add(chunkOf(+p[0], +p[1], +p[2]));
    }
    for (const ck of set) buildChunk(ck);
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

let materialsReady = false;

function generateWorld() {
    if (!materialsReady) { initMaterials(); materialsReady = true; }
    clearWorld();

    const offset = Math.floor(WORLD_SIZE / 2);
    worldBottomY = SURFACE_Y - 1 - WORLD_DEPTH; // 岩盤の底

    bulkBuild = true; // データだけ敷き詰め、最後に一括メッシュ化

    // --- 1) 固体データを敷き詰める ---
    for (let x = -offset; x < offset; x++) {
        for (let z = -offset; z < offset; z++) {
            const isRiver = (x > 8 && x < 13);
            blockData[getKey(x, worldBottomY, z)] = BLOCKS.BEDROCK;
            for (let y = worldBottomY + 1; y <= SURFACE_Y - 1; y++) {
                blockData[getKey(x, y, z)] = BLOCKS.STONE;
            }
            blockData[getKey(x, SURFACE_Y, z)] = isRiver ? BLOCKS.WATER : BLOCKS.GRASS;
        }
    }

    // --- 2) 木と家（addBlock。bulkBuild 中はデータ登録のみ） ---
    for (let x = -offset; x < offset; x++) {
        for (let z = -offset; z < offset; z++) {
            if (x > 8 && x < 13) continue; // 川には木を生やさない
            const nearCenter = Math.abs(x) < 4 && Math.abs(z) < 4;
            const nearHouse = x >= 4 && x <= 10 && z >= 4 && z <= 10;
            if (!nearCenter && !nearHouse && Math.random() < 0.03 &&
                x > -offset + 2 && x < offset - 2 && z > -offset + 2 && z < offset - 2) {
                createTree(x, SURFACE_Y + 1, z);
            }
        }
    }
    createHouse(5, SURFACE_Y + 1, 5);

    bulkBuild = false;
    buildAllChunks(); // 露出面だけを各チャンクのメッシュへ一括マージ

    // ワールドサイズが変わった可能性があるので fog を新サイズで再設定
    applyFog();
}

// スライダー値で世界を作り直し、プレイヤーを地上にリセット
function regenerateWorld() {
    generateWorld();
    camera.position.set(0, SURFACE_Y + 4, 0);
    controls.velocity.set(0, 0, 0);
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
