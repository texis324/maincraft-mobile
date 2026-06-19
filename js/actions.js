// --- Screen Toggling ---
function toggleInventory() {
    if (isGameOver) return;
    isInventoryOpen = !isInventoryOpen;

    const invScreen = document.getElementById('inventory-screen');
    if (isInventoryOpen) {
        safeExitPointerLock();
        isPaused = true;
        invScreen.style.display = 'flex';
        updateUI(); // Refresh grid
    } else {
        safeRequestPointerLock(); // Use safe lock
        invScreen.style.display = 'none';
        isPaused = false;
        swapSourceIndex = -1; // Reset any pending swap
        updateUI(); // Refresh hotbar
    }
}

function togglePause() {
    if (isGameOver) return;
    // Only pause if inventory is not open
    if (isInventoryOpen) {
        toggleInventory();
        return;
    }

    const pauseMenu = document.getElementById('pause-menu');

    // モバイルの場合は直接ポーズメニューを切り替え
    if (isMobileDevice) {
        isPaused = !isPaused;
        pauseMenu.style.display = isPaused ? 'flex' : 'none';
        return;
    }

    if (document.pointerLockElement === document.body) {
        safeExitPointerLock(); // This triggers change event to show menu
    } else {
        safeRequestPointerLock(); // Use safe lock
    }
}

// --- Mine / Place / Ignite ---

// 採掘クールダウン（小さいほど速い）。自由飛行中に下向きへ掘る時だけ速くする。
// 将来、上向きの速度も変えたくなったらここに分岐を足すだけ（FLY_DIG_UP_DELAY）。
const _digDirTmp = new THREE.Vector3();
function getBreakDelay() {
    if (controls.isFlying) {
        camera.getWorldDirection(_digDirTmp);
        if (_digDirTmp.y < -0.5) return FLY_DIG_DOWN_DELAY; // 視線が下向き＝下掘り＝速い
        // 上向きを速くする時: if (_digDirTmp.y > 0.5) return FLY_DIG_UP_DELAY;
    }
    return BREAK_DELAY;
}

function attemptMine(screenX, screenY) {
    // スクリーン座標が指定されていればそこを、なければ画面中央を使用
    let raycastCoords = new THREE.Vector2(0, 0);
    if (screenX !== undefined && screenY !== undefined) {
        raycastCoords.x = (screenX / window.innerWidth) * 2 - 1;
        raycastCoords.y = -(screenY / window.innerHeight) * 2 + 1;
    }

    raycaster.setFromCamera(raycastCoords, camera);
    // 地形ブロックのみを対象にする（銃モデルやパーティクル等を除外）
    const intersects = raycaster.intersectObjects(blockMeshes, false);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        if (intersect.distance > 5) return;

        const obj = intersect.object;
        const type = obj.userData.type;
        const bx = obj.userData.x;
        const by = obj.userData.y;
        const bz = obj.userData.z;

        if (type && type !== BLOCKS.BEDROCK) {
            playSound('break', type);
            createBlockParticles(bx, by, bz, type, 5, 0.15);
            removeBlock(bx, by, bz);
        }
    }
}

function attemptPlaceOrIgnite(screenX, screenY) {
    // Launcher Logic
    const currentItem = INVENTORY[selectedItemIndex];

    if (currentItem === BLOCKS.TNT_LAUNCHER) {
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        // Spawn slightly in front
        const spawnPos = camera.position.clone().add(dir.clone().multiplyScalar(1.5));
        // Velocity: fast forward + slight up arc
        const velocity = dir.multiplyScalar(25).add(new THREE.Vector3(0, 2, 0));

        playSound('shoot');
        triggerGunRecoil(); // リコイルアニメーション
        createPrimedTNT(spawnPos.x, spawnPos.y, spawnPos.z, velocity, false);
        return;
    }

    if (currentItem === BLOCKS.ROCKET_LAUNCHER) {
        fireRocket();
        return;
    }

    if (currentItem === BLOCKS.NUKE_MISSILE) {
        launchNukeMissile(false);
        return;
    }

    if (currentItem === BLOCKS.MIRV_MISSILE) {
        launchNukeMissile(true);
        return;
    }

    // スクリーン座標が指定されていればそこを、なければ画面中央を使用
    let raycastCoords = new THREE.Vector2(0, 0);
    if (screenX !== undefined && screenY !== undefined) {
        raycastCoords.x = (screenX / window.innerWidth) * 2 - 1;
        raycastCoords.y = -(screenY / window.innerHeight) * 2 + 1;
    }

    raycaster.setFromCamera(raycastCoords, camera);
    // 地形ブロックのみを対象にする
    const intersects = raycaster.intersectObjects(blockMeshes, false);

    if (intersects.length > 0) {
        const intersect = intersects[0];
        if (intersect.distance > 5) return;

        const obj = intersect.object;
        const type = obj.userData.type;

        // 通常TNTの点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.TNT) {
            igniteTNT(obj.userData.x, obj.userData.y, obj.userData.z, null, false);
            return;
        }

        // MEGA TNTの点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.MEGA_TNT) {
            igniteTNT(obj.userData.x, obj.userData.y, obj.userData.z, null, true);
            return;
        }

        // 原子爆弾の点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.NUKE) {
            igniteTNT(obj.userData.x, obj.userData.y, obj.userData.z, null, false, 'nuke');
            return;
        }

        // 水素爆弾の点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.HBOMB) {
            igniteTNT(obj.userData.x, obj.userData.y, obj.userData.z, null, false, 'hbomb');
            return;
        }

        if (BLOCK_PROPS[currentItem].isTool) return;

        const nx = Math.round(intersect.face.normal.x);
        const ny = Math.round(intersect.face.normal.y);
        const nz = Math.round(intersect.face.normal.z);

        const bnx = obj.userData.x + nx;
        const bny = obj.userData.y + ny;
        const bnz = obj.userData.z + nz;

        const playerPos = camera.position;

        const props = BLOCK_PROPS[currentItem];
        const isSolid = !props || !props.noCollide;

        if(isSolid) {
            if(Math.abs(bnx - playerPos.x) < 0.6 && Math.abs(bny - playerPos.y + 1) < 1.0 && Math.abs(bnz - playerPos.z) < 0.6) {
                return;
            }
        }

        playSound('place', currentItem);
        addBlock(bnx, bny, bnz, currentItem);
    }
}
