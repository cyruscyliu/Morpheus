/* Fixture: SVFG aliasing pollution must not produce rules.
 *
 * A guest-controlled config value is stored into one struct field while an
 * unrelated function uses a DIFFERENT field of the same struct as a memcpy
 * size. SVFG address/alias propagation may connect the two through the
 * shared object; the exact forward dependency must not. The extractor must
 * emit no rule for the unrelated memcpy: the sink argument is not derived
 * from the guest value by an exact LLVM use chain.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long size_t;

struct virtio_device;
struct virtio_config_ops {
    void (*get)(struct virtio_device *, u32, void *, u32);
};
struct virtio_device {
    struct virtio_config_ops *config;
};

struct shared {
    u16 len_a;
    u16 len_b;
    u8 destination[40];
};

extern void *memcpy(void *, const void *, size_t);

__attribute__((noinline))
u16 virtio_cread16(struct virtio_device *vdev) {
    u16 value = 0;
    vdev->config->get(vdev, 10, &value, 2);
    return value;
}

__attribute__((noinline))
static void unrelated_copy(struct shared *s, const u8 *source) {
    memcpy(s->destination, source, s->len_b);
}

void configure(struct virtio_device *vdev, struct shared *s,
               const u8 *source) {
    s->len_a = virtio_cread16(vdev);
    unrelated_copy(s, source);
}
