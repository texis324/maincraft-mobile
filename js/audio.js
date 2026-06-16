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
