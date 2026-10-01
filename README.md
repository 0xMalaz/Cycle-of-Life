# The Cycle of Life

Visualization of the cycle of life and the chaos inside the living. Atoms represented by circles are constantly constructing DNAs by forming a sine wave together, spending their lifetime, and finally, vanish only to be replaced by new atoms to complete the cycle of life.

Implemented using [P5.js](https://p5js.org/) library. Currently using [P5.gui](https://github.com/bitcraftlab/p5.gui) for UI.

- [Live Demo](http://creative.bflows.io/)

## Reborn

`reborn/` is a reimagining of the sketch as a living ecosystem. Open `reborn/index.html` (or serve the folder with `python -m http.server` and visit `/reborn/`).

- Every strand carries a 24-base genome. Its colour, coil, twist, spin, length, lifespan, speed and appetite are all read from the sequence.
- Strands eat free atoms to build their bodies one base pair at a time, pair up to have children (crossover plus mutation), and unzip when they die.
- The world is closed: a fixed number of atoms moves between the soup and living bodies, and the HUD keeps the ledger.
- Families rise and fall in a live "Houses over time" chart, and evolution shows up as drift in the population's average traits.
- A field journal narrates what happens. Add an Anthropic API key and Claude writes the entries from a factual snapshot of the world.
- With sound on, each base pair plays a note from its letter. A, T, G and C map onto a pentatonic scale.

Keys: `1`–`5` palettes · `Space` pause · `[` `]` speed · `M` sound · `J` journal · `H` hide UI · `S` still · `R` record video · `N` new world · `T` trails · `F` fullscreen

## Technical Details

To be written

## Usage

You can either try out the parameters provided in UI or edit the code yourself by cloning the repo. Open the html file in your browser to see the sketch

## To Record Your Sketch

Take a look at sketches/sketchRecording.js for exacty same code with a recording option. Refer to [this article](https://medium.com/swlh/video-export-from-p5-js-sketch-1b9b6287801a) for the recording process.
