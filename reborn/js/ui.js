// Everything layered over the canvas: stats, the houses chart, the field
// journal, the inspector card, the floating name label and the toast.

const UI = (() => {
    const $ = id => document.getElementById(id);
    const el = {
        living: $("st-living"), gen: $("st-gen"), births: $("st-births"), deaths: $("st-deaths"),
        ledger: $("st-ledger"), muller: $("muller"), legend: $("houses-legend"),
        entries: $("entries"), status: $("journal-status"), journal: $("journal"),
        inspector: $("inspector"), label: $("label"), tooltip: $("tooltip"), toast: $("toast"),
        summary: $("claude-summary"), keyInput: $("api-key"), remember: $("remember-key")
    };
    let world = null;
    let selected = null, hovered = null, labelFor = null;
    let goneTimer = null;
    let typed = 0;
    let mullerHoverX = null;
    let lastHistoryLen = -1;

    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    // Lift dark palette colours so text and thin marks stay legible on the dark glass.
    function legible(hex, amount = 0.35) {
        const [r, g, b] = Palette.hexToRgb(hex);
        const l = v => Math.round(v + (255 - v) * amount);
        return `rgb(${l(r)},${l(g)},${l(b)})`;
    }

    function init(w, actions) {
        world = w;
        $("btn-palette").onclick = () => actions.cyclePalette();
        $("btn-speed").onclick = () => actions.cycleSpeed();
        $("btn-pause").onclick = () => actions.togglePause();
        $("btn-sound").onclick = () => actions.toggleSound();
        $("btn-record").onclick = () => actions.toggleRecord();
        $("btn-shot").onclick = () => actions.saveStill();

        $("journal-toggle").onclick = () => toggleJournal();
        $("key-form").onsubmit = e => {
            e.preventDefault();
            if (!el.keyInput.value.trim()) return;
            Naturalist.setKey(el.keyInput.value, el.remember.checked);
            el.keyInput.value = "";
            $("claude-settings").open = false;
            toast("Claude will write the next entry");
        };
        $("forget-key").onclick = () => { Naturalist.clearKey(); toast("Key forgotten"); };

        el.muller.addEventListener("mousemove", e => { mullerHoverX = e.offsetX; drawMuller(); showMullerTip(e); });
        el.muller.addEventListener("mouseleave", () => { mullerHoverX = null; el.tooltip.hidden = true; drawMuller(); });

        Naturalist.onUpdate(renderJournal);
        Palette.onChange(p => {
            $("btn-palette").textContent = p.name;
            lastHistoryLen = -1;
        });
        $("btn-palette").textContent = Palette.current().name;
        world.on("reset", () => { lastHistoryLen = -1; close(); });
        renderJournal();
        setInterval(refresh, 250);
        refresh();
    }

    function setButton(id, text, active) {
        const b = $(id);
        b.textContent = text;
        b.classList.toggle("active", !!active);
    }

    function toggleJournal(force) {
        const collapsed = force ?? !el.journal.classList.contains("collapsed");
        el.journal.classList.toggle("collapsed", collapsed);
        const t = $("journal-toggle");
        t.textContent = collapsed ? "+" : "–";
        t.setAttribute("aria-expanded", String(!collapsed));
        t.setAttribute("aria-label", collapsed ? "Expand journal" : "Collapse journal");
    }

    function refresh() {
        if (!world || !world.soup) return;
        const living = world.living.length;
        el.living.textContent = living;
        el.gen.textContent = world.stats.maxGen;
        el.births.textContent = world.stats.births;
        el.deaths.textContent = world.stats.deaths;
        const lost = world.totalAtoms - world.atomsAccounted;
        el.ledger.innerHTML =
            `<b>${world.totalAtoms}</b> atoms in this world, <b>${world.soup.alive}</b> drifting free, ` +
            `<b>${lost === 0 ? "none" : lost}</b> ever lost. <b>${world.stats.mutations}</b> mutations so far.`;
        if (world.history.length !== lastHistoryLen) { lastHistoryLen = world.history.length; drawMuller(); drawLegend(); }
        if (selected) renderInspector();
    }

    // ---- Houses over time (a Muller plot) --------------------------------

    function lineageColor(id) {
        const L = world.lineages.get(+id);
        return L ? legible(Palette.colorAt(L.hue), 0.15) : Palette.current().mist;
    }

    function shownLineages() {
        const totals = {};
        for (const h of world.history) for (const id in h.counts) totals[id] = (totals[id] || 0) + h.counts[id];
        // The six biggest houses get their own band; the rest fold into "other".
        const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 6);
        return top.sort((a, b) => a - b);
    }

    // The chart fills its width from the first minute, then scrolls once the history is full.
    function mullerScale(w) {
        const n = Math.max(world.history.length, 40);
        return { step: w / (n - 1), x0: 0 };
    }

    function drawMuller() {
        const c = el.muller, dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = c.clientWidth, h = c.clientHeight;
        if (!w) return;
        if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
        const g = c.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const hist = world.history;
        if (hist.length < 2) return;
        const ids = shownLineages();
        const totals = hist.map(s => Object.values(s.counts).reduce((a, b) => a + b, 0));
        const max = Math.max(4, ...totals);
        const { step, x0 } = mullerScale(w);
        const bands = [...ids, "other"];
        const lower = new Float32Array(hist.length);

        for (const id of bands) {
            const upper = hist.map((s, j) => {
                const v = id === "other"
                    ? totals[j] - ids.reduce((a, k) => a + (s.counts[k] || 0), 0)
                    : (s.counts[id] || 0);
                return lower[j] + v;
            });
            g.beginPath();
            hist.forEach((s, j) => { const x = x0 + j * step, y = h - upper[j] / max * h; j ? g.lineTo(x, y) : g.moveTo(x, y); });
            for (let j = hist.length - 1; j >= 0; j--) g.lineTo(x0 + j * step, h - lower[j] / max * h);
            g.closePath();
            g.globalAlpha = id === "other" ? 0.3 : 0.85;
            g.fillStyle = id === "other" ? Palette.current().mist : lineageColor(id);
            g.fill();
            // A thin surface-coloured seam keeps neighbouring houses apart.
            g.globalAlpha = 1;
            g.strokeStyle = "rgba(6,6,10,0.9)";
            g.lineWidth = 1;
            g.beginPath();
            hist.forEach((s, j) => { const x = x0 + j * step, y = h - upper[j] / max * h; j ? g.lineTo(x, y) : g.moveTo(x, y); });
            g.stroke();
            upper.forEach((v, j) => lower[j] = v);
        }

        g.strokeStyle = "rgba(255,255,255,0.12)";
        g.beginPath(); g.moveTo(0, h - 0.5); g.lineTo(w, h - 0.5); g.stroke();

        if (mullerHoverX !== null) {
            g.strokeStyle = "rgba(255,255,255,0.6)";
            g.beginPath(); g.moveTo(mullerHoverX + 0.5, 0); g.lineTo(mullerHoverX + 0.5, h); g.stroke();
        }
    }

    function showMullerTip(e) {
        const hist = world.history;
        const { step, x0 } = mullerScale(el.muller.clientWidth);
        const j = Math.round((e.offsetX - x0) / step);
        if (j < 0 || j >= hist.length) { el.tooltip.hidden = true; return; }
        const s = hist[j];
        const rows = Object.entries(s.counts).sort((a, b) => b[1] - a[1]);
        const total = rows.reduce((a, r) => a + r[1], 0);
        el.tooltip.innerHTML =
            `<div>${Naturalist.formatTime(s.t)} · ${total} living</div>` +
            rows.slice(0, 6).map(([id, n]) => {
                const L = world.lineages.get(+id);
                return `<div class="row"><span class="swatch" style="background:${lineageColor(id)}"></span>${esc(L ? L.genus : "?")}<b>${n}</b></div>`;
            }).join("") +
            (rows.length > 6 ? `<div>+ ${rows.length - 6} smaller houses</div>` : "");
        el.tooltip.hidden = false;
        const r = el.tooltip.getBoundingClientRect();
        el.tooltip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX + 14) + "px";
        el.tooltip.style.top = (e.clientY + 14) + "px";
    }

    function drawLegend() {
        const counts = {};
        world.living.forEach(s => counts[s.lineage] = (counts[s.lineage] || 0) + 1);
        const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        el.legend.innerHTML = rows.slice(0, 3).map(([id, n]) => {
            const L = world.lineages.get(+id);
            return `<li><span class="swatch" style="background:${lineageColor(id)}"></span>House of ${esc(L.genus)}<span class="n">${n}</span></li>`;
        }).join("") + (rows.length > 3 ? `<li class="more">and ${rows.length - 3} more ${rows.length - 3 === 1 ? "house" : "houses"}</li>` : "");
    }

    // ---- Field journal ------------------------------------------------------

    function renderJournal() {
        const entries = Naturalist.entries;
        el.summary.textContent = Naturalist.hasKey ? "✦ Claude is writing this journal" : "✦ Let Claude write this journal";
        $("forget-key").hidden = !Naturalist.hasKey;
        el.status.hidden = !Naturalist.status;
        el.status.textContent = Naturalist.status;

        if (!entries.length) {
            el.entries.innerHTML = `<li class="empty">The naturalist is watching the water…</li>`;
            typed = 0;
            return;
        }
        const fresh = entries.length > typed;
        el.entries.innerHTML = entries.map((e, i) => {
            const last = i === entries.length - 1;
            const meta = `<div class="meta"><span>${Naturalist.formatTime(e.t)}</span>` +
                (e.author === "claude" ? `<span class="by-claude">✦ Claude</span>` : `<span>notebook</span>`) + `</div>`;
            return `<li>${meta}<span class="text">${last && fresh ? "" : esc(e.text)}</span>${last && fresh ? '<span class="caret"></span>' : ""}</li>`;
        }).join("");
        if (fresh) typewrite(el.entries.lastElementChild, entries[entries.length - 1].text);
        typed = entries.length;
    }

    function typewrite(li, text) {
        const span = li.querySelector(".text"), caret = li.querySelector(".caret");
        let i = 0;
        const tick = () => {
            if (!span.isConnected) return;
            i = Math.min(text.length, i + 2);
            span.textContent = text.slice(0, i);
            if (i < text.length) setTimeout(tick, 22);
            else if (caret) caret.remove();
        };
        tick();
    }

    // ---- Inspector -------------------------------------------------------------

    function inspect(s) {
        selected = s;
        clearTimeout(goneTimer);
        goneTimer = null;
        el.inspector.hidden = false;
        renderInspector();
    }

    function close() {
        selected = null;
        clearTimeout(goneTimer);
        goneTimer = null;
        el.inspector.hidden = true;
    }

    function origin(s) {
        if (s.origin === "pair") return `Child of <i>${esc(s.parents[0].name)}</i> and <i>${esc(s.parents[1].name)}</i>`;
        if (s.origin === "bud") return `Budded alone from <i>${esc(s.parents[0].name)}</i>`;
        if (s.origin === "soup") return `Assembled itself out of loose atoms`;
        return `One of the founders`;
    }

    function renderInspector() {
        const s = selected, tr = s.traits;
        const color = legible(s.color, 0.2);
        const baseColors = Palette.baseColors().map(c => legible(c, 0.4));
        const L = world.lineages.get(s.lineage);
        const state = s.state === "dying" ? "returning to the soup" : s.state;
        const codons = [];
        for (let i = 0; i < 8; i++) {
            const letters = s.genome.slice(i * 3, i * 3 + 3).split("")
                .map(b => `<span style="color:${baseColors[BASES.indexOf(b)]}">${b}</span>`).join("");
            codons.push(`<span class="codon" title="Codon ${i + 1}: ${TRAITS[i].label}">${letters}</span>`);
        }
        const traitRows = TRAITS.slice(1).map(t =>
            `<span class="t">${t.label}</span><span class="bar"><span style="width:${Math.round(tr[t.key + "N"] * 100)}%;background:${color}"></span></span>`
        ).join("");

        el.inspector.innerHTML = `
            <button class="close icon" aria-label="Close">×</button>
            <p class="kicker">House of ${esc(L ? L.genus : s.name.genus)} · Generation ${s.gen}</p>
            <h2 style="color:${color}">${esc(s.name.full)}</h2>
            <p class="origin">${origin(s)}</p>
            <div class="lifebar"><span style="width:${Math.min(100, s.age / tr.lifespan * 100)}%;background:${color}"></span></div>
            <div class="lifeline"><span>${state}</span><span>${Math.round(s.age)} s of ${Math.round(tr.lifespan)} s</span></div>
            <dl class="facts">
                <div><dt>Length</dt><dd>${s.len} / ${tr.maxLen} bp</dd></div>
                <div><dt>Saved for young</dt><dd>${s.reserve} atoms</dd></div>
                <div><dt>Children</dt><dd>${s.children}</dd></div>
            </dl>
            <div class="genome" aria-label="Genome">${codons.join("")}</div>
            <div class="traits">${traitRows}</div>
            ${s.dead ? `<p class="gone-note">Every one of its atoms is back in the soup.</p>` : ""}`;
        el.inspector.querySelector(".close").onclick = close;
        if (s.dead && !goneTimer) goneTimer = setTimeout(close, 5000);
    }

    // ---- Per-frame bits ----------------------------------------------------

    function frame(hover) {
        hovered = hover;
        const s = hovered || (selected && !selected.dead ? selected : null);
        if (!s || !s.points.length) { el.label.hidden = true; labelFor = null; return; }
        if (labelFor !== s || frame.tick++ % 15 === 0) {
            labelFor = s;
            el.label.innerHTML = `${esc(s.name.full)}<small>gen ${s.gen} · ${s.len} bp · ${s.state === "dying" ? "unzipping" : s.state}</small>`;
        }
        el.label.hidden = false;
        const h = s.head;
        el.label.style.transform = `translate(${Math.round(h.x + 16)}px, ${Math.round(h.y - 34)}px)`;
    }
    frame.tick = 0;

    let toastTimer = null;
    function toast(msg, ms = 1800) {
        el.toast.textContent = msg;
        el.toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.toast.classList.remove("show"), ms);
    }

    return {
        init, inspect, close, frame, toast, setButton, toggleJournal,
        get selected() { return selected; }
    };
})();
