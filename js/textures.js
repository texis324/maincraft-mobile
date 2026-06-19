// --- 2. Graphics & Texture Generation ---
// 64x64 の ctx に 1 タイル分を描画する（アトラス焼き込みと createTexture の共通処理）
function paintTile(ctx, type) {
    // Simple pixel art procedural generation
    if (type === 'grass_side') {
        ctx.fillStyle = '#795548'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#2E7D32'; ctx.fillRect(0,0,64,20);
        addNoise(ctx);
    } else if (type === 'grass_top') {
        ctx.fillStyle = '#2E7D32'; ctx.fillRect(0,0,64,64);
        addNoise(ctx, 10);
    } else if (type === 'dirt') {
        ctx.fillStyle = '#795548'; ctx.fillRect(0,0,64,64);
        addNoise(ctx);
    } else if (type === 'stone') {
        ctx.fillStyle = '#9E9E9E'; ctx.fillRect(0,0,64,64);
        addNoise(ctx, 30);
    } else if (type === 'wood_side') {
        ctx.fillStyle = '#5D4037'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#4E342E';
        for(let i=0; i<64; i+=8) ctx.fillRect(i, 0, 4, 64);
    } else if (type === 'wood_top') {
        ctx.fillStyle = '#8D6E63'; ctx.fillRect(0,0,64,64);
        ctx.beginPath(); ctx.arc(32,32, 25, 0, Math.PI*2); ctx.stroke();
    } else if (type === 'leaves') {
        ctx.fillStyle = '#66BB6A'; ctx.fillRect(0,0,64,64);
        addNoise(ctx, 40);
    } else if (type === 'tnt_side') {
        ctx.fillStyle = '#D32F2F'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#FFF'; ctx.fillRect(0, 16, 64, 32);
        ctx.fillStyle = '#000'; ctx.font = '20px Arial'; ctx.fillText('TNT', 12, 40);
    } else if (type === 'tnt_top') {
        ctx.fillStyle = '#D32F2F'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#333'; ctx.fillRect(28,28,8,8);
    } else if (type === 'mega_tnt_side') {
        // 紫色の超強力TNT
        ctx.fillStyle = '#4A148C'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#FFD700'; ctx.fillRect(0, 16, 64, 32); // 金色の帯
        ctx.fillStyle = '#000'; ctx.font = 'bold 16px Arial'; ctx.fillText('MEGA', 8, 38);
    } else if (type === 'mega_tnt_top') {
        ctx.fillStyle = '#4A148C'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#FFD700'; ctx.fillRect(26,26,12,12); // 金色の芯
    } else if (type === 'nuke_side') {
        // 放射能ハザード（黄×黒のトレフォイル）
        ctx.fillStyle = '#FFD600'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, 64, 6); ctx.fillRect(0, 58, 64, 6); // 上下の黒帯
        const ncx = 32, ncy = 34;
        ctx.beginPath(); ctx.arc(ncx, ncy, 5, 0, Math.PI*2); ctx.fill(); // 中心の核
        for (let k = 0; k < 3; k++) {
            const a = -Math.PI/2 + k * (2*Math.PI/3);
            ctx.beginPath();
            ctx.moveTo(ncx, ncy);
            ctx.arc(ncx, ncy, 20, a - 0.52, a + 0.52);
            ctx.closePath(); ctx.fill();
        }
    } else if (type === 'nuke_top') {
        ctx.fillStyle = '#FFD600'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#111'; ctx.fillRect(24, 24, 16, 16); // 黒い芯
        ctx.fillStyle = '#FFD600'; ctx.fillRect(29, 29, 6, 6);
    } else if (type === 'hbomb_side') {
        // 水素爆弾（赤橙＋黒帯＋白H）
        ctx.fillStyle = '#FF3D00'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 64, 7); ctx.fillRect(0, 57, 64, 7);
        ctx.fillStyle = '#FFEB3B';
        ctx.fillRect(20, 16, 6, 32); ctx.fillRect(38, 16, 6, 32); ctx.fillRect(20, 29, 24, 6); // 文字H
    } else if (type === 'hbomb_top') {
        ctx.fillStyle = '#FF3D00'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#111'; ctx.fillRect(22, 22, 20, 20);
        ctx.fillStyle = '#FFEB3B'; ctx.fillRect(29, 26, 6, 12);
    } else if (type === 'water') {
        ctx.fillStyle = '#2196F3'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(10,10,20,10); ctx.fillRect(40,40,15,5);
    } else if (type === 'bedrock') {
        ctx.fillStyle = '#212121'; ctx.fillRect(0,0,64,64);
        addNoise(ctx, 50);
    } else if (type === 'flint') {
        ctx.fillStyle = '#555'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#CCC';
        ctx.beginPath(); ctx.arc(32, 32, 20, 0, Math.PI*1.5); ctx.lineWidth=8; ctx.stroke();
        ctx.fillStyle = '#B71C1C';
        ctx.fillRect(32, 32, 10, 10);
    } else if (type === 'launcher') {
        // Gun texture
        ctx.fillStyle = '#222'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#D32F2F'; ctx.fillRect(10, 20, 44, 10); // Red Barrel
        ctx.fillStyle = '#555'; ctx.fillRect(10, 30, 15, 20); // Handle
    } else if (type === 'rocket_launcher') {
        // Rocket Launcher texture (military green)
        ctx.fillStyle = '#2E7D32'; ctx.fillRect(0,0,64,64);
        ctx.fillStyle = '#1B5E20'; ctx.fillRect(10, 15, 44, 20); // Barrel
        ctx.fillStyle = '#4E342E'; ctx.fillRect(15, 35, 12, 18); // Handle
        ctx.fillStyle = '#FFA000'; ctx.fillRect(48, 18, 6, 14); // Scope
    } else if (type === 'nuke_missile') {
        // 単弾頭ミサイルのアイコン（斜めに構えた白ボディ＋赤いノーズ＋尾翼＋噴射炎）
        ctx.fillStyle = '#1A237E'; ctx.fillRect(0,0,64,64); // 濃紺の背景
        ctx.save();
        ctx.translate(32, 32); ctx.rotate(-Math.PI/4); // 斜め45度
        // ボディ（白〜灰のグラデ風）
        ctx.fillStyle = '#ECEFF1'; ctx.fillRect(-6, -22, 12, 40);
        // 赤いノーズコーン（三角）
        ctx.fillStyle = '#D32F2F';
        ctx.beginPath(); ctx.moveTo(-6, -22); ctx.lineTo(6, -22); ctx.lineTo(0, -34); ctx.closePath(); ctx.fill();
        // 赤い帯マーキング
        ctx.fillStyle = '#D32F2F'; ctx.fillRect(-6, -8, 12, 4);
        // 尾翼（後部の三角フィン）
        ctx.fillStyle = '#90A4AE';
        ctx.beginPath(); ctx.moveTo(-6, 12); ctx.lineTo(-14, 22); ctx.lineTo(-6, 18); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6, 12); ctx.lineTo(14, 22); ctx.lineTo(6, 18); ctx.closePath(); ctx.fill();
        // オレンジ噴射炎
        ctx.fillStyle = '#FF6D00';
        ctx.beginPath(); ctx.moveTo(-4, 18); ctx.lineTo(4, 18); ctx.lineTo(0, 30); ctx.closePath(); ctx.fill();
        ctx.restore();
    } else if (type === 'mirv_missile') {
        // MIRVのアイコン（1本の母体＋上部で3本に枝分かれする弾頭を表現）
        ctx.fillStyle = '#311B92'; ctx.fillRect(0,0,64,64); // 紫がかった背景
        ctx.save();
        ctx.translate(32, 36);
        // 母体ボディ
        ctx.fillStyle = '#ECEFF1'; ctx.fillRect(-6, -8, 12, 24);
        // 帯マーキング（黄）
        ctx.fillStyle = '#FFD600'; ctx.fillRect(-6, 4, 12, 3);
        // 3つの子弾頭（コーン状に広がる赤ノーズ）
        ctx.fillStyle = '#D32F2F';
        const heads = [[-12, -26], [0, -30], [12, -26]];
        for (const h of heads) {
            ctx.beginPath(); ctx.moveTo(h[0]-4, h[1]+10); ctx.lineTo(h[0]+4, h[1]+10); ctx.lineTo(h[0], h[1]); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#CFD8DC'; ctx.fillRect(h[0]-4, h[1]+10, 8, 6); ctx.fillStyle = '#D32F2F';
        }
        // 尾翼
        ctx.fillStyle = '#90A4AE';
        ctx.beginPath(); ctx.moveTo(-6, 10); ctx.lineTo(-14, 18); ctx.lineTo(-6, 16); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(6, 10); ctx.lineTo(14, 18); ctx.lineTo(6, 16); ctx.closePath(); ctx.fill();
        ctx.restore();
    }
}

function createTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    paintTile(ctx, type);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    return tex;
}

function addNoise(ctx, amount=20) {
    const id = ctx.getImageData(0,0,64,64);
    const d = id.data;
    for(let i=0; i<d.length; i+=4) {
        const noise = (Math.random() - 0.5) * amount;
        d[i] += noise; d[i+1] += noise; d[i+2] += noise;
    }
    ctx.putImageData(id, 0, 0);
}

const materials = {};
let flintTexture;
let launcherTexture;
let rocketLauncherTexture;
let nukeMissileTexture;
let mirvMissileTexture;

function initMaterials() {
    const grassTop = createTexture('grass_top');
    const grassSide = createTexture('grass_side');
    const dirt = createTexture('dirt');
    const stone = createTexture('stone');
    const woodSide = createTexture('wood_side');
    const woodTop = createTexture('wood_top');
    const leaves = createTexture('leaves');
    const tntSide = createTexture('tnt_side');
    const tntTop = createTexture('tnt_top');
    const water = createTexture('water');
    const bedrock = createTexture('bedrock');
    flintTexture = createTexture('flint');
    launcherTexture = createTexture('launcher');
    rocketLauncherTexture = createTexture('rocket_launcher');
    nukeMissileTexture = createTexture('nuke_missile');
    mirvMissileTexture = createTexture('mirv_missile');
    const megaTntSide = createTexture('mega_tnt_side');
    const megaTntTop = createTexture('mega_tnt_top');
    const nukeSide = createTexture('nuke_side');
    const nukeTop = createTexture('nuke_top');
    const hbombSide = createTexture('hbomb_side');
    const hbombTop = createTexture('hbomb_top');

    materials[BLOCKS.GRASS] = [
        new THREE.MeshLambertMaterial({ map: grassSide }),
        new THREE.MeshLambertMaterial({ map: grassSide }),
        new THREE.MeshLambertMaterial({ map: grassTop }),
        new THREE.MeshLambertMaterial({ map: dirt }),
        new THREE.MeshLambertMaterial({ map: grassSide }),
        new THREE.MeshLambertMaterial({ map: grassSide })
    ];
    materials[BLOCKS.STONE] = new THREE.MeshLambertMaterial({ map: stone });
    materials[BLOCKS.WOOD] = [
        new THREE.MeshLambertMaterial({ map: woodSide }),
        new THREE.MeshLambertMaterial({ map: woodSide }),
        new THREE.MeshLambertMaterial({ map: woodTop }),
        new THREE.MeshLambertMaterial({ map: woodTop }),
        new THREE.MeshLambertMaterial({ map: woodSide }),
        new THREE.MeshLambertMaterial({ map: woodSide })
    ];
    materials[BLOCKS.LEAVES] = new THREE.MeshLambertMaterial({ map: leaves, transparent: true, opacity: 0.9 });
    materials[BLOCKS.TNT] = [
        new THREE.MeshLambertMaterial({ map: tntSide }),
        new THREE.MeshLambertMaterial({ map: tntSide }),
        new THREE.MeshLambertMaterial({ map: tntTop }),
        new THREE.MeshLambertMaterial({ map: tntTop }),
        new THREE.MeshLambertMaterial({ map: tntSide }),
        new THREE.MeshLambertMaterial({ map: tntSide })
    ];
    materials[BLOCKS.MEGA_TNT] = [
        new THREE.MeshLambertMaterial({ map: megaTntSide }),
        new THREE.MeshLambertMaterial({ map: megaTntSide }),
        new THREE.MeshLambertMaterial({ map: megaTntTop }),
        new THREE.MeshLambertMaterial({ map: megaTntTop }),
        new THREE.MeshLambertMaterial({ map: megaTntSide }),
        new THREE.MeshLambertMaterial({ map: megaTntSide })
    ];
    materials[BLOCKS.NUKE] = [
        new THREE.MeshLambertMaterial({ map: nukeSide }),
        new THREE.MeshLambertMaterial({ map: nukeSide }),
        new THREE.MeshLambertMaterial({ map: nukeTop }),
        new THREE.MeshLambertMaterial({ map: nukeTop }),
        new THREE.MeshLambertMaterial({ map: nukeSide }),
        new THREE.MeshLambertMaterial({ map: nukeSide })
    ];
    materials[BLOCKS.HBOMB] = [
        new THREE.MeshLambertMaterial({ map: hbombSide }),
        new THREE.MeshLambertMaterial({ map: hbombSide }),
        new THREE.MeshLambertMaterial({ map: hbombTop }),
        new THREE.MeshLambertMaterial({ map: hbombTop }),
        new THREE.MeshLambertMaterial({ map: hbombSide }),
        new THREE.MeshLambertMaterial({ map: hbombSide })
    ];
    materials[BLOCKS.NUKE_MISSILE] = [
        new THREE.MeshLambertMaterial({ map: nukeMissileTexture }),
        new THREE.MeshLambertMaterial({ map: nukeMissileTexture }),
        new THREE.MeshLambertMaterial({ map: nukeMissileTexture }),
        new THREE.MeshLambertMaterial({ map: nukeMissileTexture }),
        new THREE.MeshLambertMaterial({ map: nukeMissileTexture }),
        new THREE.MeshLambertMaterial({ map: nukeMissileTexture })
    ];
    materials[BLOCKS.MIRV_MISSILE] = [
        new THREE.MeshLambertMaterial({ map: mirvMissileTexture }),
        new THREE.MeshLambertMaterial({ map: mirvMissileTexture }),
        new THREE.MeshLambertMaterial({ map: mirvMissileTexture }),
        new THREE.MeshLambertMaterial({ map: mirvMissileTexture }),
        new THREE.MeshLambertMaterial({ map: mirvMissileTexture }),
        new THREE.MeshLambertMaterial({ map: mirvMissileTexture })
    ];
    materials[BLOCKS.WATER] = new THREE.MeshLambertMaterial({ map: water, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    materials[BLOCKS.BEDROCK] = new THREE.MeshLambertMaterial({ map: bedrock });

    initAtlas(); // チャンクメッシュ用のテクスチャアトラスと共有マテリアルを構築

    updateUI();
    updateHearts();
}

// ============================================================
// テクスチャアトラス（チャンクメッシュ化用）
// 全ブロック面を 1 枚のテクスチャに焼き、面ごとに UV を割り当てることで
// 「1 ブロック = 1 マテリアル/メッシュ」をやめ、チャンク単位の 1 メッシュにまとめる。
// 既存の materials[...]（6 面配列）は着火 TNT エンティティ等で引き続き使う。
// ============================================================
let atlasTexture = null;     // アトラスの THREE.Texture
let solidMaterial = null;    // 不透明ブロック（葉含む）用の共有マテリアル
let waterMaterial = null;    // 水（半透明）用の共有マテリアル
const ATLAS_COLS = 8, ATLAS_ROWS = 4, TILE_PX = 64;       // 8x4=32 枠（実使用 17）。512x256＝2の冪
const ATLAS_W = ATLAS_COLS * TILE_PX, ATLAS_H = ATLAS_ROWS * TILE_PX;
const ATLAS_TILES = [
    'grass_top', 'grass_side', 'dirt', 'stone', 'wood_side', 'wood_top', 'leaves',
    'tnt_side', 'tnt_top', 'mega_tnt_side', 'mega_tnt_top', 'nuke_side', 'nuke_top',
    'hbomb_side', 'hbomb_top', 'water', 'bedrock'
];
const ATLAS_INDEX = {};
ATLAS_TILES.forEach((n, i) => { ATLAS_INDEX[n] = i; });

// type -> { top, side, bottom } のアトラスタイル番号（initAtlas で確定）
const BLOCK_TILE_IDX = {};

// タイル番号 -> アトラス上の UV 矩形。NearestFilter のにじみ防止に半テクセル内側へ。
// CanvasTexture は flipY=true（既定）なので V はキャンバス上端ほど 1 に近い。
function tileUV(i) {
    const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
    const px = col * TILE_PX, py = row * TILE_PX;
    return {
        u0: (px + 0.5) / ATLAS_W,
        u1: (px + TILE_PX - 0.5) / ATLAS_W,
        vTop: 1 - (py + 0.5) / ATLAS_H,           // キャンバス上端（テクスチャの上）
        vBot: 1 - (py + TILE_PX - 0.5) / ATLAS_H  // キャンバス下端（テクスチャの下）
    };
}

function initAtlas() {
    if (atlasTexture) return;

    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W; canvas.height = ATLAS_H;
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < ATLAS_TILES.length; i++) {
        const tile = document.createElement('canvas');
        tile.width = 64; tile.height = 64;
        paintTile(tile.getContext('2d'), ATLAS_TILES[i]);
        const col = i % ATLAS_COLS, row = Math.floor(i / ATLAS_COLS);
        ctx.drawImage(tile, col * TILE_PX, row * TILE_PX);
    }

    atlasTexture = new THREE.CanvasTexture(canvas);
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.generateMipmaps = false;
    atlasTexture.wrapS = THREE.ClampToEdgeWrapping;
    atlasTexture.wrapT = THREE.ClampToEdgeWrapping;

    solidMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture });
    // 水は半透明で奥の地形が透ける。depthWrite=false で重なり順を自然に。
    waterMaterial = new THREE.MeshLambertMaterial({
        map: atlasTexture, transparent: true, opacity: 0.6,
        depthWrite: false, side: THREE.DoubleSide
    });

    const T = (name) => ATLAS_INDEX[name];
    BLOCK_TILE_IDX[BLOCKS.GRASS]    = { top: T('grass_top'),    side: T('grass_side'),    bottom: T('dirt') };
    BLOCK_TILE_IDX[BLOCKS.STONE]    = { top: T('stone'),        side: T('stone'),         bottom: T('stone') };
    BLOCK_TILE_IDX[BLOCKS.WOOD]     = { top: T('wood_top'),     side: T('wood_side'),     bottom: T('wood_top') };
    BLOCK_TILE_IDX[BLOCKS.LEAVES]   = { top: T('leaves'),       side: T('leaves'),        bottom: T('leaves') };
    BLOCK_TILE_IDX[BLOCKS.TNT]      = { top: T('tnt_top'),      side: T('tnt_side'),      bottom: T('tnt_top') };
    BLOCK_TILE_IDX[BLOCKS.MEGA_TNT] = { top: T('mega_tnt_top'), side: T('mega_tnt_side'), bottom: T('mega_tnt_top') };
    BLOCK_TILE_IDX[BLOCKS.NUKE]     = { top: T('nuke_top'),     side: T('nuke_side'),     bottom: T('nuke_top') };
    BLOCK_TILE_IDX[BLOCKS.HBOMB]    = { top: T('hbomb_top'),    side: T('hbomb_side'),    bottom: T('hbomb_top') };
    BLOCK_TILE_IDX[BLOCKS.WATER]    = { top: T('water'),        side: T('water'),         bottom: T('water') };
    BLOCK_TILE_IDX[BLOCKS.BEDROCK]  = { top: T('bedrock'),      side: T('bedrock'),       bottom: T('bedrock') };
}
