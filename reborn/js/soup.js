// The primordial soup: every atom that is not part of a living strand.
// Atoms drift on slow noise currents, get pulled into hungry mouths, and are
// released again when a strand dies. They remember the colour of the body they
// left for a while, so you can watch the dead fade back into the commons.

class Soup {
    constructor(capacity) {
        this.n = 0;
        this.allocate(capacity);
        this.cellSize = 48;
        this.cols = 0; this.rows = 0;
        this.cellStart = new Int32Array(1);
        this.cellItems = new Int32Array(capacity);
    }

    allocate(cap) {
        const grow = (old, Type) => { const a = new Type(cap); if (old) a.set(old.subarray(0, this.n)); return a; };
        this.x = grow(this.x, Float32Array);
        this.y = grow(this.y, Float32Array);
        this.vx = grow(this.vx, Float32Array);
        this.vy = grow(this.vy, Float32Array);
        this.hue = grow(this.hue, Float32Array);   // palette position of the last body, -1 for none
        this.mem = grow(this.mem, Float32Array);   // 1 = just released, fades to 0
        this.dead = grow(this.dead, Uint8Array);
        this.cap = cap;
        if (this.cellItems && this.cellItems.length < cap) this.cellItems = new Int32Array(cap);
    }

    add(x, y, vx = 0, vy = 0, hue = -1, mem = 0) {
        if (this.n >= this.cap) this.allocate(this.cap * 2);
        const i = this.n++;
        this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
        this.hue[i] = hue; this.mem[i] = mem; this.dead[i] = 0;
        return i;
    }

    // Marked atoms are swept out in compact(), so indices stay valid during a frame.
    kill(i) { this.dead[i] = 1; }

    get alive() {
        let c = 0;
        for (let i = 0; i < this.n; i++) if (!this.dead[i]) c++;
        return c;
    }

    compact() {
        let w = 0;
        for (let r = 0; r < this.n; r++) {
            if (this.dead[r]) continue;
            if (w !== r) {
                this.x[w] = this.x[r]; this.y[w] = this.y[r];
                this.vx[w] = this.vx[r]; this.vy[w] = this.vy[r];
                this.hue[w] = this.hue[r]; this.mem[w] = this.mem[r];
                this.dead[w] = 0;
            }
            w++;
        }
        this.n = w;
    }

    buildGrid(W, H) {
        const cs = this.cellSize;
        this.cols = Math.ceil(W / cs) + 2;
        this.rows = Math.ceil(H / cs) + 2;
        const cells = this.cols * this.rows;
        if (this.cellStart.length < cells + 1) this.cellStart = new Int32Array(cells + 1);
        const start = this.cellStart;
        start.fill(0, 0, cells + 1);
        if (!this._cellOf || this._cellOf.length < this.n) this._cellOf = new Int32Array(this.cap);
        const co = this._cellOf;
        for (let i = 0; i < this.n; i++) {
            const c = this.cellIndex(this.x[i], this.y[i]);
            co[i] = c;
            start[c + 1]++;
        }
        for (let c = 0; c < cells; c++) start[c + 1] += start[c];
        if (!this._fill || this._fill.length < cells + 1) this._fill = new Int32Array(cells + 1);
        const f = this._fill;
        f.set(start.subarray(0, cells + 1));
        for (let i = 0; i < this.n; i++) this.cellItems[f[co[i]]++] = i;
    }

    cellIndex(x, y) {
        const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize) + 1));
        const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize) + 1));
        return cy * this.cols + cx;
    }

    // Calls fn(i, dx, dy, d2) for every live atom within r of (x, y).
    forEachNear(x, y, r, fn) {
        const cs = this.cellSize, r2 = r * r;
        const x0 = Math.max(0, Math.floor((x - r) / cs) + 1), x1 = Math.min(this.cols - 1, Math.floor((x + r) / cs) + 1);
        const y0 = Math.max(0, Math.floor((y - r) / cs) + 1), y1 = Math.min(this.rows - 1, Math.floor((y + r) / cs) + 1);
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const c = cy * this.cols + cx;
                for (let k = this.cellStart[c], end = this.cellStart[c + 1]; k < end; k++) {
                    const i = this.cellItems[k];
                    if (this.dead[i]) continue;
                    const dx = this.x[i] - x, dy = this.y[i] - y, d2 = dx * dx + dy * dy;
                    if (d2 <= r2) fn(i, dx, dy, d2);
                }
            }
        }
    }

    // A push of water, from a click or a birth.
    impulse(x, y, radius, strength) {
        for (let i = 0; i < this.n; i++) {
            const dx = this.x[i] - x, dy = this.y[i] - y, d2 = dx * dx + dy * dy;
            if (d2 > radius * radius || d2 < 1) continue;
            const d = Math.sqrt(d2), f = strength * (1 - d / radius);
            this.vx[i] += dx / d * f;
            this.vy[i] += dy / d * f;
        }
    }

    update(dt, time, W, H, pointer) {
        const flowScale = 0.0017, flowSpeed = 13, relax = Math.min(1, dt * 0.9);
        const jitter = 26 * dt;
        const stir = pointer && pointer.active && pointer.speed > 4;
        const stirR2 = 130 * 130;
        const pad = 24;
        for (let i = 0; i < this.n; i++) {
            if (this.dead[i]) continue;
            let x = this.x[i], y = this.y[i];
            const a = Noise.noise3(x * flowScale, y * flowScale, time * 0.045) * Math.PI * 2.2;
            this.vx[i] += (Math.cos(a) * flowSpeed - this.vx[i]) * relax + (Math.random() - 0.5) * jitter;
            this.vy[i] += (Math.sin(a) * flowSpeed - this.vy[i]) * relax + (Math.random() - 0.5) * jitter;

            if (stir) {
                const dx = x - pointer.x, dy = y - pointer.y, d2 = dx * dx + dy * dy;
                if (d2 < stirR2) {
                    const f = (1 - d2 / stirR2) * 0.5;
                    this.vx[i] += pointer.vx * f * dt * 6;
                    this.vy[i] += pointer.vy * f * dt * 6;
                }
            }

            x += this.vx[i] * dt;
            y += this.vy[i] * dt;
            // The soup wraps around, so no atom is ever lost off the edge of the world.
            if (x < -pad) x += W + pad * 2; else if (x > W + pad) x -= W + pad * 2;
            if (y < -pad) y += H + pad * 2; else if (y > H + pad) y -= H + pad * 2;
            this.x[i] = x; this.y[i] = y;
            if (this.mem[i] > 0) this.mem[i] = Math.max(0, this.mem[i] - dt / 28);
        }
    }

    draw(ctx, time) {
        const mist = Palette.sprite(Palette.current().mist);
        const size = 11;
        const half = size / 2;
        for (let i = 0; i < this.n; i++) {
            if (this.dead[i]) continue;
            const twinkle = 0.72 + 0.28 * Math.sin(time * 1.7 + i * 1.37);
            const m = this.mem[i];
            if (m > 0.04 && this.hue[i] >= 0) {
                ctx.globalAlpha = (0.2 + 0.7 * m) * twinkle;
                const s = size * (1 + m * 0.6);
                ctx.drawImage(Palette.sprite(Palette.colorAt(this.hue[i])), this.x[i] - s / 2, this.y[i] - s / 2, s, s);
            }
            if (m < 0.96) {
                ctx.globalAlpha = 0.34 * (1 - m) * twinkle;
                ctx.drawImage(mist, this.x[i] - half, this.y[i] - half, size, size);
            }
        }
        ctx.globalAlpha = 1;
    }
}
