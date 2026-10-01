// The world is a closed system. A fixed number of atoms exists from the first
// frame to the last; they only ever move between the soup and living bodies.
// Population is never capped by a rule, only by how much matter there is to go round.

const MAX_POP = 40;
const MIN_POP = 3;
const HISTORY_EVERY = 1.5;   // seconds between lineage samples
const HISTORY_LENGTH = 240;

class World {
    constructor() {
        this.listeners = {};
        this.on("dying", ({ strand }) => {
            this.stats.deaths++;
            const L = this.lineages.get(strand.lineage);
            if (L && --L.alive === 0) {
                L.extinctAt = this.time;
                this.emit("extinction", { lineage: L });
            }
        });
    }

    on(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, data) { (this.listeners[type] || []).forEach(fn => fn(data, this)); }

    reset(W, H) {
        this.W = W; this.H = H;
        this.time = 0;
        this.strands = [];
        this.effects = [];
        this.lineages = new Map();
        this.history = [];
        this.historyAcc = 0;
        this.lastSpontaneous = -10;
        this.stats = { births: 0, deaths: 0, maxGen: 1, spontaneous: 0, mutations: 0 };

        const total = Math.round(Math.min(6000, Math.max(1600, W * H / 400)));
        this.totalAtoms = total;
        // Room to swim: small screens hold fewer strands so the soup never runs dry.
        this.maxPop = Math.round(Math.min(MAX_POP, Math.max(12, W * H / 52000)));
        this.soup = new Soup(total + 512);

        const founders = Math.round(Math.min(18, Math.max(8, W * H / 110000)));
        let budget = total;
        for (let f = 0; f < founders; f++) {
            const genome = Genome.random();
            const t = Genome.decode(genome);
            const s = new Strand({
                genome,
                x: W * (0.1 + Math.random() * 0.8), y: H * (0.1 + Math.random() * 0.8),
                depth: MIN_DEPTH + Math.random() * (MAX_DEPTH - MIN_DEPTH),
                len: Math.round(t.maxLen * (0.3 + Math.random() * 0.5))
            });
            s.age = Math.random() * t.lifespan * 0.35;
            s.follow();
            budget -= s.atoms;
            this.addStrand(s);
        }
        while (budget-- > 0) this.soup.add(Math.random() * W, Math.random() * H);
        this.baseline = this.traitAverages();
        this.sampleHistory();
        this.emit("reset", {});
    }

    resize(W, H) { this.W = W; this.H = H; }

    addStrand(s) {
        this.strands.push(s);
        let L = this.lineages.get(s.lineage);
        if (!L) {
            L = { id: s.lineage, genus: s.name.genus, founder: s.name.full, hue: s.traits.hue, founded: this.time, alive: 0, total: 0, peak: 0, extinctAt: null };
            this.lineages.set(s.lineage, L);
        }
        L.alive++; L.total++;
        L.peak = Math.max(L.peak, L.alive);
        this.stats.maxGen = Math.max(this.stats.maxGen, s.gen);
    }

    get living() { return this.strands.filter(s => s.alive); }

    nearestMate(a, maxD) {
        let best = null, bestD = maxD * maxD;
        for (const b of this.strands) {
            if (b === a || !b.wantsMate) continue;
            const d2 = (b.head.x - a.head.x) ** 2 + (b.head.y - a.head.y) ** 2;
            if (d2 < bestD) { bestD = d2; best = b; }
        }
        return best;
    }

    update(dt, pointer) {
        this.time += dt;
        this.soup.update(dt, this.time, this.W, this.H, pointer);
        this.soup.buildGrid(this.W, this.H);

        for (const s of this.strands) s.update(dt, this);
        this.matchmaking();
        this.abiogenesis();

        this.strands = this.strands.filter(s => !s.dead);
        this.soup.compact();

        for (const e of this.effects) e.t += dt;
        this.effects = this.effects.filter(e => e.t < e.life);

        this.historyAcc += dt;
        if (this.historyAcc >= HISTORY_EVERY) { this.historyAcc = 0; this.sampleHistory(); }
    }

    matchmaking() {
        const living = this.living.length;
        for (const a of this.strands) {
            if (this.strands.length >= this.maxPop) return;
            if (!a.wantsMate) continue;
            const b = this.nearestMate(a, 24 * (a.depth + 1.2));
            if (b) this.reproduce(a, b);
            else if (a.longing > 24 && living < 10 && a.reserve >= SEED_BP * 2) this.reproduce(a, null);
        }
    }

    // Two parents give half a seed each. A lonely strand in a sparse world may bud alone.
    reproduce(a, b) {
        let genome, mutations;
        if (b) {
            ({ genome, mutations } = Genome.mutate(Genome.crossover(a.genome, b.genome)));
            a.reserve -= SEED_BP; b.reserve -= SEED_BP;
        } else {
            ({ genome, mutations } = Genome.mutate(a.genome, MUTATION_RATE * 2.5));
            a.reserve -= SEED_BP * 2;
        }
        const parents = b ? [a, b] : [a];
        const x = b ? (a.head.x + b.head.x) / 2 : a.head.x;
        const y = b ? (a.head.y + b.head.y) / 2 : a.head.y;
        const avgDepth = parents.reduce((s, p) => s + p.depth, 0) / parents.length;
        const child = new Strand({
            genome, x, y,
            depth: Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, avgDepth + (Math.random() - 0.5) * 0.3)),
            len: SEED_BP,
            parents: parents.map(p => ({ id: p.id, name: p.name.full })),
            gen: Math.max(...parents.map(p => p.gen)) + 1,
            lineage: parents[Math.random() < 0.5 ? 0 : parents.length - 1].lineage,
            origin: b ? "pair" : "bud"
        });
        for (const p of parents) {
            p.cooldown = 12 + Math.random() * 8;
            p.longing = 0;
            p.children++;
            p.pulse();
        }
        this.addStrand(child);
        this.stats.births++;
        this.stats.mutations += mutations;
        if (b) this.effects.push({ type: "bridge", a, b, color: child.color, t: 0, life: 1.8 });
        this.effects.push({ type: "ring", x, y, color: child.color, t: 0, life: 1.6 });
        this.soup.impulse(x, y, 90, 35);
        this.emit("birth", { child, parents, mutations, asexual: !b });
    }

    // If life nearly dies out, the soup assembles a brand-new founder from loose atoms.
    abiogenesis() {
        if (this.living.length >= MIN_POP || this.time - this.lastSpontaneous < 5) return;
        const need = SEED_BP * 2;
        if (this.soup.alive < need * 4) return;
        const soup = this.soup;
        let c = -1;
        for (let tries = 0; tries < 50 && c < 0; tries++) {
            const i = (Math.random() * soup.n) | 0;
            if (!soup.dead[i]) c = i;
        }
        if (c < 0) return;
        const cx = soup.x[c], cy = soup.y[c];
        const taken = [];
        soup.forEachNear(cx, cy, 160, i => { if (taken.length < need) taken.push(i); });
        for (let i = 0; taken.length < need && i < soup.n; i++) {
            if (!soup.dead[i] && !taken.includes(i)) taken.push(i);
        }
        taken.forEach(i => soup.kill(i));
        const s = new Strand({
            genome: Genome.random(), x: cx, y: cy,
            depth: MIN_DEPTH + Math.random() * (MAX_DEPTH - MIN_DEPTH), len: SEED_BP, origin: "soup"
        });
        this.addStrand(s);
        this.lastSpontaneous = this.time;
        this.stats.spontaneous++;
        this.effects.push({ type: "ring", x: cx, y: cy, color: s.color, t: 0, life: 2.4 });
        this.emit("spontaneous", { strand: s });
    }

    stir(x, y) {
        this.soup.impulse(x, y, 170, 80);
        this.effects.push({ type: "ripple", x, y, t: 0, life: 1.4 });
        this.emit("stir", { x, y });
    }

    pick(x, y) {
        let best = null, bestD = Infinity;
        for (const s of this.strands) {
            const d = s.hitTest(x, y);
            if (d < bestD) { bestD = d; best = s; }
        }
        return best;
    }

    // The ledger: everything in the soup plus everything inside a body.
    get atomsAccounted() {
        return this.soup.alive + this.strands.reduce((sum, s) => sum + s.atoms, 0);
    }

    traitAverages() {
        const keys = ["speedN", "appetiteN", "lifespanN", "maxLenN", "ampN", "spinN"];
        const living = this.living, avg = {};
        keys.forEach(k => avg[k] = living.length ? living.reduce((s, x) => s + x.traits[k], 0) / living.length : 0);
        return avg;
    }

    sampleHistory() {
        const counts = {};
        for (const s of this.strands) if (s.alive) counts[s.lineage] = (counts[s.lineage] || 0) + 1;
        this.history.push({ t: this.time, counts });
        if (this.history.length > HISTORY_LENGTH) this.history.shift();
    }

    draw(ctx, highlighted) {
        ctx.globalCompositeOperation = "lighter";
        this.soup.draw(ctx, this.time);
        for (const s of this.strands) s.draw(ctx, this.time, highlighted.includes(s));
        this.drawEffects(ctx);
        ctx.globalCompositeOperation = "source-over";
    }

    drawEffects(ctx) {
        for (const e of this.effects) {
            const k = e.t / e.life, fade = 1 - k;
            if (e.type === "bridge") {
                if (!e.a.points.length || !e.b.points.length) continue;
                const a = e.a.head, b = e.b.head;
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                const nx = -(b.y - a.y) * 0.35, ny = (b.x - a.x) * 0.35;
                ctx.strokeStyle = e.color;
                for (const [w, al] of [[6, 0.12], [1.4, 0.7]]) {
                    ctx.globalAlpha = al * fade;
                    ctx.lineWidth = w;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.quadraticCurveTo(mx + nx * Math.sin(k * Math.PI), my + ny * Math.sin(k * Math.PI), b.x, b.y);
                    ctx.stroke();
                }
            } else if (e.type === "ring") {
                ctx.strokeStyle = e.color;
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = 0.7 * fade * fade;
                ctx.beginPath();
                ctx.arc(e.x, e.y, 6 + 70 * Math.sqrt(k), 0, Math.PI * 2);
                ctx.stroke();
            } else if (e.type === "ripple") {
                ctx.strokeStyle = Palette.current().mist;
                ctx.lineWidth = 1;
                for (let r = 0; r < 3; r++) {
                    const kk = k - r * 0.12;
                    if (kk <= 0) continue;
                    ctx.globalAlpha = 0.3 * (1 - kk) * (1 - kk);
                    ctx.beginPath();
                    ctx.arc(e.x, e.y, 200 * kk, 0, Math.PI * 2);
                    ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
    }
}
