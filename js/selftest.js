// --- 自己回帰テスト（決定的） ---
// 目的: 毎セッション手書きしていた採掘/設置/爆破/永続化/無限ワールドの検証を「コア項目だけ」常設化。
//   - window.__selftest() : アサーション群を実行し {pass,fail,total,results} を返す（Playwright から1コールで緑確認）
//   - URL に ?selftest : 起動後に自動実行し、右上にオーバーレイ＋console へ結果表示
// 方針: コア10数項目だけに絞り肥大を防ぐ。テストは遠方(T)で行い、終了時にカメラ復元＆生成したチャンク/edit を片付け、
//        localStorage は汚さない（persist の __selfTesting ガード）。読み込み順は index.html の最後。

(function () {
    const T = 100000; // 遠方のテスト原点（スポーン/家と干渉しない）

    function genCol(x, z) {
        const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
        const r = columnLoadRange(cx, cz);
        for (let cy = r[0]; cy <= r[1]; cy++) ensureChunk(cx, cy, cz);
    }
    function genArea(x, z, rad) {
        for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) genCol(x + dx * 16, z + dz * 16);
        flushDirtyChunks();
    }
    function run(results, name, fn) {
        try {
            const d = fn();
            const ok = (d && typeof d.ok === 'boolean') ? d.ok : !!d;
            results.push({ name: name, ok: ok, detail: (d && d.detail !== undefined) ? d.detail : null });
        } catch (e) {
            results.push({ name: name, ok: false, detail: 'ERR ' + (e && e.message) });
        }
    }

    window.__selftest = function () {
        window.__selfTesting = true;
        const results = [];
        const camPos = camera.position.clone(), camRot = camera.rotation.clone(), wasFly = controls.isFlying, selIdx = selectedItemIndex;
        const chunkKeysBefore = new Set(Object.keys(chunks));
        const editKeysBefore = new Set(Object.keys(editsByChunk));
        try {
            // 1) 地形は決定的（同じ入力で同じ高さ）
            run(results, 'terrain deterministic', () => {
                const a = terrainHeightAt(T, T), b = terrainHeightAt(T, T);
                return { ok: a === b, detail: a };
            });

            // 2) 無限ワールド: 旧 WORLD_SIZE 壁グローバルは廃止・VIEW_DIST がある
            run(results, 'no legacy WORLD_SIZE wall', () => ({
                ok: typeof WORLD_SIZE === 'undefined' && typeof VIEW_DIST === 'number', detail: { VIEW_DIST: VIEW_DIST }
            }));

            // 3) 深い世界の縦範囲が妥当（岩盤が十分下・最高峰が範囲内）
            run(results, 'deep vertical bounds', () => ({
                ok: worldBottomY <= SEA_LEVEL - 40 && maxSurfaceY >= terrainHeightAt(T, T),
                detail: { worldBottomY: worldBottomY, maxSurfaceY: maxSurfaceY }
            }));

            // 4) getBlock/setBlock 往復
            run(results, 'getBlock/setBlock roundtrip', () => {
                genCol(T, T);
                const y = Math.max(terrainHeightAt(T, T), SEA_LEVEL) + 3;
                setBlock(T, y, T, BLOCKS.STONE, false);
                const a = getBlock(T, y, T);
                removeBlock(T, y, T, false);
                return { ok: a === BLOCKS.STONE && getBlock(T, y, T) === 0 };
            });

            // 5) 採掘（pickBlock DDA + removeBlock）
            run(results, 'mine via crosshair', () => {
                const X = T + 48, Z = T;
                genArea(X, Z, 1);
                const top = columnTopY(X, Z);
                controls.isFlying = true;
                camera.position.set(X, top + 4, Z);
                camera.rotation.set(-Math.PI / 2, 0, 0);
                camera.updateMatrixWorld(true);
                const hit = pickBlock();
                if (!hit) return { ok: false, detail: 'no hit' };
                const before = getBlock(hit.x, hit.y, hit.z);
                attemptMine();
                return { ok: before !== 0 && getBlock(hit.x, hit.y, hit.z) === 0, detail: [hit.x, hit.y, hit.z] };
            });

            // 6) 設置（pickBlock + addBlock、別の無傷な列で）
            run(results, 'place via crosshair', () => {
                const X = T + 96, Z = T;
                genArea(X, Z, 1);
                const top = columnTopY(X, Z);
                controls.isFlying = true;
                camera.position.set(X, top + 4, Z);
                camera.rotation.set(-Math.PI / 2, 0, 0);
                camera.updateMatrixWorld(true);
                selectedItemIndex = INVENTORY.indexOf(BLOCKS.GRASS);
                const hit = pickBlock();
                if (!hit) return { ok: false, detail: 'no hit' };
                const bx = hit.x + hit.nx, by = hit.y + hit.ny, bz = hit.z + hit.nz;
                const before = getBlock(bx, by, bz);
                attemptPlaceOrIgnite();
                return { ok: before === 0 && getBlock(bx, by, bz) === BLOCKS.GRASS, detail: [bx, by, bz] };
            });

            // 7a) 地表の爆発でクレーター（爆心が空気になる）
            run(results, 'surface explosion craters', () => {
                const X = T + 160, Z = T;
                genArea(X, Z, 2);
                const ey = Math.max(columnTopY(X, Z), SEA_LEVEL);
                explode(X, ey, Z, false, 6);
                return { ok: getBlock(X, ey, Z) === 0, detail: { center: getBlock(X, ey, Z) } };
            });

            // 7b) 岩盤の保持: 列を岩盤まで全生成→岩盤直上で爆発しても岩盤は残り、上の石は掘れる
            run(results, 'bedrock survives deep blast', () => {
                const X = T + 224, Z = T;
                const cx = Math.floor(X / 16), cz = Math.floor(Z / 16);
                for (let cy = _minCY; cy <= _maxCY; cy++) ensureChunk(cx, cy, cz); // 岩盤まで全層
                flushDirtyChunks();
                explode(X, worldBottomY + 3, Z, false, 6);
                return {
                    ok: getBlock(X, worldBottomY, Z) === BLOCKS.BEDROCK && getBlock(X, worldBottomY + 2, Z) === 0,
                    detail: { bedrock: getBlock(X, worldBottomY, Z), above: getBlock(X, worldBottomY + 2, Z) }
                };
            });

            // 8) 未生成チャンクへの爆破でも carveUnloaded が edit を記録→生成でクレーター復元
            run(results, 'far blast carves on later gen', () => {
                const X = T + 6000, Z = T + 6000;
                const loadedBefore = !!chunks[chunkOf(X, terrainHeightAt(X, Z), Z)];
                const ey = terrainHeightAt(X, Z);   // 地表（固体）で起爆＝水没列でも確実に固体を掘る（seed非依存）
                explode(X, ey, Z, false, 6);
                genCol(X, Z);
                return { ok: !loadedBefore && getBlock(X, ey, Z) === 0, detail: { loadedBefore: loadedBefore, surf: ey } };
            });

            // 9) edit がチャンクのアンロード→再生成を跨いで保持
            run(results, 'edit persists across unload', () => {
                const X = T, Z = T + 48;
                genCol(X, Z);
                const y = Math.max(terrainHeightAt(X, Z), SEA_LEVEL) + 1;
                setBlock(X, y, Z, BLOCKS.STONE, false);
                unloadChunk(chunkOf(X, y, Z));
                const afterUnload = getBlock(X, y, Z);
                genCol(X, Z);
                return { ok: afterUnload === 0 && getBlock(X, y, Z) === BLOCKS.STONE };
            });

            // 10) 頂点ライティング: 有効＆地下が暗く地表が明るい
            run(results, 'AO/sky vertex lighting', () => {
                const X = T, Z = T + 96;
                genCol(X, Z);
                const h = terrainHeightAt(X, Z);
                const buried = cellSky(X, h - 8, Z);   // 真上に岩が積もる→暗い
                const surface = cellSky(X, h, Z);       // 開けた空の下→明るい
                return { ok: solidMaterial.vertexColors === true && buried < 0.35 && surface > 0.9, detail: { buried: +buried.toFixed(2), surface: +surface.toFixed(2) } };
            });

            // 11) 裂け目が本家並みに深い（最大深さ >= 30）
            run(results, 'ravine is deep', () => {
                let maxD = 0;
                for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
                    const rav = ravineForRegion(gx, gz);
                    if (!rav) continue;
                    for (let s = 0; s < rav.path.length; s++) maxD = Math.max(maxD, rav.path[s].centerSurf - rav.path[s].botY);
                }
                return { ok: maxD >= 30, detail: maxD };
            });

            // 11b) 城が生成される（近傍に石壁が地表より上に立つ）
            run(results, 'castle generates', () => {
                const c = findCastleNear(T + 30000, T + 30000, 120);
                if (!c) return { ok: false, detail: 'no castle found' };
                genArea(c.ax, c.az, 4);
                // 外壁の1点（+x辺の中央付近）に地表より上の石があるか
                const wx = c.ax + c.half, wz = c.az;
                const above = getBlock(wx, c.gy + 2, wz);
                const floor = getBlock(c.ax, c.gy, c.az);
                return { ok: above === BLOCKS.STONE && floor === BLOCKS.STONE, detail: { at: [c.ax, c.gy, c.az], wall: above, floor: floor } };
            });

            // 11c) 城を核攻撃 → live と「アンロード→再生成」が全ボクセル一致（高い塔/天守の不一致＝トラップ回帰検出）
            run(results, 'castle nuke live==reload (all voxels)', () => {
                const evLen = explosionEvents.length;
                try {
                    const c = findCastleNear(T + 30000, T + 30000, 120);
                    if (!c) return { ok: false, detail: 'no castle' };
                    const X = c.ax, Z = c.az, gy = c.gy;
                    genArea(X, Z, 5);
                    explode(X, Math.max(gy, SEA_LEVEL) + 1, Z, false, 30, 'nuke'); // 城直撃の原爆
                    flushDirtyChunks();
                    const RX = 60, Y0 = gy - 32, Y1 = gy + 30, ny = Y1 - Y0 + 1, nxz = RX * 2 + 1;
                    const snap = () => {
                        const a = new Uint8Array(nxz * nxz * ny); let i = 0;
                        for (let x = X - RX; x <= X + RX; x++)
                            for (let z = Z - RX; z <= Z + RX; z++)
                                for (let y = Y0; y <= Y1; y++) a[i++] = getBlock(x, y, z);
                        return a;
                    };
                    const live = snap();
                    const cx0 = Math.floor((X - RX) / 16), cx1 = Math.floor((X + RX) / 16);
                    const cz0 = Math.floor((Z - RX) / 16), cz1 = Math.floor((Z + RX) / 16);
                    const cy0 = Math.floor(Y0 / 16), cy1 = Math.floor(Y1 / 16);
                    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) for (let cz = cz0; cz <= cz1; cz++) unloadChunk(chunkKey(cx, cy, cz));
                    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) for (let cz = cz0; cz <= cz1; cz++) ensureChunk(cx, cy, cz);
                    flushDirtyChunks();
                    const reload = snap();
                    let diff = 0, firstAt = -1;
                    for (let k = 0; k < live.length; k++) if (live[k] !== reload[k]) { diff++; if (firstAt < 0) firstAt = k; }
                    return { ok: diff === 0, detail: { castle: [X, gy, Z], cells: live.length, diff: diff, firstAt: firstAt } };
                } finally {
                    explosionEvents.length = evLen; // テストの爆発イベントをワールドに残さない
                }
            });

            // 11d) 地中貫通核: 地下で全球状の空洞ができ、live↔再生成が一致（depthScale=1.0 のイベント再現）
            run(results, 'penetrator cavity live==reload (ds=1.0)', () => {
                const evLen = explosionEvents.length;
                try {
                    const X = T + 360, Z = T + 240;
                    const surf = Math.max(terrainHeightAt(X, Z), SEA_LEVEL);
                    const cy = surf - 12;
                    genArea(X, Z, 3);
                    explode(X, cy, Z, false, 24, 'penetrator');
                    flushDirtyChunks();
                    const RX = 32, Y0 = cy - 26, Y1 = surf + 18, ny = Y1 - Y0 + 1, nxz = RX * 2 + 1;
                    const snap = () => {
                        const a = new Uint8Array(nxz * nxz * ny); let i = 0;
                        for (let x = X - RX; x <= X + RX; x++) for (let z = Z - RX; z <= Z + RX; z++) for (let y = Y0; y <= Y1; y++) a[i++] = getBlock(x, y, z);
                        return a;
                    };
                    const live = snap();
                    const cavity = getBlock(X, cy, Z) === 0;                    // 地中の爆心が空洞
                    const surfaceBlock = getBlock(X, surf + 16, Z) === 0;        // 地表上18=空（地中起爆なので空に大穴は無いはず）
                    const cx0 = Math.floor((X - RX) / 16), cx1 = Math.floor((X + RX) / 16), cz0 = Math.floor((Z - RX) / 16), cz1 = Math.floor((Z + RX) / 16), cy0 = Math.floor(Y0 / 16), cy1 = Math.floor(Y1 / 16);
                    for (let cx = cx0; cx <= cx1; cx++) for (let cyy = cy0; cyy <= cy1; cyy++) for (let cz = cz0; cz <= cz1; cz++) unloadChunk(chunkKey(cx, cyy, cz));
                    for (let cx = cx0; cx <= cx1; cx++) for (let cyy = cy0; cyy <= cy1; cyy++) for (let cz = cz0; cz <= cz1; cz++) ensureChunk(cx, cyy, cz);
                    flushDirtyChunks();
                    const reload = snap();
                    let diff = 0; for (let k = 0; k < live.length; k++) if (live[k] !== reload[k]) diff++;
                    return { ok: cavity && diff === 0, detail: { cavity: cavity, diff: diff, cells: live.length } };
                } finally { explosionEvents.length = evLen; }
            });

            // 11d2) 深い穴の壁: LOAD_DEPTH より深いクレーターで、縁のチャンク列(中心は円外だが隅は穴の中＝
            //        壁ブロックを含む)も穴底まで深くロードされる。旧版は「列の中心点が R 内か」で判定したため
            //        縁列が浅いまま＝壁が未メッシュで青空が透けた。columnLoadRange の AABB 判定の回帰検出。
            run(results, 'deep hole edge walls load (no blue wall)', () => {
                const X = T + 9000, Z = T + 9000;
                const surf = Math.max(terrainHeightAt(X, Z), SEA_LEVEL);
                const R = 40, cy = surf - 50;
                const evBot = Math.max(worldBottomY + 1, Math.floor(cy) - Math.min(R, 30)); // LOAD_DEPTH(72)より深い
                const wantBotCy = Math.floor(evBot / 16);
                const saved = _nearEvents.slice();
                try {
                    _nearEvents.length = 0;
                    _nearEvents.push({ cx: X, cy: cy, cz: Z, R: R });
                    const span = R + 20;
                    let overlapping = 0, deepOk = 0, edge = 0, edgeDeep = 0;
                    for (let ccx = Math.floor((X - span) / 16); ccx <= Math.floor((X + span) / 16); ccx++)
                        for (let ccz = Math.floor((Z - span) / 16); ccz <= Math.floor((Z + span) / 16); ccz++) {
                            const x0 = ccx * 16, x1 = x0 + 15, z0 = ccz * 16, z1 = z0 + 15;
                            const nx = X < x0 ? x0 : (X > x1 ? x1 : X), nz = Z < z0 ? z0 : (Z > z1 ? z1 : Z);
                            if ((nx - X) ** 2 + (nz - Z) ** 2 > R * R) continue; // 穴に重ならない列は対象外
                            overlapping++;
                            const isEdge = (ccx * 16 + 8 - X) ** 2 + (ccz * 16 + 8 - Z) ** 2 > R * R; // 旧版が取りこぼす縁列
                            const deep = columnLoadRange(ccx, ccz)[0] <= wantBotCy;
                            if (deep) deepOk++;
                            if (isEdge) { edge++; if (deep) edgeDeep++; }
                        }
                    // 全重なり列が穴底まで深くロード＆「中心が円外の縁列」が存在しその全部も深くロード（旧版なら edgeDeep=0）
                    return { ok: overlapping > 0 && deepOk === overlapping && edge > 0 && edgeDeep === edge,
                             detail: { overlapping: overlapping, deepOk: deepOk, edge: edge, edgeDeep: edgeDeep } };
                } finally { _nearEvents.length = 0; for (const e of saved) _nearEvents.push(e); }
            });

            // 11e) AI破壊軍団: 召喚→updateAgentsを手動stepして例外なく動く＋InstancedMesh countが一致
            run(results, 'AI legion summon+update', () => {
                const camSave = camera.position.clone();
                try {
                    clearAgents();
                    const X = T + 540, Z = T + 540;
                    const sy = Math.max(terrainHeightAt(X, Z), SEA_LEVEL) + 2;
                    camera.position.set(X, sy, Z);
                    genArea(X, Z, 2);
                    const n = summonLegion();
                    for (let s = 0; s < 12; s++) updateAgents(0.05); // 物理を決定的に手動step（例外が出ないこと）
                    // 陣営色が instanceColor バッファに実際に書かれているか（赤優勢/青優勢が両方存在）。
                    // setColorAt の確保タイミングを壊すと色が全てサイレント無視される回帰を検出する。
                    const ic = agentMesh ? agentMesh.instanceColor : null;
                    const lenOk = !!ic && ic.array.length === AGENT_MAX * 3;
                    let hasRed = false, hasBlue = false;
                    if (ic) for (let i = 0; i < agentMesh.count; i++) {
                        const r = ic.array[i * 3], b = ic.array[i * 3 + 2];
                        if (r > 0.4 && r > b + 0.15) hasRed = true;
                        if (b > 0.4 && b > r + 0.15) hasBlue = true;
                    }
                    const ok = n > 0 && agents.length > 0 && !!agentMesh && agentMesh.count === Math.min(agents.length, AGENT_MAX) && lenOk && hasRed && hasBlue;
                    const meshCount = agentMesh ? agentMesh.count : -1;
                    clearAgents();
                    return { ok: ok, detail: { spawned: n, alive: agents.length, meshCount: meshCount, lenOk: lenOk, hasRed: hasRed, hasBlue: hasBlue } };
                } catch (e) { clearAgents(); return { ok: false, detail: 'ERR ' + (e && e.message) }; }
                finally { camera.position.copy(camSave); camera.updateMatrixWorld(true); }
            });

            // 11f) AI陣営戦: 離れた赤×青が銃で撃ち合い、HPが減る／撃破される＋曳光弾(tracer)が出る
            run(results, 'AI faction ranged combat', () => {
                const camSave = camera.position.clone();
                try {
                    clearAgents();
                    const X = T + 600, Z = T + 600;
                    // 平らな石の足場を作って撃ち合わせる（自然地形の起伏で埋まる/LOSが通らないのを排除）。
                    // setBlockData は edit を記録せず・チャンクは自動生成・getBlock は data 読みなのでmesh不要。
                    const baseY = Math.max(terrainHeightAt(X, Z), SEA_LEVEL) + 4;
                    for (let dx = -10; dx <= 10; dx++) for (let dz = -2; dz <= 2; dz++) setBlockData(X + dx, baseY, Z + dz, BLOCKS.STONE);
                    camera.position.set(X, baseY + 3, Z);
                    agents.push(_makeAgent(X - 6, baseY + 1, Z, 0));    // 赤（射程内・足場上でLOSクリア）
                    agents.push(_makeAgent(X + 6, baseY + 1, Z, 1));    // 青
                    let firedFrames = 0;
                    for (let s = 0; s < 120; s++) { updateAgents(0.05); if (tracers.length > 0) firedFrames++; } // 6秒撃ち合い
                    const remaining = agents.length;
                    const died = remaining < 2;
                    const hurt = agents.some(a => a.hp < AGENT_HP);
                    clearAgents();
                    return { ok: (died || hurt) && firedFrames > 0, detail: { remaining: remaining, died: died, hurt: hurt, firedFrames: firedFrames } };
                } catch (e) { clearAgents(); return { ok: false, detail: 'ERR ' + (e && e.message) }; }
                finally { camera.position.copy(camSave); camera.updateMatrixWorld(true); }
            });

            // 11g) プレイヤーの爆発（ミサイル/核/TNT）で兵が倒せる＝killAgentsInRadius が explode から効く
            run(results, 'player explosion kills agents', () => {
                const evLen = explosionEvents.length;
                const camSave = camera.position.clone();
                try {
                    clearAgents();
                    const X = T + 720, Z = T + 720;
                    genArea(X, Z, 2);
                    const ey = Math.max(columnTopY(X, Z), SEA_LEVEL);
                    camera.position.set(X, ey + 2, Z);          // 兵はカメラ周囲(半径16〜28)に湧く
                    const before = summonLegion();
                    explode(X, ey + 1, Z, false, 50, 'nuke');    // 半径50＝周囲の兵を全部巻き込む
                    updateAgents(0.05);                          // 死亡(alive=false)を除去
                    const after = agents.length;
                    clearAgents();
                    return { ok: before > 0 && after < before, detail: { before: before, after: after, killed: before - after } };
                } catch (e) { clearAgents(); return { ok: false, detail: 'ERR ' + (e && e.message) }; }
                finally { explosionEvents.length = evLen; camera.position.copy(camSave); camera.updateMatrixWorld(true); }
            });

            // 11h) 敵が全滅したら勝者軍が自動消去される＋敵がいる間はタイマーがリセットされる（残党対策）
            run(results, 'one-sided battle auto-despawns', () => {
                const camSave = camera.position.clone();
                try {
                    clearAgents();
                    const X = T + 660, Z = T + 660;
                    const baseY = Math.max(terrainHeightAt(X, Z), SEA_LEVEL) + 4;
                    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) setBlockData(X + dx, baseY, Z + dz, BLOCKS.STONE);
                    camera.position.set(X, baseY + 2, Z);
                    agents.push(_makeAgent(X, baseY + 1, Z, 0));   // 赤のみ＝敵不在
                    for (let s = 0; s < 40; s++) updateAgents(0.05); // 2秒
                    const t1 = _battleOverTimer;                     // >0（敵不在でカウント中）
                    agents.push(_makeAgent(X + 2, baseY + 1, Z, 1)); // 青を追加＝敵出現
                    updateAgents(0.05); updateAgents(0.05);
                    const t2 = _battleOverTimer;                     // ~0（両陣営そろってリセット）
                    for (const a of agents) if (a.faction === 1) a.alive = false; // 青を全滅
                    let cleared = false;
                    for (let s = 0; s < 260; s++) { updateAgents(0.05); if (agents.length === 0) { cleared = true; break; } } // ~13秒以内に消える
                    clearAgents();
                    return { ok: t1 > 1.0 && t2 < 0.2 && cleared, detail: { t1: +t1.toFixed(1), t2: +t2.toFixed(2), cleared: cleared } };
                } catch (e) { clearAgents(); return { ok: false, detail: 'ERR ' + (e && e.message) }; }
                finally { camera.position.copy(camSave); camera.updateMatrixWorld(true); }
            });

            // 11i) 片陣営だけ召喚（summonFaction）＋戦死で死体が残る／clearAgentsで死体も消える
            run(results, 'summon one faction + corpses remain', () => {
                const camSave = camera.position.clone();
                try {
                    clearAgents();
                    const X = T + 780, Z = T + 780;
                    const baseY = Math.max(terrainHeightAt(X, Z), SEA_LEVEL) + 4;
                    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) setBlockData(X + dx, baseY, Z + dz, BLOCKS.STONE);
                    camera.position.set(X, baseY + 2, Z);
                    const nr = summonFaction(0);                                  // 赤だけ
                    const onlyRed = agents.length === nr && agents.every(a => a.faction === 0);
                    // 数体倒して死体を確認
                    for (let k = 0; k < Math.min(3, agents.length); k++) agents[k].hp = 0;
                    updateAgents(0.05);
                    const corpsesLeft = corpses.length;                          // 死体が残る
                    clearAgents();
                    const corpsesCleared = corpses.length === 0;                  // clearで死体も消える
                    return { ok: nr > 0 && onlyRed && corpsesLeft >= 3 && corpsesCleared, detail: { nr: nr, onlyRed: onlyRed, corpsesLeft: corpsesLeft } };
                } catch (e) { clearAgents(); return { ok: false, detail: 'ERR ' + (e && e.message) }; }
                finally { camera.position.copy(camSave); camera.updateMatrixWorld(true); }
            });

            // 12) スポーンが固体地面の上（水中/空中でない）
            run(results, 'spawn on solid ground', () => {
                spawnPlayer();
                const feet = getBlock(Math.floor(camera.position.x), Math.floor(camera.position.y - 2.6), Math.floor(camera.position.z));
                return { ok: feet !== 0, detail: feet };
            });

        } finally {
            // 後片付け: カメラ/選択を復元、テストで作った chunk と edit を破棄、save を汚さない
            camera.position.copy(camPos); camera.rotation.copy(camRot); controls.isFlying = wasFly; selectedItemIndex = selIdx;
            camera.updateMatrixWorld(true);
            for (const k in editsByChunk) if (!editKeysBefore.has(k)) delete editsByChunk[k];
            for (const ck in chunks) if (!chunkKeysBefore.has(ck)) unloadChunk(ck);
            if (typeof _editSaveTimer !== 'undefined' && _editSaveTimer) { clearTimeout(_editSaveTimer); }
            _streamSettled = false; _lastPcx = 2147483647; // 通常ストリーミングを次フレームで再開
            window.__selfTesting = false;
        }
        const pass = results.filter(r => r.ok).length;
        return { pass: pass, fail: results.length - pass, total: results.length, results: results };
    };

    // ?selftest で起動後に自動実行＋オーバーレイ表示
    if (location.search.indexOf('selftest') >= 0) {
        setTimeout(function () {
            const r = window.__selftest();
            console.log('[selftest] ' + r.pass + '/' + r.total + ' passed', r);
            const div = document.createElement('div');
            div.id = 'selftest-overlay';
            div.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:rgba(0,0,0,.85);color:#fff;'
                + 'font:12px/1.5 monospace;padding:10px 12px;max-height:92vh;overflow:auto;max-width:52vw;'
                + 'border-radius:6px;border:2px solid ' + (r.fail ? '#e5533d' : '#3cba6a');
            div.innerHTML = '<b>SELFTEST ' + r.pass + '/' + r.total + (r.fail ? ' ❌' : ' ✅ ALL PASS') + '</b><br>'
                + r.results.map(x => (x.ok ? '✅' : '❌') + ' ' + x.name + (x.ok ? '' : ' — ' + JSON.stringify(x.detail))).join('<br>');
            document.body.appendChild(div);
        }, 2800);
    }
})();
