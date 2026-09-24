/* Fixture: inlined feature-bit test on a host_features value. */

typedef unsigned int u32;

static inline u32 readl(void *addr) {
    return *(volatile u32 *)addr;
}

int check(void *base) {
    u32 features = readl(base + 0x010); /* host_features */
    volatile int r = 0;
    if (features & (1u << 5)) {
        r = 1;
    }
    return r;
}
