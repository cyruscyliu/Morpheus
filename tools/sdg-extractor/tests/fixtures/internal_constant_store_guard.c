/* Constant-store-under-feature-branch guard fixture.
 *
 * A feature test branches, and the branch successor stores a CONSTANT 1 into
 * a struct boolean (the compiler knows the value is true inside the branch).
 * The boolean is later loaded and branched on, gating a config read. The
 * extractor must trace the stored constant through the load to the guarded
 * config read and emit the source -> config-read head_guard cross-edge
 * without name-based special casing.
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

extern int virtio_has_feature(struct virtio_device *vdev, unsigned bit);
extern void *memcpy(void *, const void *, size_t);

struct driver_state {
    u8 has_rss;
    u8 key[40];
};

__attribute__((noinline))
u8 virtio_cread8(struct virtio_device *vdev) {
    u8 value = 0;
    vdev->config->get(vdev, 0x11, &value, 1);
    return value;
}

void configure(struct virtio_device *vdev, struct driver_state *state,
               const u8 *source) {
    if (virtio_has_feature(vdev, 60))
        state->has_rss = 1;

    if (state->has_rss) {
        u8 sz = virtio_cread8(vdev);
        memcpy(state->key, source, (size_t)sz);
    }
}
