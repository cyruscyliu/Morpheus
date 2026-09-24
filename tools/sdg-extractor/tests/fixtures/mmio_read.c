/* Minimal fixture: an MMIO read with a boundary check. */

typedef unsigned int u32;
typedef unsigned long long u64;

#define VIRTIO_MMIO_DEVICE_ID 0x008
#define VIRTIO_MMIO_VERSION   0x004

static inline u32 readl(volatile void *addr) {
    return *(volatile u32 *)addr;
}

struct vm_dev {
    void *base;
    u32 version;
    u32 device;
};

int probe(struct vm_dev *dev) {
    dev->version = readl(dev->base + VIRTIO_MMIO_VERSION);
    if (dev->version < 1 || dev->version > 2) {
        return -1;
    }

    dev->device = readl(dev->base + VIRTIO_MMIO_DEVICE_ID);
    if (dev->device == 0) {
        return -2;
    }

    return 0;
}
