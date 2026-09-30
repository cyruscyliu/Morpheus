/* Fixture: inlined feature-bit test on a host_features value. */

typedef unsigned int u32;

__attribute__((noinline))
static u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

extern void *ioremap(unsigned long phys, unsigned long size);

struct virtio_mmio_device {
    void *base;
};

static struct virtio_mmio_device vm_dev;


int check(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 features = readl(base + 0x010); /* host_features */
    volatile int r = 0;
    if (features & (1u << 5)) {
        r = 1;
    }
    return r;
}
