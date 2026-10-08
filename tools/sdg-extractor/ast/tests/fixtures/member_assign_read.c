/* Synthetic fixture: one read per device-written surface, plus one read
 * with no provenance. Assignments live in a different function than the
 * reads so the TU-level member index is what connects them.
 */

typedef unsigned int u32;
typedef unsigned long size_t;
typedef unsigned long long u64;

extern void *ioremap(size_t phys, size_t size);
extern void *dma_alloc_coherent(void *dev, size_t size, u64 *handle,
                                unsigned flags);
extern void *virtqueue_get_buf(void *vq, u32 *len);
extern void *memcpy(void *dst, const void *src, size_t n);
extern void *kmalloc(size_t size, unsigned flags);

static u64 handle;
static u32 len;
static void *vq;

u32 read_mmio_surface(void);
u32 read_coherent_surface(void);
u32 read_streaming_surface(void);

struct surfaces {
    void *mmio_base;
    void *coherent_buf;
    void *stream_buf;
    void *plain;
    u32 gate;
    u32 len;
};

static struct surfaces g;

void setup_surfaces(void *dev) {
    g.mmio_base = ioremap(0x1000, 0x200);
    g.coherent_buf = dma_alloc_coherent(dev, 0x100, &handle, 0);
    g.stream_buf = virtqueue_get_buf(vq, &len);
    g.gate = read_mmio_surface();
    g.len = read_coherent_surface();
}

u32 read_mmio_surface(void) {
    return *(volatile u32 *)(g.mmio_base + 8);
}

u32 read_coherent_surface(void) {
    return *(volatile u32 *)g.coherent_buf;
}

u32 read_streaming_surface(void) {
    return *(volatile u32 *)g.stream_buf;
}

u32 read_unproven(void) {
    return *(volatile u32 *)g.plain;
}

/* A guarded read: one surface member gates another (head_guard cross-edge). */
u32 read_gated(void) {
    if (g.gate > 0)
        return g.len;
    return 0;
}

/* A var-vs-var bound (head_bound cross-edge). */
u32 compare_surfaces(void) {
    if (g.len != g.gate)
        return 1;
    return 0;
}

/* Sinks: a surface read used as a size operand of memory-sensitive calls. */
void sink_from_coherent(void *dst, const void *src) {
    u32 n = read_coherent_surface();
    memcpy(dst, src, n);
    memcpy(dst, src, (size_t)n * 2);
}

void *sink_direct_size(void) {
    return kmalloc((size_t)read_coherent_surface(), 0);
}

/* A guarded sink: the device-derived size compared against a bound. */
void sink_guarded(void *dst, const void *src) {
    u32 n = read_coherent_surface();
    if (n > 40)
        memcpy(dst, src, n);
}

/* A mask truth test on a surface read. */
void sink_masked(void *dst, const void *src) {
    u32 n = read_coherent_surface();
    if (n & 0x8)
        memcpy(dst, src, n);
}

/* Feature-bitmap gating: the core copies a device-written bitmap into the
 * device struct; a bit-test helper reads it; a flag set under the gate is
 * tested later, gating its region transitively. */
struct virtio_dev {
    void *config;
    unsigned long long features_array[2];
    u32 version;
};

struct drv_state {
    u32 rss_flag;
    u32 gated_len;
    u32 clamp_len;
    u32 other_len;
};

static struct virtio_dev vd;
static struct drv_state ds;

extern unsigned int virtio_cread32(struct virtio_dev *v, unsigned offset);

/* A bit-test helper over the bitmap member. */
static u32 virtio_has_feature(struct virtio_dev *d, unsigned fbit) {
    return (u32)((d->features_array[fbit / 64] >> (fbit % 64)) & 1);
}

/* Core: the bitmap member inherits the device-written surface. */
void core_init(void *dev) {
    unsigned long long device_features[2];
    device_features[0] =
        (unsigned long long)dma_alloc_coherent(dev, 0x10, &handle, 0);
    vd.features_array[0] = device_features[0] & device_features[0];
}

/* Flag set under a feature-bit gate; the flag test gates its region
 * transitively; a clamp bounds the member; a bounded var-vs-var degrades
 * to a constant boundary. */
void drv_probe(void) {
    if (virtio_has_feature(&vd, 60))
        ds.rss_flag = 1;
    if (ds.rss_flag)
        ds.gated_len = read_coherent_surface();

    u32 key = read_coherent_surface();
    ds.clamp_len = ({ u32 ux = key; u32 uy = 256; ux < uy ? ux : uy; });
    if (key > ds.clamp_len)
        ds.gated_len = key;

    ds.other_len =
        virtio_cread32(&vd, __builtin_offsetof(struct drv_state, other_len));

    /* A bounded loop counter indexing an array: an offset fact. */
    unsigned long long table[4];
    unsigned long long src[2] = {1, 2};
    for (unsigned i = 0; i < 4; ++i)
        table[i] = src[i & 1];
}


