// --- 8. Input & Game State Logic ---
let isLeftMouseDown = false;
let isRightMouseDown = false;
let lastActionTime = 0;
let lastSpaceTime = 0; // For double jump detection
let spaceTaps = 0;     // 連続スペースタップ数（2=飛行トグル / 3+長押し=上昇ブースト）
let lastWTime = 0; // For dash detection

// Event Listeners for UI
document.getElementById('btn-resume').addEventListener('click', togglePause);
document.getElementById('btn-reset').addEventListener('click', () => {
    resetPlayer();
    // モバイルではポインターロックが無いので、ポーズ状態を明示的に解除する
    if (isMobileDevice) {
        isPaused = false;
        document.getElementById('pause-menu').style.display = 'none';
    } else {
        safeRequestPointerLock();
    }
});
document.getElementById('btn-close-inv').addEventListener('click', toggleInventory);

document.getElementById('sensitivity').addEventListener('input', (e) => { mouseSensitivity = e.target.value * 0.0005; });
document.getElementById('touch-sensitivity').addEventListener('input', (e) => { mobileLookSensitivity = e.target.value * 0.001; });
document.getElementById('rocket-power').addEventListener('input', (e) => {
    rocketPower = parseInt(e.target.value);
    document.getElementById('rocket-power-value').textContent = rocketPower;
});
const nukePowerSlider = document.getElementById('nuke-power');
if (nukePowerSlider) {
    nukePowerSlider.addEventListener('input', (e) => {
        nukePower = parseInt(e.target.value);
        document.getElementById('nuke-power-value').textContent = nukePower;
    });
}
const hbombPowerSlider = document.getElementById('hbomb-power');
if (hbombPowerSlider) {
    hbombPowerSlider.addEventListener('input', (e) => {
        hbombPower = parseInt(e.target.value);
        document.getElementById('hbomb-power-value').textContent = hbombPower;
    });
}

// マップ設定スライダー（値表示のみ。実反映は「再生成」ボタン）
const mapSizeSlider = document.getElementById('map-size');
const mapDepthSlider = document.getElementById('map-depth');
if (mapSizeSlider) {
    mapSizeSlider.addEventListener('input', (e) => {
        document.getElementById('map-size-value').textContent = e.target.value;
    });
}
if (mapDepthSlider) {
    mapDepthSlider.addEventListener('input', (e) => {
        document.getElementById('map-depth-value').textContent = e.target.value;
    });
}
const regenBtn = document.getElementById('btn-regenerate');
if (regenBtn) {
    regenBtn.addEventListener('click', () => {
        VIEW_DIST = parseInt(mapSizeSlider.value);
        WORLD_DEPTH = parseInt(mapDepthSlider.value);
        regenerateWorld();
        // 再生成後はゲームに戻す
        if (isMobileDevice) {
            isPaused = false;
            document.getElementById('pause-menu').style.display = 'none';
        } else {
            safeRequestPointerLock();
        }
    });
}

// Prevent click-through on UI
const stopProp = (e) => e.stopPropagation();
['pause-menu', 'inventory-screen'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('mousedown', stopProp);
});

// ポインターロックイベント（デスクトップのみ）
if (!isMobileDevice) {
    document.addEventListener('pointerlockchange', () => {
        const pauseMenu = document.getElementById('pause-menu');
        if (document.pointerLockElement === document.body) {
            isPaused = false;
            pauseMenu.style.display = 'none';
            if(isInventoryOpen) {
                isInventoryOpen = false;
                document.getElementById('inventory-screen').style.display = 'none';
            }
        } else {
            if (!isGameOver && !isInventoryOpen) {
                isPaused = true;
                pauseMenu.style.display = 'flex';
            }
        }
    });
}

document.body.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.overlay-screen')) return;
    if (e.target.closest('#mobile-controls')) return;
    if(!isGameOver && !isPaused && !isInventoryOpen) {
        safeRequestPointerLock();
        if(audioCtx.state === 'suspended') audioCtx.resume();
    }
});

document.addEventListener('wheel', (event) => {
    if (isGameOver || isPaused || isInventoryOpen) return;
    if (event.deltaY > 0) {
        selectedItemIndex = (selectedItemIndex + 1) % INVENTORY.length;
    } else {
        selectedItemIndex = (selectedItemIndex - 1 + INVENTORY.length) % INVENTORY.length;
    }
    updateUI(); // Highlights slot
});

document.addEventListener('keydown', (event) => {
    if(isGameOver) return;

    if (event.code === 'KeyE') {
        toggleInventory();
        return;
    }

    if (event.code === 'Escape') {
        if(isInventoryOpen) toggleInventory();
        return;
    }

    if (!isPaused && !isInventoryOpen) {
        // Ctrl下降中にブラウザのCtrl+S/A/F等が暴発しないよう抑制（プレイ中のみ・キャンセル可能なものだけ防げる）
        if (event.ctrlKey) event.preventDefault();
        if (event.code === 'Digit1') setSlot(0);
        if (event.code === 'Digit2') setSlot(1);
        if (event.code === 'Digit3') setSlot(2);
        if (event.code === 'Digit4') setSlot(3);
        if (event.code === 'Digit5') setSlot(4);
        if (event.code === 'Digit6') setSlot(5);
        if (event.code === 'Digit7') setSlot(6);
        if (event.code === 'Digit8') setSlot(7);
        if (event.code === 'Digit9') setSlot(8);
        if (event.code === 'Digit0') setSlot(9);

        // Gキーで空爆要請（上空から爆弾の雨）
        if (event.code === 'KeyG' && !event.repeat) {
            if (performance.now() - lastActionTime > 500) {
                callAirstrike();
                lastActionTime = performance.now();
            }
        }

        // Cキーで銃を発射（ランチャー/ロケラン/ライフル/レールガン）
        if (event.code === 'KeyC') {
            const currentItem = INVENTORY[selectedItemIndex];
            const isGun = currentItem === BLOCKS.TNT_LAUNCHER || currentItem === BLOCKS.ROCKET_LAUNCHER
                || currentItem === BLOCKS.RIFLE || currentItem === BLOCKS.RAILGUN;
            if (isGun) {
                const d = currentItem === BLOCKS.RIFLE ? RIFLE_DELAY : (currentItem === BLOCKS.RAILGUN ? RAILGUN_DELAY : LAUNCHER_DELAY);
                if (performance.now() - lastActionTime > d) {
                    attemptPlaceOrIgnite();
                    lastActionTime = performance.now();
                }
            }
        }

        switch (event.code) {
            case 'ArrowUp': case 'KeyW':
                if (!controls.moveForward) { // First press
                    const now = performance.now();
                    if (now - lastWTime < 300) {
                        controls.isSprinting = true;
                    }
                    lastWTime = now;
                }
                controls.moveForward = true;
                break;
            case 'ArrowLeft': case 'KeyA': controls.moveLeft = true; break;
            case 'ArrowDown': case 'KeyS': controls.moveBackward = true; break;
            case 'ArrowRight': case 'KeyD': controls.moveRight = true; break;
            case 'ShiftLeft': case 'ShiftRight': controls.moveUp = true; break;     // 上昇（飛行中）
            case 'ControlLeft': case 'ControlRight': controls.moveDown = true; break; // 下降（飛行中）
            case 'Space':
                if (controls.isFlying) {
                    controls.jump = true; // Ascend
                } else {
                    if (controls.canJump) controls.velocity.y += JUMP_FORCE;
                    controls.canJump = false;
                }

                // 連続タップ判定（自動リピートは数えない＝押しっぱなしで誤作動しないように）
                // 2回タップ=飛行トグル / 3回タップ＋長押し=上昇スピード2倍ブースト（ツァーリ埋め後の脱出用）
                if (!event.repeat) {
                    const now = performance.now();
                    if (now - lastSpaceTime < 300) spaceTaps++; else spaceTaps = 1;
                    lastSpaceTime = now;
                    if (spaceTaps === 2) {
                        controls.isFlying = !controls.isFlying;
                        controls.velocity.y = 0; // Stop falling
                        document.getElementById('fly-mode-indicator').style.display = controls.isFlying ? 'block' : 'none';
                    } else if (spaceTaps >= 3) {
                        // 3回目以降＝上昇ブースト。飛行を確実にONにして、押している間だけ2倍上昇。
                        if (!controls.isFlying) {
                            controls.isFlying = true;
                            controls.velocity.y = 0;
                            document.getElementById('fly-mode-indicator').style.display = 'block';
                        }
                        controls.boostAscend = true;
                    }
                }
                break;
        }
    }
});

document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'ArrowUp': case 'KeyW':
            controls.moveForward = false;
            controls.isSprinting = false; // Stop sprinting on release
            break;
        case 'ArrowLeft': case 'KeyA': controls.moveLeft = false; break;
        case 'ArrowDown': case 'KeyS': controls.moveBackward = false; break;
        case 'ArrowRight': case 'KeyD': controls.moveRight = false; break;
        case 'ShiftLeft': case 'ShiftRight': controls.moveUp = false; break;
        case 'ControlLeft': case 'ControlRight': controls.moveDown = false; break;
        case 'Space': controls.jump = false; controls.boostAscend = false; break;
    }
});

document.addEventListener('mousemove', (event) => {
    // ポインターロック中のみ視点操作
    if (document.pointerLockElement === document.body) {
        if (isGameOver || isPaused || isInventoryOpen) return;

        if (Math.abs(event.movementX) > 300 || Math.abs(event.movementY) > 300) return;

        camera.rotation.y -= event.movementX * mouseSensitivity;
        camera.rotation.x -= event.movementY * mouseSensitivity;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
    }
});

document.addEventListener('mousedown', (event) => {
    // UIをクリックした場合は無視
    if (event.target.closest('.overlay-screen') || event.target.closest('.settings-panel')) return;
    if (event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT') return;
    if (event.target.closest('#mobile-controls')) return;

    if (isGameOver || isPaused || isInventoryOpen) return;

    // ポインターロック外ならロックを取得
    if (document.pointerLockElement !== document.body) {
        safeRequestPointerLock();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return;
    }

    // ポインターロック中
    if (event.button === 0) {
        // 左クリック: 破壊
        isLeftMouseDown = true;
        if (performance.now() - lastActionTime > getBreakDelay()) {
            attemptMine();
            lastActionTime = performance.now();
        }
    } else if (event.button === 2) {
        // 右クリック: 設置
        isRightMouseDown = true;
        const currentItem = INVENTORY[selectedItemIndex];
        let currentDelay = currentItem === BLOCKS.TNT_LAUNCHER ? LAUNCHER_DELAY : SLOW_PLACE_DELAY;

        if (performance.now() - lastActionTime > currentDelay) {
            attemptPlaceOrIgnite();
            lastActionTime = performance.now();
        }
    }
});

document.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
        isLeftMouseDown = false;
    }
    if (event.button === 2) isRightMouseDown = false;
});

// 右クリックメニュー無効化
document.addEventListener('contextmenu', (e) => e.preventDefault());
