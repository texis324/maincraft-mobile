// --- 1. Game Config & Performance Settings ---
let WORLD_SIZE = 64;      // マップの一辺（再生成で変更可・スライダー 32〜128）
let WORLD_DEPTH = 16;     // 地表より下に何層の石を生成するか（爆弾でクレーターを掘れる）
let worldBottomY = -1;    // 岩盤の底のY（generateWorldで計算）
const SURFACE_Y = 2;      // 地表（草/水）のY。岩盤の底=SURFACE_Y-1-WORLD_DEPTH
const WORLD_HEIGHT = 8;
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
    MIRV_MISSILE: 11 // MIRV核ミサイル（飛行中に複数弾頭へ分裂）
};

// Initial Inventory Order
let INVENTORY = [BLOCKS.GRASS, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.LEAVES, BLOCKS.TNT, BLOCKS.MEGA_TNT, BLOCKS.NUKE, BLOCKS.HBOMB, BLOCKS.FLINT, BLOCKS.WATER, BLOCKS.TNT_LAUNCHER, BLOCKS.ROCKET_LAUNCHER, BLOCKS.NUKE_MISSILE, BLOCKS.MIRV_MISSILE];
let selectedItemIndex = 0;
let swapSourceIndex = -1;

// ロケットランチャーの威力設定（1-10）
let rocketPower = 5;

// 原子爆弾の威力（爆発半径・10〜50）
let nukePower = 30;

// 水素爆弾の威力（爆発半径・30〜70）
let hbombPower = 50;

const BLOCK_PROPS = {
    [BLOCKS.GRASS]: { color: 0x795548, sound: 'soft' },
    [BLOCKS.STONE]: { color: 0x9E9E9E, sound: 'hard' },
    [BLOCKS.WOOD]: { color: 0x5D4037, sound: 'wood' },
    [BLOCKS.LEAVES]: { color: 0x66BB6A, sound: 'soft' },
    [BLOCKS.TNT]: { color: 0xD32F2F, sound: 'soft' },
    [BLOCKS.MEGA_TNT]: { color: 0x4A148C, sound: 'soft' }, // 紫色の超強力TNT
    [BLOCKS.NUKE]: { color: 0xFFD600, sound: 'soft' }, // 原子爆弾（放射能イエロー）
    [BLOCKS.HBOMB]: { color: 0xFF3D00, sound: 'soft' }, // 水素爆弾（赤橙）
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
