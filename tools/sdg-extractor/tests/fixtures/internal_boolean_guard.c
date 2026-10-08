/* Generic internal-state guard fixture.
 *
 * Two feature bits are stored as struct booleans in one function and then
 * tested in a callee before a device-provided config value is used as a
 * memcpy size. The extractor must recover the internal intermediate nodes
 * and the source->internal->sink cross-edges without name-based special
 * casing.
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
    u8 has_rss_hash_report;
    u8 key[40];
};

__attribute__((noinline))
u8 virtio_cread8(struct virtio_device *vdev) {
    u8 value = 0;
    vdev->config->get(vdev, 0x11, &value, 1);
    return value;
}

__attribute__((noinline))
static void consume(struct virtio_device *vdev, struct driver_state *state,
                    const u8 *source) {
    if (state->has_rss | state->has_rss_hash_report) {
        u8 sz = virtio_cread8(vdev);
        memcpy(state->key, source, (size_t)sz);
    }
}

void configure(struct virtio_device *vdev, struct driver_state *state,
               const u8 *source) {
    state->has_rss = (u8)virtio_has_feature(vdev, 60);
    state->has_rss_hash_report = (u8)virtio_has_feature(vdev, 57);
    consume(vdev, state, source);
}
