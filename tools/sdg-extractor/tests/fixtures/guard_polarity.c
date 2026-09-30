/* Fixture: guard polarity — callees on both branch successors.
 *
 * The true successor's callee is reached when the feature bit is set
 * (BitSet); the false successor's callee is reached when the bit is clear
 * (BitClear). Both callees sink the value through a memcpy, so the proof
 * must carry the exact guarded successor and the exact callsite, not just
 * the function name and argument index.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long size_t;

struct virtio_device;
extern int virtio_has_feature(struct virtio_device *vdev, unsigned bit);
extern void *memcpy(void *, const void *, unsigned long);

struct buf {
    u8 data[64];
};

__attribute__((noinline))
static u16 readl16(void *addr) {
    return *(volatile u16 *)addr;
}

extern void *ioremap(unsigned long phys, unsigned long size);

struct virtio_mmio_device {
    void *base;
};

static struct virtio_mmio_device vm_dev;


__attribute__((noinline))
void sink_true(struct buf *b, u16 n) {
    memcpy(b->data, &n, (size_t)n);
}

__attribute__((noinline))
void sink_false(struct buf *b, u16 n) {
    memcpy(b->data, &n, (size_t)n);
}

int probe(struct virtio_device *vdev, unsigned long phys, struct buf *b,
          struct buf *b2) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u16 n = readl16(base + 0x10a);

    if (n > 4096)
        return -1;

    if (virtio_has_feature(vdev, 3)) {
        sink_true(b, n);
    } else {
        sink_false(b2, n);
    }

    return 0;
}
