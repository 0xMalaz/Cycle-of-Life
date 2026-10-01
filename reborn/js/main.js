// Wiring: canvas, the main loop, input, recording.

(() => {
    const canvas = document.getElementById("stage");
    const ctx = canvas.getContext("2d");
    const SPEEDS = [0.5, 1, 2, 4];
    const TRAIL_FADE = 0.45;

    const world = new World();
    const pointer = { x: 0, y: 0, vx: 0, vy: 0, speed: 0, active: false, lastT: 0 };
    let W = 0, H = 0;
    let paused = false, speedIdx = 1, trails = true, needsClear = true;
    let hover = null, recorder = null;

    function resize() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        needsClear = true;
        if (world.soup) world.resize(W, H);
    }
    resize();
    world.reset(W, H);
    window.addEventListener("resize", resize);

    // ---- Events -> sound and notices ---------------------------------------
    world.on("basepair", ({ strand, base }) => Sound.basepair(strand, base));
    world.on("birth", ({ child }) => Sound.birth(child.head.x));
    world.on("dying", ({ strand }) => Sound.death(strand.head.x));
    world.on("spontaneous", ({ strand }) => {
        Sound.genesis(strand.head.x);
        UI.toast("Life assembled itself out of the soup", 2600);
    });
    world.on("extinction", ({ lineage }) => {
        if (lineage.total >= 3) UI.toast(`The house of ${lineage.genus} has died out`, 2600);
    });
    Palette.onChange(() => { needsClear = true; });

    // ---- Actions -----------------------------------------------------------
    const actions = {
        cyclePalette() { setPalette(Palette.index + 1); },
        cycleSpeed(dir = 1) {
            speedIdx = dir > 0 ? (speedIdx + 1) % SPEEDS.length : Math.max(0, speedIdx - 1);
            UI.setButton("btn-speed", "×" + SPEEDS[speedIdx], speedIdx !== 1);
        },
        togglePause() {
            paused = !paused;
            UI.setButton("btn-pause", paused ? "Resume" : "Pause", paused);
        },
        toggleSound() { setSound(!Sound.enabled); },
        toggleRecord,
        saveStill
    };

    function setPalette(i) {
        Palette.set(i);
        UI.toast(Palette.current().name);
    }

    function setSound(on) {
        Sound.setEnabled(on);
        UI.setButton("btn-sound", on ? "Sound on" : "Sound off", false);
    }

    function stamp() {
        return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    }

    function download(blob, name) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    function saveStill() {
        canvas.toBlob(b => { download(b, `cycle-of-life-${stamp()}.png`); UI.toast("Still saved"); }, "image/png");
    }

    // The original sketch had a recording variant; this one records in the browser.
    function toggleRecord() {
        if (recorder) { recorder.stop(); return; }
        if (!canvas.captureStream || !window.MediaRecorder) { UI.toast("This browser can't record the canvas"); return; }
        const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find(t => MediaRecorder.isTypeSupported(t));
        if (!type) { UI.toast("No supported video format"); return; }
        const chunks = [];
        recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: type, videoBitsPerSecond: 12e6 });
        recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        recorder.onstop = () => {
            download(new Blob(chunks, { type }), `cycle-of-life-${stamp()}.${type.includes("mp4") ? "mp4" : "webm"}`);
            recorder = null;
            UI.setButton("btn-record", "Record", false);
            UI.toast("Video saved");
        };
        recorder.start(500);
        UI.setButton("btn-record", "● Stop", true);
        UI.toast("Recording the canvas. Press R to stop.");
    }

    function newWorld() {
        world.reset(W, H);
        needsClear = true;
        UI.toast("A new world begins");
    }

    Naturalist.attach(world);
    UI.init(world, actions);

    // ---- Intro -------------------------------------------------------------
    document.body.classList.add("intro");
    document.querySelectorAll("#intro [data-sound]").forEach(b => {
        b.onclick = () => {
            if (b.dataset.sound === "on") setSound(true);
            document.getElementById("intro").classList.add("gone");
            document.body.classList.remove("intro");
        };
    });

    // ---- Input -------------------------------------------------------------
    canvas.addEventListener("pointermove", e => {
        const now = performance.now();
        const dt = Math.max(8, now - pointer.lastT) / 1000;
        if (pointer.active) {
            pointer.vx = Math.max(-1500, Math.min(1500, (e.clientX - pointer.x) / dt));
            pointer.vy = Math.max(-1500, Math.min(1500, (e.clientY - pointer.y) / dt));
        }
        pointer.x = e.clientX; pointer.y = e.clientY;
        pointer.active = true;
        pointer.lastT = now;
    });
    canvas.addEventListener("pointerleave", () => { pointer.active = false; });
    canvas.addEventListener("click", e => {
        const s = world.pick(e.clientX, e.clientY);
        if (s) UI.inspect(s);
        else world.stir(e.clientX, e.clientY);
    });

    window.addEventListener("keydown", e => {
        if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k >= "1" && k <= String(PALETTES.length)) return setPalette(+k - 1);
        switch (k) {
            case " ": e.preventDefault(); actions.togglePause(); break;
            case "p": actions.cyclePalette(); break;
            case "m": actions.toggleSound(); break;
            case "j": UI.toggleJournal(); break;
            case "h": document.body.classList.toggle("hide-ui"); break;
            case "[": actions.cycleSpeed(-1); break;
            case "]": actions.cycleSpeed(1); break;
            case "s": saveStill(); break;
            case "r": toggleRecord(); break;
            case "n": newWorld(); break;
            case "t":
                trails = !trails;
                UI.toast(trails ? "Trails on" : "Trails off");
                break;
            case "f":
                if (document.fullscreenElement) document.exitFullscreen();
                else document.documentElement.requestFullscreen?.();
                break;
            case "escape": UI.close(); break;
        }
    });

    // ---- Loop --------------------------------------------------------------
    let last = performance.now(), tickAcc = 0, auditAcc = 0;

    function frame(now) {
        const real = Math.min(0.1, (now - last) / 1000);
        last = now;
        pointer.vx *= 0.86; pointer.vy *= 0.86;
        pointer.speed = Math.hypot(pointer.vx, pointer.vy);

        if (!paused) {
            const dt = real * SPEEDS[speedIdx];
            const steps = Math.ceil(dt / 0.034);
            for (let k = 0; k < steps; k++) world.update(dt / steps, pointer);
        }

        tickAcc += real;
        if (tickAcc >= 1) { tickAcc = 0; Naturalist.tick(paused); }

        auditAcc += real;
        if (auditAcc >= 5) {
            auditAcc = 0;
            const accounted = world.atomsAccounted;
            if (accounted !== world.totalAtoms) console.warn(`[conservation] expected ${world.totalAtoms} atoms, found ${accounted}`);
        }

        render();
        hover = pointer.active ? world.pick(pointer.x, pointer.y) : null;
        canvas.classList.toggle("over-strand", !!hover);
        UI.frame(hover);
        requestAnimationFrame(frame);
    }

    function render() {
        const [r, g, b] = Palette.current().bg;
        if (needsClear || !trails) {
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            needsClear = false;
        } else {
            ctx.fillStyle = `rgba(${r},${g},${b},${TRAIL_FADE})`;
        }
        ctx.fillRect(0, 0, W, H);

        const sel = UI.selected;
        world.draw(ctx, [hover, sel].filter(Boolean));

        if (sel && !sel.dead && sel.points.length) {
            const h = sel.head;
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 5]);
            ctx.lineDashOffset = -world.time * 12;
            ctx.beginPath();
            ctx.arc(h.x, h.y, 16 + 14 * sel.depth, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    requestAnimationFrame(frame);
})();
