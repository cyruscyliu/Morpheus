/* Fixture: a feature guard in one function controls a sink inside a callee.
 *
 * The guard dominates the call to consume_state in configure; the sink reads
 * a value stored before the call and loaded inside the callee. Proving the
 * cross-function precondition requires a call chain from the guard to the
 * sink, not name matching.
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
extern void *memcpy(void *, const void *, unsigned long);
extern void consume(const void *, unsigned long);

struct state {
    u16 length;
    u8 destination[64];
};

__attribute__((noinline))
u16 virtio_cread16(struct virtio_device *vdev) {
    u16 value = 0;
    vdev->config->get(vdev, 10, &value, 2);
    return value;
}

__attribute__((noinline))
void consume_state(struct state *state, u16 n, const u8 *source) {
    memcpy(state->destination, source, (size_t)n);
    consume(state->destination, sizeof(state->destination));
}

void configure(struct virtio_device *vdev, struct state *state,
               const u8 *source) {
    u16 mtu = virtio_cread16(vdev);
    if (virtio_has_feature(vdev, 17)) {
        consume_state(state, mtu, source);
    }
}
