/* Catalog surface fixture: one read per device-written surface.
 *
 * Three surfaces, no protocol tables: the extractor classifies each read by
 * the provenance of its base address.
 *   - mmio:    an ioremap mapping read through an accessor argument
 *   - coherent: a dma_alloc_coherent buffer read back
 *   - streaming: a buffer the device wrote into, read via a virtqueue call
 */

typedef unsigned int u32;
typedef unsigned long long u64;
typedef unsigned long size_t;

__attribute__((noinline))
static u32 readl(volatile void *addr) {
    return *(volatile u32 *)addr;
}

extern void *ioremap(unsigned long phys, unsigned long size);
extern void *dma_alloc_coherent(void *dev, size_t size, u64 *handle,
                                unsigned flags);
extern void *virtqueue_get_buf(void *vq, u32 *len);

struct surface_state {
    void *mmio_base;
    u64 handle;
};

static struct surface_state st;

u32 read_mmio_surface(unsigned long phys) {
    st.mmio_base = ioremap(phys, 0x200);
    return readl(st.mmio_base + 0x8);
}

u32 read_coherent_surface(void *dev) {
    u32 *buf = (u32 *)dma_alloc_coherent(dev, 0x100, &st.handle, 0);
    return *buf;
}

u32 read_streaming_surface(void *vq) {
    u32 len;
    u32 *buf = (u32 *)virtqueue_get_buf(vq, &len);
    return *buf;
}

u32 read_stack(void) {
    u32 local = 7;
    return local;
}
