// --- 3. Three.js Initialization ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
// fog をマップサイズ連動で設定（PC専用方針なので大きなキノコ雲も眺められるよう遠くへ）
// near は近景の空気感を残しつつ、far はマップ全体＋高く広い爆発煙を飲み込まないところまで伸ばす
function applyFog() {
    // 無限ワールド: 霧は描画距離(VIEW_DIST チャンク)の境界で地形を溶かし、ストリーミングの
    // ポップインを隠す。far はロード半径の内側に置く（far > ロード半径だと未生成の縁が見える）。
    const span = VIEW_DIST * 16;            // 描画距離（ブロック）
    const near = Math.max(48, span * 0.45);
    const far  = Math.max(150, span * 0.92);
    if (scene.fog) {
        scene.fog.near = near;
        scene.fog.far  = far;
    } else {
        scene.fog = new THREE.Fog(0x87CEEB, near, far);
    }
}
applyFog();

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP));
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

// --- TNT Launcher (Gun) View Model ---
const gunGroup = new THREE.Group();

// 銃本体（バレル）
const barrelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.4);
const barrelMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
const barrel = new THREE.Mesh(barrelGeo, barrelMat);
barrel.position.set(0, 0, -0.2);
gunGroup.add(barrel);

// 赤いストライプ（TNTランチャーらしく）
const stripeGeo = new THREE.BoxGeometry(0.09, 0.04, 0.35);
const stripeMat = new THREE.MeshLambertMaterial({ color: 0xD32F2F });
const stripe = new THREE.Mesh(stripeGeo, stripeMat);
stripe.position.set(0, 0.02, -0.2);
gunGroup.add(stripe);

// グリップ
const gripGeo = new THREE.BoxGeometry(0.06, 0.15, 0.08);
const gripMat = new THREE.MeshLambertMaterial({ color: 0x5D4037 });
const grip = new THREE.Mesh(gripGeo, gripMat);
grip.position.set(0, -0.1, 0.05);
grip.rotation.x = 0.3;
gunGroup.add(grip);

// マズル（銃口）
const muzzleGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.05, 8);
const muzzleMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
muzzle.rotation.x = Math.PI / 2;
muzzle.position.set(0, 0, -0.42);
gunGroup.add(muzzle);

// TNTの装飾（小さいTNTが見える）
const tntDecoGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const tntDecoMat = new THREE.MeshLambertMaterial({ color: 0xD32F2F });
const tntDeco = new THREE.Mesh(tntDecoGeo, tntDecoMat);
tntDeco.position.set(0, 0.06, -0.1);
gunGroup.add(tntDeco);

// 銃の初期位置（画面右下）
gunGroup.position.set(0.25, -0.2, -0.5);
gunGroup.rotation.set(0, -0.1, 0);
gunGroup.visible = false; // 最初は非表示

camera.add(gunGroup);

// --- Rocket Launcher View Model ---
const rocketGunGroup = new THREE.Group();

// ロケットランチャー本体（太いチューブ）
const rocketBarrelGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8);
const rocketBarrelMat = new THREE.MeshLambertMaterial({ color: 0x2E7D32 });
const rocketBarrel = new THREE.Mesh(rocketBarrelGeo, rocketBarrelMat);
rocketBarrel.rotation.x = Math.PI / 2;
rocketBarrel.position.set(0, 0, -0.25);
rocketGunGroup.add(rocketBarrel);

// スコープ
const scopeGeo = new THREE.BoxGeometry(0.03, 0.05, 0.08);
const scopeMat = new THREE.MeshLambertMaterial({ color: 0xFFA000 });
const scope = new THREE.Mesh(scopeGeo, scopeMat);
scope.position.set(0, 0.07, -0.15);
rocketGunGroup.add(scope);

// グリップ
const rocketGripGeo = new THREE.BoxGeometry(0.05, 0.12, 0.06);
const rocketGripMat = new THREE.MeshLambertMaterial({ color: 0x4E342E });
const rocketGrip = new THREE.Mesh(rocketGripGeo, rocketGripMat);
rocketGrip.position.set(0, -0.08, 0);
rocketGrip.rotation.x = 0.2;
rocketGunGroup.add(rocketGrip);

// 後部（排気口）
const exhaustGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.1, 8);
const exhaustMat = new THREE.MeshLambertMaterial({ color: 0x1B5E20 });
const exhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
exhaust.rotation.x = Math.PI / 2;
exhaust.position.set(0, 0, 0.05);
rocketGunGroup.add(exhaust);

rocketGunGroup.position.set(0.28, -0.18, -0.5);
rocketGunGroup.rotation.set(0, -0.1, 0);
rocketGunGroup.visible = false;

camera.add(rocketGunGroup);

// --- アサルトライフル View Model（プレイヤーが構える黒い銃） ---
const rifleGunGroup = new THREE.Group();
const _rBody = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.34), new THREE.MeshLambertMaterial({ color: 0x1c1f24 }));
_rBody.position.set(0, 0, -0.17); rifleGunGroup.add(_rBody);
const _rBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.22, 8), new THREE.MeshLambertMaterial({ color: 0x111317 }));
_rBarrel.rotation.x = Math.PI / 2; _rBarrel.position.set(0, 0.01, -0.34); rifleGunGroup.add(_rBarrel);
const _rMag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.11, 0.05), new THREE.MeshLambertMaterial({ color: 0x33373d }));
_rMag.position.set(0, -0.08, -0.13); _rMag.rotation.x = -0.15; rifleGunGroup.add(_rMag);
const _rGrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05), new THREE.MeshLambertMaterial({ color: 0x26292e }));
_rGrip.position.set(0, -0.07, -0.02); _rGrip.rotation.x = 0.3; rifleGunGroup.add(_rGrip);
const _rSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.04), new THREE.MeshLambertMaterial({ color: 0x111317 }));
_rSight.position.set(0, 0.05, -0.1); rifleGunGroup.add(_rSight);
rifleGunGroup.position.set(0.26, -0.2, -0.5);
rifleGunGroup.rotation.set(0, -0.08, 0);
rifleGunGroup.userData.defPos = rifleGunGroup.position.clone();
rifleGunGroup.visible = false;
camera.add(rifleGunGroup);

// --- レールガン View Model（スリムな本体＋発光するシアンのレール） ---
const railgunGunGroup = new THREE.Group();
const _glBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.5), new THREE.MeshLambertMaterial({ color: 0x37474f }));
_glBody.position.set(0, 0, -0.25); railgunGunGroup.add(_glBody);
const _glRailMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
const _glRailT = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.5), _glRailMat);
_glRailT.position.set(0, 0.035, -0.25); railgunGunGroup.add(_glRailT);
const _glRailB = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.5), _glRailMat);
_glRailB.position.set(0, -0.035, -0.25); railgunGunGroup.add(_glRailB);
const _glMuzzle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xb2ebf2 }));
_glMuzzle.position.set(0, 0, -0.5); railgunGunGroup.add(_glMuzzle);
const _glGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.06), new THREE.MeshLambertMaterial({ color: 0x263238 }));
_glGrip.position.set(0, -0.08, -0.02); _glGrip.rotation.x = 0.25; railgunGunGroup.add(_glGrip);
railgunGunGroup.position.set(0.27, -0.19, -0.5);
railgunGunGroup.rotation.set(0, -0.1, 0);
railgunGunGroup.userData.defPos = railgunGunGroup.position.clone();
railgunGunGroup.visible = false;
camera.add(railgunGunGroup);

scene.add(camera); // カメラをシーンに追加（子オブジェクトを表示するため）

// 銃のアニメーション用変数
let gunRecoilTime = 0;
let gunBobTime = 0;
const gunDefaultPos = new THREE.Vector3(0.25, -0.2, -0.5);
const gunDefaultRot = new THREE.Euler(0, -0.1, 0);
const rocketGunDefaultPos = new THREE.Vector3(0.28, -0.18, -0.5);

const controls = {
    moveForward: false, moveBackward: false,
    moveLeft: false, moveRight: false,
    jump: false,
    moveUp: false,   // 飛行中の上昇（Shift）
    moveDown: false, // 飛行中の下降（Ctrl）
    canJump: false,
    isFlying: false,
    isSprinting: false, // Dash
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3()
};
