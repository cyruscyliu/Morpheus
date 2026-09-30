/* Fixture: a guard controls a sink behind an indirect call.
 *
 * The callee is reached through a function pointer stored in a global ops
 * struct; pointer analysis resolves the indirect call. The proof must come
 * from the resolved call edge, never from name matching.
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

struct state {
    u16 length;
    u8 destination[64];
};

struct consume_ops {
    void (*consume)(struct state *, u16, const u8 *);
};

__attribute__((noinline))
void consume_state(struct state *state, u16 n, const u8 *source) {
    memcpy(state->destination, source, (size_t)n);
}

__attribute__((noinline))
u16 virtio_cread16(struct virtio_device *vdev) {
    u16 value = 0;
    vdev->config->get(vdev, 10, &value, 2);
    return value;
}

static struct consume_ops g_ops = { consume_state };

void configure(struct virtio_device *vdev, struct state *state,
               const u8 *source) {
    u16 mtu = virtio_cread16(vdev);
    if (virtio_has_feature(vdev, 17)) {
        g_ops.consume(state, mtu, source);
    }
}
