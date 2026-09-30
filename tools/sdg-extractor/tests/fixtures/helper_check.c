/* Fixture: helper-encapsulated boundary check. */

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

static int __attribute__((noinline)) size_ok(u32 sz) {
    // Transparent op around the formal to exercise helper extraction.
    u32 masked = sz & 0xffffffffu;
    return masked <= 64;
}

int probe(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 sz = readl(base + 0x10c); /* speed */
    if (!size_ok(sz))
        return -1;
    kmalloc(sz);
    return 0;
}
