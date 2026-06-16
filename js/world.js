// --- 5. World Generation ---
const chunks = {};
const blockData = {};
// 地形ブロックのメッシュだけを保持するリスト（レイキャスト対象を限定するため）
const blockMeshes = [];

function getKey(x, y, z) { return `${x},${y},${z}`; }

function addBlock(x, y, z, type) {
    const key = getKey(x, y, z);
    if (chunks[key]) return;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = materials[type];
    const mesh = new THREE.Mesh(geometry, material);

    if (type === BLOCKS.WATER) {
        mesh.scale.y = 0.8;
        mesh.position.set(x, y - 0.1, z);
    } else {
        mesh.position.set(x, y, z);
    }

    scene.add(mesh);

    chunks[key] = mesh;
    blockData[key] = type;
    mesh.userData = { type: type, x:x, y:y, z:z };
    blockMeshes.push(mesh);
}

function removeBlock(x, y, z) {
    const key = getKey(x, y, z);
    if (chunks[key]) {
        const mesh = chunks[key];
        scene.remove(mesh);
        mesh.geometry.dispose();
        const idx = blockMeshes.indexOf(mesh);
        if (idx !== -1) blockMeshes.splice(idx, 1);
        delete chunks[key];
        delete blockData[key];
    }
}

function generateWorld() {
    initMaterials();

    const offset = Math.floor(WORLD_SIZE / 2);

    for (let x = -offset; x < offset; x++) {
        for (let z = -offset; z < offset; z++) {

            const isRiver = (x > 8 && x < 13);

            if (isRiver) {
                addBlock(x, 0, z, BLOCKS.BEDROCK);
                addBlock(x, 1, z, BLOCKS.STONE);
                addBlock(x, 2, z, BLOCKS.WATER);
            } else {
                addBlock(x, 0, z, BLOCKS.BEDROCK);
                addBlock(x, 1, z, BLOCKS.STONE);
                addBlock(x, 2, z, BLOCKS.GRASS);

                // Prevent tree spawn near center or near the house (5,3,5) to (9,3,9)
                const nearCenter = Math.abs(x) < 4 && Math.abs(z) < 4;
                const nearHouse = x >= 4 && x <= 10 && z >= 4 && z <= 10;

                if (!nearCenter && !nearHouse && Math.random() < 0.03 && x > -offset+2 && x < offset-2 && z > -offset+2 && z < offset-2) {
                    createTree(x, 3, z);
                }
            }
        }
    }

    // Build a small house near the spawn
    createHouse(5, 3, 5);
}

function createTree(x, y, z) {
    for(let i=0; i<4; i++) addBlock(x, y+i, z, BLOCKS.WOOD);
    for(let lx=x-2; lx<=x+2; lx++) {
        for(let lz=z-2; lz<=z+2; lz++) {
            for(let ly=y+2; ly<=y+3; ly++) {
                if (Math.abs(lx-x) === 2 && Math.abs(lz-z) === 2) continue;
                if (getKey(lx, ly, lz) in chunks) continue;
                addBlock(lx, ly, lz, BLOCKS.LEAVES);
            }
        }
    }
    for(let lx=x-1; lx<=x+1; lx++) {
        for(let lz=z-1; lz<=z+1; lz++) {
             if (getKey(lx, y+4, lz) in chunks) continue;
             addBlock(lx, y+4, lz, BLOCKS.LEAVES);
        }
    }
    addBlock(x, y+5, z, BLOCKS.LEAVES);
}

function createHouse(x, y, z) {
    // Floor
    for(let i=0; i<5; i++) {
        for(let j=0; j<5; j++) {
            addBlock(x+i, y, z+j, BLOCKS.WOOD);
        }
    }
    // Walls & Air
    for(let dy=1; dy<=3; dy++) {
        for(let i=0; i<5; i++) {
            for(let j=0; j<5; j++) {
                if(i===0 || i===4 || j===0 || j===4) {
                    // Door hole
                    if(dy<3 && i===2 && j===0) continue;
                    // Window hole
                    if(dy===2 && (i===0 || i===4) && j===2) continue;

                    addBlock(x+i, y+dy, z+j, BLOCKS.WOOD);
                }
            }
        }
    }
    // Roof
    for(let i=0; i<5; i++) {
        for(let j=0; j<5; j++) {
            addBlock(x+i, y+4, z+j, BLOCKS.LEAVES);
        }
    }
}
