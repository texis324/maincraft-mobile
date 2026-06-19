// --- 9. Main Loop & Bootstrap ---
let prevTime = performance.now();
let stepTimer = 0;
let frameCount = 0;
let lastFpsTime = performance.now();

// カメラ初期位置（ワールド中央の上空）
camera.position.set(0, 6, 0);
// 少し下を向く
camera.rotation.x = -0.3;

// 水に入っているかどうかの状態
let wasInWater = false;

generateWorld();

function animate() {
    requestAnimationFrame(animate);

    if(isGameOver) return;

    const time = performance.now();
    // ラグスパイク（カクつき/タブ復帰/大爆発のフリーズ）で delta が巨大化すると
    // 1フレームの移動量が跳ね上がり、床判定をすり抜けて世界の底に落ちる（=下方ワープ）。
    // 上限0.05sにクランプして大ジャンプを防ぐ。
    const delta = Math.min((time - prevTime) / 1000, 0.05);
    prevTime = time;

    // FPS Counter
    frameCount++;
    if (time - lastFpsTime >= 1000) {
        document.getElementById('fps-counter').innerText = `FPS: ${frameCount}`;
        frameCount = 0;
        lastFpsTime = time;
    }

    // 座標表示を更新
    const coordsDisplay = document.getElementById('coords-display');
    if (coordsDisplay) {
        const x = Math.floor(camera.position.x);
        const y = Math.floor(camera.position.y);
        const z = Math.floor(camera.position.z);
        coordsDisplay.innerText = `X: ${x}  Y: ${y}  Z: ${z}`;
    }

    // Paused Logic
    if (isPaused || isInventoryOpen) {
        renderer.render(scene, camera);
        return;
    }

    // Game Logic
    if (isLeftMouseDown && time - lastActionTime > getBreakDelay()) {
        attemptMine();
        lastActionTime = time;
    }
    if (isRightMouseDown) {
        // Check delay dynamically again for continuous hold
        const currentItem = INVENTORY[selectedItemIndex];
        let currentDelay = SLOW_PLACE_DELAY;

        if (currentItem === BLOCKS.TNT_LAUNCHER) {
            currentDelay = LAUNCHER_DELAY;
        } else {
            const hSpeed = Math.sqrt(controls.velocity.x**2 + controls.velocity.z**2);
            if (hSpeed > 10) {
                currentDelay = FAST_PLACE_DELAY;
            }
        }

        if (time - lastActionTime > currentDelay) {
            attemptPlaceOrIgnite();
            lastActionTime = time;
        }
    }

    updateParticles(delta);
    updateMushroom(delta); // 原爆のキノコ雲を更新
    updatePrimedTNTs(delta); // Update Physics TNT
    updateRockets(delta); // Update Rockets
    updateNukeMissiles(delta); // 核ミサイル（単弾頭/MIRV）の飛行・分裂・着弾を更新
    updateGunAnimation(delta); // 銃のアニメーション更新

    // Physics & Movement
    // Apply Friction
    controls.velocity.x -= controls.velocity.x * 10.0 * delta;
    controls.velocity.z -= controls.velocity.z * 10.0 * delta;

    if (controls.isFlying) {
        controls.velocity.y -= controls.velocity.y * 2.0 * delta; // Reduced Air resistance
        if (controls.jump || controls.moveUp) controls.velocity.y += 30.0 * delta;
        if (controls.moveDown) controls.velocity.y -= 30.0 * delta;
    } else {
        controls.velocity.y -= GRAVITY * delta;
    }

    controls.direction.z = Number(controls.moveForward) - Number(controls.moveBackward);
    controls.direction.x = Number(controls.moveRight) - Number(controls.moveLeft);
    controls.direction.normalize();

    // Determine move speed
    let currentSpeed = controls.isFlying ? FLY_SPEED : WALK_SPEED;
    if (!controls.isFlying && controls.isSprinting) {
        currentSpeed = SPRINT_SPEED;
    }

    if (controls.moveForward || controls.moveBackward) controls.velocity.z -= controls.direction.z * currentSpeed * delta;
    if (controls.moveLeft || controls.moveRight) controls.velocity.x += controls.direction.x * currentSpeed * delta;

    // プレイヤーの足元のブロックを確認
    const footBlockKey = getKey(Math.floor(camera.position.x), Math.floor(camera.position.y - 1.6), Math.floor(camera.position.z));
    const isInWater = blockData[footBlockKey] === BLOCKS.WATER;

    // 水に入った/出た検出
    if (isInWater && !wasInWater) {
        playSound('water_enter');
    }
    wasInWater = isInWater;

    // Footsteps (only when grounded)
    if (!controls.isFlying && (controls.moveForward || controls.moveBackward || controls.moveLeft || controls.moveRight) && controls.canJump) {
        stepTimer += delta;
        const stepRate = controls.isSprinting ? 0.25 : 0.4;
        if (stepTimer > stepRate) {
            if (isInWater) {
                playSound('water_step');
            } else {
                playSound('step');
            }
            stepTimer = 0;
        }
    } else {
        stepTimer = 0.4;
    }

    const yaw = camera.rotation.y;
    const v = controls.velocity;

    const worldVelocityX = v.x * Math.cos(yaw) + v.z * Math.sin(yaw);
    const worldVelocityZ = v.x * -Math.sin(yaw) + v.z * Math.cos(yaw);

    camera.position.x += worldVelocityX * delta;
    let collisions = getCollidingBlocks(camera.position);
    if(collisions.length > 0) {
        camera.position.x -= worldVelocityX * delta;
    }

    camera.position.z += worldVelocityZ * delta;
    collisions = getCollidingBlocks(camera.position);
    if(collisions.length > 0) {
        camera.position.z -= worldVelocityZ * delta;
    }

    const limit = WORLD_SIZE / 2 - 0.5;
    if (camera.position.x > limit) camera.position.x = limit;
    if (camera.position.x < -limit) camera.position.x = -limit;
    if (camera.position.z > limit) camera.position.z = limit;
    if (camera.position.z < -limit) camera.position.z = -limit;

    // 終端速度クランプ: 大爆発のノックバック等で落下/上昇速度が跳ね上がっても、
    // 1フレームの縦移動を床判定の範囲内(±約2ブロック)に抑え、すり抜け＝下方ワープを防ぐ。
    controls.velocity.y = Math.max(-45, Math.min(45, controls.velocity.y));
    camera.position.y += controls.velocity.y * delta;
    collisions = getCollidingBlocks(camera.position);
    if(collisions.length > 0) {
        if (controls.isFlying) {
            // Flying Collision - Stop velocity on impact
            if (controls.velocity.y < 0) {
                 const hitY = collisions[0].max.y;
                 camera.position.y = hitY + 1.501;
            } else if (controls.velocity.y > 0) {
                 const hitY = collisions[0].min.y;
                 camera.position.y = hitY - 1.501;
            }
            controls.velocity.y = 0;
        } else {
            // Normal Gravity Collision
            if(controls.velocity.y < 0) {
                 controls.canJump = true;
                 const hitY = collisions[0].max.y;
                 camera.position.y = hitY + 1.501;
            } else {
                 camera.position.y -= controls.velocity.y * delta;
            }
            controls.velocity.y = 0;
        }
    }

    if(camera.position.y < worldBottomY - 8) {
        takeDamage(100);
    }

    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
