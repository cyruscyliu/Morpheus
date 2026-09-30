/* Fixture: signed and unsigned comparisons with operand reversal. */

typedef unsigned int u32;
typedef signed int s32;

__attribute__((noinline))
static u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

extern void *ioremap(unsigned long phys, unsigned long size);

struct virtio_mmio_device {
    void *base;
};

static struct virtio_mmio_device vm_dev;


static inline s32 readls(void *addr) {
    return *(volatile s32 *)addr;
}

void sink_u32(u32 x);
void sink_s32(s32 x);

int probe(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 a = readl(base + 0x10c); /* speed, 4 bytes, offset known by catalog */
    s32 b = readls(base + 0x10a); /* mtu, 2 bytes, accessed as signed */

    if (a > 1500U)
        sink_u32(a);
    if (1000U < a)
        sink_u32(a);

    if (b < -10)
        sink_s32(b);

    return 0;
}
