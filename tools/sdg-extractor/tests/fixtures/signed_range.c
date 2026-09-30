/* Fixture: signed InRange with two-complement encoded bounds.
 *
 * probe is optnone so the optimizer keeps the two signed comparisons as one
 * conjunction instead of canonicalizing them into an unsigned range idiom.
 * The region is mapped through ioremap into a virtio_mmio_device that
 * escapes through a noinline registration call: the honest Virtio transport
 * provenance for a volatile access.
 */

typedef signed short s16;
typedef unsigned long size_t;

extern void *ioremap(size_t phys, size_t size);

struct virtio_mmio_device {
    void *base;
    unsigned int features;
};

void sink_s16(s16 x);

__attribute__((noinline))
static void register_region(struct virtio_mmio_device *dev) {
    asm volatile("" :: "r"(dev) : "memory");
}

__attribute__((optnone))
int probe(size_t phys) {
    struct virtio_mmio_device vm_dev;
    vm_dev.base = ioremap(phys, 0x200);
    vm_dev.features = 0;
    register_region(&vm_dev);

    char *base = vm_dev.base;

    s16 v = *(volatile s16 *)(base + 0x10a);

    if ((v >= -10) & (v <= 10))
        sink_s16(v);

    return (int)vm_dev.features;
}
