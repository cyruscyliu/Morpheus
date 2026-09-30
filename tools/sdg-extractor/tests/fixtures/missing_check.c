/* Fixture: source flows into a size sink with no explicit bound. */

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


extern void *kmalloc(size_t size);

int probe(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 sz = readl(base + 0x10c); /* speed */
    // No comparison bounds sz before passing it to kmalloc.
    kmalloc((size_t)sz);
    return 0;
}
