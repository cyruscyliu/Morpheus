/* Fixture: virtio-defined DMA formats with provenance.
 *
 * The vring structures are queue-owned (Virtio 1.3 section 2.7); the
 * virtio_net_hdr payload traces to a virtqueue_get_buf call, which is its
 * DMA provenance. A packed-descriptor load is not registered: packed ring
 * ownership changes with the wrap bits and is not proven by type.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long long u64;

struct vring_used {
    u16 flags;
    u16 idx;
    u32 ring[];
};

struct vring_packed_desc {
    u64 addr;
    u32 len;
    u16 id;
    u16 flags;
};

struct virtio_net_hdr {
    u8 flags;
    u8 gso_type;
    u16 hdr_len;
    u16 gso_size;
    u16 csum_start;
    u16 csum_offset;
};

struct virtqueue;

extern void *virtqueue_get_buf(struct virtqueue *vq, unsigned int *len);

u32 read_dma_formats(struct vring_used *used,
                     struct vring_packed_desc *packed,
                     struct virtqueue *vq) {
    unsigned int len;
    struct virtio_net_hdr *header = virtqueue_get_buf(vq, &len);
    if (!header)
        return 0;
    return used->idx + packed->len + header->gso_size + header->csum_start;
}
