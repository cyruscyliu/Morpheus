typedef unsigned short u16;
typedef unsigned int u32;

struct virtio_device;

struct virtio_config_ops {
    void (*get)(struct virtio_device *, u32, void *, u32);
};

struct virtio_device {
    struct virtio_config_ops *config;
};

__attribute__((noinline))
u16 virtio_cread16(struct virtio_device *vdev) {
    u16 value = 0;
    vdev->config->get(vdev, 10, &value, 2);
    return value;
}

int probe_mtu(struct virtio_device *vdev) {
    u16 mtu = virtio_cread16(vdev);
    return mtu > 1500;
}
