// Every strand carries a real genome: 24 bases = 8 codons, one codon per trait.
// What you see (colour, coil, twist, size) and how it lives (speed, appetite,
// lifespan) are both read straight out of the sequence, so evolution is visible.

const BASES = "ATGC";
const COMPLEMENT = { A: "T", T: "A", G: "C", C: "G" };
const GENOME_LENGTH = 24;
const MUTATION_RATE = 0.018;

const TRAITS = [
    { key: "hue", label: "Colour" },
    { key: "amp", label: "Coil", min: 5, max: 15 },
    { key: "twist", label: "Twist", min: 0.24, max: 0.72 },     // radians per base pair
    { key: "spin", label: "Spin", min: 0.8, max: 2.8 },         // radians per second
    { key: "maxLen", label: "Length", min: 26, max: 84 },       // base pairs
    { key: "lifespan", label: "Lifespan", min: 45, max: 120 },  // seconds
    { key: "speed", label: "Speed", min: 16, max: 50 },         // px per second
    { key: "appetite", label: "Appetite", min: 0.2, max: 1 }
];

const Genome = (() => {
    const CONSONANTS = "bcdfghklmnprstvz";
    const VOWELS = "aeio";
    const GENUS_ENDINGS = ["a", "is", "ora", "ium", "ella", "ux", "ea", "on"];
    const SPECIES_ENDINGS = ["ensis", "ii", "ata", "ica", "oides", "ana", "ifera", "um"];

    function random(len = GENOME_LENGTH) {
        let g = "";
        for (let i = 0; i < len; i++) g += BASES[(Math.random() * 4) | 0];
        return g;
    }

    function codon(g, i) {
        return BASES.indexOf(g[i * 3]) * 16 + BASES.indexOf(g[i * 3 + 1]) * 4 + BASES.indexOf(g[i * 3 + 2]);
    }

    function decode(g) {
        const t = {};
        TRAITS.forEach((trait, i) => {
            const v = codon(g, i) / 63;
            t[trait.key] = trait.min === undefined ? codon(g, i) / 64 : trait.min + v * (trait.max - trait.min);
            t[trait.key + "N"] = v; // normalised 0..1, handy for UI bars and selection pressure
        });
        t.maxLen = Math.round(t.maxLen);
        // Fast swimmers burn out sooner: the trade-off that keeps evolution interesting.
        t.lifespan *= 1.12 - 0.25 * t.speedN;
        return t;
    }

    function mutate(g, rate = MUTATION_RATE) {
        let out = "", count = 0;
        for (let i = 0; i < g.length; i++) {
            if (Math.random() < rate) {
                let b;
                do { b = BASES[(Math.random() * 4) | 0]; } while (b === g[i]);
                out += b; count++;
            } else out += g[i];
        }
        return { genome: out, mutations: count };
    }

    // Single-point crossover on a codon boundary, so whole traits are inherited intact.
    function crossover(a, b) {
        const cut = (1 + Math.floor(Math.random() * (GENOME_LENGTH / 3 - 1))) * 3;
        return Math.random() < 0.5 ? a.slice(0, cut) + b.slice(cut) : b.slice(0, cut) + a.slice(cut);
    }

    function syllable(v) { return CONSONANTS[v >> 2] + VOWELS[v & 3]; }

    // Binomial names grow from the genome, so close relatives share a genus.
    function name(g) {
        const genus = syllable(codon(g, 0)) + syllable(codon(g, 1)).slice(0, 1) + GENUS_ENDINGS[codon(g, 7) & 7];
        const species = syllable(codon(g, 2)) + syllable(codon(g, 4)).slice(0, 1) + SPECIES_ENDINGS[codon(g, 5) & 7];
        return {
            genus: genus[0].toUpperCase() + genus.slice(1),
            species,
            full: genus[0].toUpperCase() + genus.slice(1) + " " + species
        };
    }

    function distance(a, b) {
        let d = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
        return d;
    }

    return { random, decode, mutate, crossover, name, distance, codon };
})();
