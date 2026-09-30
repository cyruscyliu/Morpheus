/* Fixture: an unrelated feature guard must not attach to the rule.
 *
 * The proven value-flow path is configure -> fill_buffer -> memcpy, gated by
 * the two stored-boolean feature bits 17 and 18. A second caller reaches the
 * same sink helper through a different call path under an unrelated feature
 * bit 20, but its call passes a constant length: no proven value flow enters
 * the sink through it. The unrelated guard is explored during the search and
 * must be rejected: the rule's guard set remains exactly the two intended
 * bits.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long size_t;

#define offsetof(TYPE, MEMBER) ((size_t) &((TYPE *)0)->MEMBER)

struct virtio_device;
struct virtio_config_ops {
    void (*get)(struct virtio_device *, u32, void *, u32);
};
struct virtio_device {
    struct virtio_config_ops *config;
};

/* Ordered config shape: the key-size field sits at relative offset 17, which
 * the catalog maps to absolute config offset 0x111. */
struct device_config {
    u8 mac[6];
    u16 status;
    u16 max_virtqueue_pairs;
    u16 mtu;
    u32 speed;
    u8 duplex;
    u8 max_key_size;
};

struct trailer {
    u8 key_length;
    u16 max_tx_vq;
    u8 key_data[];   /* flexible array member */
};

struct __attribute__((packed)) info {
    u16 key_size;
    u8 feature_a;
    u8 feature_b;
    union {
        struct trailer trailer;
        struct {
            unsigned char __offset_to_FAM[offsetof(struct trailer, key_data)];
            u8 key_storage[40];   /* trailing storage overlapping the FAM */
        };
    };
};

extern int virtio_has_feature(struct virtio_device *vdev, unsigned bit);
extern void *memcpy(void *, const void *, size_t);

u8 random_key[64];

__attribute__((noinline))
u8 virtio_cread8(struct virtio_device *vdev) {
    u8 value = 0;
    vdev->config->get(vdev, offsetof(struct device_config, max_key_size),
                      &value, 1);
    return value;
}

/* The helper performs the real copy: the sink is the memcpy size operand. */
__attribute__((noinline))
void fill_buffer(void *buffer, size_t len) {
    memcpy(buffer, random_key, len);
}

void configure(struct virtio_device *vdev, struct info *vi) {
    vi->key_size = virtio_cread8(vdev);
    if (virtio_has_feature(vdev, 17))
        vi->feature_a = 1;
    if (virtio_has_feature(vdev, 18))
        vi->feature_b = 1;
    if (vi->feature_a || vi->feature_b)
        fill_buffer(&vi->trailer.key_data[0], vi->key_size);
}

/* Unrelated caller: reaches the same sink helper through a different call
 * path under an unrelated feature bit, but passes a constant length, so no
 * proven value flow enters the sink through this callsite. */
void unrelated_caller(struct virtio_device *vdev, struct info *vi) {
    if (virtio_has_feature(vdev, 20))
        fill_buffer(&vi->trailer.key_data[0], 1);
}
