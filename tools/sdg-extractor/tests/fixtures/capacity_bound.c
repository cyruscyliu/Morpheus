/* Fixture: the evidence-backed cross-function capacity rule shape.
 *
 * A device-provided config byte (relative offset 17 of the config space, the
 * spec's max-key-size field) is stored into state, loaded by the caller, and
 * passed as the length argument of a helper. The helper performs the real
 * copy into the caller-provided destination with memcpy() — the generic
 * memory-sensitive operation. The destination is a flexible-array member
 * overlapped by a fixed 40-byte trailing storage. Two stored-boolean feature
 * guards gate the helper call.
 *
 * The extractor must emit the executable rule: physical target
 * mmio:273:1:rss_max_key_size (catalog schema at absolute config offset
 * 0x111), target predicate Gt(40) with SetBoundary Above, and sink evidence
 * from the memcpy size argument inside the helper.
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
