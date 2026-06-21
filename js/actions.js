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
    let base = BREAK_DELAY;
    if (controls.isFlying) {
        camera.getWorldDirection(_digDirTmp);
        if (_digDirTmp.y < -0.5) base = FLY_DIG_DOWN_DELAY; // 視線が下向き＝下掘り＝速い
        // 上向きを速くする時: if (_digDirTmp.y > 0.5) base = FLY_DIG_UP_DELAY;
    }
    // 採掘対象ブロックの硬さでクールダウンを伸ばす（地層の石ほど遅い・既存ブロックは hardness 未設定＝等倍）
    const hit = pickBlock();
    if (hit) {
        const p = BLOCK_PROPS[hit.type];
        if (p && p.hardness) base = Math.round(base * p.hardness);
    }
    return base;
}

// スクリーン座標（未指定なら画面中央）からカメラ光線を作り、ボクセル DDA で最初のブロックを返す。
// メッシュ非依存（チャンクメッシュ化に対応）。reach=5。
const _pickCoords = new THREE.Vector2();
function pickBlock(screenX, screenY) {
    _pickCoords.set(0, 0);
    if (screenX !== undefined && screenY !== undefined) {
        _pickCoords.x = (screenX / window.innerWidth) * 2 - 1;
        _pickCoords.y = -(screenY / window.innerHeight) * 2 + 1;
    }
    raycaster.setFromCamera(_pickCoords, camera);
    return voxelRaycast(raycaster.ray.origin, raycaster.ray.direction, 5, true);
}

function attemptMine(screenX, screenY) {
    const hit = pickBlock(screenX, screenY);
    if (!hit) return;

    const type = hit.type;
    if (type && type !== BLOCKS.BEDROCK) {
        playSound('break', type);
        createBlockParticles(hit.x, hit.y, hit.z, type, 5, 0.15);
        removeBlock(hit.x, hit.y, hit.z);
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

    // ミサイル発射ボタン: 核ミサイル5発を横一列に斉射（着弾点がきのこ雲群で一望できる中距離）
    if (currentItem === BLOCKS.MISSILE_BUTTON) {
        launchNukeBarrage();
        return;
    }

    // 地中貫通核: 発射→着弾後に地中へ潜って起爆（地下空洞＋陥没）
    if (currentItem === BLOCKS.PENETRATOR) {
        launchPenetrator();
        return;
    }

    // AI陣営戦の召喚: 赤軍＋青軍を同時召喚（中央で会戦）
    if (currentItem === BLOCKS.SUMMONER) {
        summonLegion();
        return;
    }
    // 赤軍だけ召喚（負けてる側の増援＝リスポーンキル回避）
    if (currentItem === BLOCKS.SUMMON_RED) {
        summonFaction(0);
        return;
    }
    // 青軍だけ召喚
    if (currentItem === BLOCKS.SUMMON_BLUE) {
        summonFaction(1);
        return;
    }

    const hit = pickBlock(screenX, screenY);

    if (hit) {
        const type = hit.type;

        // 通常TNTの点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.TNT) {
            igniteTNT(hit.x, hit.y, hit.z, null, false);
            return;
        }

        // MEGA TNTの点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.MEGA_TNT) {
            igniteTNT(hit.x, hit.y, hit.z, null, true);
            return;
        }

        // 原子爆弾の点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.NUKE) {
            igniteTNT(hit.x, hit.y, hit.z, null, false, 'nuke');
            return;
        }

        // 水素爆弾の点火
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.HBOMB) {
            igniteTNT(hit.x, hit.y, hit.z, null, false, 'hbomb');
            return;
        }

        // ツァーリ・ボンバの点火（史上最大＝閃光→暗転）
        if (currentItem === BLOCKS.FLINT && type === BLOCKS.TSAR) {
            igniteTNT(hit.x, hit.y, hit.z, null, false, 'tsar');
            return;
        }

        if (BLOCK_PROPS[currentItem].isTool) return;

        const bnx = hit.x + hit.nx;
        const bny = hit.y + hit.ny;
        const bnz = hit.z + hit.nz;

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
