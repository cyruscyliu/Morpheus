/* Minimal fixture: an MMIO read with a boundary check. */

typedef unsigned int u32;
typedef unsigned long long u64;

#define VIRTIO_MMIO_DEVICE_ID 0x008
#define VIRTIO_MMIO_VERSION   0x004
#define VIRTIO_MMIO_DRIVER_FEATURES 0x020

__attribute__((noinline))
static u32 readl(volatile void *addr) {
    return *(volatile u32 *)addr;
}

extern void *ioremap(unsigned long phys, unsigned long size);

struct virtio_mmio_device {
    void *base;
};

static struct virtio_mmio_device vm_dev;


int probe(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    if (readl(base + VIRTIO_MMIO_DRIVER_FEATURES) != 0) {
        return -3;
    }
    u32 version = readl(base + VIRTIO_MMIO_VERSION);
    if (version < 1 || version > 2) {
        return -1;
    }

    u32 device = readl(base + VIRTIO_MMIO_DEVICE_ID);
    if (device == 0) {
        return -2;
    }

    return 0;
}
