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
                const ey = Math.max(terrainHeightAt(X, Z), SEA_LEVEL);
                explode(X, ey, Z, false, 6);
                genCol(X, Z);
                return { ok: !loadedBefore && getBlock(X, ey, Z) === 0, detail: { loadedBefore: loadedBefore } };
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
