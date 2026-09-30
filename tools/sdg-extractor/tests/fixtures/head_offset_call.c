/* Fixture: source used as array offset and as call argument. */

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
extern void consume(u32 x);

u32 arr[16];

int probe(unsigned long phys) {
    vm_dev.base = ioremap(phys, 0x200);
    void *base = vm_dev.base;
    u32 off = readl(base + 0x10a); /* mtu */
    u32 sz = readl(base + 0x10c);  /* speed */

    if (off >= 16)
        return -1;
    consume(arr[off]);

    if (sz == 0)
        return -1;
    kmalloc(sz);

    return 0;
}
