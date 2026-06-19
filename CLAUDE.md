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
js/world.js       … ワールド生成・addBlock/removeBlock・blockMeshes 配列
js/physics.js     … getCollidingBlocks / checkBlockCollision・raycaster
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
- **オーバーレイ(ポーズ/インベントリ/ゲームオーバー)の見切れ対策(2026-06-19)**: 設定項目が増えて(水爆/マップ広さ深さ/再生成)横向きの低い画面で下が切れる問題。`.overlay-screen` に `overflow-y:auto` + `justify-content: safe center`(収まる時中央/はみ出す時先頭寄せ＝上が切れずスクロール) + セーフエリアpadding。`@media (max-height:520px)` で h1/設定/ボタンをコンパクト化し、`order` で Resume/Reset をタイトル直下へ（設定群を全スクロールせず即戻れる）。インベントリgridは `flex-wrap`。デスクトップ(1920×1080)は中央表示で回帰なし。

## 追加機能: ☢ 原子爆弾（NUKE）

- `BLOCKS.NUKE = 8`。インベントリ7番目（FLINTの直前）。アイコンは黄/黒の放射能トレフォイル（`textures.js` の `nuke_side`/`nuke_top`、`materials[BLOCKS.NUKE]` は6面マテリアル配列）。
- 操作: NUKEブロックを設置 → 火打石(FLINT)で右クリック着火（`actions.js`）。導火線5秒（`entities.js createPrimedTNT` の `isNuke`分岐）。
- 仕組み: TNT機構に `isNuke` フラグを並走させる（`createPrimedTNT`/`igniteTNT`/`updatePrimedTNTs`/`explode` の第6引数）。`explode` の `isNuke` 分岐で半径=`nukePower`(既定30)・大量パーティクル・`triggerNukeFlash()`(DOMホワイトフラッシュ)・`createMushroomCloud()`(火球+茎+ドーム傘のボクセル煙、`smokeParticles`/`updateMushroom`、main.js のループで更新)・`nukeScreenShake()`(camera.roll を一時的に揺らす)。
- 威力スライダー: ポーズメニュー `#nuke-power`（10〜50）→ `nukePower`（config.js）。
- ⚠ ダメージは即死級だが、ポーズメニューの「ダメージ無効」既定ONなら死なない。
- **性能: `removeBlock` を swap-pop で O(1) 化**（`mesh.userData.meshIndex`）。原爆で約3000ブロック消去しても62ms（実測）でフリーズしない。**マップ拡張（WORLD_SIZE増）の下地にもなる**＝旧来の `blockMeshes.indexOf` O(n) が大量消去で O(n²) になる問題を解消済み。

## 追加機能: 深さ調節マップ＋サーフェスカリング（world.js 全面改修）

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
