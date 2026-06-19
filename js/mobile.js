// ===== Mobile Touch Controls =====
// isMobileDevice は config.js で定義済み

// Joystick State
const joystick = {
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    identifier: null
};

// Look State
const lookTouch = {
    active: false,
    lastX: 0,
    lastY: 0,
    startX: 0,
    startY: 0,
    identifier: null
};

// Touch button states
let touchBreakActive = false;
let touchPlaceActive = false;

// Mobile sensitivity (変更可能)
let mobileLookSensitivity = 0.004;

// Joystick elements
const joystickZone = document.getElementById('joystick-zone');
const joystickStick = document.getElementById('joystick-stick');
const joystickBase = document.getElementById('joystick-base');
const lookZone = document.getElementById('look-zone');

// Joystick Touch Handlers
if (joystickZone) {
    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystick.active) return;

        const touch = e.changedTouches[0];
        const rect = joystickBase.getBoundingClientRect();
        joystick.active = true;
        joystick.identifier = touch.identifier;
        joystick.startX = rect.left + rect.width / 2;
        joystick.startY = rect.top + rect.height / 2;
        joystick.currentX = touch.clientX;
        joystick.currentY = touch.clientY;

        updateJoystick();
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (let touch of e.changedTouches) {
            if (touch.identifier === joystick.identifier) {
                joystick.currentX = touch.clientX;
                joystick.currentY = touch.clientY;
                updateJoystick();
                break;
            }
        }
    }, { passive: false });

    joystickZone.addEventListener('touchend', (e) => {
        for (let touch of e.changedTouches) {
            if (touch.identifier === joystick.identifier) {
                joystick.active = false;
                joystick.identifier = null;
                resetJoystick();
                break;
            }
        }
    });

    joystickZone.addEventListener('touchcancel', (e) => {
        joystick.active = false;
        joystick.identifier = null;
        resetJoystick();
    });
}

function updateJoystick() {
    const maxDist = 50;
    let dx = joystick.currentX - joystick.startX;
    let dy = joystick.currentY - joystick.startY;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) {
        dx = (dx / dist) * maxDist;
        dy = (dy / dist) * maxDist;
    }

    joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    // Update controls based on joystick position
    const threshold = 15;
    controls.moveForward = dy < -threshold;
    controls.moveBackward = dy > threshold;
    controls.moveLeft = dx < -threshold;
    controls.moveRight = dx > threshold;

    // Sprint only when pushed very far up (90%+ of max distance and mostly upward)
    const sprintThreshold = 45; // maxDist の 90%
    const isMainlyUp = dy < -threshold && Math.abs(dx) < 25; // 上方向がメイン
    if (dist > sprintThreshold && isMainlyUp) {
        controls.isSprinting = true;
    } else {
        controls.isSprinting = false;
    }
}

function resetJoystick() {
    joystickStick.style.transform = 'translate(-50%, -50%)';
    controls.moveForward = false;
    controls.moveBackward = false;
    controls.moveLeft = false;
    controls.moveRight = false;
    controls.isSprinting = false;
}

// Look Zone Touch Handlers (タップ:設置 / 長押し:破壊)
let screenTouchStartTime = 0;
let screenTouchMoved = false;
let screenTouchHoldTimer = null;
let screenTouchBreaking = false;
let screenTouchX = 0; // タッチしたスクリーン座標
let screenTouchY = 0;
const LONG_PRESS_THRESHOLD = 250; // 250ms以上で長押し判定
const MOVE_THRESHOLD = 10; // これ以上動いたらカメラ操作と判定

// 破壊インジケーター要素
const breakIndicator = document.getElementById('break-indicator');

// 破壊インジケーターを表示
function showBreakIndicator(x, y) {
    if (breakIndicator) {
        breakIndicator.style.display = 'block';
        breakIndicator.style.left = x + 'px';
        breakIndicator.style.top = y + 'px';
    }
}

// 破壊インジケーターを非表示
function hideBreakIndicator() {
    if (breakIndicator) {
        breakIndicator.style.display = 'none';
    }
}

// ジョイスティックエリア内かどうかをチェック
function isInJoystickArea(x, y) {
    const rect = joystickZone.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

if (lookZone) {
    lookZone.addEventListener('touchstart', (e) => {
        const touch = e.changedTouches[0];

        // ジョイスティックエリア内のタッチは無視
        if (isInJoystickArea(touch.clientX, touch.clientY)) {
            return;
        }

        // UIボタン上では無視
        if (e.target.closest('.touch-btn') || e.target.closest('#item-nav') || e.target.closest('#ui-container')) {
            return;
        }

        e.preventDefault();
        if (lookTouch.active) return;
        if (isGameOver || isPaused || isInventoryOpen) return;

        lookTouch.active = true;
        lookTouch.identifier = touch.identifier;
        lookTouch.lastX = touch.clientX;
        lookTouch.lastY = touch.clientY;
        lookTouch.startX = touch.clientX;
        lookTouch.startY = touch.clientY;

        // タッチ座標を保存（破壊・設置に使用）
        screenTouchX = touch.clientX;
        screenTouchY = touch.clientY;

        screenTouchStartTime = performance.now();
        screenTouchMoved = false;
        screenTouchBreaking = false;

        // 長押し検出タイマー開始
        screenTouchHoldTimer = setTimeout(() => {
            if (!screenTouchMoved && lookTouch.active) {
                // 長押し開始 → 破壊モード（タッチ座標で破壊）
                screenTouchBreaking = true;
                // 破壊インジケーターを表示
                showBreakIndicator(screenTouchX, screenTouchY);
                // 即座に1回破壊を試みる
                attemptMine(screenTouchX, screenTouchY);
                touchBreakActive = true;
            }
        }, LONG_PRESS_THRESHOLD);

    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
        const touch = e.changedTouches[0];

        // ジョイスティックエリア内のタッチは無視
        if (isInJoystickArea(touch.clientX, touch.clientY)) {
            return;
        }

        if (e.target.closest('.touch-btn') || e.target.closest('#item-nav') || e.target.closest('#ui-container')) {
            return;
        }

        e.preventDefault();
        if (!lookTouch.active) return;
        if (isGameOver || isPaused || isInventoryOpen) return;

        for (let t of e.changedTouches) {
            if (t.identifier === lookTouch.identifier) {
                const dx = t.clientX - lookTouch.lastX;
                const dy = t.clientY - lookTouch.lastY;

                // 移動量チェック
                const totalDx = t.clientX - lookTouch.startX;
                const totalDy = t.clientY - lookTouch.startY;
                const totalDist = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

                if (totalDist > MOVE_THRESHOLD) {
                    screenTouchMoved = true;
                    // 長押しタイマーをキャンセル
                    if (screenTouchHoldTimer) {
                        clearTimeout(screenTouchHoldTimer);
                        screenTouchHoldTimer = null;
                    }
                    // 破壊モードを解除
                    if (screenTouchBreaking) {
                        screenTouchBreaking = false;
                        touchBreakActive = false;
                        hideBreakIndicator();
                    }
                }

                // カメラ回転
                camera.rotation.y -= dx * mobileLookSensitivity;
                camera.rotation.x -= dy * mobileLookSensitivity;
                camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));

                lookTouch.lastX = t.clientX;
                lookTouch.lastY = t.clientY;
                break;
            }
        }
    }, { passive: false });

    lookZone.addEventListener('touchend', (e) => {
        for (let touch of e.changedTouches) {
            if (touch.identifier === lookTouch.identifier) {
                // 長押しタイマーをキャンセル
                if (screenTouchHoldTimer) {
                    clearTimeout(screenTouchHoldTimer);
                    screenTouchHoldTimer = null;
                }

                const touchDuration = performance.now() - screenTouchStartTime;

                // 破壊モード終了
                if (screenTouchBreaking) {
                    screenTouchBreaking = false;
                    touchBreakActive = false;
                    hideBreakIndicator();
                }
                // 短いタップで動いてない場合 → 設置（タッチ座標で）
                else if (!screenTouchMoved && touchDuration < LONG_PRESS_THRESHOLD) {
                    if (!isGameOver && !isPaused && !isInventoryOpen) {
                        attemptPlaceOrIgnite(screenTouchX, screenTouchY);
                    }
                }

                lookTouch.active = false;
                lookTouch.identifier = null;
                break;
            }
        }
    });

    lookZone.addEventListener('touchcancel', () => {
        if (screenTouchHoldTimer) {
            clearTimeout(screenTouchHoldTimer);
            screenTouchHoldTimer = null;
        }
        if (screenTouchBreaking) {
            screenTouchBreaking = false;
            touchBreakActive = false;
            hideBreakIndicator();
        }
        lookTouch.active = false;
        lookTouch.identifier = null;
    });
}

// Button Handlers
function setupTouchButton(id, onStart, onEnd) {
    const btn = document.getElementById(id);
    if (!btn) return;

    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btn.classList.add('active');
        if (onStart) onStart();
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        if (onEnd) onEnd();
    }, { passive: false });

    btn.addEventListener('touchcancel', () => {
        btn.classList.remove('active');
        if (onEnd) onEnd();
    });
}

// Jump Button (二度押しで飛行モード切り替え)
let lastJumpTapTime = 0;
setupTouchButton('btn-jump', () => {
    if (isGameOver || isPaused || isInventoryOpen) return;

    const now = performance.now();

    // 二度押し検出（300ms以内）
    if (now - lastJumpTapTime < 300) {
        // 飛行モード切り替え
        controls.isFlying = !controls.isFlying;
        controls.velocity.y = 0;
        document.getElementById('fly-mode-indicator').style.display = controls.isFlying ? 'block' : 'none';
        lastJumpTapTime = 0; // リセット
    } else {
        // 通常ジャンプ or 飛行中上昇
        if (controls.isFlying) {
            controls.jump = true;
        } else {
            if (controls.canJump) controls.velocity.y += JUMP_FORCE;
            controls.canJump = false;
        }
        lastJumpTapTime = now;
    }
}, () => {
    controls.jump = false;
});

// Inventory Button
setupTouchButton('btn-inventory', () => {
    toggleInventory();
});

// Pause Button
setupTouchButton('btn-pause', () => {
    if (!isInventoryOpen) {
        isPaused = true;
        document.getElementById('pause-menu').style.display = 'flex';
    }
});

// Integrate touch actions into game loop.
// We need to check touchBreakActive and touchPlaceActive
function checkTouchActions() {
    if (isGameOver || isPaused || isInventoryOpen) return;

    const time = performance.now();

    // 長押し中の破壊（タッチ座標を使用）
    if (touchBreakActive && time - lastActionTime > getBreakDelay()) {
        attemptMine(screenTouchX, screenTouchY);
        lastActionTime = time;
    }

    if (touchPlaceActive) {
        const currentItem = INVENTORY[selectedItemIndex];
        let currentDelay = SLOW_PLACE_DELAY;

        if (currentItem === BLOCKS.TNT_LAUNCHER) {
            currentDelay = LAUNCHER_DELAY;
        }

        if (time - lastActionTime > currentDelay) {
            attemptPlaceOrIgnite(screenTouchX, screenTouchY);
            lastActionTime = time;
        }
    }
}

// Hook into render loop
const originalRender = renderer.render.bind(renderer);
renderer.render = function(scene, camera) {
    checkTouchActions();
    originalRender(scene, camera);
};

// モバイルコントロールの表示/非表示を設定
const mobileControlsEl = document.getElementById('mobile-controls');
if (mobileControlsEl) {
    mobileControlsEl.style.display = isMobileDevice ? 'block' : 'none';
}

// PCの場合は操作説明を表示
const infoEl = document.getElementById('info');
if (infoEl) {
    infoEl.style.display = isMobileDevice ? 'none' : 'block';
}
