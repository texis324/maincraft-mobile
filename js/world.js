// --- 5. World Generation (サーフェスカリング対応) ---
// blockData: すべての固体ブロック（地中の埋没ブロック含む）を type で保持＝衝突/爆破の真実
// chunks:    実際にメッシュを持つ（＝見えている）ブロックだけ key->mesh
// blockMeshes: レイキャスト対象（chunksのmesh配列）
const chunks = {};
const blockData = {};
const blockMeshes = [];

// 全地形ブロックで共有する単位ジオメトリ（個別 dispose しない＝メモリ激減）
const sharedBlockGeometry = new THREE.BoxGeometry(1, 1, 1);

function getKey(x, y, z) { return `${x},${y},${z}`; }

// 不透明な固体か（水・葉など透過は隣を遮蔽しない＝隣面は見える扱い）
function isOpaqueSolid(key) {
    const t = blockData[key];
    if (!t) return false;
    const p = BLOCK_PROPS[t];
    if (p && (p.noCollide || p.transparent)) return false;
    return true;
}

// 隣セルが「面を遮蔽するか」。ワールド底より下は遮蔽扱い＝裏面を描かない
function neighborOccludes(nx, ny, nz) {
    if (ny < worldBottomY) return true;
    return isOpaqueSolid(getKey(nx, ny, nz));
}

// 6面のうち1つでも露出していれば true
function isExposed(x, y, z) {
    return !neighborOccludes(x + 1, y, z) || !neighborOccludes(x - 1, y, z)
        || !neighborOccludes(x, y + 1, z) || !neighborOccludes(x, y - 1, z)
        || !neighborOccludes(x, y, z + 1) || !neighborOccludes(x, y, z - 1);
}

// このセルにメッシュを持たせるべきか（透過ブロックは常に描画／不透明は露出時のみ）
function shouldRender(x, y, z) {
    const t = blockData[getKey(x, y, z)];
    if (!t) return false;
    const p = BLOCK_PROPS[t];
    if (p && (p.transparent || p.noCollide)) return true;
    return isExposed(x, y, z);
}

// メッシュを生成して登録（データは既にあること前提）
function spawnMesh(x, y, z, type) {
    const key = getKey(x, y, z);
    if (chunks[key]) return;

    const material = materials[type];
    const mesh = new THREE.Mesh(sharedBlockGeometry, material);

    if (type === BLOCKS.WATER) {
        mesh.scale.y = 0.8;
        mesh.position.set(x, y - 0.1, z);
    } else {
        mesh.position.set(x, y, z);
    }

    scene.add(mesh);
    chunks[key] = mesh;
    // meshIndex を持たせて removeBlock を O(1) にする
    mesh.userData = { type: type, x: x, y: y, z: z, meshIndex: blockMeshes.length };
    blockMeshes.push(mesh);
}

// データがあって未メッシュかつ露出していればメッシュ化（採掘/爆破で隣が見えた時）
function revealIfNeeded(x, y, z) {
    const key = getKey(x, y, z);
    if (!blockData[key] || chunks[key]) return;
    if (shouldRender(x, y, z)) spawnMesh(x, y, z, blockData[key]);
}

// プレイヤー設置・木・建物など（データ登録＋即メッシュ。設置物は露出しているので描画）
function addBlock(x, y, z, type) {
    const key = getKey(x, y, z);
    if (blockData[key]) return;
    blockData[key] = type;
    spawnMesh(x, y, z, type);
}

// メッシュだけ外す（共有ジオメトリ/マテリアルは dispose しない）
function detachMesh(key) {
    const mesh = chunks[key];
    if (!mesh) return;
    scene.remove(mesh);
    const idx = mesh.userData.meshIndex;
    if (idx !== undefined && blockMeshes[idx] === mesh) {
        const last = blockMeshes[blockMeshes.length - 1];
        blockMeshes[idx] = last;
        last.userData.meshIndex = idx;
        blockMeshes.pop();
    } else {
        const i = blockMeshes.indexOf(mesh);
        if (i !== -1) blockMeshes.splice(i, 1);
    }
    delete chunks[key];
}

// ブロック削除。skipReveal=true なら隣の再メッシュをしない（爆破の一括処理用）
function removeBlock(x, y, z, skipReveal) {
    const key = getKey(x, y, z);
    if (blockData[key] === undefined) return;
    detachMesh(key);
    delete blockData[key];
    if (!skipReveal) {
        revealIfNeeded(x + 1, y, z); revealIfNeeded(x - 1, y, z);
        revealIfNeeded(x, y + 1, z); revealIfNeeded(x, y - 1, z);
        revealIfNeeded(x, y, z + 1); revealIfNeeded(x, y, z - 1);
    }
}

// 世界を空にする（再生成用。共有資産は破棄しない）
function clearWorld() {
    for (const key in chunks) scene.remove(chunks[key]);
    blockMeshes.length = 0;
    for (const k in chunks) delete chunks[k];
    for (const k in blockData) delete blockData[k];
}

let materialsReady = false;

function generateWorld() {
    if (!materialsReady) { initMaterials(); materialsReady = true; }
    clearWorld();

    const offset = Math.floor(WORLD_SIZE / 2);
    worldBottomY = SURFACE_Y - 1 - WORLD_DEPTH; // 岩盤の底

    // --- 1) 固体データを敷き詰める（メッシュはまだ作らない） ---
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

    // --- 2) 露出している地形ブロックだけメッシュ化（地表＋外周の崖） ---
    for (let x = -offset; x < offset; x++) {
        for (let z = -offset; z < offset; z++) {
            for (let y = worldBottomY; y <= SURFACE_Y; y++) {
                if (shouldRender(x, y, z)) spawnMesh(x, y, z, blockData[getKey(x, y, z)]);
            }
        }
    }

    // --- 3) 木と家（addBlock＝即メッシュ。地表より上で露出している） ---
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
