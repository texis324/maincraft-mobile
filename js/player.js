// --- Player State (Damage / Reset) ---
function takeDamage(amount) {
    if (document.getElementById('invincible').checked) return;

    playerHP -= amount;
    if(playerHP < 0) playerHP = 0;
    updateHearts();

    document.body.style.backgroundColor = 'rgba(255,0,0,0.3)';
    setTimeout(() => { document.body.style.backgroundColor = ''; }, 100);

    if(playerHP <= 0 && !isGameOver) {
        isGameOver = true;
        safeExitPointerLock();
        document.getElementById('game-over').style.display = 'flex';
    }
}

// Reset Player
function resetPlayer() {
    // 起伏地形では (0,5,0) 固定だと地中に埋まる/落下する。乾いた陸地を探して配置。
    spawnPlayer(); // camera.position 設定 + velocity ゼロ化
    controls.isFlying = false;
    document.getElementById('fly-mode-indicator').style.display = 'none';
    playerHP = 100;
    updateHearts();
}
