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
    camera.position.set(0, 5, 0);
    controls.velocity.set(0, 0, 0);
    controls.isFlying = false;
    document.getElementById('fly-mode-indicator').style.display = 'none';
    playerHP = 100;
    updateHearts();
}
