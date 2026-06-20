// --- 1. Game Config & Performance Settings ---
// ★無限ワールド: 旧「WORLD_SIZE 固定の箱」を廃止。プレイヤー周囲のチャンクだけを動的生成し、
//   遠方は破棄する。地形は terrainHeightAt/strataBlockAt が位置非依存＆決定的（worldSeed）なので
//   どの順序で生成しても同じ世界になる。データは blockData(文字列キー巨大オブジェクト) →
//   チャンクごとの Uint8Array に作り替え（数百万ブロックでも軽い・無限の前提）。
const CHUNK_SIZE = 16;     // チャンク一辺（world.js のメッシュ単位）
const CS = CHUNK_SIZE;     // 短縮
let VIEW_DIST = 8;         // 描画距離（チャンク数・スライダー 4〜16）。旧 WORLD_SIZE の役目を置換
let WORLD_DEPTH = 96;      // 海面より下、岩盤までの層数（本家マイクラ並みの深さ・スライダー 48〜192）
let worldBottomY = -1;    // 岩盤の底のY（generateWorldで計算）
const SURFACE_Y = 2;      // 基準の地表高（海面の高さでもある）。起伏はこの周辺に上下する
const SEA_LEVEL = SURFACE_Y; // 海面。地表高がこれ未満の列は水で満たす（谷＝湖/海）
const WORLD_HEIGHT = 8;

// --- 起伏地形（手続き生成）のチューニング ---
// バリューノイズは中央(0.5)寄りなので、ダイナミックな起伏には大きめの振幅が要る
let TERRAIN_HILL_AMP = 9;    // 細かい丘の振幅（高周波）
let TERRAIN_MTN_AMP = 20;   // 大きな起伏=山/谷の振幅（低周波）
let TERRAIN_CONT_AMP = 26;  // 大陸スケールの超低周波起伏（無限ワールドの探索に変化をつける）
let TERRAIN_BASE = SEA_LEVEL + 7; // 平均的な陸の高さ（海面より上）＝大部分を陸地にし谷だけ湖に
let worldSeed = 0;          // 0=未設定。generateWorld で乱数化（再生成で更新・persistで保存）
let maxSurfaceY = SURFACE_Y; // 生成時に算出する最高地表Y（スポーン/カリング基準）
const GRAVITY = 20.0;
const JUMP_FORCE = 8.0;

const FAST_PLACE_DELAY = 100; // Moving
const SLOW_PLACE_DELAY = 250; // Standing still
const BREAK_DELAY = 250;
// 自由飛行中に「下向き」に掘るときの採掘クールダウン（小さいほど速い）。
// 上向き/通常は BREAK_DELAY のまま。将来上向きも速くしたくなったら FLY_DIG_UP_DELAY を足す。
const FLY_DIG_DOWN_DELAY = 80;
const LAUNCHER_DELAY = 200; // Fire rate for TNT gun

const WALK_SPEED = 50.0;
const SPRINT_SPEED = 120.0;
const FLY_SPEED = 200.0;

// Performance Tuning
const PIXEL_RATIO_CAP = 1.0;

let mouseSensitivity = 0.002;
let playerHP = 100;
const MAX_HEARTS = 10;

// ☢ 被爆量（目安・mSv）。原爆/水爆の近くにいると累積する一生モノのカウンタ（リセットしない＝笑える）。
// 永続化(persist)で過去の被爆も積み上がる。通常TNTは非放射性なので増えない。
let radiationDose = 0;

let isGameOver = false;
let isPaused = false;
let isInventoryOpen = false;

// Block & Item Definitions
const BLOCKS = {
    GRASS: 1,
    STONE: 2,
    WOOD: 3,
    LEAVES: 4,
    TNT: 5,
    FLINT: 100,
    WATER: 6,
    BEDROCK: 99,
    TNT_LAUNCHER: 101, // TNT Gun
    MEGA_TNT: 7, // 超強力TNT（半径2倍）
    ROCKET_LAUNCHER: 102, // ロケットランチャー
    NUKE: 8, // 原子爆弾（超広範囲・キノコ雲）
    HBOMB: 9, // 水素爆弾（原爆のさらに上・超巨大クレーター）
    NUKE_MISSILE: 10, // 核ミサイル（単弾頭・右クリで発射）
    MIRV_MISSILE: 11, // MIRV核ミサイル（飛行中に複数弾頭へ分裂）
    // --- 地層用ブロック（ワールド生成専用・インベントリには出さない＝BEDROCKと同じ扱い） ---
    DIRT: 12,       // 土（草の下）
    SAND: 13,       // 砂（砂浜・浅瀬の底）
    SANDSTONE: 14,  // 砂岩（砂の下）
    GRANITE: 15,    // 花崗岩（石のポケット）
    DIORITE: 16,    // 閃緑岩
    ANDESITE: 17,   // 安山岩
    DEEPSLATE: 18,  // 深層岩（最深部・硬い）
    TSAR: 20,           // ツァーリ・ボンバ（史上最大の核・設置→火打石で着火・閃光→暗転）
    MISSILE_BUTTON: 103, // ミサイル発射ボタン（右クリで核ミサイル5発を横一列に斉射）
    PENETRATOR: 104     // 地中貫通核（右クリで発射→着弾後に地中へ潜って起爆＝地下空洞＋陥没）
};

// Initial Inventory Order
let INVENTORY = [BLOCKS.GRASS, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.LEAVES, BLOCKS.TNT, BLOCKS.MEGA_TNT, BLOCKS.NUKE, BLOCKS.HBOMB, BLOCKS.TSAR, BLOCKS.FLINT, BLOCKS.WATER, BLOCKS.TNT_LAUNCHER, BLOCKS.ROCKET_LAUNCHER, BLOCKS.NUKE_MISSILE, BLOCKS.MIRV_MISSILE, BLOCKS.MISSILE_BUTTON, BLOCKS.PENETRATOR];
let selectedItemIndex = 0;
let swapSourceIndex = -1;

// ロケットランチャーの威力設定（1-10）
let rocketPower = 5;

// 原子爆弾の威力（爆発半径・10〜50）
let nukePower = 30;

// 水素爆弾の威力（爆発半径・30〜70）
let hbombPower = 50;

// ツァーリ・ボンバの威力（史上最大＝水爆よりさらに上。性能と相談で既定80）
let tsarPower = 80;
// 地中貫通核が地表から潜る深さ（この深さで起爆＝地下に球状空洞＋地表に陥没）
let penetratorDepth = 12;

const BLOCK_PROPS = {
    [BLOCKS.GRASS]: { color: 0x795548, sound: 'soft' },
    [BLOCKS.STONE]: { color: 0x9E9E9E, sound: 'hard', hardness: 1.0 },
    // 地層ブロック（hardness=採掘クールダウン倍率。1.0=石と同じ・大きいほど遅い）
    [BLOCKS.DIRT]:      { color: 0x795548, sound: 'soft', hardness: 0.6 },
    [BLOCKS.SAND]:      { color: 0xDBC68B, sound: 'soft', hardness: 0.5 },
    [BLOCKS.SANDSTONE]: { color: 0xCBB682, sound: 'hard', hardness: 0.9 },
    [BLOCKS.GRANITE]:   { color: 0x9B6A53, sound: 'hard', hardness: 1.6 },
    [BLOCKS.DIORITE]:   { color: 0xCDCDCD, sound: 'hard', hardness: 1.5 },
    [BLOCKS.ANDESITE]:  { color: 0x8C8C8C, sound: 'hard', hardness: 1.5 },
    [BLOCKS.DEEPSLATE]: { color: 0x4B4B52, sound: 'hard', hardness: 2.4 },
    [BLOCKS.WOOD]: { color: 0x5D4037, sound: 'wood' },
    [BLOCKS.LEAVES]: { color: 0x66BB6A, sound: 'soft' },
    [BLOCKS.TNT]: { color: 0xD32F2F, sound: 'soft' },
    [BLOCKS.MEGA_TNT]: { color: 0x4A148C, sound: 'soft' }, // 紫色の超強力TNT
    [BLOCKS.NUKE]: { color: 0xFFD600, sound: 'soft' }, // 原子爆弾（放射能イエロー）
    [BLOCKS.HBOMB]: { color: 0xFF3D00, sound: 'soft' }, // 水素爆弾（赤橙）
    [BLOCKS.TSAR]: { color: 0xFF6F00, sound: 'soft' }, // ツァーリ・ボンバ（橙×黒ハザード）
    [BLOCKS.MISSILE_BUTTON]: { isTool: true }, // 発射ボタン（設置不可・右クリで斉射）
    [BLOCKS.PENETRATOR]: { isTool: true, color: 0x546E7A }, // 地中貫通核（設置不可・右クリで発射）
    [BLOCKS.WATER]: { color: 0x2196F3, sound: 'water', transparent: true, opacity: 0.6, noCollide: true },
    [BLOCKS.BEDROCK]: { color: 0x000000, sound: 'hard' },
    [BLOCKS.FLINT]: { isTool: true },
    [BLOCKS.TNT_LAUNCHER]: { isTool: true },
    [BLOCKS.ROCKET_LAUNCHER]: { isTool: true },
    [BLOCKS.NUKE_MISSILE]: { isTool: true, color: 0xECEFF1 }, // 設置不可・右クリで発射
    [BLOCKS.MIRV_MISSILE]: { isTool: true, color: 0xECEFF1 }
};

// --- Helper: Safe Pointer Lock ---
// モバイル判定（より正確に）
const isMobileDevice = (function() {
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const cannotHover = window.matchMedia('(hover: none)').matches;
    return hasCoarsePointer && cannotHover;
})();

// ポインターロックを使用
function safeRequestPointerLock() {
    if (isMobileDevice) return;

    try {
        if (document.pointerLockElement !== document.body) {
            document.body.requestPointerLock();
        }
    } catch (e) {
        console.warn("Pointer lock error:", e);
    }
}

function safeExitPointerLock() {
    if (isMobileDevice) return;

    try {
        if (document.pointerLockElement === document.body) {
            document.exitPointerLock();
        }
    } catch (e) {
        console.warn("Pointer lock exit error:", e);
    }
}
