// --- 7. TNT Mechanics (Physics Based) ---
const primedTNTs = []; // List of active TNT entities

// 着火TNTのメッシュ（複製ジオメトリ・マテリアル）を破棄してメモリリークを防ぐ
function disposePrimedTNTMesh(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
    } else if (mesh.material) {
        mesh.material.dispose();
    }
}

function createPrimedTNT(x, y, z, velocity, isMega = false) {
    // Remove block if it exists
    removeBlock(x, y, z);

    const geometry = new THREE.BoxGeometry(0.98, 0.98, 0.98); // Slightly smaller
    // Clone materials for flashing
    let mat = materials[isMega ? BLOCKS.MEGA_TNT : BLOCKS.TNT];
    if(Array.isArray(mat)) mat = mat.map(m => m.clone());
    else mat = mat.clone();

    const mesh = new THREE.Mesh(geometry, mat);
    // FIX: Ensure it spawns exactly centered on grid to prevent clipping
    mesh.position.set(x, y, z);
    scene.add(mesh);

    // Add slight randomness to fuse so they don't explode all at once in a stack
    // MEGA TNTは少し長めの導火線
    const fuse = isMega ? (4.0 + Math.random() * 0.5) : (3.0 + Math.random() * 0.5);

    primedTNTs.push({
        mesh: mesh,
        velocity: velocity || new THREE.Vector3(0, 0, 0),
        fuse: fuse,
        flashTimer: 0,
        isMega: isMega, // MEGA TNTかどうかのフラグ
        grounded: false // 接地フラグ
    });
}

function igniteTNT(x, y, z, velocity, isMega = false) {
    playSound('ignite');
    // Default small hop if triggered by player
    const initialVel = velocity || new THREE.Vector3((Math.random()-0.5)*0.2, 0.3, (Math.random()-0.5)*0.2);
    createPrimedTNT(x, y, z, initialVel, isMega);
}

function updatePrimedTNTs(delta) {
    const limit = WORLD_SIZE / 2 - 1.0;

    for (let i = primedTNTs.length - 1; i >= 0; i--) {
        const tnt = primedTNTs[i];

        // Physics - 接地していない場合のみ重力を適用
        if (!tnt.grounded) {
            tnt.velocity.y -= GRAVITY * delta;
        }

        // Wall Reflection
        if (tnt.mesh.position.x > limit) {
            tnt.mesh.position.x = limit;
            tnt.velocity.x *= -0.5;
        } else if (tnt.mesh.position.x < -limit) {
            tnt.mesh.position.x = -limit;
            tnt.velocity.x *= -0.5;
        }

        if (tnt.mesh.position.z > limit) {
            tnt.mesh.position.z = limit;
            tnt.velocity.z *= -0.5;
        } else if (tnt.mesh.position.z < -limit) {
            tnt.mesh.position.z = -limit;
            tnt.velocity.z *= -0.5;
        }

        // 位置更新
        const currentPos = tnt.mesh.position.clone();
        const nextPos = currentPos.clone().add(tnt.velocity.clone().multiplyScalar(delta));

        // X方向の衝突チェック
        const checkXPos = new THREE.Vector3(nextPos.x, currentPos.y, currentPos.z);
        if (checkBlockCollision(checkXPos, 0.4)) {
            tnt.velocity.x *= -0.3;
            nextPos.x = currentPos.x;
        }

        // Z方向の衝突チェック
        const checkZPos = new THREE.Vector3(currentPos.x, currentPos.y, nextPos.z);
        if (checkBlockCollision(checkZPos, 0.4)) {
            tnt.velocity.z *= -0.3;
            nextPos.z = currentPos.z;
        }

        // Y方向の衝突チェック（下）
        // ブロックは中心座標で配置されている（Y=2のブロックは上面Y=2.5、下面Y=1.5）
        const tntCenterY = nextPos.y;
        const tntBottomY = tntCenterY - 0.49;

        // TNTの底面より下にあるブロックを探す
        const blockBelowY = Math.floor(tntBottomY);
        const groundKey = getKey(Math.floor(nextPos.x), blockBelowY, Math.floor(nextPos.z));
        const hasGroundBelow = blockData[groundKey] && !BLOCK_PROPS[blockData[groundKey]]?.noCollide;

        if (tnt.velocity.y <= 0 && hasGroundBelow) {
            // 地面ブロックの上面Y座標（ブロック中心 + 0.5）
            const groundTopY = blockBelowY + 0.5;

            // TNTの底面が地面の上面より下なら衝突
            if (tntBottomY <= groundTopY) {
                // 速度が小さければ完全に停止
                if (Math.abs(tnt.velocity.y) < 3) {
                    tnt.velocity.y = 0;
                    tnt.velocity.x *= 0.3;
                    tnt.velocity.z *= 0.3;
                    tnt.grounded = true;
                } else {
                    // バウンド（かなり減衰）
                    tnt.velocity.y *= -0.15;
                    tnt.velocity.x *= 0.5;
                    tnt.velocity.z *= 0.5;
                }
                // 地面の上に配置（TNTの中心 = 地面の上面 + TNTの半分の高さ）
                nextPos.y = groundTopY + 0.49;
            }
        } else if (tnt.grounded) {
            // 接地中だったが下にブロックがなくなった場合
            const checkY = Math.floor(nextPos.y - 0.5);
            const checkGroundKey = getKey(Math.floor(nextPos.x), checkY, Math.floor(nextPos.z));
            if (!blockData[checkGroundKey] || BLOCK_PROPS[blockData[checkGroundKey]]?.noCollide) {
                tnt.grounded = false;
            }
        }

        // Y方向の衝突チェック（上）
        const tntTopY = tntCenterY + 0.49;
        const ceilingCheckY = Math.floor(tntTopY);
        const ceilingKey = getKey(Math.floor(nextPos.x), ceilingCheckY, Math.floor(nextPos.z));
        const hasCeilingAbove = blockData[ceilingKey] && !BLOCK_PROPS[blockData[ceilingKey]]?.noCollide;

        if (tnt.velocity.y > 0 && hasCeilingAbove) {
            tnt.velocity.y *= -0.2;
            // 天井ブロックの下面 = ceilingCheckY - 0.5
            nextPos.y = (ceilingCheckY - 0.5) - 0.49;
        }

        // 速度が非常に小さくなったら停止
        if (Math.abs(tnt.velocity.x) < 0.1) tnt.velocity.x = 0;
        if (Math.abs(tnt.velocity.z) < 0.1) tnt.velocity.z = 0;

        tnt.mesh.position.copy(nextPos);

        // Fuse & Flash
        tnt.fuse -= delta;
        tnt.flashTimer += delta;

        // Blink frequency increases as fuse shortens
        const blinkSpeed = tnt.fuse < 1.0 ? 0.1 : 0.5;

        if (tnt.flashTimer > blinkSpeed) {
            tnt.flashTimer = 0;
            const isWhite = tnt.mesh.material[0].emissive.r > 0;
            const color = isWhite ? new THREE.Color(0x000000) : new THREE.Color(0xFFFFFF);
            if(Array.isArray(tnt.mesh.material)) tnt.mesh.material.forEach(m => m.emissive = color);
            else tnt.mesh.material.emissive = color;
        }

        if (tnt.fuse <= 0) {
            explode(tnt.mesh.position.x, tnt.mesh.position.y, tnt.mesh.position.z, tnt.isMega);
            scene.remove(tnt.mesh);
            disposePrimedTNTMesh(tnt.mesh); // 複製したジオメトリ・マテリアルを破棄
            primedTNTs.splice(i, 1);
        }
    }
}

// --- Rocket (Bullet) System ---
const rockets = [];

function fireRocket() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);

    // 銃弾の形状（細長い）
    const rocketGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6);
    const rocketMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const rocket = new THREE.Mesh(rocketGeo, rocketMat);

    // 弾の向きを進行方向に合わせる
    rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    // 発射位置
    const spawnPos = camera.position.clone().add(dir.clone().multiplyScalar(1));
    rocket.position.copy(spawnPos);

    scene.add(rocket);

    // ゆっくり直線的に飛ぶ
    rockets.push({
        mesh: rocket,
        velocity: dir.multiplyScalar(20), // 遅めのスピード
        power: rocketPower // 威力設定
    });

    playSound('shoot');
    triggerGunRecoil();
}

function disposeRocketMesh(mesh) {
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
}

function updateRockets(delta) {
    for (let i = rockets.length - 1; i >= 0; i--) {
        const rocket = rockets[i];

        // 位置更新
        const movement = rocket.velocity.clone().multiplyScalar(delta);
        rocket.mesh.position.add(movement);

        let hit = false;

        // 衝突チェック（レイキャスト） - 地形ブロックのみを対象にする
        const rayDir = rocket.velocity.clone().normalize();
        const rocketRay = new THREE.Raycaster(rocket.mesh.position, rayDir, 0, movement.length() + 0.2);
        const intersects = rocketRay.intersectObjects(blockMeshes, false);
        for (const intersect of intersects) {
            const props = BLOCK_PROPS[intersect.object.userData.type];
            if (props && props.noCollide) continue; // 水はすり抜ける
            hit = true;
            break;
        }

        // ブロックとの直接衝突チェック
        const pos = rocket.mesh.position;
        const blockKey = getKey(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (blockData[blockKey] && !BLOCK_PROPS[blockData[blockKey]]?.noCollide) {
            hit = true;
        }

        // ワールド境界チェック
        const limit = WORLD_SIZE / 2;
        if (Math.abs(pos.x) > limit || Math.abs(pos.z) > limit || pos.y < 0 || pos.y > 50) {
            hit = true;
        }

        if (hit) {
            // 爆発（威力に応じた半径）
            const explosionRadius = 1 + rocket.power * 0.5; // 1.5 ~ 6
            explode(pos.x, pos.y, pos.z, false, explosionRadius);

            scene.remove(rocket.mesh);
            disposeRocketMesh(rocket.mesh);
            rockets.splice(i, 1);
        }
    }
}

function explode(cx, cy, cz, isMega = false, customRadius = null) {
    playSound('explode');

    // MEGA TNTは半径2倍、ダメージとノックバックも強化
    const radius = customRadius !== null ? customRadius : (isMega ? 8 : 4);
    const particleCount = isMega ? 60 : 30;
    const particleSize = isMega ? 0.6 : 0.4;
    createBlockParticles(cx, cy, cz, isMega ? BLOCKS.MEGA_TNT : BLOCKS.TNT, particleCount, particleSize);

    // Affect blocks and other TNTs
    for(let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        for(let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
            for(let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
                const dist = Math.sqrt((x-cx)**2 + (y-cy)**2 + (z-cz)**2);
                if(dist <= radius) {
                    const key = getKey(x,y,z);

                    // Check for block
                    if(blockData[key] && blockData[key] !== BLOCKS.BEDROCK) {
                        if (blockData[key] === BLOCKS.TNT) {
                            // Propel TNT
                            const dx = x - cx;
                            const dy = y - cy;
                            const dz = z - cz;
                            // Normalized direction * force (MEGA TNTはより強い力)
                            const force = (1 - dist / radius) * (isMega ? 30 : 20);
                            const velocity = new THREE.Vector3(dx, dy + 0.5, dz).normalize().multiplyScalar(force);

                            igniteTNT(x, y, z, velocity, false);
                        } else if (blockData[key] === BLOCKS.MEGA_TNT) {
                            // MEGA TNTの誘爆
                            const dx = x - cx;
                            const dy = y - cy;
                            const dz = z - cz;
                            const force = (1 - dist / radius) * (isMega ? 35 : 25);
                            const velocity = new THREE.Vector3(dx, dy + 0.5, dz).normalize().multiplyScalar(force);

                            igniteTNT(x, y, z, velocity, true); // MEGA TNTとして点火
                        } else {
                            if(Math.random() < 0.3) createBlockParticles(x, y, z, blockData[key], 2, 0.15);
                            removeBlock(x, y, z);
                        }
                    }
                }
            }
        }
    }

    // Also push existing Primed TNTs (着火済みTNTを吹き飛ばす)
    const pushForceMultiplier = isMega ? 45 : 30;
    for(let i=0; i<primedTNTs.length; i++) {
        const tnt = primedTNTs[i];
        const dist = tnt.mesh.position.distanceTo(new THREE.Vector3(cx, cy, cz));
        if(dist < radius * 2 && dist > 0.1) { // 自分自身は除外
            const dir = new THREE.Vector3().subVectors(tnt.mesh.position, new THREE.Vector3(cx, cy, cz)).normalize();
            const force = (1 - dist / (radius * 2)) * pushForceMultiplier;
            dir.y += 0.3; // 上方向に少し加える
            dir.normalize();
            tnt.velocity.add(dir.multiplyScalar(force));
            tnt.grounded = false; // 地面から離す
        }
    }

    const distToPlayer = camera.position.distanceTo(new THREE.Vector3(cx, cy, cz));
    // MEGA TNTはより広い範囲でダメージ、より大きなダメージとノックバック
    const damageRadius = isMega ? radius * 2.5 : radius * 2;
    const maxDamage = isMega ? 120 : 80;
    const knockbackForce = isMega ? 50 : 30;
    if(distToPlayer < damageRadius) {
        const damage = Math.floor((1 - (distToPlayer / damageRadius)) * maxDamage);
        takeDamage(damage);

        // Knockback player even if flying? Maybe reduce it.
        // controls.velocity はカメラのローカル座標系なので、ワールド方向を
        // yaw で逆回転させてから加える（そのまま加えると向きがズレる）。
        const dir = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(cx, cy, cz)).normalize();
        const wx = dir.x * knockbackForce;
        const wz = dir.z * knockbackForce;
        const yaw = camera.rotation.y;
        controls.velocity.x += Math.cos(yaw) * wx - Math.sin(yaw) * wz;
        controls.velocity.z += Math.sin(yaw) * wx + Math.cos(yaw) * wz;
        controls.velocity.y += dir.y * knockbackForce;
    }
}

// --- Particles ---
const particles = [];
// 全パーティクルで共有する単位ジオメトリ（個別 dispose しないことで描画バグを防ぐ）
const particleGeometry = new THREE.BoxGeometry(1, 1, 1);
// 色ごとにマテリアルをキャッシュして再利用する
const particleMaterialCache = {};
function getParticleMaterial(color) {
    if (!particleMaterialCache[color]) {
        particleMaterialCache[color] = new THREE.MeshBasicMaterial({ color: color });
    }
    return particleMaterialCache[color];
}

function createBlockParticles(x, y, z, type, count=8, size=0.15) {
    const props = BLOCK_PROPS[type];
    const color = props ? props.color : 0x888888;
    const mat = getParticleMaterial(color);

    for(let i=0; i<count; i++) {
        const mesh = new THREE.Mesh(particleGeometry, mat);
        mesh.position.set(x + (Math.random()-0.5)*0.5, y + (Math.random()-0.5)*0.5, z + (Math.random()-0.5)*0.5);
        mesh.scale.set(size, size, size);

        const vel = new THREE.Vector3(
            (Math.random()-0.5) * 8,
            (Math.random() * 8),
            (Math.random()-0.5) * 8
        );

        mesh.userData = { velocity: vel, life: 1.0 + Math.random() * 0.5, size: size };
        scene.add(mesh);
        particles.push(mesh);
    }
}

function updateParticles(delta) {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.userData.life -= delta * 2;
        p.userData.velocity.y -= GRAVITY * delta;
        p.position.add(p.userData.velocity.clone().multiplyScalar(delta));

        const scale = Math.max(0, p.userData.life) * p.userData.size;
        p.scale.set(scale, scale, scale);

        if (p.userData.life <= 0 || p.position.y < -10) {
            // ジオメトリ・マテリアルは共有しているので dispose しない
            scene.remove(p);
            particles.splice(i, 1);
        }
    }
}
