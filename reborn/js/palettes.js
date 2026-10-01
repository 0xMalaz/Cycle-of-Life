// The five palettes from the original sketch, names and all.
// `bg` is the deep water the strands swim in; `mist` tints the free atoms
// once they have forgotten which body they came from.

const PALETTES = [
    {
        name: "Neon Knights",
        colors: ["#f72585", "#b5179e", "#7209b7", "#560bad", "#480ca8", "#3a0ca3", "#3f37c9", "#4361ee", "#4895ef", "#4cc9f0"],
        bg: [6, 4, 18], mist: "#8d8fd6"
    },
    {
        name: "Soft Touch",
        colors: ["#95998A", "#BDCC94", "#FFEC67", "#FFFFFF", "#A9B6CC"],
        bg: [9, 10, 9], mist: "#a3a89a"
    },
    {
        name: "ATGS",
        colors: ["#6060FF", "#FEFE00", "#3EFB00", "#F82620", "#B45A00"],
        bg: [3, 3, 8], mist: "#7d7d9c"
    },
    {
        name: "Child's Play",
        colors: ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#073b4c"],
        bg: [4, 12, 16], mist: "#7fb3c4"
    },
    {
        name: "Dracula",
        colors: ["#053c5e", "#1d3958", "#353652", "#4c334d", "#643047", "#7c2e41", "#942b3b", "#ab2836", "#c32530", "#db222a"],
        bg: [10, 3, 6], mist: "#9a5a66"
    }
];

const Palette = (() => {
    let index = 0;
    const listeners = [];
    const spriteCache = new Map();

    function current() { return PALETTES[index]; }

    function set(i) {
        index = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length;
        listeners.forEach(fn => fn(current()));
    }

    // Genes store a position in [0, 1); the palette decides which colour that is.
    // Swapping palettes recolours every living thing while keeping families together.
    function colorAt(t) {
        const c = current().colors;
        return c[Math.min(c.length - 1, Math.floor(t * c.length))];
    }

    // Four rung colours for A, T, G, C, spread across the palette.
    function baseColors() {
        const c = current().colors;
        return [0, 1, 2, 3].map(k => c[Math.floor((k + 0.5) * c.length / 4)]);
    }

    function hexToRgb(hex) {
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // A soft glowing disc, pre-rendered once per colour and stamped with drawImage.
    function sprite(hex) {
        let s = spriteCache.get(hex);
        if (s) return s;
        const size = 64;
        s = document.createElement("canvas");
        s.width = s.height = size;
        const g = s.getContext("2d");
        const [r, gr, b] = hexToRgb(hex);
        // Lift very dark palette entries so they still read against the water.
        const lift = v => Math.round(v + (255 - v) * 0.18);
        const rgb = `${lift(r)},${lift(gr)},${lift(b)}`;
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, `rgba(255,255,255,1)`);
        grad.addColorStop(0.12, `rgba(${rgb},1)`);
        grad.addColorStop(0.28, `rgba(${rgb},0.55)`);
        grad.addColorStop(0.55, `rgba(${rgb},0.12)`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        spriteCache.set(hex, s);
        return s;
    }

    return {
        current, set, colorAt, baseColors, sprite, hexToRgb,
        get index() { return index; },
        onChange: fn => listeners.push(fn)
    };
})();
