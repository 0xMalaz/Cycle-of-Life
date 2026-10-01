// The Naturalist watches the world and keeps a field journal.
// Out of the box it writes from its own notebook of phrasings. Give it an
// Anthropic API key and Claude writes the entries instead, from a factual
// snapshot of what actually happened since the last one.

const Naturalist = (() => {
    const MODEL = "claude-opus-5-5";
    const INTERVAL = 45;         // seconds between entries
    const EAGER_INTERVAL = 18;   // sooner when something remarkable happens
    const KEY_STORAGE = "cycle-of-life.anthropic-key";

    const SYSTEM_PROMPT = `You keep the field journal for a small digital ecosystem called the Cycle of Life. Its creatures are glowing DNA strands drifting through a dark soup of free atoms. They eat atoms to build their bodies, pair up to have children whose genomes mix and mutate, and unzip when they die, returning every atom to the soup. Nothing is ever created or lost; matter only changes hands.

You will receive a factual snapshot of what happened since your last entry, along with your most recent entries. Write the next entry: two to four sentences, at most 70 words, in the voice of a curious, warm nineteenth-century naturalist. Refer to creatures by the Latin-style names given. Stay with the facts in the snapshot and don't invent events or numbers. Don't repeat an observation you have already made; notice something new. Write plain prose with no heading, date, quotation marks or markdown.`;

    let world = null;
    let buffer = [];
    let entries = [];
    let lastEntryAt = -Infinity;
    let eager = false;
    let busy = false;
    let apiKey = null;
    let client = null;
    let status = "";
    const listeners = [];
    const recentTemplates = [];

    try { apiKey = localStorage.getItem(KEY_STORAGE); } catch (e) { /* storage unavailable */ }

    function attach(w) {
        world = w;
        w.on("reset", () => { buffer = []; entries = []; lastEntryAt = -Infinity; notify(); });
        w.on("birth", ({ child, parents, mutations, asexual }) => {
            buffer.push({ type: "birth", child: child.name.full, gen: child.gen, parents: parents.map(p => p.name.full), mutations, asexual });
            if (child.gen % 5 === 0 && child.gen === w.stats.maxGen && !buffer.some(b => b.type === "milestone" && b.gen === child.gen)) {
                buffer.push({ type: "milestone", gen: child.gen, name: child.name.full });
                eager = true;
            }
        });
        w.on("dying", ({ strand }) => {
            buffer.push({ type: "death", name: strand.name.full, age: Math.round(strand.age), children: strand.children, gen: strand.gen });
        });
        w.on("extinction", ({ lineage }) => {
            // A founder dying alone is ordinary; a family that grew and then failed is news.
            if (lineage.total < 3) return;
            buffer.push({ type: "extinction", genus: lineage.genus, founder: lineage.founder, lasted: Math.round(w.time - lineage.founded), total: lineage.total });
            eager = true;
        });
        w.on("spontaneous", ({ strand }) => {
            buffer.push({ type: "spontaneous", name: strand.name.full });
            eager = true;
        });
        w.on("stir", () => buffer.push({ type: "stir" }));
    }

    function notify() { listeners.forEach(fn => fn(entries, status)); }

    function tick(paused) {
        if (!world || busy || paused || document.hidden) return;
        const since = world.time - lastEntryAt;
        const first = entries.length === 0 && world.time > 6;
        if (first || since >= INTERVAL || (eager && since >= EAGER_INTERVAL)) write();
    }

    async function write() {
        busy = true;
        eager = false;
        const snap = snapshot();
        buffer = [];
        lastEntryAt = world.time;
        let text = null, author = "notebook";
        if (apiKey) {
            text = await askClaude(snap);
            if (text) author = "claude";
        }
        if (!text) text = fromNotebook(snap);
        entries.push({ t: snap.timeSeconds, text, author });
        if (entries.length > 40) entries.shift();
        busy = false;
        notify();
    }

    function snapshot() {
        const w = world, living = w.living;
        const births = buffer.filter(e => e.type === "birth");
        const deaths = buffer.filter(e => e.type === "death");
        const counts = {};
        living.forEach(s => counts[s.lineage] = (counts[s.lineage] || 0) + 1);
        const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const dom = ranked[0] ? w.lineages.get(+ranked[0][0]) : null;
        const oldest = living.reduce((o, s) => (!o || s.age > o.age ? s : o), null);
        const prolific = living.reduce((o, s) => (!o || s.children > o.children ? s : o), null);

        const notable = [];
        buffer.filter(e => e.type === "milestone").forEach(e => notable.push(`the first member of generation ${e.gen} appeared: ${e.name}`));
        buffer.filter(e => e.type === "extinction").forEach(e => notable.push(`the house of ${e.genus} died out after ${e.lasted} seconds, having numbered ${e.total} in all`));
        buffer.filter(e => e.type === "spontaneous").forEach(e => notable.push(`with life nearly gone, loose atoms assembled themselves into a new founder, ${e.name}`));
        births.filter(e => e.mutations >= 2).slice(0, 2).forEach(e => notable.push(`${e.child} was born to ${e.parents.join(" and ")} carrying ${e.mutations} fresh mutations`));
        births.filter(e => e.asexual).slice(0, 1).forEach(e => notable.push(`${e.parents[0]}, finding no partner, budded a child alone: ${e.child}`));
        deaths.filter(e => e.children >= 3).slice(0, 2).forEach(e => notable.push(`${e.name} died at ${e.age} seconds old, leaving ${e.children} children`));

        const drift = [];
        const now = w.traitAverages(), base = w.baseline;
        const labels = { speedN: "swimming speed", appetiteN: "appetite", lifespanN: "inherited lifespan", maxLenN: "body length", ampN: "coil width", spinN: "spin" };
        Object.keys(labels).forEach(k => {
            if (!living.length) return;
            const d = now[k] - base[k];
            if (Math.abs(d) >= 0.08) drift.push(`average ${labels[k]} has ${d > 0 ? "risen" : "fallen"} ${Math.round(Math.abs(d) * 100)} points since the founders`);
        });

        return {
            timeSeconds: w.time,
            elapsed: formatTime(w.time),
            living: living.length,
            freeAtoms: w.soup.alive,
            totalAtoms: w.totalAtoms,
            highestGeneration: w.stats.maxGen,
            sinceLastEntry: {
                births: births.length,
                deaths: deaths.length,
                mutations: births.reduce((s, e) => s + e.mutations, 0),
                timesObserverStirredTheWater: buffer.filter(e => e.type === "stir").length
            },
            dominantHouse: dom ? { genus: dom.genus, living: ranked[0][1], shareOfPopulation: Math.round(100 * ranked[0][1] / living.length) + "%" } : null,
            housesStillAlive: ranked.length,
            oldestLiving: oldest ? { name: oldest.name.full, ageSeconds: Math.round(oldest.age) } : null,
            mostChildren: prolific && prolific.children > 0 ? { name: prolific.name.full, children: prolific.children } : null,
            notable,
            evolution: drift.slice(0, 3),
            palette: Palette.current().name
        };
    }

    // ---- Claude ----------------------------------------------------------

    async function getClient() {
        if (client) return client;
        // Loaded on demand, so the page works offline until someone asks for Claude.
        const { default: Anthropic } = await import("https://esm.sh/@anthropic-ai/sdk");
        client = { Anthropic, api: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
        return client;
    }

    async function askClaude(snap) {
        let Anthropic;
        try {
            const c = await getClient();
            Anthropic = c.Anthropic;
            const recent = entries.slice(-3).map(e => "- " + e.text).join("\n") || "(none yet: this is your first entry)";
            const { timeSeconds, ...facts } = snap;
            const response = await c.api.beta.messages.create({
                model: MODEL,
                max_tokens: 2000,
                betas: ["server-side-fallback-2026-07-01"],
                fallbacks: "default",
                output_config: { effort: "low" },
                system: SYSTEM_PROMPT,
                messages: [{
                    role: "user",
                    content: `Snapshot of the world:\n${JSON.stringify(facts, null, 2)}\n\nYour most recent entries:\n${recent}`
                }]
            });
            if (response.stop_reason === "refusal") {
                setStatus("Claude declined this entry, so the notebook wrote it instead.");
                return null;
            }
            const text = response.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
            setStatus("");
            return text || null;
        } catch (err) {
            if (Anthropic && err instanceof Anthropic.AuthenticationError) {
                setStatus("That API key was rejected. The notebook will keep writing until you add another.");
                apiKey = null;
                client = null;
                try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* storage unavailable */ }
            } else if (Anthropic && err instanceof Anthropic.RateLimitError) {
                setStatus("Rate limited. The notebook is filling in for a while.");
            } else if (Anthropic && err instanceof Anthropic.APIError) {
                setStatus(`Claude is unavailable (${err.status ?? "network"}). The notebook is filling in.`);
            } else {
                setStatus("Couldn't reach Claude. Check your connection. The notebook is filling in.");
                client = null;
            }
            console.warn("[naturalist]", err);
            return null;
        }
    }

    function setStatus(s) { status = s; notify(); }

    // ---- The notebook (no key needed) --------------------------------------

    const pick = (arr, tag) => {
        const options = arr.map((_, i) => i).filter(i => !recentTemplates.includes(tag + i));
        const i = options.length ? options[(Math.random() * options.length) | 0] : 0;
        recentTemplates.push(tag + i);
        if (recentTemplates.length > 12) recentTemplates.shift();
        return arr[i];
    };

    function fromNotebook(s) {
        const sentences = [];
        const d = s.sinceLastEntry;

        if (s.highestGeneration === 1 && d.births === 0 && entries.length === 0) {
            sentences.push(pick([
                `I begin these notes with ${s.living} founders adrift in a soup of ${s.freeAtoms} loose atoms.`,
                `First light on the water: ${s.living} strands, each a stranger to the others, feeding in the dark.`,
                `A fresh world, ${s.totalAtoms} atoms in all, and not one of them will ever be lost. ${s.living} strands have already begun to gather them.`
            ], "open"));
        } else if (s.notable.length) {
            const n = s.notable[0];
            sentences.push(pick([
                `Most remarkable since my last entry: ${n}.`,
                `I must record that ${n}.`,
                `Of note today, ${n}.`
            ], "note"));
        } else if (d.births || d.deaths) {
            sentences.push(pick([
                `${plural(d.births, "birth")} and ${plural(d.deaths, "death")} since I last wrote; ${s.living} strands remain.`,
                `The water has seen ${plural(d.births, "new life", "new lives")} and ${plural(d.deaths, "unzipping", "unzippings")}. ${s.living} now swim.`,
                `Life turns over steadily: ${d.births} in, ${d.deaths} out, ${s.living} remaining.`
            ], "turn"));
        } else {
            sentences.push(pick([
                `A quiet interval. The strands feed and the soup drifts.`,
                `Little to report, which is itself worth noting: the ${s.living} strands are simply eating.`,
                `The currents carry ${s.freeAtoms} free atoms past mouths that are, for now, content.`
            ], "quiet"));
        }

        if (s.evolution.length && Math.random() < 0.7) {
            sentences.push(pick([
                `Across the generations, ${s.evolution[0]}.`,
                `Selection is at work: ${s.evolution[0]}.`,
                `I can no longer doubt it; ${s.evolution[0]}.`
            ], "evo"));
        } else if (s.dominantHouse && s.housesStillAlive > 1 && s.dominantHouse.living >= 3 && Math.random() < 0.6) {
            sentences.push(pick([
                `The house of ${s.dominantHouse.genus} holds ${s.dominantHouse.shareOfPopulation} of all the living.`,
                `${s.dominantHouse.genus} is ascendant, ${s.dominantHouse.living} strong among ${s.housesStillAlive} surviving houses.`
            ], "dom"));
        } else if (s.oldestLiving && s.oldestLiving.ageSeconds > 40) {
            sentences.push(pick([
                `The eldest, ${s.oldestLiving.name}, has lived ${s.oldestLiving.ageSeconds} seconds.`,
                `${s.oldestLiving.name} is the oldest still swimming, at ${s.oldestLiving.ageSeconds} seconds.`
            ], "old"));
        }

        if (Math.random() < 0.45) {
            sentences.push(pick([
                `Every atom they release is taken up again; nothing here is wasted.`,
                `The soup still glows faintly with the colours of the dead.`,
                `It is strange to watch a body come apart and feed its rivals.`,
                `I find myself rooting for the small ones near the bottom of the water.`,
                d.timesObserverStirredTheWater ? `My stirring of the water has scattered their meals, and I feel some guilt about it.` : `The water is calm.`
            ], "close"));
        }
        return sentences.join(" ");
    }

    function plural(n, one, many) { return `${n === 0 ? "no" : n} ${n === 1 ? one : (many || one + "s")}`; }

    function formatTime(t) {
        const m = Math.floor(t / 60), s = Math.floor(t % 60);
        return `${m}:${String(s).padStart(2, "0")}`;
    }

    return {
        attach, tick, formatTime,
        onUpdate: fn => listeners.push(fn),
        get entries() { return entries; },
        get status() { return status; },
        get hasKey() { return !!apiKey; },
        get model() { return MODEL; },
        setKey(key, remember) {
            apiKey = key.trim() || null;
            client = null;
            status = "";
            try {
                if (remember && apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
                else localStorage.removeItem(KEY_STORAGE);
            } catch (e) { /* storage unavailable */ }
            notify();
            if (apiKey && world && !busy) write();
        },
        clearKey() {
            apiKey = null; client = null; status = "";
            try { localStorage.removeItem(KEY_STORAGE); } catch (e) { /* storage unavailable */ }
            notify();
        }
    };
})();
