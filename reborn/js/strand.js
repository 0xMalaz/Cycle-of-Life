// A living DNA strand. It swims head-first, eats free atoms to build its own
// body one base pair at a time, pairs up with others to have children, and
// unzips back into the soup when its time is up.

const SEG = 6.5;          // spacing between base pairs at depth 1
const ATOM_R = 2.2;       // atom radius at depth 1
const SEED_BP = 5;        // a newborn's starting length
const RESERVE_MAX = 16;   // atoms a mature strand can hold for its children
const MIN_DEPTH = 0.55, MAX_DEPTH = 1.6;

let strandCounter = 0;

// z is the atom's position around the helix: +1 faces us, -1 is behind the axis.
function stampAtom(ctx, spr, x, y, z, baseR, boost, life) {
    const d = baseR * (1 + 0.35 * z) * (1 + boost * 0.6) * 7;
    ctx.globalAlpha = Math.min(1, (0.45 + 0.3 * (z + 1)) * life * (1 + boost));
    ctx.drawImage(spr, x - d / 2, y - d / 2, d, d);
}
const scratch = {
    x1: new Float32Array(256), y1: new Float32Array(256),
    x2: new Float32Array(256), y2: new Float32Array(256),
    z: new Float32Array(256)
};

class Strand {
    constructor({ genome, x, y, heading = Math.random() * Math.PI * 2, depth, len = SEED_BP, parents = [], gen = 1, lineage = null, origin = "founder" }) {
        this.id = ++strandCounter;
        this.origin = origin;        // founder | pair | bud | soup
        this.genome = genome;
        this.traits = Genome.decode(genome);
        this.name = Genome.name(genome);
        this.depth = depth;
        this.parents = parents;      // [{ id, name }]
        this.gen = gen;
        this.lineage = lineage ?? this.id;
        this.heading = heading;
        this.age = 0;
        this.state = "growing";
        this.maturity = 0;           // 0..1, rungs fade in as the strand comes of age
        this.pending = 0;            // atoms eaten toward the next base pair
        this.reserve = 0;            // atoms saved up for a child
        this.cooldown = 8 + Math.random() * 6;
        this.longing = 0;            // seconds spent ready to mate with no partner around
        this.children = 0;
        this.flash = 0;
        this.pulses = [];
        this.offset = 0;             // keeps each physical base pair's identity as the head grows
        this.seed = Math.random() * 1000;
        this.phase0 = Math.random() * Math.PI * 2;
        this.unzipAcc = 0;
        this.dead = false;
        this.points = [];
        const seg = this.seg;
        for (let i = 0; i < len; i++) {
            this.points.push({ x: x - Math.cos(heading) * seg * i, y: y - Math.sin(heading) * seg * i });
        }
        if (len >= this.traits.maxLen) { this.state = "mature"; this.maturity = 1; }
    }

    get seg() { return SEG * this.depth; }
    get len() { return this.points.length; }
    get head() { return this.points[0]; }
    get color() { return Palette.colorAt(this.traits.hue); }
    // Everything this strand is made of or carrying, for the conservation ledger.
    get atoms() { return this.points.length * 2 + this.pending + this.reserve; }
    get alive() { return this.state !== "dying"; }

    get wantsMate() {
        return this.state === "mature" && this.cooldown <= 0 && this.reserve >= SEED_BP && this.age > 10;
    }

    baseAt(i) {
        const g = this.genome, k = ((i - this.offset) % g.length + g.length) % g.length;
        return g[k];
    }

    update(dt, world) {
        this.age += dt;
        this.cooldown -= dt;
        this.flash = Math.max(0, this.flash - dt * 2.5);
        for (const p of this.pulses) p.t += dt * 0.9;
        this.pulses = this.pulses.filter(p => p.t < 1.2);

        if (this.state !== "dying" && this.age >= this.traits.lifespan) this.die(world, "age");

        if (this.state === "dying") {
            this.swim(dt, world, 0.3);
            this.unzip(dt, world);
            return;
        }

        if (this.state === "mature") this.maturity = Math.min(1, this.maturity + dt * 0.6);
        this.longing = this.wantsMate ? this.longing + dt : 0;

        this.swim(dt, world, 1);
        this.eat(dt, world);
    }

    swim(dt, world, effort) {
        const t = world.time, h = this.head, tr = this.traits;
        let turn = Noise.noise3(this.seed, t * 0.12, this.depth) * 1.5;
        let wx = 0, wy = 0;

        // Stay in the light: steer back when the head nears the edge of the world.
        const m = 90;
        if (h.x < m) wx += (m - h.x) / m * 2;
        if (h.x > world.W - m) wx -= (h.x - world.W + m) / m * 2;
        if (h.y < m) wy += (m - h.y) / m * 2;
        if (h.y > world.H - m) wy -= (h.y - world.H + m) / m * 2;

        if (this.state !== "dying") {
            if (this.hungry) {
                const food = world.soup && this.foodNear(world);
                if (food) { wx += food.x * tr.appetite; wy += food.y * tr.appetite; }
            }
            if (this.wantsMate) {
                const mate = world.nearestMate(this, 380);
                if (mate) {
                    const dx = mate.head.x - h.x, dy = mate.head.y - h.y, d = Math.hypot(dx, dy) || 1;
                    wx += dx / d * 1.6; wy += dy / d * 1.6;
                }
            }
        }

        const w = Math.hypot(wx, wy);
        if (w > 0.001) {
            let diff = Math.atan2(wy, wx) - this.heading;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            turn += diff * Math.min(2.6, w * 1.4);
        }
        // A minimum turning circle, so long bodies sweep in arcs instead of coiling into knots.
        const maxTurn = Math.max(0.5, tr.speed / (40 * Math.sqrt(this.depth)));
        this.heading += Math.max(-maxTurn, Math.min(maxTurn, turn)) * dt;

        const pulse = 0.78 + 0.22 * Math.sin(t * tr.spin * 0.7 + this.phase0);
        const speed = tr.speed * this.depth * effort * pulse * (0.75 + 0.25 * this.maturity);
        h.x += Math.cos(this.heading) * speed * dt;
        h.y += Math.sin(this.heading) * speed * dt;
        this.follow();
    }

    // Follow-the-leader: each base pair keeps a fixed distance to the one ahead.
    follow() {
        const p = this.points, seg = this.seg;
        for (let i = 1; i < p.length; i++) {
            const a = p[i - 1], b = p[i];
            let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
            if (d < 1e-4) { dx = -Math.cos(this.heading); dy = -Math.sin(this.heading); d = 1; }
            b.x = a.x + dx / d * seg;
            b.y = a.y + dy / d * seg;
        }
    }

    get hungry() {
        return this.state === "growing" || (this.state === "mature" && this.reserve < RESERVE_MAX);
    }

    get senseRadius() { return (50 + 90 * this.traits.appetite) * this.depth; }

    foodNear(world) {
        let sx = 0, sy = 0, c = 0;
        world.soup.forEachNear(this.head.x, this.head.y, this.senseRadius, (i, dx, dy, d2) => {
            const w = 1 / (Math.sqrt(d2) + 10);
            sx += dx * w; sy += dy * w; c++;
        });
        if (c < 2) return null;
        const d = Math.hypot(sx, sy) || 1;
        return { x: sx / d, y: sy / d };
    }

    eat(dt, world) {
        if (!this.hungry) return;
        const soup = world.soup, h = this.head;
        const mouth = 6 + 7 * this.depth, mouth2 = mouth * mouth;
        const pull = (40 + 90 * this.traits.appetite) * dt;
        soup.forEachNear(h.x, h.y, this.senseRadius, (i, dx, dy, d2) => {
            if (d2 < mouth2) {
                soup.kill(i);
                this.ingest(world);
            } else {
                const d = Math.sqrt(d2);
                soup.vx[i] -= dx / d * pull;
                soup.vy[i] -= dy / d * pull;
            }
        });
    }

    ingest(world) {
        this.flash = Math.min(1, this.flash + 0.2);
        if (this.state === "growing") {
            if (++this.pending >= 2) {
                this.pending -= 2;
                this.grow(world);
            }
        } else if (this.state === "mature") {
            this.reserve++;
        }
    }

    // New base pairs are laid down at the head, the way a polymerase extends a chain.
    grow(world) {
        const h = this.head;
        this.points.unshift({ x: h.x + Math.cos(this.heading) * this.seg, y: h.y + Math.sin(this.heading) * this.seg });
        this.offset++;
        world.emit("basepair", { strand: this, base: this.baseAt(0) });
        if (this.points.length >= this.traits.maxLen) {
            this.state = "mature";
            this.reserve += this.pending;
            this.pending = 0;
            world.emit("matured", { strand: this });
        }
    }

    die(world, cause) {
        this.state = "dying";
        // Unspent atoms spill from the head straight away; the body follows as it unzips.
        const h = this.head;
        for (let k = 0; k < this.reserve + this.pending; k++) {
            const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 30;
            world.soup.add(h.x, h.y, Math.cos(a) * v, Math.sin(a) * v, this.traits.hue, 1);
        }
        this.reserve = 0;
        this.pending = 0;
        world.emit("dying", { strand: this, cause });
    }

    unzip(dt, world) {
        const rate = Math.max(10, this.points.length / 2.2);
        this.unzipAcc += dt * rate;
        const tr = this.traits, amp = tr.amp * this.depth;
        while (this.unzipAcc >= 1 && this.points.length > 0) {
            this.unzipAcc -= 1;
            const n = this.points.length, p = this.points[n - 1], q = this.points[Math.max(0, n - 2)];
            let tx = q.x - p.x, ty = q.y - p.y;
            const tl = Math.hypot(tx, ty) || 1;
            const nx = -ty / tl, ny = tx / tl;
            const s = Math.sin((n - 1 - this.offset) * tr.twist + tr.spin * world.time + this.phase0);
            for (const sign of [1, -1]) {
                const v = 18 + Math.random() * 30;
                world.soup.add(
                    p.x + nx * amp * s * sign, p.y + ny * amp * s * sign,
                    nx * v * sign + (Math.random() - 0.5) * 16, ny * v * sign + (Math.random() - 0.5) * 16,
                    tr.hue, 1
                );
            }
            this.points.pop();
        }
        if (this.points.length === 0) this.dead = true;
    }

    // Light running down the body, used for births.
    pulse() { this.pulses.push({ t: 0 }); this.flash = 1; }

    hitTest(x, y) {
        const r = 10 + 10 * this.depth, r2 = r * r;
        let best = Infinity;
        for (let i = 0; i < this.points.length; i += 2) {
            const p = this.points[i], d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
            if (d2 < best) best = d2;
        }
        return best < r2 ? best : Infinity;
    }

    draw(ctx, time, highlight) {
        const p = this.points, n = p.length;
        if (n === 0) return;
        const tr = this.traits, s = this.depth;
        const amp = tr.amp * s;
        const depthAlpha = 0.32 + 0.68 * (s - MIN_DEPTH) / (MAX_DEPTH - MIN_DEPTH);
        const birthFade = Math.min(1, this.age / 1.5);
        let life = depthAlpha * birthFade * (highlight ? 1.35 : 1);
        if (this.state === "dying") life *= 0.85;
        const { x1, y1, x2, y2, z } = scratch;
        const count = Math.min(n, x1.length);

        for (let i = 0; i < count; i++) {
            const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
            let tx = a.x - b.x, ty = a.y - b.y;
            if (n === 1) { tx = Math.cos(this.heading); ty = Math.sin(this.heading); }
            const tl = Math.hypot(tx, ty) || 1;
            const nx = -ty / tl, ny = tx / tl;
            const th = (i - this.offset) * tr.twist + tr.spin * time + this.phase0;
            const sn = Math.sin(th);
            x1[i] = p[i].x + nx * amp * sn; y1[i] = p[i].y + ny * amp * sn;
            x2[i] = p[i].x - nx * amp * sn; y2[i] = p[i].y - ny * amp * sn;
            z[i] = Math.cos(th);
        }

        // Rungs: each half coloured by its base, so A-T and G-C pairs are visible.
        if (this.maturity > 0.01 || this.state === "dying") {
            const colors = Palette.baseColors();
            ctx.lineWidth = Math.max(0.6, 0.9 * s);
            ctx.globalAlpha = 0.34 * Math.max(this.maturity, this.state === "dying" ? 0.6 : 0) * life;
            for (let b = 0; b < 4; b++) {
                ctx.strokeStyle = colors[b];
                ctx.beginPath();
                for (let i = 0; i < count; i++) {
                    if (((i - this.offset) & 1) !== 0) continue;
                    const base = this.baseAt(i);
                    const bi = BASES.indexOf(base), ci = BASES.indexOf(COMPLEMENT[base]);
                    const mx = (x1[i] + x2[i]) / 2, my = (y1[i] + y2[i]) / 2;
                    if (bi === b) { ctx.moveTo(x1[i], y1[i]); ctx.lineTo(mx, my); }
                    if (ci === b) { ctx.moveTo(mx, my); ctx.lineTo(x2[i], y2[i]); }
                }
                ctx.stroke();
            }
        }

        // Atoms: the twist gives each one a depth, so the helix reads as 3D.
        const spr = Palette.sprite(this.color);
        const pulseAt = this.pulses.map(pl => pl.t * n);
        const baseR = ATOM_R * s * (1 + tr.ampN * 0.3);
        for (let i = 0; i < count; i++) {
            let boost = 0;
            for (const c of pulseAt) { const d = (i - c) / 3; boost += Math.exp(-d * d); }
            if (i === 0) boost += this.flash * 0.8;
            stampAtom(ctx, spr, x1[i], y1[i], z[i], baseR, boost, life);
            stampAtom(ctx, spr, x2[i], y2[i], -z[i], baseR, boost, life);
        }

        // A faint halo around the mouth of anything still hungry.
        if (this.hungry && this.state !== "dying") {
            const h = p[0], d = (14 + 10 * this.flash) * s * 2.4;
            ctx.globalAlpha = (0.12 + 0.25 * this.flash) * life;
            ctx.drawImage(spr, h.x - d / 2, h.y - d / 2, d, d);
        }
        ctx.globalAlpha = 1;
    }
}
