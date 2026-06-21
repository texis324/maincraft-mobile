// --- 🚜 戦車（搭乗して運転できる重装甲ビークル） ---
// 「TANK アイテムを右クリで召喚して即搭乗 → WASDで走行・マウスで砲塔旋回・クリック/Cで主砲を撃つ」。
// 主砲弾は着弾で explode() を呼ぶ＝クレーターは通常爆発と同じ仕組みで永続化＆live↔reload一致（編集edit経由）。
// 履帯で兵（agents の陣営兵）を轢き殺せる＝AI陣営戦の戦場に突っ込める。F で降車（戦車はその場に残り再搭乗可）。
//
// 方針:
//   ① 戦車は同時に1台（新規召喚で古い1台は撤去）＝端ケースを抑えて堅牢に。
//   ② 接地は agents と同じ「下のブロックにスナップ」方式（沈み込み/浮きを防ぐ実績ロジック）。
//   ③ カメラは砲塔の後方上空に置くチェイスカメラ。マウスで自由に旋回し、砲塔/砲身はその視線方向へ追従。
//      発砲は視線方向（カメラの実方向）に沿って撃つ＝「見た所に飛ぶ」。
//   ④ 毎フレームの new を避けるため一時ベクトルを使い回す。

// --- チューニング ---
const TANK_ACCEL = 14.0;     // 加速度（前進/後退）
const TANK_BRAKE = 22.0;     // 入力なし時のエンジンブレーキ（0へ減衰）
const TANK_MAX_FWD = 12.0;   // 前進最高速
const TANK_MAX_REV = 6.0;    // 後退最高速
const TANK_TURN_RATE = 1.5;  // 旋回速度（rad/s・速度が乗ると曲がりやすい）
const TANK_GRAVITY = 24.0;
const TANK_CRUSH_R = 2.3;    // 走行中に兵を轢き潰す半径
const TANK_FIRE_CD = 0.8;    // 主砲の連射間隔（秒）
const TANK_SHELL_SPEED = 80; // 砲弾の初速
const TANK_SHELL_R = 6;      // 砲弾の爆発半径（整数＝explode の掘削Y範囲が小数化して削れないのを避ける。核/メガと同じ作法）
const TANK_SHELL_MAX_RANGE = 220;
const TANK_CAM_DIST = 8.0;   // チェイスカメラの後方距離
const TANK_CAM_HEIGHT = 3.4; // チェイスカメラの高さ（戦車基準）
const TANK_BODY_Y = -0.5;    // モデル原点(履帯底)を接地スナップ面に合わせる補正
const TANK_TURRET_OFFY = 1.35; // 砲身ピボットの戦車基準からの高さ（砲口算出に使う）
const TANK_BARREL_LEN = 2.6;   // 砲身の長さ（砲口位置の算出に使う）

let inTank = false;          // プレイヤーが戦車に搭乗中か
let tank = null;             // 現在の戦車（1台）。{ group,turretGroup,barrelPivot,barrel, x,y,z, hullYaw,turretYaw,barrelPitch, speed,vy,grounded, fireCd,recoil }

const tankShells = [];       // 飛んでいる砲弾 [{ mesh, vel, traveled }]

// 使い回しベクトル（GC回避）
const _tankDir = new THREE.Vector3();
const _shellMove = new THREE.Vector3();
const _shellRayDir = new THREE.Vector3();
const _shellPrev = new THREE.Vector3();

// 固体判定（noCollide=水などはすり抜け）
function _tankSolid(x, y, z) {
    const t = getBlock(x, y, z);
    return t && !(BLOCK_PROPS[t] && BLOCK_PROPS[t].noCollide);
}

// 指定XZ列で、fromY 以下にある最上段の固体ブロックの「上面Y」を返す（接地スナップと一致する規約）。
function _tankGroundTop(x, z, fromY) {
    const top = Math.floor(fromY);
    for (let y = top; y > worldBottomY; y--) {
        if (_tankSolid(x, y, z)) return y + 1;
    }
    // 未生成域では決定的な地形高で代用（遠方でも破綻しない）
    return Math.max(Math.min(terrainHeightAt(x, z), top), worldBottomY + 1);
}

// カメラの実視線方向（YXZ オイラーから直接算出＝matrixWorldのフレーム遅延を避ける）。
function tankAimDir(out) {
    const yaw = camera.rotation.y, pitch = camera.rotation.x;
    const cp = Math.cos(pitch);
    out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return out;
}

// 戦車の3Dモデル＋状態を生成して返す（モデルは +Z を前方として組む）。
function makeTank(x, y, z, hullYaw) {
    const group = new THREE.Group();

    const treadMat = new THREE.MeshLambertMaterial({ color: 0x171717 });
    const hullMat = new THREE.MeshLambertMaterial({ color: 0x4b5320 });
    const turretMat = new THREE.MeshLambertMaterial({ color: 0x556b2f });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0x33371c });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x222222 });

    // 履帯（左右の黒い箱・底を group 原点に合わせる）
    for (const sx of [-1.05, 1.05]) {
        const tread = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 4.4), treadMat);
        tread.position.set(sx, 0.35, 0);
        group.add(tread);
    }
    // 車体（ハル）
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.9, 3.7), hullMat);
    hull.position.set(0, 1.05, 0);
    group.add(hull);
    // 前面の傾斜装甲っぽい板
    const glacis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 0.5), hullMat);
    glacis.position.set(0, 0.85, 1.9);
    group.add(glacis);

    // 砲塔（独立旋回するグループ）
    const turretGroup = new THREE.Group();
    turretGroup.position.set(0, 1.5, -0.15);
    group.add(turretGroup);
    const turret = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 1.9), turretMat);
    turret.position.set(0, 0.35, 0);
    turretGroup.add(turret);
    // キューポラ（ハッチ）
    const cupola = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.6), turretMat);
    cupola.position.set(-0.3, 0.82, -0.3);
    turretGroup.add(cupola);

    // 砲身ピボット（砲塔前面・ここを基準に上下にピッチ）
    const barrelPivot = new THREE.Group();
    barrelPivot.position.set(0, 0.35, 0.7);
    turretGroup.add(barrelPivot);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, TANK_BARREL_LEN, 10), barrelMat);
    barrel.rotation.x = Math.PI / 2;           // 円柱の軸(Y)を前方(Z)へ倒す
    barrel.position.set(0, 0, TANK_BARREL_LEN * 0.5); // ピボットから前方へ伸ばす
    barrelPivot.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.35), darkMat);
    muzzle.position.set(0, 0, TANK_BARREL_LEN + 0.1);
    barrelPivot.add(muzzle);

    const t = {
        group: group, turretGroup: turretGroup, barrelPivot: barrelPivot, barrel: barrel,
        barrelBaseZ: barrel.position.z,
        x: x, y: y, z: z,
        hullYaw: hullYaw, turretYaw: hullYaw, barrelPitch: 0,
        speed: 0, vy: 0, grounded: false,
        fireCd: 0, recoil: 0
    };
    return t;
}

function removeTank() {
    if (!tank) return;
    scene.remove(tank.group);
    tank.group.traverse(o => {
        if (o.isMesh) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }
    });
    tank = null;
}

// プレイヤーの少し前に戦車を召喚して接地（既存の1台は撤去）。
function spawnTank() {
    removeTank();
    const yaw = camera.rotation.y;
    const fwdHx = -Math.sin(yaw), fwdHz = -Math.cos(yaw);
    const sx = camera.position.x + fwdHx * 5;
    const sz = camera.position.z + fwdHz * 5;
    const fromY = Math.max(camera.position.y, maxSurfaceY) + 6;
    const top = _tankGroundTop(Math.floor(sx), Math.floor(sz), fromY);
    const hullYaw = Math.atan2(fwdHz, fwdHx); // プレイヤーの前方を向く
    tank = makeTank(sx, top, sz, hullYaw);
    scene.add(tank.group);
    syncTankModel(tank);
}

// 近くに（再搭乗できる距離に）戦車があるか
function _tankNear() {
    if (!tank) return false;
    const dx = tank.x - camera.position.x, dz = tank.z - camera.position.z;
    return dx * dx + dz * dz < 64; // 8ブロック以内
}

function boardTank() {
    if (!tank) return;
    inTank = true;
    controls.isFlying = false;
    controls.velocity.set(0, 0, 0);
    tank.speed = 0;
    if (typeof showTankUI === 'function') showTankUI(true);
    if (typeof updateGunVisibility === 'function') updateGunVisibility(); // 銃ビューモデルを隠す
    document.getElementById('fly-mode-indicator').style.display = 'none';
}

function exitTank() {
    inTank = false;
    // 搭乗中の WASD はキーが押されたまま降りると controls.move* が true で残り、徒歩で勝手に動き出す。明示クリア。
    controls.moveForward = controls.moveBackward = controls.moveLeft = controls.moveRight = false;
    controls.isSprinting = false;
    if (tank) {
        // 戦車の真横に降ろす
        const rx = Math.cos(tank.hullYaw + Math.PI / 2), rz = Math.sin(tank.hullYaw + Math.PI / 2);
        const px = tank.x + rx * 3, pz = tank.z + rz * 3;
        const top = _tankGroundTop(Math.floor(px), Math.floor(pz), tank.y + 6);
        camera.position.set(px, top + 1.6, pz);
        controls.velocity.set(0, 0, 0);
    }
    if (typeof showTankUI === 'function') showTankUI(false);
    if (typeof updateGunVisibility === 'function') updateGunVisibility();
}

// F キー / 降車ボタン / アイテム操作からの統一トグル。
function tankToggle() {
    if (inTank) { exitTank(); return; }
    if (_tankNear()) { boardTank(); return; }
    spawnTank(); boardTank();
}

// TANK アイテムを右クリ/タップした時の動作（搭乗中＝砲撃 / 非搭乗＝近くの戦車に乗る or 新規召喚して乗る）。
function tankItemAction() {
    if (inTank) { fireTankShell(); return; }
    if (_tankNear()) { boardTank(); return; }
    spawnTank(); boardTank();
}

// 主砲を撃つ（砲弾を生成＝着弾で explode）。
function fireTankShell() {
    const t = tank;
    if (!t || t.fireCd > 0) return;
    t.fireCd = TANK_FIRE_CD;
    t.recoil = 1; // 砲身が後退する見た目の反動（挙動は乱さない）
    tankAimDir(_tankDir);
    // 砲口位置＝砲塔ピボット（戦車基準の高さ）から視線方向へ砲身分だけ前
    const mx = t.x + _tankDir.x * TANK_BARREL_LEN;
    const my = t.y + TANK_TURRET_OFFY + _tankDir.y * TANK_BARREL_LEN;
    const mz = t.z + _tankDir.z * TANK_BARREL_LEN;

    const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshLambertMaterial({ color: 0x2b2b2b })
    );
    shell.position.set(mx, my, mz);
    scene.add(shell);
    tankShells.push({ mesh: shell, vel: _tankDir.clone().multiplyScalar(TANK_SHELL_SPEED), traveled: 0 });

    if (typeof createBlockParticles === 'function') createBlockParticles(mx, my, mz, BLOCKS.TNT, 5, 0.22); // マズルフラッシュ
    playSound('tank_fire');
    if (typeof nukeScreenShake === 'function') nukeScreenShake(0.25, 0.04);
}

function updateTankShells(delta) {
    for (let i = tankShells.length - 1; i >= 0; i--) {
        const s = tankShells[i];
        const movement = _shellMove.copy(s.vel).multiplyScalar(delta);
        const mlen = movement.length();
        s.mesh.position.add(movement);
        s.traveled += mlen;

        let hit = false;
        const pos = s.mesh.position;
        const rayDir = _shellRayDir.copy(s.vel).normalize();
        const prevPos = _shellPrev.copy(pos).sub(movement);
        if (voxelRaycast(prevPos, rayDir, mlen + 0.3, false)) hit = true;
        const bt = getBlock(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
        if (bt && !BLOCK_PROPS[bt]?.noCollide) hit = true;
        if (s.traveled > TANK_SHELL_MAX_RANGE || pos.y < worldBottomY || pos.y > maxSurfaceY + 80) hit = true;

        if (hit) {
            explode(pos.x, pos.y, pos.z, false, TANK_SHELL_R);
            scene.remove(s.mesh);
            if (s.mesh.geometry) s.mesh.geometry.dispose();
            if (s.mesh.material) s.mesh.material.dispose();
            tankShells.splice(i, 1);
        }
    }
}

// 戦車のモデル変換を状態から反映。
function syncTankModel(t) {
    t.group.position.set(t.x, t.y + TANK_BODY_Y, t.z);
    t.group.rotation.y = Math.PI / 2 - t.hullYaw;          // モデル+Z→hullYaw方向
    t.turretGroup.rotation.y = t.hullYaw - t.turretYaw;    // 砲塔をturretYaw方向(ワールド)へ
    const pitch = Math.max(-0.45, Math.min(1.0, t.barrelPitch));
    t.barrelPivot.rotation.x = -pitch;                     // 上を向くと砲口が上がる
    t.barrel.position.z = t.barrelBaseZ - t.recoil * 0.5;  // 発砲反動で砲身が後退
}

// 接地・重力（manned/unmanned 共通の落下スナップ）。
function _tankGravityStep(t, dt) {
    t.vy -= TANK_GRAVITY * dt;
    if (t.vy < -45) t.vy = -45;
    const fx = Math.floor(t.x), fz = Math.floor(t.z);
    const below = Math.floor(t.y) - 1;
    t.grounded = false;
    if (t.vy <= 0 && _tankSolid(fx, below, fz)) { t.y = below + 1; t.vy = 0; t.grounded = true; }
    else t.y += t.vy * dt;
}

// 降車中の戦車：重力で settle して止まる（入力は受けない）。
function idleTank(dt) {
    const t = tank;
    _tankGravityStep(t, dt);
    if (t.speed > 0) t.speed = Math.max(0, t.speed - TANK_BRAKE * dt);
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 4);
    if (t.fireCd > 0) t.fireCd -= dt;
    // 遠方で地表チャンクがアンロードされると無人戦車が接地を失って奈落へ落ち続ける＝撤去する。
    if (t.y < worldBottomY - 4) { removeTank(); return; }
    syncTankModel(t);
}

// 搭乗運転：throttle/steer・接地・段差越え・兵轢き・砲塔追従・チェイスカメラ。
function updateTankDriving(delta) {
    const t = tank;
    if (!t) return;
    const dt = Math.min(delta, 0.05);

    // throttle（W=前進 / S=後退 / 無入力=ブレーキ）
    if (controls.moveForward) t.speed += TANK_ACCEL * dt;
    else if (controls.moveBackward) t.speed -= TANK_ACCEL * dt;
    else {
        const dec = TANK_BRAKE * dt;
        if (t.speed > dec) t.speed -= dec; else if (t.speed < -dec) t.speed += dec; else t.speed = 0;
    }
    t.speed = Math.max(-TANK_MAX_REV, Math.min(TANK_MAX_FWD, t.speed));

    // steer（A=左 / D=右・速度が乗るほど曲がりやすい）
    let turn = 0;
    if (controls.moveLeft) turn += 1;
    if (controls.moveRight) turn -= 1;
    if (turn !== 0) {
        const rate = TANK_TURN_RATE * (0.45 + Math.min(1, Math.abs(t.speed) / 4) * 0.55);
        t.hullYaw += turn * rate * dt;
    }

    // 重力＋接地
    _tankGravityStep(t, dt);

    // 前後移動（接地時）。前方が2段以上の壁なら停止、1段なら乗り越える。
    if (t.grounded && t.speed !== 0) {
        const fwdx = Math.cos(t.hullYaw), fwdz = Math.sin(t.hullYaw);
        const sgn = t.speed >= 0 ? 1 : -1;
        const nx = t.x + fwdx * t.speed * dt;
        const nz = t.z + fwdz * t.speed * dt;
        const fy = Math.floor(t.y);
        const bx = Math.floor(nx + fwdx * 1.6 * sgn), bz = Math.floor(nz + fwdz * 1.6 * sgn);
        if (!_tankSolid(bx, fy, bz)) { t.x = nx; t.z = nz; }
        else if (!_tankSolid(bx, fy + 1, bz) && !_tankSolid(bx, fy + 2, bz)) { t.y += 1; t.x = nx; t.z = nz; }
        else { t.speed = 0; }
    }

    // 履帯で兵を轢く（走行中のみ）
    if (Math.abs(t.speed) > 0.6 && typeof killAgentsInRadius === 'function') {
        killAgentsInRadius(t.x, t.y + 0.4, t.z, TANK_CRUSH_R);
    }

    // 砲塔/砲身を視線方向へ追従
    tankAimDir(_tankDir);
    t.turretYaw = Math.atan2(_tankDir.z, _tankDir.x);
    t.barrelPitch = Math.asin(Math.max(-1, Math.min(1, _tankDir.y)));

    if (t.fireCd > 0) t.fireCd -= dt;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 4);
    syncTankModel(t);

    // チェイスカメラ（砲塔の後方上空・カメラ水平方向の後ろへ引く）
    const yaw = camera.rotation.y;
    const fwdHx = -Math.sin(yaw), fwdHz = -Math.cos(yaw);
    let camX = t.x - fwdHx * TANK_CAM_DIST;
    let camZ = t.z - fwdHz * TANK_CAM_DIST;
    let camY = t.y + TANK_CAM_HEIGHT;
    const gtop = _tankGroundTop(Math.floor(camX), Math.floor(camZ), camY + 6);
    if (camY < gtop + 1.2) camY = gtop + 1.2; // 地面にめり込まない
    camera.position.set(camX, camY, camZ);

    // 奈落に落ちたら降車（戦車は撤去）
    if (t.y < worldBottomY - 4) { removeTank(); inTank = false; if (typeof showTankUI === 'function') showTankUI(false); }
}

// 戦車HUD（操作ヒント＋降車ボタン）の表示/非表示。
function showTankUI(show) {
    const hud = document.getElementById('tank-hud');
    if (hud) hud.style.display = show ? 'block' : 'none';
    const exitBtn = document.getElementById('btn-exit-tank');
    if (exitBtn) exitBtn.style.display = show ? 'block' : 'none';
}

// main.js のループから毎フレーム呼ぶ（戦車本体＋砲弾）。
function updateTanks(delta) {
    if (tank) {
        if (inTank) updateTankDriving(delta);
        else idleTank(delta);
    }
    updateTankShells(delta);
}
