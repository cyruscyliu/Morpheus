/* Fixture: MMIO read flows into a sink (kmalloc) size argument. */

typedef unsigned int u32;
typedef unsigned long size_t;

static inline u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

void *kmalloc(size_t size);

int probe(void *base) {
    u32 n = readl(base + 0x034); /* queue_num_max */
    if (n == 0)
        return -1;
    void *p = kmalloc((size_t)n * 16);
    return p ? 0 : -2;
}
