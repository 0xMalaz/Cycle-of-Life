// Sonification. Every base pair that forms plays a note picked by its base
// (A, T, G, C map onto a minor pentatonic scale), pitched by depth and panned
// by position. Births ring like small bells; deaths sink. Under it all, a low drone.

const Sound = (() => {
    const SCALE = [0, 3, 5, 7, 10, 12, 15];
    const BASE_DEGREE = { A: 0, T: 2, G: 3, C: 4 };
    const ROOT = 146.83; // D3
    let ctx = null, master, dry, send, enabled = false;
    let tokens = 4, lastRefill = 0;

    function init() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18; comp.ratio.value = 4;
        comp.connect(ctx.destination);
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(comp);
        dry = ctx.createGain(); dry.gain.value = 0.7; dry.connect(master);
        const reverb = ctx.createConvolver();
        reverb.buffer = impulse(3.4, 2.4);
        send = ctx.createGain(); send.gain.value = 0.55;
        send.connect(reverb); reverb.connect(master);
        drone();
    }

    function impulse(seconds, decay) {
        const len = Math.floor(ctx.sampleRate * seconds);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
        return buf;
    }

    function out(node, pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        node.connect(p);
        p.connect(dry);
        p.connect(send);
    }

    function drone() {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass"; filter.frequency.value = 340; filter.Q.value = 0.8;
        const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
        lfo.frequency.value = 0.04; lfoGain.gain.value = 140;
        lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start();
        const g = ctx.createGain(); g.gain.value = 0.022;
        filter.connect(g); out(g, 0);
        [[ROOT / 2, -4], [ROOT / 2, 4], [ROOT * 0.75, 0]].forEach(([f, cents]) => {
            const o = ctx.createOscillator();
            o.type = "sawtooth"; o.frequency.value = f; o.detune.value = cents;
            o.connect(filter); o.start();
        });
    }

    function tone(freq, { gain = 0.05, attack = 0.005, decay = 1.2, type = "sine", pan = 0, when = 0, partial = 0 } = {}) {
        const t0 = ctx.currentTime + when;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(gain, t0 + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
        out(g, pan);
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = freq;
        o.connect(g); o.start(t0); o.stop(t0 + attack + decay + 0.05);
        if (partial) { // an inharmonic overtone makes it ring like a bell
            const o2 = ctx.createOscillator(), g2 = ctx.createGain();
            o2.frequency.value = freq * partial; g2.gain.value = 0.35;
            o2.connect(g2); g2.connect(g);
            o2.start(t0); o2.stop(t0 + attack + decay * 0.5);
        }
    }

    function freqOf(degree, octave) {
        const d = SCALE[degree % SCALE.length] + 12 * (octave + Math.floor(degree / SCALE.length));
        return ROOT * Math.pow(2, d / 12);
    }

    // At most ~7 notes a second, however busy the world gets.
    function take() {
        const now = ctx.currentTime;
        tokens = Math.min(4, tokens + (now - lastRefill) * 7);
        lastRefill = now;
        if (tokens < 1) return false;
        tokens--;
        return true;
    }

    function panFor(x) { return (x / window.innerWidth) * 1.4 - 0.7; }

    return {
        get enabled() { return enabled; },
        setEnabled(on) {
            enabled = on;
            if (on && !ctx) init();
            if (!ctx) return;
            if (on) ctx.resume();
            master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.4);
        },
        basepair(strand, base) {
            if (!enabled || !take()) return;
            const octave = strand.depth > 1.25 ? 0 : strand.depth > 0.85 ? 1 : 2;
            tone(freqOf(BASE_DEGREE[base], octave), {
                gain: 0.03 + 0.025 * strand.depth, decay: 0.7 + strand.depth * 0.6,
                type: "triangle", pan: panFor(strand.head.x)
            });
        },
        birth(x) {
            if (!enabled) return;
            [0, 2, 4].forEach((deg, k) => tone(freqOf(deg, 2), { gain: 0.045, decay: 2.2, partial: 2.76, pan: panFor(x), when: k * 0.11 }));
        },
        death(x) {
            if (!enabled) return;
            tone(freqOf(0, 0) / 2, { gain: 0.06, attack: 0.4, decay: 3.2, pan: panFor(x) });
            tone(freqOf(3, 0) / 2, { gain: 0.03, attack: 0.6, decay: 3.0, pan: panFor(x) });
        },
        genesis(x) {
            if (!enabled) return;
            [4, 3, 1, 0].forEach((deg, k) => tone(freqOf(deg, 3), { gain: 0.03, decay: 2.6, partial: 3.1, pan: panFor(x), when: k * 0.16 }));
        }
    };
})();
