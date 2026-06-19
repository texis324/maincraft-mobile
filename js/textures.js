// --- 2. Graphics & Texture Generation ---
function createTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');

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
    }

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
    const megaTntSide = createTexture('mega_tnt_side');
    const megaTntTop = createTexture('mega_tnt_top');
    const nukeSide = createTexture('nuke_side');
    const nukeTop = createTexture('nuke_top');

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
    materials[BLOCKS.WATER] = new THREE.MeshLambertMaterial({ map: water, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    materials[BLOCKS.BEDROCK] = new THREE.MeshLambertMaterial({ map: bedrock });

    updateUI();
    updateHearts();
}
