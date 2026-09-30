/* Cross-function stored length with two feature-guard alternatives.
 *
 * The device-provided config value is stored in state, loaded in a callee,
 * and used as the size of a copy into a fixed 40-byte array. Either feature
 * opens the call path. The extractor must keep the physical config source as
 * the executable target rather than lowering the InternalState alias.
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

struct state {
    u16 length;
    u8 feature_a;
    u8 feature_b;
    u8 destination[40];
};

extern int virtio_has_feature(struct virtio_device *vdev, unsigned bit);
extern void *memcpy(void *, const void *, size_t);

__attribute__((noinline))
u16 virtio_cread16(struct virtio_device *vdev) {
    u16 value = 0;
    vdev->config->get(vdev, 10, &value, 2);
    return value;
}

__attribute__((noinline))
static void consume(struct state *state, const u8 *source) {
    memcpy(state->destination, source, state->length);
}

void configure(struct virtio_device *vdev, struct state *state,
               const u8 *source) {
    state->length = virtio_cread16(vdev);
    if (virtio_has_feature(vdev, 17))
        state->feature_a = 1;
    if (virtio_has_feature(vdev, 18))
        state->feature_b = 1;
    if (state->feature_a || state->feature_b)
        consume(state, source);
}
