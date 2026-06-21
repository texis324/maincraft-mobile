// --- 4. Sound System with Limiter ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.5;

const compressor = audioCtx.createDynamicsCompressor();
compressor.threshold.value = -10;
compressor.knee.value = 40;
compressor.ratio.value = 12;
compressor.attack.value = 0;
compressor.release.value = 0.25;

masterGain.connect(compressor);
compressor.connect(audioCtx.destination);

function createNoiseBuffer() {
    const bufferSize = audioCtx.sampleRate * 2;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    return buffer;
}
const noiseBuffer = createNoiseBuffer();

let lastExplosionTime = 0;
let lastWhistleTime = 0; // 空爆ホイッスルのスロットル（同フレーム多重発火の間引き用）
let lastGunshotTime = 0; // 兵の銃声のスロットル（大量同時発射でも潰れない＆スパイク防止）

function playSound(type, materialType) {
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;

    if (type === 'explode') {
        if (now - lastExplosionTime < 0.05) return;
        lastExplosionTime = now;

        const noiseSrc = audioCtx.createBufferSource();
        noiseSrc.buffer = noiseBuffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, now);
        filter.frequency.exponentialRampToValueAtTime(100, now + 0.5);

        const sGain = audioCtx.createGain();
        noiseSrc.connect(filter);
        filter.connect(sGain);
        sGain.connect(masterGain);

        sGain.gain.setValueAtTime(0.5, now);
        sGain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

        noiseSrc.start();
        noiseSrc.stop(now + 1.2);

        const osc = audioCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(10, now + 0.5);
        const subGain = audioCtx.createGain();
        subGain.gain.setValueAtTime(0.3, now);
        subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        osc.connect(subGain);
        subGain.connect(masterGain);
        osc.start();
        osc.stop(now + 0.5);
        return;
    }

    if (type === 'nuke') {
        lastExplosionTime = now;

        // 初撃のクラック（バンドパスノイズ）
        const crack = audioCtx.createBufferSource();
        crack.buffer = noiseBuffer;
        const cFilter = audioCtx.createBiquadFilter();
        cFilter.type = 'bandpass';
        cFilter.frequency.value = 1200;
        const cGain = audioCtx.createGain();
        cGain.gain.setValueAtTime(0.5, now);
        cGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        crack.connect(cFilter); cFilter.connect(cGain); cGain.connect(masterGain);
        crack.start(); crack.stop(now + 0.3);

        // 深い重低音（サブ）
        const sub = audioCtx.createOscillator();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(70, now);
        sub.frequency.exponentialRampToValueAtTime(8, now + 1.5);
        const subGain = audioCtx.createGain();
        subGain.gain.setValueAtTime(0.7, now);
        subGain.gain.exponentialRampToValueAtTime(0.01, now + 1.8);
        sub.connect(subGain); subGain.connect(masterGain);
        sub.start(); sub.stop(now + 1.8);

        // 長く尾を引く轟音（ローパスノイズ）
        const rumble = audioCtx.createBufferSource();
        rumble.buffer = noiseBuffer;
        rumble.loop = true;
        const rFilter = audioCtx.createBiquadFilter();
        rFilter.type = 'lowpass';
        rFilter.frequency.setValueAtTime(500, now);
        rFilter.frequency.exponentialRampToValueAtTime(60, now + 2.6);
        const rGain = audioCtx.createGain();
        rGain.gain.setValueAtTime(0.6, now);
        rGain.gain.exponentialRampToValueAtTime(0.01, now + 2.8);
        rumble.connect(rFilter); rFilter.connect(rGain); rGain.connect(masterGain);
        rumble.start(); rumble.stop(now + 2.8);
        return;
    }

    if (type === 'whistle') {
        // 空爆で落ちてくる爆弾の「ヒューーン」: ピッチが高→低へスイープする下降トーン＋微ノイズ。
        // 複数同時投下でも潰れないよう控えめゲイン。同フレーム多重発火だけスロットルで間引く。
        if (now - lastWhistleTime < 0.05) return;
        lastWhistleTime = now;

        const dur = 1.8 + Math.random() * 0.5; // 約1.8〜2.3秒

        // メインの下降トーン（高→低スイープ）
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        const startHz = 1600 + Math.random() * 400; // 開始ピッチに少しゆらぎ
        osc.frequency.setValueAtTime(startHz, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + dur);

        // 倍音を少し重ねて「ヒュー」感を強める（弱め）
        const osc2 = audioCtx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(startHz * 1.5, now);
        osc2.frequency.exponentialRampToValueAtTime(270, now + dur);

        const wGain = audioCtx.createGain();
        // 立ち上がりは小さく→中盤で少し上げ→着弾前にフェードアウト。控えめピーク0.12。
        wGain.gain.setValueAtTime(0.001, now);
        wGain.gain.exponentialRampToValueAtTime(0.12, now + dur * 0.35);
        wGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

        const wGain2 = audioCtx.createGain();
        wGain2.gain.setValueAtTime(0.001, now);
        wGain2.gain.exponentialRampToValueAtTime(0.04, now + dur * 0.35);
        wGain2.gain.exponentialRampToValueAtTime(0.001, now + dur);

        osc.connect(wGain);
        osc2.connect(wGain2);
        wGain.connect(masterGain);
        wGain2.connect(masterGain);
        osc.start(); osc.stop(now + dur);
        osc2.start(); osc2.stop(now + dur);

        // 微ノイズ（風切り感）。バンドパスで耳障りにならない帯域に絞る。
        const air = audioCtx.createBufferSource();
        air.buffer = noiseBuffer;
        const airFilter = audioCtx.createBiquadFilter();
        airFilter.type = 'bandpass';
        airFilter.frequency.setValueAtTime(2000, now);
        airFilter.frequency.exponentialRampToValueAtTime(600, now + dur);
        airFilter.Q.value = 1.2;
        const airGain = audioCtx.createGain();
        airGain.gain.setValueAtTime(0.001, now);
        airGain.gain.exponentialRampToValueAtTime(0.05, now + dur * 0.4);
        airGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        air.connect(airFilter); airFilter.connect(airGain); airGain.connect(masterGain);
        air.start(); air.stop(now + dur);
        return;
    }

    if (type === 'gunshot') {
        // 兵の銃声: 鋭いクラック（ハイパスノイズの破裂）＋低めの芯。大量同時発射でも潰れないよう間引き＆控えめ。
        if (now - lastGunshotTime < 0.03) return;
        lastGunshotTime = now;
        const n = audioCtx.createBufferSource();
        n.buffer = noiseBuffer;
        const f = audioCtx.createBiquadFilter();
        f.type = 'highpass'; f.frequency.value = 850 + Math.random() * 400;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.16, now);
        g.gain.exponentialRampToValueAtTime(0.004, now + 0.06);
        n.connect(f); f.connect(g); g.connect(masterGain);
        n.start(); n.stop(now + 0.07);
        const o = audioCtx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(170, now);
        o.frequency.exponentialRampToValueAtTime(50, now + 0.05);
        const og = audioCtx.createGain();
        og.gain.setValueAtTime(0.05, now);
        og.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
        o.connect(og); og.connect(masterGain);
        o.start(); o.stop(now + 0.06);
        return;
    }

    if (type === 'missile_launch') {
        // ミサイル/ロケット発射の whoosh: 低→高へ駆け上がるノイズスイープ＋短いトーン。約0.45秒。
        const dur = 0.45;

        const whoosh = audioCtx.createBufferSource();
        whoosh.buffer = noiseBuffer;
        const wFilter = audioCtx.createBiquadFilter();
        wFilter.type = 'bandpass';
        wFilter.frequency.setValueAtTime(300, now);
        wFilter.frequency.exponentialRampToValueAtTime(3000, now + dur);
        wFilter.Q.value = 0.8;
        const wGain = audioCtx.createGain();
        wGain.gain.setValueAtTime(0.25, now);
        wGain.gain.exponentialRampToValueAtTime(0.01, now + dur);
        whoosh.connect(wFilter); wFilter.connect(wGain); wGain.connect(masterGain);
        whoosh.start(); whoosh.stop(now + dur);

        // 推進トーン（低→高）
        const osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + dur);
        const oGain = audioCtx.createGain();
        oGain.gain.setValueAtTime(0.1, now);
        oGain.gain.exponentialRampToValueAtTime(0.01, now + dur);
        osc.connect(oGain); oGain.connect(masterGain);
        osc.start(); osc.stop(now + dur);
        return;
    }

    const gain = audioCtx.createGain();
    gain.connect(masterGain);

    if (type === 'break' || type === 'place') {
        let soundType = 'soft';
        if (BLOCK_PROPS[materialType]) soundType = BLOCK_PROPS[materialType].sound;

        const osc = audioCtx.createOscillator();
        osc.connect(gain);

        if (soundType === 'hard') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(type === 'break' ? 200 : 400, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start();
            osc.stop(now + 0.1);
        } else if (soundType === 'wood') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.05);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start();
            osc.stop(now + 0.1);
        } else if (soundType === 'water') {
             const noiseSrc = audioCtx.createBufferSource();
             noiseSrc.buffer = noiseBuffer;
             const noiseFilter = audioCtx.createBiquadFilter();
             noiseFilter.type = 'lowpass';
             noiseFilter.frequency.value = 400;
             noiseSrc.connect(noiseFilter);
             noiseFilter.connect(gain);
             gain.gain.setValueAtTime(0.3, now);
             gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
             noiseSrc.start();
             noiseSrc.stop(now + 0.3);
        } else {
            const noiseSrc = audioCtx.createBufferSource();
            noiseSrc.buffer = noiseBuffer;
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.value = 600;
            noiseSrc.connect(noiseFilter);
            noiseFilter.connect(gain);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            noiseSrc.start();
            noiseSrc.stop(now + 0.1);
        }
    }
    else if (type === 'ignite') {
        const noiseSrc = audioCtx.createBufferSource();
        noiseSrc.buffer = noiseBuffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2000;
        noiseSrc.connect(filter);
        filter.connect(gain);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        noiseSrc.start();
        noiseSrc.stop(now + 0.2);
    }
    else if (type === 'shoot') {
        // Shoot sound (thump)
        const osc = audioCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.1);
        osc.connect(gain);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start();
        osc.stop(now + 0.1);
    }
    else if (type === 'step') {
        const noiseSrc = audioCtx.createBufferSource();
        noiseSrc.buffer = noiseBuffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        noiseSrc.connect(filter);
        filter.connect(gain);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        noiseSrc.start();
        noiseSrc.stop(now + 0.08);
    }
    else if (type === 'water_enter' || type === 'water_step') {
        // 水に入る音 / 水の中を歩く音
        const noiseSrc = audioCtx.createBufferSource();
        noiseSrc.buffer = noiseBuffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = type === 'water_enter' ? 600 : 400;
        noiseSrc.connect(filter);
        filter.connect(gain);

        const volume = type === 'water_enter' ? 0.25 : 0.1;
        const duration = type === 'water_enter' ? 0.3 : 0.15;

        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        noiseSrc.start();
        noiseSrc.stop(now + duration);

        // 水の泡っぽい音を追加
        const osc = audioCtx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800 + Math.random() * 400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
        const oscGain = audioCtx.createGain();
        oscGain.gain.setValueAtTime(0.05, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.connect(oscGain);
        oscGain.connect(masterGain);
        osc.start();
        osc.stop(now + 0.1);
    }
}
