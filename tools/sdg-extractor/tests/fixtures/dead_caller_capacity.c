/* Fixture: dead callers must not pollute capacity provenance.
 *
 * The sink helper copies into its destination formal with memcpy(), the
 * generic memory-sensitive operation. The device-provided config value
 * reaches the sink's size operand through the len formal from the good
 * caller. A second caller passes the same value through the spare formal,
 * whose flow never reaches the sink's size operand: the search explores it,
 * but it is dead provenance. Its smaller destination storage must not lower
 * the inferred bound of the successful path.
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

/* Ordered config shape: the length field sits at relative offset 17, which
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

u8 wide_store[40];
u8 narrow_store[8];
u8 random_key[64];

extern void *memcpy(void *, const void *, size_t);

__attribute__((noinline))
u8 virtio_cread8(struct virtio_device *vdev) {
    u8 value = 0;
    vdev->config->get(vdev, offsetof(struct device_config, max_key_size),
                      &value, 1);
    return value;
}

/* The helper performs the real copy: the sink is the memcpy size operand. */
__attribute__((noinline))
void fill_buffer(void *buffer, size_t spare, size_t len) {
    memcpy(buffer, random_key, len);
}

/* Good caller: the tainted value reaches the sink's size operand. */
void configure(struct virtio_device *vdev) {
    fill_buffer(wide_store, 0, virtio_cread8(vdev));
}

/* Dead caller: the tainted value reaches only the spare formal, whose flow
 * never reaches the sink's size operand. Its smaller destination storage is
 * explored during the search but is dead provenance. */
void configure_alt(struct virtio_device *vdev) {
    fill_buffer(narrow_store, virtio_cread8(vdev), 0);
}
