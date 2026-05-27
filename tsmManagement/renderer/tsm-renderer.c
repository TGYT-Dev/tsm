/*
 * tsm-renderer.c
 * Fast top-down Minecraft world renderer.
 * Reads .mca region files, extracts top block per column, outputs PNG.
 *
 * Build:
 *   gcc -O2 -o tsm-renderer tsm-renderer.c -lz -lpng -lm
 *
 * Usage:
 *   ./tsm-renderer <world_dir> <center_x> <center_z> <radius_regions> <output.png>
 *
 * Dependencies: zlib, libpng
 *   sudo pacman -S zlib libpng
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <dirent.h>
#include <sys/stat.h>
#include <zlib.h>
#include <png.h>

/* ── Colour map ────────────────────────────────────────────────────────────── */
typedef struct { const char *name; uint8_t r, g, b; } BlockColor;

static const BlockColor BLOCK_COLORS[] = {
    /* Stone / ground */
    {"stone",                128,128,128}, {"granite",              153,114, 99},
    {"diorite",              188,188,188}, {"andesite",             136,136,136},
    {"deepslate",             79, 79, 90}, {"cobblestone",          120,120,120},
    {"bedrock",               50, 50, 50}, {"gravel",               140,130,120},
    {"sand",                 220,210,160}, {"sandstone",            210,200,140},
    {"red_sand",             200,120, 60}, {"red_sandstone",        190,110, 50},
    {"clay",                 160,165,175},
    /* Dirt / grass */
    {"grass_block",           90,140, 60}, {"dirt",                 130, 95, 70},
    {"coarse_dirt",          120, 85, 60}, {"podzol",               110, 80, 50},
    {"mycelium",             130,110,130}, {"farmland",             110, 80, 50},
    {"dirt_path",            130,100, 65}, {"rooted_dirt",          120, 85, 60},
    /* Logs */
    {"oak_log",              110, 85, 55}, {"spruce_log",            80, 60, 40},
    {"birch_log",            200,195,175}, {"jungle_log",           100, 80, 50},
    {"acacia_log",           110, 75, 45}, {"dark_oak_log",          60, 40, 25},
    {"mangrove_log",          95, 55, 45}, {"cherry_log",           160,120,110},
    /* Leaves */
    {"oak_leaves",            60,120, 40}, {"spruce_leaves",         45, 90, 45},
    {"birch_leaves",          80,140, 55}, {"jungle_leaves",         50,130, 35},
    {"acacia_leaves",         65,115, 35}, {"dark_oak_leaves",       40, 90, 30},
    {"mangrove_leaves",       55,125, 40}, {"cherry_leaves",        220,140,160},
    {"azalea_leaves",         70,130, 50},
    /* Planks */
    {"oak_planks",           165,130, 80}, {"spruce_planks",        110, 85, 55},
    {"birch_planks",         210,185,135}, {"jungle_planks",        155,115, 70},
    {"acacia_planks",        175,100, 55}, {"dark_oak_planks",       70, 45, 25},
    /* Water / lava */
    {"water",                 40, 80,200}, {"lava",                 220,100, 20},
    /* Grass / plants */
    {"grass",                 80,160, 50}, {"tall_grass",            75,155, 45},
    {"fern",                  65,145, 50}, {"seagrass",              40,160,100},
    {"kelp",                  35,140, 80}, {"dead_bush",            130,100, 55},
    /* Snow / ice */
    {"snow",                 230,240,255}, {"snow_block",           225,235,250},
    {"ice",                  140,190,230}, {"packed_ice",           100,160,220},
    {"blue_ice",              60,130,220},
    /* Ores */
    {"coal_ore",              60, 60, 60}, {"iron_ore",             160,130,110},
    {"gold_ore",             220,190, 60}, {"diamond_ore",           80,210,210},
    {"emerald_ore",           50,200, 90}, {"lapis_ore",             50, 80,180},
    {"redstone_ore",         180, 40, 40}, {"copper_ore",           180,120, 80},
    {"deepslate_coal_ore",    50, 50, 55}, {"deepslate_iron_ore",   120,100, 90},
    {"deepslate_gold_ore",   180,155, 50}, {"deepslate_diamond_ore", 60,180,185},
    {"deepslate_emerald_ore", 40,170, 75}, {"deepslate_lapis_ore",   40, 65,155},
    {"deepslate_redstone_ore",150, 30, 30},{"deepslate_copper_ore", 150,100, 65},
    /* Nether */
    {"netherrack",           130, 50, 50}, {"nether_brick",          80, 30, 30},
    {"soul_sand",            100, 80, 65}, {"soul_soil",             95, 75, 60},
    {"basalt",                70, 70, 80}, {"blackstone",            45, 40, 50},
    {"magma_block",          200, 90, 30}, {"glowstone",            230,180, 80},
    {"shroomlight",          240,160, 60}, {"warped_nylium",         40,150,130},
    {"crimson_nylium",       150, 40, 60}, {"warped_stem",           40,120,120},
    {"crimson_stem",         120, 40, 55},
    /* End */
    {"end_stone",            220,220,160}, {"purpur_block",         170,120,170},
    {"obsidian",              20, 15, 30}, {"crying_obsidian",       30, 20, 80},
    /* Concrete */
    {"white_concrete",       210,215,220}, {"orange_concrete",      220,110, 35},
    {"yellow_concrete",      235,185, 30}, {"lime_concrete",        100,175, 40},
    {"green_concrete",        60, 90, 30}, {"cyan_concrete",         20,135,150},
    {"blue_concrete",         40, 55,145}, {"red_concrete",         150, 35, 35},
    {"black_concrete",        10, 10, 10}, {"gray_concrete",         85, 90, 95},
    {"light_gray_concrete",  155,160,165}, {"pink_concrete",        215,115,140},
    {"magenta_concrete",     180, 70,175}, {"light_blue_concrete",   80,155,210},
    {"purple_concrete",      105, 40,160}, {"brown_concrete",       100, 65, 35},
    /* Wool */
    {"white_wool",           220,220,220}, {"orange_wool",          220,120, 40},
    {"yellow_wool",          220,180, 40}, {"lime_wool",            100,180, 50},
    {"green_wool",            65, 95, 40}, {"cyan_wool",             40,140,145},
    {"blue_wool",             50, 65,150}, {"red_wool",             165, 45, 45},
    {"black_wool",            25, 25, 25},
    /* Terracotta */
    {"terracotta",           170,120, 90}, {"white_terracotta",     200,175,155},
    {"orange_terracotta",    175, 90, 50}, {"yellow_terracotta",    185,155, 70},
    {"brown_terracotta",     100, 65, 45}, {"red_terracotta",       155, 65, 55},
    /* Misc */
    {"glass",                170,210,230}, {"bookshelf",            155,125, 80},
    {"crafting_table",       145,100, 65}, {"chest",                165,130, 75},
    {"tnt",                  200, 60, 50}, {"pumpkin",              210,130, 40},
    {"melon",                100,160, 50}, {"hay_block",            200,175, 40},
    {"bricks",               165, 95, 80}, {"sponge",               200,195, 80},
    {"slime_block",           90,180, 80}, {"honey_block",          220,160, 50},
    {"netherite_block",       60, 55, 60}, {"ancient_debris",       100, 75, 65},
    {"moss_block",            80,120, 55}, {"mud",                   90, 75, 70},
    {"packed_mud",           130,105, 80}, {"mud_bricks",           140,110, 85},
    {"bamboo_block",         170,160, 60}, {"mangrove_roots",        85, 65, 50},
    {"sculk",                 25, 55, 65}, {"sculk_catalyst",        30, 60, 70},
    {"calcite",              215,215,215}, {"tuff",                 110,110,105},
    {"dripstone_block",      155,135,120}, {"amethyst_block",       145, 90,175},
    {"raw_iron_block",       185,155,115}, {"raw_gold_block",       220,185, 80},
    {"raw_copper_block",     175,120, 80}, {"copper_block",         165,115, 75},
    {"target",               240,200,180},
    {NULL, 0, 0, 0}
};

static const uint8_t AIR_COLOR[3] = {30, 28, 27};

/* ── NBT minimal parser ────────────────────────────────────────────────────── */
/* We only need block palette names and block states data arrays.
 * Full NBT spec: https://wiki.vg/NBT
 * Tag types: 1=byte 2=short 3=int 4=long 5=float 6=double
 *            7=byte[] 8=string 9=list 10=compound 11=int[] 12=long[]
 */

typedef struct {
    const uint8_t *data;
    size_t         len;
    size_t         pos;
} NBTReader;

static int nbt_read_byte(NBTReader *r, uint8_t *out) {
    if (r->pos >= r->len) return -1;
    *out = r->data[r->pos++];
    return 0;
}

static int nbt_read_short(NBTReader *r, int16_t *out) {
    if (r->pos + 2 > r->len) return -1;
    *out = (int16_t)((r->data[r->pos] << 8) | r->data[r->pos+1]);
    r->pos += 2;
    return 0;
}

static int nbt_read_int(NBTReader *r, int32_t *out) {
    if (r->pos + 4 > r->len) return -1;
    *out = ((int32_t)r->data[r->pos]   << 24) |
           ((int32_t)r->data[r->pos+1] << 16) |
           ((int32_t)r->data[r->pos+2] <<  8) |
            (int32_t)r->data[r->pos+3];
    r->pos += 4;
    return 0;
}

static int nbt_read_long(NBTReader *r, int64_t *out) {
    if (r->pos + 8 > r->len) return -1;
    *out = 0;
    for (int i = 0; i < 8; i++)
        *out = (*out << 8) | r->data[r->pos+i];
    r->pos += 8;
    return 0;
}

static int nbt_read_string(NBTReader *r, char *out, size_t max_len) {
    int16_t slen;
    if (nbt_read_short(r, &slen) < 0 || slen < 0) return -1;
    size_t n = (size_t)slen;
    if (r->pos + n > r->len) return -1;
    if (out && n < max_len) { memcpy(out, r->data + r->pos, n); out[n] = '\0'; }
    r->pos += n;
    return (int)n;
}

static int nbt_skip_payload(NBTReader *r, uint8_t type);

static int nbt_skip_compound(NBTReader *r) {
    for (;;) {
        uint8_t type;
        if (nbt_read_byte(r, &type) < 0) return -1;
        if (type == 0) return 0; /* TAG_End */
        char name[256];
        if (nbt_read_string(r, name, sizeof(name)) < 0) return -1;
        if (nbt_skip_payload(r, type) < 0) return -1;
    }
}

static int nbt_skip_payload(NBTReader *r, uint8_t type) {
    switch (type) {
        case 1: { uint8_t v; return nbt_read_byte(r, &v); }
        case 2: { int16_t v; return nbt_read_short(r, &v); }
        case 3: { int32_t v; return nbt_read_int(r, &v); }
        case 4: { int64_t v; return nbt_read_long(r, &v); }
        case 5: r->pos += 4; return (r->pos <= r->len) ? 0 : -1;
        case 6: r->pos += 8; return (r->pos <= r->len) ? 0 : -1;
        case 7: { int32_t n; if (nbt_read_int(r, &n) < 0) return -1; r->pos += n; return (r->pos <= r->len) ? 0 : -1; }
        case 8: return nbt_read_string(r, NULL, 0) >= 0 ? 0 : -1;
        case 9: {
            uint8_t elem_type; if (nbt_read_byte(r, &elem_type) < 0) return -1;
            int32_t count;     if (nbt_read_int(r, &count) < 0) return -1;
            for (int32_t i = 0; i < count; i++)
                if (nbt_skip_payload(r, elem_type) < 0) return -1;
            return 0;
        }
        case 10: return nbt_skip_compound(r);
        case 11: { int32_t n; if (nbt_read_int(r, &n) < 0) return -1; r->pos += n * 4; return (r->pos <= r->len) ? 0 : -1; }
        case 12: { int32_t n; if (nbt_read_int(r, &n) < 0) return -1; r->pos += n * 8; return (r->pos <= r->len) ? 0 : -1; }
        default: return -1;
    }
}

/* ── Block colour lookup ────────────────────────────────────────────────────── */
static void get_block_color(const char *name, uint8_t *r, uint8_t *g, uint8_t *b) {
    /* Strip minecraft: prefix */
    const char *n = strstr(name, ":") ? strstr(name, ":") + 1 : name;

    /* Skip air */
    if (strcmp(n, "air") == 0 || strcmp(n, "cave_air") == 0 ||
        strcmp(n, "void_air") == 0 || strcmp(n, "barrier") == 0) {
        *r = *g = *b = 0; return;
    }

    /* Exact match */
    for (int i = 0; BLOCK_COLORS[i].name; i++) {
        if (strcmp(BLOCK_COLORS[i].name, n) == 0) {
            *r = BLOCK_COLORS[i].r; *g = BLOCK_COLORS[i].g; *b = BLOCK_COLORS[i].b;
            return;
        }
    }

    /* Partial suffix match (e.g. "chiseled_stone_bricks" → "stone") */
    for (int i = 0; BLOCK_COLORS[i].name; i++) {
        if (strstr(n, BLOCK_COLORS[i].name)) {
            *r = BLOCK_COLORS[i].r; *g = BLOCK_COLORS[i].g; *b = BLOCK_COLORS[i].b;
            return;
        }
    }

    /* Default grey */
    *r = 100; *g = 100; *b = 100;
}

/* ── Chunk processing ───────────────────────────────────────────────────────── */
#define MAX_PALETTE 512
#define MAX_SECTIONS 32

typedef struct {
    char   names[MAX_PALETTE][128];
    int    count;
    int64_t *data;
    int     data_len;
    int     y;
} Section;

static int parse_sections(NBTReader *r, Section sections[], int *nsections) {
    *nsections = 0;

    /* We expect to be positioned at the start of the root compound payload */
    /* Navigate: root -> sections list */
    for (;;) {
        uint8_t type;
        if (nbt_read_byte(r, &type) < 0) return -1;
        if (type == 0) return 0;

        char name[256];
        if (nbt_read_string(r, name, sizeof(name)) < 0) return -1;

        if (type == 9 && strcmp(name, "sections") == 0) {
            uint8_t elem_type;
            if (nbt_read_byte(r, &elem_type) < 0 || elem_type != 10) return -1;
            int32_t count;
            if (nbt_read_int(r, &count) < 0) return -1;

            for (int32_t s = 0; s < count && *nsections < MAX_SECTIONS; s++) {
                Section *sec = &sections[*nsections];
                sec->count    = 0;
                sec->data     = NULL;
                sec->data_len = 0;
                sec->y        = -99;

                /* Parse compound section */
                int found_y = 0, found_bs = 0;
                for (;;) {
                    uint8_t ft;
                    if (nbt_read_byte(r, &ft) < 0) return -1;
                    if (ft == 0) break;

                    char fn[256];
                    if (nbt_read_string(r, fn, sizeof(fn)) < 0) return -1;

                    if (ft == 1 && strcmp(fn, "Y") == 0) {
                        uint8_t yv;
                        if (nbt_read_byte(r, &yv) < 0) return -1;
                        sec->y = (int8_t)yv;
                        found_y = 1;
                    } else if (ft == 10 && strcmp(fn, "block_states") == 0) {
                        /* block_states compound: palette list + data long[] */
                        for (;;) {
                            uint8_t bt;
                            if (nbt_read_byte(r, &bt) < 0) return -1;
                            if (bt == 0) break;
                            char bn[256];
                            if (nbt_read_string(r, bn, sizeof(bn)) < 0) return -1;

                            if (bt == 9 && strcmp(bn, "palette") == 0) {
                                uint8_t pet;
                                if (nbt_read_byte(r, &pet) < 0 || pet != 10) { nbt_skip_payload(r, 9); continue; }
                                int32_t pc;
                                if (nbt_read_int(r, &pc) < 0) return -1;
                                sec->count = (pc < MAX_PALETTE) ? pc : MAX_PALETTE;
                                for (int32_t pi = 0; pi < pc; pi++) {
                                    /* Each palette entry is a compound with at least Name */
                                    char block_name[128] = "";
                                    for (;;) {
                                        uint8_t et;
                                        if (nbt_read_byte(r, &et) < 0) return -1;
                                        if (et == 0) break;
                                        char en[256];
                                        if (nbt_read_string(r, en, sizeof(en)) < 0) return -1;
                                        if (et == 8 && strcmp(en, "Name") == 0) {
                                            nbt_read_string(r, block_name, sizeof(block_name));
                                        } else {
                                            nbt_skip_payload(r, et);
                                        }
                                    }
                                    if (pi < MAX_PALETTE)
                                        snprintf(sec->names[pi], sizeof(sec->names[pi]), "%s", block_name);
                                }
                            } else if (bt == 12 && strcmp(bn, "data") == 0) {
                                int32_t dl;
                                if (nbt_read_int(r, &dl) < 0) return -1;
                                sec->data = malloc(dl * sizeof(int64_t));
                                sec->data_len = dl;
                                if (!sec->data) return -1;
                                for (int32_t di = 0; di < dl; di++) {
                                    if (nbt_read_long(r, &sec->data[di]) < 0) return -1;
                                }
                                found_bs = 1;
                            } else {
                                if (nbt_skip_payload(r, bt) < 0) return -1;
                            }
                        }
                    } else {
                        if (nbt_skip_payload(r, ft) < 0) return -1;
                    }
                }

                if (found_y && found_bs && sec->count > 0 && sec->data_len > 0)
                    (*nsections)++;
                else if (sec->data) { free(sec->data); sec->data = NULL; }
            }
        } else {
            if (nbt_skip_payload(r, type) < 0) return -1;
        }
    }
}

static void get_top_blocks(Section sections[], int nsections, uint8_t out_r[16][16], uint8_t out_g[16][16], uint8_t out_b[16][16]) {
    /* Sort sections by Y descending */
    for (int i = 0; i < nsections - 1; i++)
        for (int j = i + 1; j < nsections; j++)
            if (sections[j].y > sections[i].y) {
                Section tmp = sections[i]; sections[i] = sections[j]; sections[j] = tmp;
            }

    int done[16][16];
    memset(done, 0, sizeof(done));

    for (int bx = 0; bx < 16; bx++)
        for (int bz = 0; bz < 16; bz++) {
            out_r[bx][bz] = AIR_COLOR[0];
            out_g[bx][bz] = AIR_COLOR[1];
            out_b[bx][bz] = AIR_COLOR[2];
        }

    for (int si = 0; si < nsections; si++) {
        Section *sec = &sections[si];
        int bpe = (sec->count <= 1) ? 1 : (int)ceil(log2((double)sec->count));
        if (bpe < 4) bpe = 4;
        int64_t mask = (1LL << bpe) - 1;

        for (int bx = 0; bx < 16; bx++) {
            for (int bz = 0; bz < 16; bz++) {
                if (done[bx][bz]) continue;
                for (int by = 15; by >= 0; by--) {
                    int block_idx = by * 256 + bz * 16 + bx;
                    int blocks_per_long = 64 / bpe;
                    int long_idx  = block_idx / blocks_per_long;
                    int bit_off   = (block_idx % blocks_per_long) * bpe;

                    if (long_idx >= sec->data_len) continue;

                    int palette_idx = (int)((sec->data[long_idx] >> bit_off) & mask);

                    if (palette_idx < 0 || palette_idx >= sec->count) continue;

                    const char *bname = sec->names[palette_idx];
                    const char *bn    = strstr(bname, ":") ? strstr(bname, ":") + 1 : bname;

                    if (strcmp(bn, "air") == 0 || strcmp(bn, "cave_air") == 0 ||
                        strcmp(bn, "void_air") == 0) continue;

                    uint8_t r, g, b;
                    get_block_color(bname, &r, &g, &b);
                    out_r[bx][bz] = r;
                    out_g[bx][bz] = g;
                    out_b[bx][bz] = b;
                    done[bx][bz] = 1;
                    break;
                }
            }
        }
        if (si > 0) {
            int all_done = 1;
            for (int bx = 0; bx < 16 && all_done; bx++)
                for (int bz = 0; bz < 16 && all_done; bz++)
                    if (!done[bx][bz]) all_done = 0;
            if (all_done) break;
        }
    }
}

/* ── Region file processing ─────────────────────────────────────────────────── */
static int process_region(const char *region_path, int reg_rx, int reg_rz,
                           int img_origin_cx, int img_origin_cz,
                           int img_chunks_wide,
                           uint8_t *pixels, int img_width) {
    FILE *f = fopen(region_path, "rb");
    if (!f) return 0;

    fseek(f, 0, SEEK_END);
    long fsize = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (fsize < 8192) { fclose(f); return 0; }

    uint8_t *fbuf = malloc(fsize);
    if (!fbuf) { fclose(f); return 0; }
    fread(fbuf, 1, fsize, f);
    fclose(f);

    for (int cz = 0; cz < 32; cz++) {
        for (int cx = 0; cx < 32; cx++) {
            int hi = 4 * (cx + cz * 32);
            int offset = ((fbuf[hi] << 16) | (fbuf[hi+1] << 8) | fbuf[hi+2]) * 4096;
            int sectors = fbuf[hi+3];
            if (offset == 0 || sectors == 0 || offset + 5 > fsize) continue;

            int data_len = ((int)fbuf[offset] << 24) | ((int)fbuf[offset+1] << 16) |
                           ((int)fbuf[offset+2] << 8) | fbuf[offset+3];
            int compression = fbuf[offset+4];
            if (compression != 2 && compression != 1) continue;
            if (offset + 5 + data_len - 1 > fsize) continue;

            /* Decompress */
            uLongf dest_len = 1024 * 1024 * 2; /* 2MB max decompressed */
            uint8_t *decompressed = malloc(dest_len);
            if (!decompressed) continue;

            int zret;
            if (compression == 2) {
                zret = uncompress(decompressed, &dest_len, fbuf + offset + 5, data_len - 1);
            } else {
                z_stream zs = {0};
                inflateInit2(&zs, 16 + MAX_WBITS);
                zs.next_in  = fbuf + offset + 5;
                zs.avail_in = data_len - 1;
                zs.next_out = decompressed;
                zs.avail_out = dest_len;
                zret = inflate(&zs, Z_FINISH);
                dest_len = dest_len - zs.avail_out;
                inflateEnd(&zs);
                zret = (zret == Z_STREAM_END) ? Z_OK : Z_DATA_ERROR;
            }

            if (zret != Z_OK) { free(decompressed); continue; }

            /* Skip NBT root tag header (type 10 + name) */
            NBTReader r = { decompressed, dest_len, 0 };
            uint8_t root_type;
            if (nbt_read_byte(&r, &root_type) < 0 || root_type != 10) { free(decompressed); continue; }
            nbt_read_string(&r, NULL, 0); /* skip root name */

            Section sections[MAX_SECTIONS];
            int nsections = 0;
            parse_sections(&r, sections, &nsections);
            free(decompressed);

            if (nsections == 0) continue;

            uint8_t top_r[16][16], top_g[16][16], top_b[16][16];
            get_top_blocks(sections, nsections, top_r, top_g, top_b);

            for (int si = 0; si < nsections; si++)
                if (sections[si].data) free(sections[si].data);

            /* Place into image */
            int global_cx = reg_rx * 32 + cx;
            int global_cz = reg_rz * 32 + cz;
            int pix_x0 = (global_cx - img_origin_cx) * 16;
            int pix_z0 = (global_cz - img_origin_cz) * 16;

            for (int bx = 0; bx < 16; bx++) {
                for (int bz = 0; bz < 16; bz++) {
                    int px = pix_x0 + bx;
                    int pz = pix_z0 + bz;
                    if (px < 0 || pz < 0 || px >= img_width || pz >= img_width) continue;
                    int idx = (pz * img_width + px) * 3;
                    pixels[idx]     = top_r[bx][bz];
                    pixels[idx + 1] = top_g[bx][bz];
                    pixels[idx + 2] = top_b[bx][bz];
                }
            }
        }
    }

    free(fbuf);
    return 1;
}

/* ── PNG output ─────────────────────────────────────────────────────────────── */
static int write_png(const char *path, uint8_t *pixels, int width, int height) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;

    png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, NULL, NULL);
    png_infop   info = png_create_info_struct(png);
    if (setjmp(png_jmpbuf(png))) { fclose(f); return -1; }

    png_init_io(png, f);
    png_set_IHDR(png, info, width, height, 8, PNG_COLOR_TYPE_RGB,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_write_info(png, info);

    for (int y = 0; y < height; y++)
        png_write_row(png, pixels + y * width * 3);

    png_write_end(png, NULL);
    png_destroy_write_struct(&png, &info);
    fclose(f);
    return 0;
}

/* ── Main ───────────────────────────────────────────────────────────────────── */
int main(int argc, char *argv[]) {
    if (argc < 6) {
        fprintf(stderr, "Usage: %s <world_dir> <center_x> <center_z> <radius_regions> <output.png>\n", argv[0]);
        return 1;
    }

    const char *world_dir  = argv[1];
    int         center_x   = atoi(argv[2]);
    int         center_z   = atoi(argv[3]);
    int         radius     = atoi(argv[4]);
    const char *output_png = argv[5];

    if (radius < 1) radius = 1;
    if (radius > 4) radius = 4;

    /* Compute region range */
    int center_rx = (int)floor((double)center_x / 512.0);
    int center_rz = (int)floor((double)center_z / 512.0);
    int r0x = center_rx - radius, r1x = center_rx + radius;
    int r0z = center_rz - radius, r1z = center_rz + radius;

    /* Image dimensions in chunks */
    int chunks_wide = (r1x - r0x + 1) * 32;
    int img_width   = chunks_wide * 16;

    uint8_t *pixels = calloc(img_width * img_width * 3, 1);
    if (!pixels) { fprintf(stderr, "Out of memory\n"); return 1; }

    /* Fill background */
    for (int i = 0; i < img_width * img_width * 3; i += 3) {
        pixels[i]     = AIR_COLOR[0];
        pixels[i + 1] = AIR_COLOR[1];
        pixels[i + 2] = AIR_COLOR[2];
    }

    char region_dir[1024];
    snprintf(region_dir, sizeof(region_dir), "%s/region", world_dir);

    int origin_cx = r0x * 32;
    int origin_cz = r0z * 32;

    for (int rz = r0z; rz <= r1z; rz++) {
        for (int rx = r0x; rx <= r1x; rx++) {
            char path[2048];
            snprintf(path, sizeof(path), "%s/r.%d.%d.mca", region_dir, rx, rz);
            struct stat st;
            if (stat(path, &st) < 0) continue;
            fprintf(stderr, "Rendering region r.%d.%d.mca\n", rx, rz);
            process_region(path, rx, rz, origin_cx, origin_cz, chunks_wide, pixels, img_width);
        }
    }

    int ret = write_png(output_png, pixels, img_width, img_width);
    free(pixels);

    if (ret < 0) { fprintf(stderr, "Failed to write PNG\n"); return 1; }
    fprintf(stderr, "Wrote %dx%d PNG to %s\n", img_width, img_width, output_png);
    return 0;
}
