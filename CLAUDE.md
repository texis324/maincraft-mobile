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
