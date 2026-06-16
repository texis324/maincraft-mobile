# maincraft-mobile

Three.js 製のブラウザ向けミニ Minecraft（TNT 物理つき）。PC・モバイル両対応。

## 遊び方

- **PC**: `index.html` をブラウザで開く（クリックでポインターロック開始）
- **モバイル**: 公開 URL にアクセス（タッチ操作 UI が自動で表示されます）

> ローカルで開く場合、`file://` でも動きますが、一部ブラウザの制約を避けるため
> 簡易サーバー（例: `python3 -m http.server`）経由での起動を推奨します。

## 操作方法（PC）

| 操作 | キー |
| --- | --- |
| 視点 | マウス |
| 移動 | WASD（W 2回でダッシュ） |
| ジャンプ / 飛行切替 | SPACE（2回押しで飛行） |
| 飛行中の下降 | SHIFT |
| 破壊 | 左クリック |
| 設置 / 銃発射 | 右クリック（または C キー） |
| インベントリ | E |
| ポーズ | Esc |

## ファイル構成

機能ごとに分割しています（読み込み順は `index.html` の `<script>` 順）。

```
index.html        … HTML 本体 + スクリプト読み込み
css/style.css     … スタイル / HUD / モバイル UI
js/config.js      … 定数・ブロック定義・ポインターロック補助
js/audio.js       … 効果音（WebAudio）
js/textures.js    … 手続き的テクスチャ生成・マテリアル
js/scene.js       … Three.js 初期化・カメラ・銃モデル
js/world.js       … ワールド生成・ブロックの追加/削除
js/physics.js     … プレイヤー / TNT の衝突判定
js/entities.js    … TNT・ロケット・爆発・パーティクル
js/ui.js          … ホットバー・インベントリ・ハート・銃アニメ
js/player.js      … ダメージ・リセット
js/actions.js     … 採掘・設置・着火・画面切替
js/input.js       … キーボード / マウス入力
js/mobile.js      … タッチ操作（ジョイスティック等）
js/main.js        … メインループ・起動
```

## デプロイ

`main`（または開発ブランチ）への push で GitHub Actions が GitHub Pages に
自動デプロイします（`.github/workflows/deploy-pages.yml`）。
