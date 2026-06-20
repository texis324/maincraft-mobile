# CLAUDE.md

このファイルは Claude Code 用のプロジェクトメモリです。次回以降のセッションで
最初に読み込まれます。作業の前提・経緯・現状をここに残します。

## プロジェクト概要

Three.js (r128, CDN) 製のブラウザ向けミニ Minecraft（TNT 物理つき）。
PC・モバイル両対応。元々は単一の `minecraft_mobile.html`（約2811行）だったが、
機能ごとに分割した。

- 公開URL: https://texis324.github.io/maincraft-mobile/
- デフォルトブランチ: `main`（GitHub Pages は `main` への push で自動デプロイ）

## ファイル構成

読み込み順は `index.html` の `<script>` 順（依存関係順）。すべて素の
クラシックスクリプト（ES Modules ではない）で、グローバルスコープを共有する。

```
index.html        … HTML 本体 + スクリプト読み込み（viewport-fit=cover 済み）
css/style.css     … スタイル / HUD / モバイル UI（セーフエリア対応済み）
js/config.js      … 定数・BLOCKS・BLOCK_PROPS・INVENTORY・状態フラグ・ポインターロック補助
js/audio.js       … 効果音（WebAudio: playSound 他）
js/textures.js    … 手続き的テクスチャ生成・マテリアル（materials, initMaterials）
js/scene.js       … Three.js 初期化・カメラ・ライト・銃ビューモデル・controls
js/world.js       … ワールド生成・blockData・チャンクメッシュ化(buildChunk等)・voxelRaycast(DDA)
js/physics.js     … getCollidingBlocks / checkBlockCollision・raycaster(画面→光線生成のみ)
js/entities.js    … TNT・ロケット・explode・パーティクル
js/ui.js          … ホットバー・インベントリ・ハート・銃アニメ
js/player.js      … takeDamage / resetPlayer
js/actions.js     … attemptMine / attemptPlaceOrIgnite・画面切替
js/input.js       … キーボード/マウス入力・設定スライダー
js/mobile.js      … タッチ操作（ジョイスティック等）・render フック・checkTouchActions
js/main.js        … メインループ animate()・起動（generateWorld/animate 呼び出し）
.github/workflows/deploy-pages.yml … GitHub Pages 自動デプロイ
```

### 分割時の重要な制約
- 全 JS はグローバル lexical scope を共有するため、**同名の top-level const/let を
  複数ファイルで宣言しない**こと（重複は読み込みエラーになる）。
- 即時実行される top-level コードが参照する識別子は、それより前に読み込まれる
  ファイルで定義されていること（コールバック内の参照は実行時解決なので順不同でOK）。
- 起動処理（`generateWorld()` と `animate()` の呼び出し）は最後の `main.js` に集約。

## 修正済みバグ（経緯）

1. パーティクルの共有ジオメトリを各消滅時に dispose しており描画が壊れていた
   → 共有ジオメトリ/マテリアルを再利用し dispose しない方式へ（entities.js）
2. スペースキー長押し（自動リピート）で飛行モードが誤切替 → `event.repeat` ガード（input.js）
3. 爆発ノックバックがローカル速度系にワールド方向を直接加算して向きがズレる
   → yaw で逆回転してから加算（entities.js explode）
4. 着火TNT/ロケットのジオメトリ・マテリアル未解放（メモリリーク）→ dispose 追加
5. 採掘/設置/ロケットのレイキャストが scene.children 全体（銃モデル等）に当たり
   操作が空振り → 地形専用 `blockMeshes` 配列に限定（world.js / actions.js / entities.js）
6. モバイルでリセット後にポーズメニューから抜けられない → リセット時に明示解除（input.js）
- 未使用デッドコード `originalAnimate` を削除

## モバイル横向き対応（見切れ対策）

- `index.html`: viewport に `viewport-fit=cover`
- `css/style.css`: 端のタッチ操作・HUD に `env(safe-area-inset-*)` を適用、
  FPS/座標/FLY 表示を左上に縦並びへ再配置（左下ジョイスティックとの重なり回避）、
  ホットバーを flex-wrap + max-width で画面幅内に収める。
- **ハートとホットバーの被り対策(2026-06-19)**: アイテム14個でホットバーが折り返して背が高くなり、下部のハートと被る。★`#ui-container`に**明示`width: calc(100vw-16px)`+`box-sizing:border-box`**を与える（abs配置のflex-wrapは`max-width`だけだとshrink-to-fitで横に縮み段数が無駄に増える＝142px/3-4段になってた→2段97pxに）。+ ハートはモバイルのみ**上部中央へ移動**(`top:8px; bottom:auto`)＝段数に関係なく被らない根治。`.heart`もモバイル18pxに縮小。PCは`@media`外なので無傷。
- **オーバーレイ(ポーズ/インベントリ/ゲームオーバー)の見切れ対策(2026-06-19)**: 設定項目が増えて(水爆/マップ広さ深さ/再生成)横向きの低い画面で下が切れる問題。`.overlay-screen` に `overflow-y:auto` + `justify-content: safe center`(収まる時中央/はみ出す時先頭寄せ＝上が切れずスクロール) + セーフエリアpadding。`@media (max-height:520px)` で h1/設定/ボタンをコンパクト化し、`order` で Resume/Reset をタイトル直下へ（設定群を全スクロールせず即戻れる）。インベントリgridは `flex-wrap`。デスクトップ(1920×1080)は中央表示で回帰なし。

## 追加機能: ☢ 原子爆弾（NUKE）

- `BLOCKS.NUKE = 8`。インベントリ7番目（FLINTの直前）。アイコンは黄/黒の放射能トレフォイル（`textures.js` の `nuke_side`/`nuke_top`、`materials[BLOCKS.NUKE]` は6面マテリアル配列）。
- 操作: NUKEブロックを設置 → 火打石(FLINT)で右クリック着火（`actions.js`）。導火線5秒（`entities.js createPrimedTNT` の `isNuke`分岐）。
- 仕組み: TNT機構に `isNuke` フラグを並走させる（`createPrimedTNT`/`igniteTNT`/`updatePrimedTNTs`/`explode` の第6引数）。`explode` の `isNuke` 分岐で半径=`nukePower`(既定30)・大量パーティクル・`triggerNukeFlash()`(DOMホワイトフラッシュ)・`createMushroomCloud()`(火球+茎+ドーム傘のボクセル煙、`smokeParticles`/`updateMushroom`、main.js のループで更新)・`nukeScreenShake()`(camera.roll を一時的に揺らす)。
- 威力スライダー: ポーズメニュー `#nuke-power`（10〜50）→ `nukePower`（config.js）。
- ⚠ ダメージは即死級だが、ポーズメニューの「ダメージ無効」既定ONなら死なない。
- **性能: `removeBlock` を swap-pop で O(1) 化**（`mesh.userData.meshIndex`）。原爆で約3000ブロック消去しても62ms（実測）でフリーズしない。**マップ拡張（WORLD_SIZE増）の下地にもなる**＝旧来の `blockMeshes.indexOf` O(n) が大量消去で O(n²) になる問題を解消済み。

## ★性能overhaul: チャンクメッシュ化（world.js / textures.js / actions.js / entities.js）

旧方式「1ブロック=1 THREE.Mesh=1 draw call」を廃止。一辺128で約2.5万draw call→CPU飽和でFPS10だった。
**新方式=世界を 16³ チャンクに分け、各チャンクの露出している面だけを 1 つの BufferGeometry にマージ**。
draw call が『ブロック数』→『画面内チャンク数(数十)』に激減。実測: 64ワールド(7.8万ブロック)=draw call 14、
128ワールド/深さ48(83万ブロック)の地上視点=draw call 50。爆発も高速化(水爆 旧0.96〜1.5秒→141ms)。

- **データ**: `blockData["x,y,z"]=type` が固体の真実（地中の埋没含む。衝突/採掘/爆破/DDAの基盤）。旧 `blockMeshes`/`chunks(key→mesh)`/`spawnMesh`/`revealIfNeeded`/`shouldRender`/`sharedBlockGeometry` は**全廃**。
- **描画(world.js)**: `chunkMeshes["cx,cy,cz"]={solid,water}`。`buildChunk`が露出面(`faceVisible`)だけを `addFace`(法線から巻き順を自動補正)でバッファに積み `BufferGeometry` 化。`markDirty`(6近傍チャンクも)→`flushDirtyChunks`で再構築。生成中は `bulkBuild=true` で遅延し最後に `buildAllChunks`。main.js は毎フレーム保険 flush。
- **テクスチャ(textures.js)**: 17タイルを1枚の `512x256` アトラスに焼き(`initAtlas`)、`solidMaterial`(不透明・葉含む)/`waterMaterial`(半透明)の2マテリアルだけで全地形を描く。面ごとUVは `tileUV`+`BLOCK_TILE_IDX`。`paintTile` を抽出して `createTexture` と共用。既存 `materials[]`(6面配列)は着火TNTエンティティ用に残置。
- **水**: 高さ0.8(上面 y+0.3/底 y-0.5)で旧来の「水面が少し低い」見た目を維持。`faceVisible` で水-水/不透明との共有面を隠す。
- **葉**: アトラス化で旧 opacity:0.9(わずかな半透明)が**不透明化**(葉テクスチャにアルファ無し＝見た目差はごく僅か。許容トレードオフ)。
- **ピッキング=DDA(world.js voxelRaycast)**: メッシュ非依存。`intersectObjects(blockMeshes)` を廃し、採掘/設置/FLINT点火(actions.js pickBlock, reach5, hitWater=true)・ロケット/核ミサイル着弾(entities.js, hitWater=false でprevPosから移動区間を走査)に使用。命中面法線(nx,ny,nz)で隣接設置。
  - ⚠**座標規約の罠(敵対監査で発見・修正済)**: ブロックは整数座標を『中心』に [N-0.5,N+0.5] を占める(描画も physics.js 衝突も)。素朴な `floor(origin)` DDA はセルを [N,N+1) 扱いし**0.5ブロックずれて全ピッキングが狂う**。→ `voxelRaycast` 冒頭で `origin+0.5` してから `floor`(=セル番号が round(world))で中心規約に一致させている。**DDAを触る時はこの+0.5を壊すな**。厳密検証(命中点が返ブロックのAABB表面に乗るか2947本)で確認済。
- **爆発(entities.js explode)**: クレーター掘りは `removeBlock(x,y,z,true)`(defer)で dirty を貯め末尾で `flushDirtyChunks()` 一括。`createPrimedTNT` も `removeBlock(...,true)`(連鎖誘爆ループ中のフル flush 連発=性能回帰を回避。監査で発見・修正済)。

## ★手続き地形: 起伏＋地層（石9種）＋裂け目（world.js / config.js / textures.js / actions.js / entities.js / player.js / persist.js）

旧「平らな草原＋固定の川」を廃止し、ノイズで起伏する本格地形に。**外部ライブラリ無しの決定的バリューノイズ**（worldSeed で再現）。

- **高さマップ(world.js terrainHeightAt)**: `fbm2`（多重 valueNoise2）で丘(高周波)＋山/谷(低周波)。`TERRAIN_BASE=SEA_LEVEL+7` を中心に上下＝大部分は陸・谷だけ水没。`TERRAIN_HILL_AMP=9`/`TERRAIN_MTN_AMP=18`（config.js・将来スライダー化可）。バリューノイズは0.5寄りなので振幅は大きめが要る。
- **海面(SEA_LEVEL=SURFACE_Y=2)**: 地表高 < 海面 の列は `h+1..SEA_LEVEL` を WATER で満たす＝谷が湖/海に。旧ハードコード川は撤去。実測 既定64で水19%（陸主体）。
- **地層(world.js strataBlockAt)**: 深さ d=h-y で層を決定。地表=草(海面近くは砂)／d≤3=土(砂浜は砂岩)／最深部5層=深層岩(deepslate)／中間=石＋鉱石ポケット(花崗/閃緑/安山岩、3Dノイズ pocket>0.72 の塊)。新ブロック **DIRT/SAND/SANDSTONE/GRANITE/DIORITE/ANDESITE/DEEPSLATE=12〜18**。textures.js にタイル追加（アトラス8x4=32枠中23使用）。**インベントリには出さない**＝BEDROCK同様ワールド限定（UI無改修）。
- **硬さ(config BLOCK_PROPS.hardness → actions.js getBreakDelay)**: 採掘クールダウン=BREAK_DELAY×hardness。砂0.5・土0.6・砂岩0.9・石1.0・花崗1.6・閃緑/安山1.5・深層岩2.4。既存ブロックは hardness 未設定＝等倍（無回帰）。getBreakDelay が pickBlock で対象を見て倍率を掛ける。
- **裂け目(world.js carveRavine)**: 蛇行しながら細く深いV字の溝を掘る（断面に地層が露出＝石種を増やした意味）。`ravineCount=max(1,round(WORLD_SIZE/48))`。各列は自分の天面から掘る(オーバーハング防止)。**水没列は SEA_LEVEL まで掘る**（さもないと地面だけ消えて水が宙に浮く＝監査で発見・修正済）。BEDROCK は残す。実測 深さ最大21。
- **スポーン(world.js spawnPlayer/columnTopY)**: 中央から渦巻き状に「海面以上の自然な地面(木/家の上は避ける)」を探して配置。`main.js`起動・`regenerateWorld`・`player.js resetPlayer` の3経路すべてが使う（旧 (0,5,0) 固定は起伏地形で地中に埋まる＝監査で発見・修正済）。
- **シード永続化(persist.js)**: worldSeed を保存＝リロードで同じ地形を再現。再生成(regenerateWorld)で新シード。
- **メッシャ高速化(world.js buildAllChunks/buildChunk)**: 旧 buildChunk は空セルも 16³ 全走査＝128/48で生成が数秒フリーズ（監査で発見）。buildAllChunks が blockData を1パスでチャンク別に振り分け、buildChunk(ck, cells) は**実在ブロックだけ走査**。増分再構築(採掘/設置/爆破の flushDirtyChunks)は cells 省略＝従来の密走査(チャンク数少で軽い)。実測 128/48 生成 2.6→2.2秒（完全解消は将来の blockData Uint8Array 化）。
- **既存システムの追従修正(監査で発見・修正済)**: 地形が y<0 まで掘れるため、entities.js のロケット/核ミサイルの境界 `pos.y<0`→`pos.y<worldBottomY`（裂け目の底へ撃ち込める）、爆発デブリのゲート `y>=SURFACE_Y-2`→`y>=min(SURFACE_Y,floor(cy))-2`（谷底の爆発でも破片が出る）。
- **★敵対監査(6次元18体)で6バグ発見・全修正**: フローティング水(裂け目×湖)・mesher空セル全走査・resetPlayer地中埋没・弾のy<0自爆・デブリ抑制・(重複)。Playwrightで全修正を実走検証（フローティング水5seed＋128全0／生成時間／リセット足元air／弾の生存／増分mesher無回帰）。
- **未実装/次段**: 洞窟(3Dノイズ)、地中貫通核(penetrator)、水中核・水流改善、blockData Uint8Array化(無限ワールドと大マップ生成高速化の土台)。

## ★無限ワールド化（world.js 全面書き換え / config・scene・main・physics・entities・persist・input・textures 追従）

旧「WORLD_SIZE 固定の箱（壁あり）＋単一巨大 `blockData["x,y,z"]` オブジェクト」を廃止し、**プレイヤー周囲だけを動的生成・遠方を破棄する無限ストリーミングワールド**に作り替えた。地形は `terrainHeightAt`/`strataBlockAt` が位置非依存＆決定的(worldSeed)なのでどの順序で生成しても同じ世界になる。

- **データモデル**: `chunks["cx,cy,cz"] = {cx,cy,cz, data:Uint8Array(16³), generated, solid:Mesh|null, water:Mesh|null}`。`blockData` オブジェクトは全廃。アクセスは `getBlock(x,y,z)`/`setBlock`/`addBlock`/`removeBlock`（physics/entities/main/actions の `blockData[getKey()]` を全て置換）。`getBlock` は直前チャンクをキャッシュ(`_gcx/_gch`、`_invalidateGetCache()` で破棄)。
- **ストリーミング(streamWorld・main.js 毎フレーム)**: スパイラル(近い順)で VIEW_DIST チャンク内の未生成を `GEN_BUDGET=4`/frの予算で生成、`flushDirtyChunks(MESH_BUDGET=6)` で再メッシュ、`VIEW_DIST+UNLOAD_MARGIN` 超を破棄。**垂直は列ごとのバンド**(`columnLoadRange`: 地表-LOAD_DEPTH=72 〜 地表+8) ∪ プレイヤー cy±1＝深い世界でも常時全層ロードしない。生成は**上(地表)から下**＝予算下でも見える地表が先。`_streamSettled` で「視界内全生成済み＆移動無し」なら走査スキップ(空回り回避)。アンロード/ravineキャッシュ刈りはチャンクを跨いだ時だけ＋**垂直アンロード**(掘り下げ後の漏れ防止)。
- **深さ大幅増**: `WORLD_DEPTH=96`(既定・スライダー 48〜192)。`worldBottomY=SEA_LEVEL-1-WORLD_DEPTH`。`maxSurfaceY` は **TERRAIN_BASE 基準**で算出(SEA_LEVEL 基準だと最高峰がチャンク垂直範囲からこぼれてクリップ＝修正済)。`TERRAIN_CONT_AMP=26` の大陸スケール起伏を追加。
- **裂け目=領域決定的**(`ravineForRegion`/`carveRavinesInChunk`): 世界を `RAVINE_REGION=176` で区切り各領域がハッシュで0/1本。経路は決定的・各チャンクは自分に重なる区間だけ彫る(3×3領域近傍を走査・bbox早期スキップ)。**最大深さ ≈ 50**(`RAVINE_DEPTH_MIN=26 + VAR=30`、旧 14+12 から大幅増)。
- **木=決定的**(`treeAt`/`placeTreesInChunk`、TREE_MARGIN=2 で跨ぎ葉も一貫)。**家=`seedHouse` で worldEdits に焼く**(決定的位置・永続)。
- **改変の永続(editsByChunk)**: プレイヤー設置/採掘/爆破を `editsByChunk[ck]={"x,y,z":type}`(0=撤去)に記録、チャンク(再)生成時に再適用＝アンロード→再ロードで建造物/クレーターが残る。**チャンク別索引**なので生成時に全edit走査しない(大爆発で数万editでも軽い)。**未生成チャンクへの爆破は `carveUnloaded` が「自然地形なら固体だった」セルの撤去editだけ記録**＝遠方ミサイル着弾のクレーターも後で訪れると存在(チャンク生成不要でフリーズしない)。
- **★リロード跨ぎ保存(persist.js)**: `editsByChunk` を `localStorage['maincraft_edits_v1']={seed,edits}` に保存・復元＝**ページリロード後も改変が残る**。setBlock から `scheduleEditSave`(1.5sデバウンス)＋`beforeunload` で書き出し、`generateWorld` が seedHouse 後に `loadPersistedEdits`(**同じ worldSeed の時だけ適用**＝別世界に誤適用しない)。上限 `MAX_PERSIST_EDITS=60000`(localStorage~5MB)＝超過時は**プレイヤーに近いチャンク優先**で詰め遠方を捨てる。**main.js は boot 時に `saveSettings()` を呼び worldSeed を即永続化**(設定未変更でもリロードで同じ世界＆edit一致)。Playwrightで設置/採掘→リロード→復元、再生成で旧edit非適用 を実走確認。
- **頂点ライティング(AO＋天空光)**: `solidMaterial.vertexColors=true`。`buildChunk` が各頂点に `AO(cornerAO=角の遮蔽)×sky(cellSky=真上の不透明数で減光)` を焼く＝地下/洞窟/裂け目の底が暗く、ブロックに立体感。**cellSky は遅延算出**(露出面が無い埋設セルでは呼ばない＝深い世界のメッシュコスト激減・surface 2.28→1.12ms/chunk)。**cornerAO は未生成チャンクを不透明扱い**(明るい継ぎ目を防ぐ)。水は頂点色なし(sky=1.0)。
- **壁撤去**: main.js のカメラ ±WORLD_SIZE/2 クランプ廃止。entities.js の TNT 壁反射廃止。ロケットは `traveled`(発射地点基準)で消滅(カメラ相対だと高速移動で自分のロケットを追い越して誤消滅)、核ミサイルは `NUKE_MISSILE_MAX_RANGE`。`nukeGroundYBelow` は未生成域では `terrainHeightAt` で地表を予測(遠方の空中炸裂高度が底なしにならない)。
- **UI**: ポーズの「広さ」スライダーを **描画距離(VIEW_DIST・4〜16)** に転用、「深さ」を 48〜192 に拡大。persist は `VIEW_DIST`/`WORLD_DEPTH`/`worldSeed` を保存。`scene.applyFog` は VIEW_DIST*16 連動(ロード境界で霧＝ポップイン隠し)。
- **★敵対監査(6次元/40件発見→24件確定)＋Playwright実走で検証**: 採掘/設置/爆破/edit永続化/再生成/無限移動(FPS60)/裂け目深さ50/地下暗化/遅延sky/遠方クレーター永続 を確認。先回り修正＝vertexColors未設定でAO非表示・edit全走査の性能崖・maxSurfaceYクリップ・遅延sky・AO継ぎ目・stream空回り・垂直アンロード漏れ・ロケット消滅基準・ravineキャッシュ漏れ。
- **未対応(意図的スコープ外)**: 洞窟(3Dノイズ)・地中貫通核・水中核・Web Worker化(移動中の生成カクつきの本丸・現状はメインスレッド予算制)・爆発の水平範囲は radius のまま(既存挙動)。
- **★自己回帰テスト(js/selftest.js)**: `?selftest` で起動後に自動実行＋右上オーバーレイ、または `window.__selftest()` で `{pass,fail,total,results}` を返す（Playwrightから1コールで緑確認）。コア13項目(地形決定性/壁撤去/縦範囲/get-setBlock/採掘/設置/地表クレーター/岩盤保持/未生成域カーブ/edit永続/AO天空光/裂け目深さ/スポーン接地)。遠方(T=100000)で実行し**終了時にカメラ/選択復元・テストchunk/editを破棄・localStorage不汚染**(persist の `window.__selfTesting` ガード)。コア改造後はまず `__selftest()` を回す＝手書きeval不要。**肥大させない**(コア項目だけ・大規模監査はworkflowに温存)。
- **検証ハーネス**: temp clone + `serve.js`(port8099・リポジトリ未コミット) + Playwright MCP(`browser_evaluate` で関数直呼び/`camera.updateMatrixWorld(true)` してから pickBlock)。

## 追加機能: 深さ調節マップ＋サーフェスカリング（world.js 全面改修）

> ⚠ この節は**無限ワールド化(上)で置き換え済み**(WORLD_SIZE/箱/有限生成は廃止)。履歴として残す。
> ⚠ 下記の旧サーフェスカリング(blockMeshes/chunks/spawnMesh/shouldRender)は上の**チャンクメッシュ化で置き換え済み**。
> `blockData` の二層思想（地中の埋没を真実として保持）は継続。履歴として残す。

- **二層管理**: `blockData`=全固体ブロック（地中の埋没含む・衝突/爆破の真実）／`chunks`=実際にメッシュを持つ（見える）ブロックだけ／`blockMeshes`=レイキャスト対象。
- **サーフェスカリング**: `shouldRender()`＝透過ブロックは常時、不透明は露出時(`isExposed`)のみメッシュ化。`neighborOccludes`はワールド底(`worldBottomY`)より下を遮蔽扱い＝裏面を描かない。実測 全78kブロックでメッシュ13k（16%）。**深くしてもメッシュはほぼ増えない**＝深さ青天井の土台。
- **採掘/爆破で露出**: `removeBlock(x,y,z,skipReveal)`。除去後に6隣接を`revealIfNeeded`で再メッシュ（埋没ブロックが見える）。爆破は`skipReveal=true`で一括除去→殻候補Setを最後にまとめて再メッシュ（spawnチャーン回避）。
- **共有ジオメトリ**: 全地形ブロックで`sharedBlockGeometry`を共有（個別disposeしない＝メモリ激減）。`removeBlock`はジオメトリ/マテリアルをdisposeしない。
- **設定**: `WORLD_SIZE`(let・32〜128)/`WORLD_DEPTH`(4〜48)/`SURFACE_Y`=2/`worldBottomY`=SURFACE_Y-1-DEPTH。`generateWorld()`は岩盤底＋石充填＋地表(草/水)。ポーズメニューのスライダー＋「マップ再生成」(`regenerateWorld`)で作り直し→プレイヤーを地上に戻す。

## 追加機能: ☢☢ 水素爆弾 / 空爆 / クレーター掘削

- **bombKind 化**: 旧 `isNuke` ブール → `bombKind`(null|'nuke'|'hbomb')を `createPrimedTNT`/`igniteTNT`/`explode` に通す。水爆=`hbombPower`(30〜60)・二段フラッシュ・巨大キノコ雲。
- **クレーター掘削**: `explode` は球状に`inBlast`判定でえぐる。`bottomY=max(worldBottomY+1, floor(cy)-min(radius,30))`＝掘削深さは爆心から最大30（深いマップで底まで掘って激重化するのを防止）。Y上限も地表+8でキャップ（空中セルの無駄走査回避）。破片パーティクルは地表付近(y≥SURFACE_Y-2)のみ。
- **空爆 `callAirstrike()`(Gキー)**: 視線方向の上空(SURFACE_Y+45)から `impactDetonate=true` の爆弾を時間差で12発投下→落下→着弾で爆発（`updatePrimedTNTs`で接地時に`fuse=0`）。飛行機描写は省略。
- **実測フリーズ**: 通常原爆(半径30/深さ16)≈0.28秒で快適。水爆(半径50/深さ24)≈0.96秒。最悪(半径60/深さ48)≈1.5秒。ボトルネックは大量の `delete blockData[key]`（V8の巨大オブジェクトdelete）。**将来の最適化案=クレーターを数フレームに分割(アニメ化)／blockDataをMap化**。
- ⚠ `explode` で `const bottomY` が `radius` を参照するので順序注意（`R`はTDZで使えない）。

## 追加機能: 核ミサイル / 設定永続化 / fog修正 / 落下音 / 下方ワープ修正

- **核ミサイル(NUKE_MISSILE=10 / MIRV_MISSILE=11)**: entities.js の独立エンティティ `nukeMissiles`（rocket手本・createPrimedTNT不使用）。`buildNukeMissileMesh`=ノーズコーン+ボディ+赤帯+4フィン+噴射炎のGroup、煙トレイル。右クリ発射(actions.js)、毎フレーム`updateNukeMissiles`(main.js)。着弾で`explode(...,'nuke')`。**MIRV**は`MIRV_SPLIT_TIME=0.5s` または着弾の早い方で5発(`MIRV_CHILD_COUNT`)へコーン分裂(`splitMirv`)→各自着弾で個別キノコ雲。
  - ⚠**MIRV同時爆発スパイク対策**: 着弾は即explodeせず`nukeBlastQueue`へ積み、`updateNukeMissiles`末尾で**1フレーム1発**だけ処理（5発同時の~1.5秒フリーズを時間分散）。
  - 罠: 単純な「時刻だけで分裂」だと地面狙いで着弾が先行し分裂しない（floatで `14*0.05 < 0.7`）→「時刻 or 着弾」の早い方で分裂に修正済。
- **設定永続化(js/persist.js)**: localStorage `maincraft_settings_v1`。`loadSettings()`をトップレベル即時実行（**mobile.js後・main.js前**＝mobileLookSensitivityのTDZ回避＆WORLD_SIZE/DEPTHをgenerateWorld前に確定）。autosaveは主要コントロールに自前リスナー。⚠**WORLD_SIZE/DEPTHは「再生成で適用済みの値(data.WORLD_SIZE/DEPTH)」を権威**にする（スライダーのドラッグだけの未適用値で復元すると、リロード時に勝手に再生成され設置ブロックが消える）。
- **fog修正(scene.js applyFog)**: 旧 near15/far40 が近すぎて大きなキノコ雲(半径50)が霧で霞んだ→`near=max(40,WORLD_SIZE*0.9) / far=max(160,WORLD_SIZE*2.6)`にサイズ連動。`generateWorld`末尾でも`applyFog()`（再生成追従）。far<camera.far(1000)。
- **落下音(audio.js)**: `'whistle'`=空爆の下降ホイッスル(高→低スイープ・スロットル`lastWhistleTime`)、`'missile_launch'`=発射whoosh。whistleは`callAirstrike`の各投下setTimeout内で鳴らす（createPrimedTNTに置くと全TNTで鳴る）。
- **★下方ワープ修正(main.js)**: 「突然ワールドの下にワープ」バグ＝**ラグスパイクで delta 巨大化→1フレームで数十ブロック落下→床判定(±2ブロック)すり抜け**。修正=①`delta = Math.min(..., 0.05)` ②`velocity.y` を ±45 に終端クランプ。これで1フレーム縦移動≦約2.25ブロック＝当たり判定範囲内。**ラグと連動して起きる挙動の正体がこれ**。

## 追加機能: 🤖 AI 陣営戦（赤軍 vs 青軍）（js/agents.js）

召喚アイテム **SUMMONER(=105)** 右クリで赤軍(faction0)と青軍(faction1)を左右から同時召喚し、中央で会戦させる。
**地形は壊さない（侵食なし＝シンプルに戦うだけ）**。※当初は「破壊軍団(地形をカオス破壊)」だったが、Tench が「虫が地面を侵食しながら進む感じが気持ち悪い」→侵食撤去・純粋な戦闘に変更(2026-06-20)。

- **性能の土台（数百体でも軽い）**: ①描画＝単一 `THREE.InstancedMesh`(agentMesh・1ドローコール)＋`setColorAt`で陣営色を per-instance tint ②思考＝ラウンドロビン(`AGENT_THINK_BUDGET=14`体/frameだけ最寄り敵を索敵・残りは惰性) ③`VIEW_DIST*16` 外/奈落のユニットは消滅。`AGENT_MAX=260`/`AGENT_WAVE=28`(赤14+青14)。実測 140体で updateAgents avg0.14ms/max0.7ms・FPS60。
- **見た目**: 明るめグレーの胴体＋**軍隊っぽいヘルメット(上部の暗いドーム＋ブリム線・`createAgentTexture`)**＋光る目。tint で陣営色のヘルメット兵に。
- **陣営戦の挙動**: 各兵は `{faction, hp, target, atkCd, hitFlash, alive, turnDir}` を持つ。索敵=思考フレームで最寄りの敵陣ユニット(`AGENT_SIGHT=64`)を `target` に。移動=`a.heading`(=敵/徘徊の向き=顔の向き)へ前進。戦闘=射程`AGENT_ATK_RANGE=1.7`内で `AGENT_ATK_CD=0.5s` 毎に `AGENT_ATK_DMG=2` を与える(`AGENT_HP=6`＝3発で撃破)。被弾で白フラッシュ＋軽いノックバック。**核なし＝近接melee のみ・地形破壊なし**。戦死時のみ小さな破片パフ(throttle付き)。
- **★障害物回避（つっかえ解消・2026-06-20）**: 「侵食なし」で掘削を撤去した結果、壁にぶつかると向きを散らすだけ→target がいると毎フレーム `heading=敵方向` で上書きされ**壁に再突進→散らす→上書きの無限往復でその場固着**した(Tench「移動中につっかえる」)。修正=移動時、`heading` を変えず**移動方向だけ左右に角度を振った候補(`_AGENT_AVOID_*` = 0,±0.5,±1.0,±1.6,±2.4rad)から最初に通れる方向へ進む**＝壁を蟹歩きで迂回。1段差は登る。全方向塞がれたら向き反転で脱出。`turnDir(±1)`で好む回り込み側を分けて団子化防止。検証=3高×14幅の壁を挟んだ敵に迂回して到達・交戦(最大停止10フレーム＝固着なし)。
- **★プレイヤーが倒せる（2026-06-20）**: `explode`(ミサイル/核/TNT/ロケット全部の中枢)が半径確定後に `killAgentsInRadius(cx,cy,cz,radius)`(agents.js・typeofガード)を呼び、半径内の兵を即死(`hp=0/alive=false`)→updateAgents が除去。**プレイヤーがミサイル等で兵を掃討できる**(Tench「俺も殺せるように」)。selftest=爆発で28体→0体。
- **死亡/カリングの規約**: `agents` を **reverse for で splice**。他兵の `a.target` が残るので、**splice する前に `alive=false` を倒す**（参照側は `!tgt.alive || tgt.hp<=0` で無効と判定して追跡をやめる）。これを破ると「消えた敵を永久に殴る/追う」になる。
- **⚠ setColorAt の確保タイミングの罠（敵対監査で発見・修正済）**: r128 の `InstancedMesh.setColorAt` は **呼んだ瞬間の `count`** で `Float32Array(3*count)` を一度だけ確保し二度と作り直さない。`agentMesh.count = 0` にした**後**に `setColorAt` を呼ぶと長さ0配列になり、以降の陣営色書き込みが全て**サイレント無視**(範囲外write=例外も出ない)＝両軍が同色になる。**対策**=`instanceColor` を `new THREE.InstancedBufferAttribute(new Float32Array(AGENT_MAX*3),3)` で **count=0 にする前に** AGENT_MAX サイズで明示確保(initAgentMesh)。selftest 11e に `instanceColor.array.length===AGENT_MAX*3` ＋「赤優勢/青優勢が両方バッファに存在」アサートを追加して回帰検出。
- **selftest**: 11e(legion summon+update＋色バッファ検証)・11f(隣接した赤×青の近接戦闘でHP減少/撃破)・11g(プレイヤーの爆発で兵が死ぬ)。`window.__selftest()` で緑確認(現在20項目)。
- **チューニング余地**: 密集会戦は決着が速い(56体→2秒で十数体)。長引かせたいなら `AGENT_HP↑`/`AGENT_ATK_DMG↓`/`AGENT_ATK_CD↑`。

## 開発フロー / 既知の事項

- 作業ブランチ: `claude/game-bug-check-refactor-po14h4`。`main` へは PR 経由でマージ。
- GitHub Pages は **Settings > Pages > Source = GitHub Actions**（設定済み）。
  自動作成される `github-pages` 環境は **デフォルトブランチ（main）からのデプロイ前提**
  のため、作業ブランチへの push では Pages デプロイは失敗する（main マージで解消）。
- この実行環境にはブラウザ/ヘッドレス環境が無いため、**実機/描画テストは不可**。
  検証は (a) node の構文チェック、(b) THREE/DOM スタブでのロード&初回フレーム実行、
  (c) 実機での目視、(d) 必要なら CI に Playwright を追加、で行う。

## 次にやるかもしれないこと

- 実機（横向き）で見切れが残る場合の機種別追い込み
- CI への Playwright 横向きビジュアルテスト追加（未着手）
