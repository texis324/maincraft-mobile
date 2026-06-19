// --- 8. Input & Game State Logic ---
let isLeftMouseDown = false;
let isRightMouseDown = false;
let lastActionTime = 0;
let lastSpaceTime = 0; // For double jump detection
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

        // Cキーで銃を発射
        if (event.code === 'KeyC') {
            const currentItem = INVENTORY[selectedItemIndex];
            if (currentItem === BLOCKS.TNT_LAUNCHER || currentItem === BLOCKS.ROCKET_LAUNCHER) {
                if (performance.now() - lastActionTime > LAUNCHER_DELAY) {
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
            case 'ShiftLeft': case 'ShiftRight': controls.moveDown = true; break;
            case 'Space':
                if (controls.isFlying) {
                    controls.jump = true; // Ascend
                } else {
                    if (controls.canJump) controls.velocity.y += JUMP_FORCE;
                    controls.canJump = false;
                }

                // Double Tap Detection
                // キーの自動リピートでは判定しない（押しっぱなしで飛行モードが
                // 誤って切り替わるのを防ぐ）
                if (!event.repeat) {
                    const now = performance.now();
                    if (now - lastSpaceTime < 300) {
                        controls.isFlying = !controls.isFlying;
                        controls.velocity.y = 0; // Stop falling
                        document.getElementById('fly-mode-indicator').style.display = controls.isFlying ? 'block' : 'none';
                    }
                    lastSpaceTime = now;
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
        case 'ShiftLeft': case 'ShiftRight': controls.moveDown = false; break;
        case 'Space': controls.jump = false; break;
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
        if (performance.now() - lastActionTime > BREAK_DELAY) {
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
