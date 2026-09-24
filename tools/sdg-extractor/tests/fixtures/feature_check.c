/* Fixture for virtio_has_feature call detection. */

typedef unsigned int u32;

__attribute__((noinline))
int virtio_has_feature(void *vdev, u32 bit) {
    volatile int dummy = 1;
    return dummy & (bit & 1);
}

int check(void *vdev) {
    if (virtio_has_feature(vdev, 5)) {
        return 1;
    }
    return 0;
}
