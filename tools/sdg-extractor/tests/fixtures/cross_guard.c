/* Fixture: feature-bit guard controls use of another MMIO field. */

typedef unsigned int u32;
typedef unsigned long size_t;

__attribute__((noinline))
static u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

extern void *kmalloc(size_t size);

struct virtio_device;
extern int virtio_has_feature(struct virtio_device *vdev, unsigned bit);

extern void *ioremap(unsigned long phys, unsigned long size);

struct virtio_mmio_device {
    void *base;
};

static struct virtio_mmio_device vm_dev;


int probe(struct virtio_device *vdev, unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 mtu = readl(base + 0x10a);

    if (virtio_has_feature(vdev, 3)) {
        // mtu is only used when VIRTIO_NET_F_CTRL_GUEST_OFFLOADS is negotiated.
        if (mtu > 1500)
            kmalloc((size_t)mtu);
    } else {
        // Side effect prevents the optimizer from merging the feature guard
        // with the inner mtu comparison.
        asm volatile("" ::: "memory");
    }

    return 0;
}
