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

// bombKind: null(通常) | 'nuke'(原爆) | 'hbomb'(水爆)。impactDetonate: 空爆＝着弾で爆発
function createPrimedTNT(x, y, z, velocity, isMega = false, bombKind = null, impactDetonate = false) {
    // Remove block if it exists
    removeBlock(x, y, z);

    const geometry = new THREE.BoxGeometry(0.98, 0.98, 0.98); // Slightly smaller
    // Clone materials for flashing
    let matType = BLOCKS.TNT;
    if (bombKind === 'nuke') matType = BLOCKS.NUKE;
    else if (bombKind === 'hbomb') matType = BLOCKS.HBOMB;
    else if (isMega) matType = BLOCKS.MEGA_TNT;
    let mat = materials[matType];
    if(Array.isArray(mat)) mat = mat.map(m => m.clone());
    else mat = mat.clone();

    const mesh = new THREE.Mesh(geometry, mat);
    // FIX: Ensure it spawns exactly centered on grid to prevent clipping
    mesh.position.set(x, y, z);
    scene.add(mesh);

    // Add slight randomness to fuse so they don't explode all at once in a stack
    // MEGA TNTは少し長め、原爆/水爆はさらに長め（逃げる/飛んで眺める時間）
    let fuse = 3.0 + Math.random() * 0.5;
    if (bombKind) fuse = 5.0 + Math.random() * 0.5;
    else if (isMega) fuse = 4.0 + Math.random() * 0.5;
    if (impactDetonate) fuse = 999; // 空爆は時間でなく着弾で爆発

    primedTNTs.push({
        mesh: mesh,
        velocity: velocity || new THREE.Vector3(0, 0, 0),
        fuse: fuse,
        flashTimer: 0,
        isMega: isMega,            // MEGA TNTかどうか
        bombKind: bombKind,        // 'nuke' / 'hbomb' / null
        impactDetonate: impactDetonate, // 着弾起爆（空爆）
        grounded: false            // 接地フラグ
    });
}

function igniteTNT(x, y, z, velocity, isMega = false, bombKind = null) {
    playSound('ignite');
    // Default small hop if triggered by player
    const initialVel = velocity || new THREE.Vector3((Math.random()-0.5)*0.2, 0.3, (Math.random()-0.5)*0.2);
    createPrimedTNT(x, y, z, initialVel, isMega, bombKind);
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
                if (tnt.impactDetonate) {
                    // 空爆＝着弾した瞬間に爆発
                    tnt.fuse = 0;
                } else if (Math.abs(tnt.velocity.y) < 3) {
                    // 速度が小さければ完全に停止
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
            explode(tnt.mesh.position.x, tnt.mesh.position.y, tnt.mesh.position.z, tnt.isMega, null, tnt.bombKind);
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

// --- 空爆（カーペットボミング）。上空から爆弾を降らせて着弾爆発 ---
function callAirstrike() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x); // 進行方向の横
    const startAhead = 6;          // プレイヤーの少し前から
    const spacing = 4;             // 爆弾の前後間隔
    const count = 12;              // 爆弾数
    const dropY = SURFACE_Y + 45;  // 上空から投下
    const base = camera.position.clone();
    playSound('shoot');
    for (let i = 0; i < count; i++) {
        const along = startAhead + i * spacing;
        const lateral = (Math.random() - 0.5) * 4;
        const px = base.x + dir.x * along + right.x * lateral;
        const pz = base.z + dir.z * along + right.z * lateral;
        // 少しずつ時間差で投下（落下→着弾で爆発）
        setTimeout(() => {
            playSound('whistle'); // 落下開始の瞬間に「ヒューーン」
            createPrimedTNT(px, dropY, pz,
                new THREE.Vector3((Math.random() - 0.5), -8, (Math.random() - 0.5)),
                false, null, true); // impactDetonate
        }, i * 110);
    }
}

// bombKind: null | 'nuke' | 'hbomb'
function explode(cx, cy, cz, isMega = false, customRadius = null, bombKind = null) {
    const isBomb = (bombKind === 'nuke' || bombKind === 'hbomb');

    // 原爆/水爆は専用の演出（ホワイトフラッシュ・キノコ雲・画面揺れ・重低音）
    if (isBomb) {
        playSound('nuke');
        triggerNukeFlash();
        if (bombKind === 'hbomb') {
            setTimeout(triggerNukeFlash, 130); // 二段フラッシュ
            nukeScreenShake(1.3, 0.09);
        } else {
            nukeScreenShake();
        }
    } else {
        playSound('explode');
    }

    // 半径: 明示指定(customRadius・ミサイルairburst等)が最優先 > 水爆 > 原爆 > MEGA(8) > 通常(4)
    let radius;
    if (customRadius !== null) radius = customRadius;
    else if (bombKind === 'hbomb') radius = hbombPower;
    else if (bombKind === 'nuke') radius = nukePower;
    else radius = isMega ? 8 : 4;

    const particleCount = isBomb ? (bombKind === 'hbomb' ? 220 : 140) : (isMega ? 60 : 30);
    const particleSize = isBomb ? 0.9 : (isMega ? 0.6 : 0.4);
    const particleType = bombKind === 'hbomb' ? BLOCKS.HBOMB : (bombKind === 'nuke' ? BLOCKS.NUKE : (isMega ? BLOCKS.MEGA_TNT : BLOCKS.TNT));
    createBlockParticles(cx, cy, cz, particleType, particleCount, particleSize);
    if (isBomb) createMushroomCloud(cx, cy, cz, radius);

    // --- 地形を球状にえぐる（深さ対応・サーフェスカリング向けに二段処理） ---
    // 掘る深さは爆心から最大30まで（岩盤は残す）。深いマップで底まで掘って激重になるのを防ぐ
    const bottomY = Math.max(worldBottomY + 1, Math.floor(cy) - Math.min(radius, 30));
    const R = radius, R2 = R * R;
    function inBlast(x, y, z) {
        if (y < bottomY) return false;
        return ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) <= R2;
    }
    const revealSet = new Set();
    const chainForce = bombKind ? 40 : (isMega ? 30 : 20);
    const x0 = Math.floor(cx - R), x1 = Math.ceil(cx + R);
    const y0 = Math.max(bottomY, Math.floor(cy - R));
    // Y上限は地表（または爆心）の少し上まで。広大な空中セルを総当たりしない＝重い爆弾の高速化
    const y1 = Math.min(Math.ceil(cy + R), Math.max(SURFACE_Y, Math.ceil(cy)) + 8);
    const z0 = Math.floor(cz - R), z1 = Math.ceil(cz + R);
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            for (let z = z0; z <= z1; z++) {
                if (!inBlast(x, y, z)) continue;
                const key = getKey(x, y, z);
                const t = blockData[key];
                if (!t || t === BLOCKS.BEDROCK) continue;

                // 爆薬系は誘爆（連鎖）
                if (t === BLOCKS.TNT || t === BLOCKS.MEGA_TNT || t === BLOCKS.NUKE || t === BLOCKS.HBOMB) {
                    const dx = x - cx, dy = y - cy, dz = z - cz;
                    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 0.001;
                    const f = (1 - dist / R) * chainForce + 4;
                    const vel = new THREE.Vector3(dx, dy + 0.5, dz).normalize().multiplyScalar(f);
                    const childKind = t === BLOCKS.NUKE ? 'nuke' : (t === BLOCKS.HBOMB ? 'hbomb' : null);
                    igniteTNT(x, y, z, vel, t === BLOCKS.MEGA_TNT, childKind);
                    continue;
                }

                // 殻になる隣（爆破範囲外で固体）を後でまとめて再メッシュ
                if (!inBlast(x + 1, y, z)) revealSet.add(getKey(x + 1, y, z));
                if (!inBlast(x - 1, y, z)) revealSet.add(getKey(x - 1, y, z));
                if (!inBlast(x, y + 1, z)) revealSet.add(getKey(x, y + 1, z));
                if (!inBlast(x, y - 1, z)) revealSet.add(getKey(x, y - 1, z));
                if (!inBlast(x, y, z + 1)) revealSet.add(getKey(x, y, z + 1));
                if (!inBlast(x, y, z - 1)) revealSet.add(getKey(x, y, z - 1));
                // 破片パーティクルは見える地表付近だけ（地下に数千個作る無駄を回避）
                if (y >= SURFACE_Y - 2 && Math.random() < (isBomb ? 0.06 : 0.3)) {
                    createBlockParticles(x, y, z, t, 2, 0.15);
                }
                removeBlock(x, y, z, true); // skipReveal（一括処理）
            }
        }
    }
    // クレーターの壁を一括で再メッシュ（埋没していたブロックが露出した分）
    for (const key of revealSet) {
        if (chunks[key] || !blockData[key]) continue;
        const parts = key.split(',');
        revealIfNeeded(+parts[0], +parts[1], +parts[2]);
    }

    // Also push existing Primed TNTs (着火済みTNTを吹き飛ばす)
    const pushForceMultiplier = isBomb ? (bombKind === 'hbomb' ? 90 : 70) : (isMega ? 45 : 30);
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
    // MEGA/原爆/水爆はより広い範囲・大ダメージ・大ノックバック
    // （原爆/水爆は即死級。ただしポーズメニューの「ダメージ無効」ONなら死なない）
    const damageRadius = isBomb ? radius * 1.3 : (isMega ? radius * 2.5 : radius * 2);
    const maxDamage = isBomb ? 9999 : (isMega ? 120 : 80);
    const knockbackForce = isBomb ? (bombKind === 'hbomb' ? 100 : 80) : (isMega ? 50 : 30);
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

// --- 原子爆弾の演出（ホワイトフラッシュ / キノコ雲 / 画面揺れ） ---

// 画面全体を一瞬白く飛ばす（DOMオーバーレイ。CSSファイル不要）
function triggerNukeFlash() {
    let flash = document.getElementById('nuke-flash');
    if (!flash) {
        flash = document.createElement('div');
        flash.id = 'nuke-flash';
        flash.style.cssText = 'position:fixed;inset:0;background:#ffffff;pointer-events:none;z-index:9998;opacity:0;';
        document.body.appendChild(flash);
    }
    flash.style.transition = 'none';
    flash.style.opacity = '1';
    // opacity:1 を一度描画させてからフェードアウト
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            flash.style.transition = 'opacity 1.3s ease-out';
            flash.style.opacity = '0';
        });
    });
}

// 画面揺れ。camera の roll(z) を一時的に揺らす（yaw/pitch のマウス操作と干渉しない）
function nukeScreenShake(duration = 0.9, intensity = 0.06) {
    const start = performance.now();
    function step() {
        const t = (performance.now() - start) / 1000;
        if (t >= duration) { camera.rotation.z = 0; return; }
        const decay = 1 - t / duration;
        camera.rotation.z = (Math.random() - 0.5) * intensity * decay * 2;
        requestAnimationFrame(step);
    }
    step();
}

// キノコ雲（火球 + 立ち上る茎 + 上部で広がる傘）。ボクセル風の煙キューブ。
const smokeParticles = [];
function spawnSmoke(x, y, z, color, size, vel, life, grow, buoy) {
    // 病的な肥大の保険: 上限超過なら最古を捨てる（共有geo/材質なので dispose 不要）
    if (smokeParticles.length >= 2200) {
        const old = smokeParticles.shift();
        if (old) scene.remove(old);
    }
    const mesh = new THREE.Mesh(particleGeometry, getParticleMaterial(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(size, size, size);
    mesh.userData = { velocity: vel, life: life, size: size, grow: grow, buoy: buoy };
    scene.add(mesh);
    smokeParticles.push(mesh);
}

function createMushroomCloud(cx, cy, cz, radius) {
    const stemH = Math.max(8, radius * 0.9);
    const capR = Math.max(4, radius * 0.55);
    const smoke = [0x888888, 0x9e9e9e, 0x6d6d6d, 0x757575];
    const fire = [0xff6a00, 0xff9100, 0xffc107, 0xffe082];

    // 地表の火球（短命・明るい）
    for (let i = 0; i < 50; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * radius * 0.4;
        const vel = new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 6), 2 + Math.random() * 5, Math.sin(a) * (2 + Math.random() * 6));
        spawnSmoke(cx + Math.cos(a) * r, cy + Math.random() * 2, cz + Math.sin(a) * r,
            fire[i % fire.length], 1.2 + Math.random() * 1.5, vel, 0.7 + Math.random() * 0.5, 2.0, 4.0);
    }

    // 茎（立ち上る煙の柱）
    const stemCount = Math.floor(stemH * 4);
    for (let i = 0; i < stemCount; i++) {
        const t = i / stemCount;
        const y = cy + t * stemH;
        const swirl = Math.random() * Math.PI * 2;
        const rr = (0.6 + t * 0.8) * (1 + Math.random());
        const vel = new THREE.Vector3((Math.random() - 0.5) * 1.5, 4 + Math.random() * 4, (Math.random() - 0.5) * 1.5);
        spawnSmoke(cx + Math.cos(swirl) * rr, y, cz + Math.sin(swirl) * rr,
            smoke[i % smoke.length], 1.5 + Math.random() * 1.5, vel, 2.5 + Math.random() * 1.5, 0.8, 3.5);
    }

    // 傘（上部でドーム状に外へ広がる）
    const capCount = Math.floor(capR * 14);
    const capY = cy + stemH;
    for (let i = 0; i < capCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * capR;
        const dome = Math.cos((r / capR) * Math.PI / 2) * capR * 0.5;
        const vel = new THREE.Vector3(Math.cos(a) * (2 + r * 0.3), 1 + Math.random() * 2, Math.sin(a) * (2 + r * 0.3));
        spawnSmoke(cx + Math.cos(a) * r, capY + dome + (Math.random() - 0.5) * 2, cz + Math.sin(a) * r,
            smoke[i % smoke.length], 2.0 + Math.random() * 2.0, vel, 3.0 + Math.random() * 1.5, 1.2, 1.5);
    }
}

function updateMushroom(delta) {
    for (let i = smokeParticles.length - 1; i >= 0; i--) {
        const p = smokeParticles[i];
        const d = p.userData;
        d.life -= delta;
        d.velocity.y += d.buoy * delta;             // 浮力で上昇
        d.velocity.multiplyScalar(1 - 0.6 * delta); // 空気抵抗
        p.position.add(d.velocity.clone().multiplyScalar(delta));
        d.size += d.grow * delta;                   // 膨張
        const fade = Math.min(1, d.life);           // 終端1秒で縮小フェード
        const s = Math.max(0, d.size * fade);
        p.scale.set(s, s, s);
        if (d.life <= 0) {
            scene.remove(p);
            smokeParticles.splice(i, 1);
        }
    }
}

// --- 核ミサイル（単弾頭 / MIRV）システム ---
// rockets/updateRockets を手本にした独自エンティティ。createPrimedTNT は使わない。
const nukeMissiles = [];
const NUKE_MISSILE_SPEED = 40;        // 35〜45 u/s の中央値
const NUKE_MISSILE_MAX_RANGE = 600;   // 射程（超過で自爆）
const MIRV_SPLIT_TIME = 0.5;          // 発射後この秒数で分裂（着弾が先なら着弾点で分裂）
const MIRV_CHILD_COUNT = 5;           // 子弾頭の数（4〜5）
const MIRV_SPREAD = 14;               // 子弾頭の横方向拡散の強さ
const nukeBlastQueue = [];            // 近接同時のnuke爆発を1フレーム1発に分散（MIRVのフレームスパイク対策）
const NUKE_MISSILE_AIRBURST_H = 7;    // 単弾頭ミサイルが地表からこの高さで空中爆発（airburst・横に広く薙ぎ払う）

// リアルなミサイル形状（THREE.Group）。scale=1で全長約1.6。
function buildNukeMissileMesh(scale, isMirv) {
    const g = new THREE.Group();

    // 円筒ボディ（白〜灰）
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xECEFF1 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.0, 10), bodyMat);
    g.add(body);

    // 赤い帯マーキング（細い円筒のリング）
    const bandMat = new THREE.MeshLambertMaterial({ color: 0xD32F2F });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.12, 10), bandMat);
    band.position.y = 0.15;
    g.add(band);

    // 尖ったノーズコーン（赤い先端）
    const noseMat = new THREE.MeshLambertMaterial({ color: 0xD32F2F });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 10), noseMat);
    nose.position.y = 0.75; // ボディ上端 +コーン半高
    g.add(nose);

    // 後部に4枚の尾翼フィン（薄いBox）
    const finMat = new THREE.MeshLambertMaterial({ color: 0x90A4AE });
    for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.22), finMat);
        const a = i * Math.PI / 2;
        fin.position.set(Math.cos(a) * 0.16, -0.42, Math.sin(a) * 0.16);
        fin.rotation.y = -a;
        g.add(fin);
    }

    // オレンジの噴射炎（小Cone・毎フレーム明滅/伸縮させる）
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xFF6D00, transparent: true, opacity: 0.9 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8), flameMat);
    flame.position.y = -0.72;
    flame.rotation.x = Math.PI; // 後ろ向きに尖らせる
    g.add(flame);
    g.userData.flame = flame;

    // MIRV母体は識別用に帯を黄色にしておく
    if (isMirv) bandMat.color.setHex(0xFFD600);

    g.scale.setScalar(scale);
    return g;
}

// ミサイルを1基生成して nukeMissiles に登録
function spawnNukeMissile(position, direction, scale, isMirv, canSplit) {
    const mesh = buildNukeMissileMesh(scale, isMirv);
    mesh.position.copy(position);
    // 機首(+Y)を進行方向へ向ける
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    scene.add(mesh);
    nukeMissiles.push({
        mesh: mesh,
        velocity: direction.clone().normalize().multiplyScalar(NUKE_MISSILE_SPEED),
        traveled: 0,
        age: 0,
        isMirv: isMirv,
        canSplit: canSplit,   // true=分裂前の母体 / false=単弾頭・分裂後の子弾頭
        flameTime: 0
    });
}

// プレイヤー視点から発射（actions.js から呼ぶ）
function launchNukeMissile(isMirv) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y += 0.12; // やや上向き
    dir.normalize();
    // 単弾頭は大きく＝核ミサイルっぽさ。MIRVの母体は従来サイズ（子弾頭も小さいまま）
    const scale = isMirv ? 1.0 : 2.6;
    const ahead = isMirv ? 1.5 : 3.2; // 大きい分すこし前方から出す
    const spawnPos = camera.position.clone().add(dir.clone().multiplyScalar(ahead));
    spawnNukeMissile(spawnPos, dir, scale, isMirv, isMirv); // 母体は分裂可
    playSound('missile_launch');
    triggerGunRecoil();
}

// 母体を MIRV_CHILD_COUNT 個の子弾頭へコーン状に分裂
function splitMirv(missile) {
    const baseDir = missile.velocity.clone().normalize();
    const pos = missile.mesh.position.clone();
    // baseDir に直交する2軸を作る
    const up = Math.abs(baseDir.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(baseDir, up).normalize();
    const side2 = new THREE.Vector3().crossVectors(baseDir, side).normalize();
    for (let i = 0; i < MIRV_CHILD_COUNT; i++) {
        const a = (i / MIRV_CHILD_COUNT) * Math.PI * 2;
        const spread = side.clone().multiplyScalar(Math.cos(a)).add(side2.clone().multiplyScalar(Math.sin(a)));
        const childDir = baseDir.clone().multiplyScalar(NUKE_MISSILE_SPEED)
            .add(spread.multiplyScalar(MIRV_SPREAD)).normalize();
        spawnNukeMissile(pos, childDir, 0.6, true, false); // 子は分裂しない
    }
}

function disposeNukeMissileMesh(group) {
    group.traverse(o => {
        if (o.isMesh) {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        }
    });
}

// ミサイル直下の地表（最上段の固体ブロック）のYを返す（airburst高度の基準）
function nukeGroundYBelow(x, z, fromY) {
    for (let y = Math.floor(fromY); y > worldBottomY; y--) {
        const t = blockData[getKey(x, y, z)];
        if (t && !(BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide)) return y;
    }
    return worldBottomY;
}

function updateNukeMissiles(delta) {
    const limit = WORLD_SIZE / 2;
    for (let i = nukeMissiles.length - 1; i >= 0; i--) {
        const m = nukeMissiles[i];
        m.age += delta;
        m.flameTime += delta;

        // 噴射炎の明滅/伸縮
        const flame = m.mesh.userData.flame;
        if (flame) {
            const f = 0.7 + Math.random() * 0.6;
            flame.scale.set(1, f, 1);
            flame.material.opacity = 0.6 + Math.random() * 0.4;
        }

        // 機首を進行方向へ追従
        m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), m.velocity.clone().normalize());

        // 移動
        const movement = m.velocity.clone().multiplyScalar(delta);
        m.mesh.position.add(movement);
        m.traveled += movement.length();

        // 後方に煙トレイル（寿命短め）。spawnSmoke を再利用。
        const back = m.velocity.clone().normalize().multiplyScalar(-0.5).add(m.mesh.position);
        spawnSmoke(
            back.x, back.y, back.z,
            0x9e9e9e, 0.4 + Math.random() * 0.3,
            new THREE.Vector3((Math.random() - 0.5), 0.5 + Math.random(), (Math.random() - 0.5)),
            0.5 + Math.random() * 0.3, // life 短め
            0.6, 1.0
        );

        // 着弾判定（updateRockets を手本：レイキャスト＋直接セル＋境界）
        let hit = false;
        const pos = m.mesh.position;
        const rayDir = m.velocity.clone().normalize();
        const ray = new THREE.Raycaster(pos.clone(), rayDir, 0, movement.length() + 0.3);
        const intersects = ray.intersectObjects(blockMeshes, false);
        for (const it of intersects) {
            const props = BLOCK_PROPS[it.object.userData.type];
            if (props && props.noCollide) continue;
            hit = true; break;
        }
        const blockKey = getKey(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (blockData[blockKey] && !BLOCK_PROPS[blockData[blockKey]]?.noCollide) hit = true;
        if (Math.abs(pos.x) > limit || Math.abs(pos.z) > limit || pos.y < 0 || pos.y > 80) hit = true;
        if (m.traveled > NUKE_MISSILE_MAX_RANGE) hit = true;

        // 単弾頭ミサイルは空中爆発(airburst): 降下中に「地表+H」で炸裂＝横に広く薙ぎ払う（被害最大化・MIRVは対象外）
        let airburstRadius = null;
        if (!m.isMirv && m.velocity.y < 0 && m.traveled > 10) {
            const gy = nukeGroundYBelow(Math.floor(pos.x), Math.floor(pos.z), pos.y);
            if (pos.y <= gy + NUKE_MISSILE_AIRBURST_H) airburstRadius = Math.round(nukePower * 1.25);
        }

        // MIRV母体は「分裂時刻 or 着弾」の早い方で子弾頭へ分裂（着弾しても爆発せず必ず分裂する）
        if (m.canSplit && (m.age >= MIRV_SPLIT_TIME || hit)) {
            splitMirv(m);
            scene.remove(m.mesh);
            disposeNukeMissileMesh(m.mesh);
            nukeMissiles.splice(i, 1);
            continue;
        }

        if (airburstRadius !== null || hit) {
            // 即時explodeせずキューへ（MIRV5発が同フレームに重なるフリーズを回避・1フレーム1発で処理）
            // airburst時はその大きめ半径を渡す（地表炸裂より横に広く薙ぎ払う）
            nukeBlastQueue.push({ x: pos.x, y: pos.y, z: pos.z, radius: airburstRadius });
            scene.remove(m.mesh);
            disposeNukeMissileMesh(m.mesh);
            nukeMissiles.splice(i, 1);
        }
    }

    // 1フレームにつき最大1発のnuke爆発を処理（MIRV同時多発のフレームスパイクを時間分散）
    if (nukeBlastQueue.length > 0) {
        const b = nukeBlastQueue.shift();
        explode(b.x, b.y, b.z, false, b.radius, 'nuke'); // b.radius=null(接触)→nukePower / 数値(airburst)→その半径
    }
}
