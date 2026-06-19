// --- 6. Physics & Collision ---
const raycaster = new THREE.Raycaster();

function getCollidingBlocks(playerPos) {
    const playerBox = new THREE.Box3(
        new THREE.Vector3(playerPos.x - 0.3, playerPos.y - 1.5, playerPos.z - 0.3),
        new THREE.Vector3(playerPos.x + 0.3, playerPos.y + 0.2, playerPos.z + 0.3)
    );

    const hits = [];
    const px = Math.floor(playerPos.x);
    const py = Math.floor(playerPos.y);
    const pz = Math.floor(playerPos.z);

    for(let x=px-1; x<=px+1; x++) {
        for(let y=py-2; y<=py+2; y++) {
            for(let z=pz-1; z<=pz+1; z++) {
                const bt = getBlock(x,y,z);
                if(bt) {
                    const props = BLOCK_PROPS[bt];
                    if (props && props.noCollide) continue;

                    const blockBox = new THREE.Box3(
                        new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5),
                        new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5)
                    );
                    if(playerBox.intersectsBox(blockBox)) {
                        hits.push(blockBox);
                    }
                }
            }
        }
    }
    return hits;
}

// TNT用のブロック衝突チェック
function checkBlockCollision(pos, radius) {
    const px = Math.floor(pos.x);
    const py = Math.floor(pos.y);
    const pz = Math.floor(pos.z);

    for (let x = px - 1; x <= px + 1; x++) {
        for (let y = py - 1; y <= py + 1; y++) {
            for (let z = pz - 1; z <= pz + 1; z++) {
                const bt = getBlock(x, y, z);
                if (bt) {
                    const props = BLOCK_PROPS[bt];
                    if (props && props.noCollide) continue; // 水などはスキップ

                    // 簡易的な距離チェック
                    const dx = pos.x - (x + 0.5);
                    const dy = pos.y - (y + 0.5);
                    const dz = pos.z - (z + 0.5);

                    if (Math.abs(dx) < (0.5 + radius) &&
                        Math.abs(dy) < (0.5 + radius) &&
                        Math.abs(dz) < (0.5 + radius)) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}
