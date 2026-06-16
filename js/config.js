// --- 1. Game Config & Performance Settings ---
const WORLD_SIZE = 32;
const WORLD_HEIGHT = 8;
const GRAVITY = 20.0;
const JUMP_FORCE = 8.0;

const FAST_PLACE_DELAY = 100; // Moving
const SLOW_PLACE_DELAY = 250; // Standing still
const BREAK_DELAY = 250;
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
    ROCKET_LAUNCHER: 102 // ロケットランチャー
};

// Initial Inventory Order
let INVENTORY = [BLOCKS.GRASS, BLOCKS.STONE, BLOCKS.WOOD, BLOCKS.LEAVES, BLOCKS.TNT, BLOCKS.MEGA_TNT, BLOCKS.FLINT, BLOCKS.WATER, BLOCKS.TNT_LAUNCHER, BLOCKS.ROCKET_LAUNCHER];
let selectedItemIndex = 0;
let swapSourceIndex = -1;

// ロケットランチャーの威力設定（1-10）
let rocketPower = 5;

const BLOCK_PROPS = {
    [BLOCKS.GRASS]: { color: 0x795548, sound: 'soft' },
    [BLOCKS.STONE]: { color: 0x9E9E9E, sound: 'hard' },
    [BLOCKS.WOOD]: { color: 0x5D4037, sound: 'wood' },
    [BLOCKS.LEAVES]: { color: 0x66BB6A, sound: 'soft' },
    [BLOCKS.TNT]: { color: 0xD32F2F, sound: 'soft' },
    [BLOCKS.MEGA_TNT]: { color: 0x4A148C, sound: 'soft' }, // 紫色の超強力TNT
    [BLOCKS.WATER]: { color: 0x2196F3, sound: 'water', transparent: true, opacity: 0.6, noCollide: true },
    [BLOCKS.BEDROCK]: { color: 0x000000, sound: 'hard' },
    [BLOCKS.FLINT]: { isTool: true },
    [BLOCKS.TNT_LAUNCHER]: { isTool: true },
    [BLOCKS.ROCKET_LAUNCHER]: { isTool: true }
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
