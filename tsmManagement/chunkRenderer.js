const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt  = require('prismarine-nbt');
const { PNG } = require('pngjs');

// ── Block colour map ──────────────────────────────────────────────────────────
const BLOCK_COLORS = {
    // Stone / ground
    'stone':                [128,128,128], 'granite':              [153,114,99],
    'diorite':              [188,188,188], 'andesite':             [136,136,136],
    'deepslate':            [79,79,90],    'cobblestone':          [120,120,120],
    'bedrock':              [50,50,50],    'gravel':               [140,130,120],
    'sand':                 [220,210,160], 'sandstone':            [210,200,140],
    'red_sand':             [200,120,60],  'red_sandstone':        [190,110,50],
    'clay':                 [160,165,175],

    // Dirt / grass
    'grass_block':          [90,140,60],   'dirt':                 [130,95,70],
    'coarse_dirt':          [120,85,60],   'rooted_dirt':          [120,85,60],
    'podzol':               [110,80,50],   'mycelium':             [130,110,130],
    'farmland':             [110,80,50],   'dirt_path':            [130,100,65],

    // Logs / wood
    'oak_log':              [110,85,55],   'spruce_log':           [80,60,40],
    'birch_log':            [200,195,175], 'jungle_log':           [100,80,50],
    'acacia_log':           [110,75,45],   'dark_oak_log':         [60,40,25],
    'mangrove_log':         [95,55,45],    'cherry_log':           [160,120,110],

    // Leaves
    'oak_leaves':           [60,120,40],   'spruce_leaves':        [45,90,45],
    'birch_leaves':         [80,140,55],   'jungle_leaves':        [50,130,35],
    'acacia_leaves':        [65,115,35],   'dark_oak_leaves':      [40,90,30],
    'mangrove_leaves':      [55,125,40],   'cherry_leaves':        [220,140,160],
    'azalea_leaves':        [70,130,50],

    // Planks
    'oak_planks':           [165,130,80],  'spruce_planks':        [110,85,55],
    'birch_planks':         [210,185,135], 'jungle_planks':        [155,115,70],
    'acacia_planks':        [175,100,55],  'dark_oak_planks':      [70,45,25],

    // Water / liquid
    'water':                [40,80,200],   'lava':                 [220,100,20],

    // Grass / plants
    'grass':                [80,160,50],   'tall_grass':           [75,155,45],
    'fern':                 [65,145,50],   'large_fern':           [60,140,45],
    'dead_bush':            [130,100,55],  'seagrass':             [40,160,100],
    'kelp':                 [35,140,80],

    // Flowers
    'dandelion':            [230,210,50],  'poppy':                [210,40,40],
    'blue_orchid':          [40,180,220],  'allium':               [160,80,180],
    'azure_bluet':          [180,200,240], 'red_tulip':            [200,50,50],
    'orange_tulip':         [230,130,40],  'white_tulip':          [230,230,230],
    'pink_tulip':           [230,160,190], 'oxeye_daisy':          [230,220,190],
    'cornflower':           [80,100,220],  'lily_of_the_valley':   [220,220,220],
    'sunflower':            [240,200,30],  'rose_bush':            [200,60,80],

    // Snow / ice
    'snow':                 [230,240,255], 'snow_block':           [225,235,250],
    'ice':                  [140,190,230], 'packed_ice':           [100,160,220],
    'blue_ice':             [60,130,220],  'frosted_ice':          [120,180,230],

    // Ores
    'coal_ore':             [60,60,60],    'deepslate_coal_ore':   [50,50,55],
    'iron_ore':             [160,130,110], 'deepslate_iron_ore':   [120,100,90],
    'gold_ore':             [220,190,60],  'deepslate_gold_ore':   [180,155,50],
    'diamond_ore':          [80,210,210],  'deepslate_diamond_ore':[60,180,185],
    'emerald_ore':          [50,200,90],   'deepslate_emerald_ore':[40,170,75],
    'lapis_ore':            [50,80,180],   'deepslate_lapis_ore':  [40,65,155],
    'redstone_ore':         [180,40,40],   'deepslate_redstone_ore':[150,30,30],
    'copper_ore':           [180,120,80],  'deepslate_copper_ore': [150,100,65],

    // Nether
    'netherrack':           [130,50,50],   'nether_brick':         [80,30,30],
    'nether_gold_ore':      [200,160,50],  'nether_quartz_ore':    [200,190,185],
    'soul_sand':            [100,80,65],   'soul_soil':            [95,75,60],
    'basalt':               [70,70,80],    'blackstone':           [45,40,50],
    'magma_block':          [200,90,30],   'glowstone':            [230,180,80],
    'shroomlight':          [240,160,60],  'warped_nylium':        [40,150,130],
    'crimson_nylium':       [150,40,60],   'warped_stem':          [40,120,120],
    'crimson_stem':         [120,40,55],

    // End
    'end_stone':            [220,220,160], 'end_stone_bricks':     [210,210,150],
    'purpur_block':         [170,120,170], 'obsidian':             [20,15,30],
    'crying_obsidian':      [30,20,80],

    // Concrete / terracotta / wool
    'white_concrete':       [210,215,220], 'orange_concrete':      [220,110,35],
    'magenta_concrete':     [180,70,175],  'light_blue_concrete':  [80,155,210],
    'yellow_concrete':      [235,185,30],  'lime_concrete':        [100,175,40],
    'pink_concrete':        [215,115,140], 'gray_concrete':        [85,90,95],
    'light_gray_concrete':  [155,160,165], 'cyan_concrete':        [20,135,150],
    'purple_concrete':      [105,40,160],  'blue_concrete':        [40,55,145],
    'brown_concrete':       [100,65,35],   'green_concrete':       [60,90,30],
    'red_concrete':         [150,35,35],   'black_concrete':       [10,10,10],

    'white_wool':           [220,220,220], 'orange_wool':          [220,120,40],
    'yellow_wool':          [220,180,40],  'lime_wool':            [100,180,50],
    'green_wool':           [65,95,40],    'cyan_wool':            [40,140,145],
    'blue_wool':            [50,65,150],   'red_wool':             [165,45,45],
    'black_wool':           [25,25,25],    'white_terracotta':     [200,175,155],
    'orange_terracotta':    [175,90,50],   'yellow_terracotta':    [185,155,70],
    'brown_terracotta':     [100,65,45],   'red_terracotta':       [155,65,55],

    // Misc
    'glass':                [170,210,230], 'glass_pane':           [170,210,230],
    'bookshelf':            [155,125,80],  'crafting_table':       [145,100,65],
    'furnace':              [120,115,110], 'chest':                [165,130,75],
    'tnt':                  [200,60,50],   'pumpkin':              [210,130,40],
    'melon':                [100,160,50],  'hay_block':            [200,175,40],
    'bricks':               [165,95,80],   'mossy_cobblestone':    [100,120,90],
    'sponge':               [200,195,80],  'slime_block':          [90,180,80],
    'honey_block':          [220,160,50],  'target':               [240,200,180],
    'shroomlight':          [240,160,60],

    // Default fallback handled in code
};

const DEFAULT_COLOR = [100, 100, 100];
const AIR_BLOCKS    = new Set(['air','cave_air','void_air','barrier','structure_void']);

function getBlockColor(blockName) {
    const name = blockName.replace('minecraft:', '');
    if (BLOCK_COLORS[name]) return BLOCK_COLORS[name];
    // Fuzzy match suffixes
    for (const key of Object.keys(BLOCK_COLORS)) {
        if (name.includes(key) || key.includes(name)) return BLOCK_COLORS[key];
    }
    return DEFAULT_COLOR;
}

// ── Region file parsing ───────────────────────────────────────────────────────
async function parseRegion(regionPath) {
    const buf = fs.readFileSync(regionPath);
    const chunks = [];

    for (let cz = 0; cz < 32; cz++) {
        for (let cx = 0; cx < 32; cx++) {
            const headerOffset = 4 * (cx + cz * 32);
            const offset = ((buf[headerOffset] << 16) | (buf[headerOffset+1] << 8) | buf[headerOffset+2]) * 4096;
            const sectorCount = buf[headerOffset+3];
            if (offset === 0 || sectorCount === 0) continue;

            try {
                const length      = buf.readUInt32BE(offset);
                const compression = buf[offset + 4];
                const compressed  = buf.slice(offset + 5, offset + 4 + length);

                let data;
                if (compression === 2) data = zlib.inflateSync(compressed);
                else if (compression === 1) data = zlib.gunzipSync(compressed);
                else continue;

                const { parsed } = await nbt.parse(data);
                chunks.push({ cx, cz, nbt: parsed });
            } catch { continue; }
        }
    }
    return chunks;
}

function getTopBlocks(chunkNbt) {
    // Returns 16x16 array of [r,g,b] for top blocks
    const colors = Array.from({ length: 16 }, () => Array(16).fill(DEFAULT_COLOR));
    try {
        const sections = chunkNbt.value?.sections?.value?.value || [];
        const byY = {};
        for (const section of sections) {
            const y = section.Y?.value ?? section.y?.value;
            if (y !== undefined) byY[y] = section;
        }

        const sortedYs = Object.keys(byY).map(Number).sort((a, b) => b - a);

        for (let bx = 0; bx < 16; bx++) {
            for (let bz = 0; bz < 16; bz++) {
                let found = false;
                for (const sectionY of sortedYs) {
                    if (found) break;
                    const section = byY[sectionY];
                    const palette = section.block_states?.value?.palette?.value?.value || section.Palette?.value?.value;
                    const data    = section.block_states?.value?.data?.value || section.BlockStates?.value;
                    if (!palette || !data) continue;

                    const bitsPerEntry = Math.max(4, Math.ceil(Math.log2(palette.length)));
                    const mask = (1n << BigInt(bitsPerEntry)) - 1n;

                    for (let by = 15; by >= 0; by--) {
                        const blockIndex = by * 256 + bz * 16 + bx;
                        const longIndex  = Math.floor(blockIndex * bitsPerEntry / 64);
                        const bitOffset  = BigInt(blockIndex * bitsPerEntry % 64);
                        if (longIndex >= data.length) continue;

                        const longVal     = BigInt(data[longIndex]);
                        const paletteIdx  = Number((longVal >> bitOffset) & mask);
                        const block       = palette[paletteIdx];
                        const blockName   = block?.Name?.value || 'air';

                        if (!AIR_BLOCKS.has(blockName.replace('minecraft:', ''))) {
                            colors[bx][bz] = getBlockColor(blockName);
                            found = true;
                            break;
                        }
                    }
                }
            }
        }
    } catch {}
    return colors;
}

// ── Main render function ──────────────────────────────────────────────────────
async function renderWorld(worldPath, centerX, centerZ, radius) {
    const regionDir = path.join(worldPath, 'region');
    if (!fs.existsSync(regionDir)) return null;

    // Which regions to load
    const regionRadius = Math.ceil(radius / 512);
    const centerRX = Math.floor(centerX / 512);
    const centerRZ = Math.floor(centerZ / 512);

    const chunksPerSide = (regionRadius * 2 + 1) * 32;
    const pixelsPerSide = chunksPerSide * 16;
    const png = new PNG({ width: pixelsPerSide, height: pixelsPerSide });

    // Fill with default dark color
    for (let i = 0; i < pixelsPerSide * pixelsPerSide; i++) {
        png.data[i * 4]     = 30;
        png.data[i * 4 + 1] = 28;
        png.data[i * 4 + 2] = 27;
        png.data[i * 4 + 3] = 255;
    }

    for (let rz = centerRZ - regionRadius; rz <= centerRZ + regionRadius; rz++) {
        for (let rx = centerRX - regionRadius; rx <= centerRX + regionRadius; rx++) {
            const regionFile = path.join(regionDir, `r.${rx}.${rz}.mca`);
            if (!fs.existsSync(regionFile)) continue;

            try {
                const chunks = await parseRegion(regionFile);
                for (const { cx, cz, nbt: chunkNbt } of chunks) {
                    const colors = getTopBlocks(chunkNbt);
                    const globalCX = rx * 32 + cx;
                    const globalCZ = rz * 32 + cz;
                    const pixStartX = (globalCX - (centerRX - regionRadius) * 32) * 16;
                    const pixStartZ = (globalCZ - (centerRZ - regionRadius) * 32) * 16;

                    for (let bx = 0; bx < 16; bx++) {
                        for (let bz = 0; bz < 16; bz++) {
                            const px = pixStartX + bx;
                            const pz = pixStartZ + bz;
                            if (px < 0 || pz < 0 || px >= pixelsPerSide || pz >= pixelsPerSide) continue;
                            const idx = (pz * pixelsPerSide + px) * 4;
                            const [r, g, b] = colors[bx][bz];
                            png.data[idx]     = r;
                            png.data[idx + 1] = g;
                            png.data[idx + 2] = b;
                            png.data[idx + 3] = 255;
                        }
                    }
                }
            } catch (e) { console.error(`Failed to parse region r.${rx}.${rz}.mca:`, e.message); }
        }
    }

    return await new Promise((resolve, reject) => {
        const chunks = [];
        const stream = png.pack();
        stream.on('data', d => chunks.push(d));
        stream.on('end',  () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
}

module.exports = { renderWorld };
