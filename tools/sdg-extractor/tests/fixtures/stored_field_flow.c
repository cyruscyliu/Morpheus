typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

struct virtio_device;

struct virtio_config_ops {
    void (*get)(struct virtio_device *, u32, void *, u32);
};

struct virtio_device {
    struct virtio_config_ops *config;
};

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

extern void *memcpy(void *, const void *, unsigned long);
extern void consume(const void *, unsigned long);

__attribute__((noinline))
void consume_state(struct state *state, const u8 *source) {
    memcpy(state->destination, source, state->length);
    consume(state->destination, sizeof(state->destination));
}

void configure(struct virtio_device *vdev, struct state *state,
               const u8 *source) {
    state->length = virtio_cread16(vdev);
    consume_state(state, source);
}
