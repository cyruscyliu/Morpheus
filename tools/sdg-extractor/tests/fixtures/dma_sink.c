/* Fixture: MMIO read flows into a sink (kmalloc) size argument. */

typedef unsigned int u32;
typedef unsigned long size_t;

__attribute__((noinline))
static u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

extern void *ioremap(unsigned long phys, unsigned long size);

struct virtio_mmio_device {
    void *base;
};

static struct virtio_mmio_device vm_dev;


void *kmalloc(size_t size);

int probe(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 n = readl(base + 0x034); /* queue_size_max */
    if (n > 4096)
        return -1;
    // The sink size is an arithmetic derivation of the source; this keeps
    // forward-only traversal through multiplication covered.
    void *p = kmalloc((size_t)n * 16);
    return p ? 0 : -2;
}
