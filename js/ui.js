// --- UI Updates ---
function getImageForType(type) {
    if(type === BLOCKS.GRASS) return materials[type][2].map.image.toDataURL();
    else if(type === BLOCKS.WOOD) return materials[type][0].map.image.toDataURL();
    else if(type === BLOCKS.TNT) return materials[type][0].map.image.toDataURL();
    else if(type === BLOCKS.MEGA_TNT) return materials[type][0].map.image.toDataURL();
    else if(type === BLOCKS.WATER) return materials[type].map.image.toDataURL();
    else if(type === BLOCKS.FLINT) return flintTexture.image.toDataURL();
    else if(type === BLOCKS.TNT_LAUNCHER) return launcherTexture.image.toDataURL();
    else if(type === BLOCKS.ROCKET_LAUNCHER) return rocketLauncherTexture.image.toDataURL();
    else return materials[type].map.image.toDataURL();
}

function updateUI() {
    const container = document.getElementById('ui-container');
    container.innerHTML = '';

    INVENTORY.forEach((type, index) => {
        const div = document.createElement('div');
        div.className = `slot ${selectedItemIndex === index ? 'active' : ''}`;
        div.style.backgroundImage = `url(${getImageForType(type)})`;

        const hint = document.createElement('div');
        hint.className = 'key-hint';
        hint.innerText = index + 1;
        div.appendChild(hint);

        // タッチでアイテム選択（モバイル用）
        div.addEventListener('touchstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectedItemIndex = index;
            updateUI();
        }, { passive: false });

        // クリックでもアイテム選択（PC用）
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedItemIndex = index;
            updateUI();
        });

        container.appendChild(div);
    });

    if(isInventoryOpen) {
        const grid = document.getElementById('inv-grid');
        grid.innerHTML = '';
        INVENTORY.forEach((type, index) => {
            const div = document.createElement('div');
            div.className = 'slot';
            if(swapSourceIndex === index) div.classList.add('swapping');
            div.style.backgroundImage = `url(${getImageForType(type)})`;

            div.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                handleInventorySwap(index);
            });

            // タッチでも入れ替え（モバイル用）
            div.addEventListener('touchstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleInventorySwap(index);
            }, { passive: false });

            grid.appendChild(div);
        });
    }

    // 銃の表示を更新
    updateGunVisibility();
}

function handleInventorySwap(index) {
    if (swapSourceIndex === -1) {
        swapSourceIndex = index;
    } else {
        if (swapSourceIndex !== index) {
            const temp = INVENTORY[swapSourceIndex];
            INVENTORY[swapSourceIndex] = INVENTORY[index];
            INVENTORY[index] = temp;
        }
        swapSourceIndex = -1;
    }
    updateUI();
}

// 銃の表示を更新
function updateGunVisibility() {
    const currentItem = INVENTORY[selectedItemIndex];
    if (typeof gunGroup !== 'undefined') {
        gunGroup.visible = (currentItem === BLOCKS.TNT_LAUNCHER);
    }
    if (typeof rocketGunGroup !== 'undefined') {
        rocketGunGroup.visible = (currentItem === BLOCKS.ROCKET_LAUNCHER);
    }
}

// 現在アクティブな銃グループを取得
function getActiveGunGroup() {
    const currentItem = INVENTORY[selectedItemIndex];
    if (currentItem === BLOCKS.TNT_LAUNCHER) return gunGroup;
    if (currentItem === BLOCKS.ROCKET_LAUNCHER) return rocketGunGroup;
    return null;
}

// 銃の発射アニメーション
function triggerGunRecoil() {
    gunRecoilTime = 0.2; // 0.2秒のリコイル
}

// 銃のアニメーション更新
function updateGunAnimation(delta) {
    const activeGun = getActiveGunGroup();
    if (!activeGun || !activeGun.visible) return;

    const defaultPos = activeGun === gunGroup ? gunDefaultPos : rocketGunDefaultPos;
    const defaultRot = gunDefaultRot;

    // 歩行時のボブ
    const isMoving = controls.moveForward || controls.moveBackward || controls.moveLeft || controls.moveRight;
    if (isMoving && !controls.isFlying) {
        gunBobTime += delta * (controls.isSprinting ? 12 : 8);
        const bobX = Math.sin(gunBobTime) * 0.01;
        const bobY = Math.abs(Math.cos(gunBobTime)) * 0.015;
        activeGun.position.x = defaultPos.x + bobX;
        activeGun.position.y = defaultPos.y + bobY;
    } else {
        gunBobTime = 0;
        activeGun.position.x = defaultPos.x;
        activeGun.position.y = defaultPos.y;
    }

    // リコイルアニメーション
    if (gunRecoilTime > 0) {
        gunRecoilTime -= delta;
        const recoilProgress = gunRecoilTime / 0.2;
        const recoilAmount = Math.sin(recoilProgress * Math.PI) * 0.1;

        activeGun.position.z = defaultPos.z + recoilAmount;
        activeGun.rotation.x = defaultRot.x - recoilAmount * 2;
        activeGun.position.y = defaultPos.y + recoilAmount * 0.3;
    } else {
        activeGun.position.z = defaultPos.z;
        activeGun.rotation.x = defaultRot.x;
    }
}

function updateHearts() {
    const container = document.getElementById('hearts-container');
    container.innerHTML = '';
    const heartCount = Math.ceil(playerHP / 10);

    for(let i=0; i<MAX_HEARTS; i++) {
        const span = document.createElement('span');
        span.className = `heart ${i < heartCount ? '' : 'empty'}`;
        span.innerHTML = '❤';
        container.appendChild(span);
    }
}

function setSlot(index) {
    if(index >= 0 && index < INVENTORY.length) {
        selectedItemIndex = index;
        updateUI();
    }
}
