/* Negative fixture: reads with no Virtio provenance produce no sources.
 *
 * The readl call and the volatile load both use an arbitrary function
 * argument as their base, and two arbitrary reads on the same unproven base
 * never prove each other. A generic ioremap of an unrelated region proves
 * MMIO, not Virtio MMIO: without a Virtio transport device tying the
 * mapping to a Virtio driver path, the read is not a Virtio source.
 */

typedef unsigned int u32;
typedef unsigned long size_t;

__attribute__((noinline))
static u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

extern void *ioremap(size_t phys, size_t size);

u32 unproven_call(void *base) {
    return readl(base + 0x034); /* a catalog transport offset */
}

u32 unproven_load(void *base) {
    return *(volatile u32 *)(base + 0x10a); /* a catalog config offset */
}

u32 unproven_sibling_calls(void *base) {
    // Two arbitrary reads on the same unproven base: neither proves the
    // other, whatever catalog offset each uses.
    return readl(base + 0x034) + readl(base + 0x010);
}

u32 generic_ioremap(size_t unrelated_phys) {
    char *base = ioremap(unrelated_phys, 0x1000);
    return *(volatile u32 *)(base + 0x034); /* a Virtio-shaped offset */
}
