/* Fixture: partial DMA telemetry patch recognition.
 *
 * Models the hp_dma_trace publishers from the partial DMA telemetry patch.
 * Association requires a provable relationship: the traced address (or the
 * virtqueue pointer) and the loaded value must share provenance. Positive
 * and negative cases live in the same function.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long long u64;
typedef unsigned long size_t;

struct vring_used {
    u16 flags;
    u16 idx;
    u32 ring[];
};

struct virtio_net_hdr {
    u8 flags;
    u8 gso_type;
    u16 hdr_len;
    u16 gso_size;
    u16 csum_start;
    u16 csum_offset;
};

struct virtio_net_ctrl_ack {
    u8 ack;
};

struct virtqueue {
    struct vring_used *used;
    struct virtio_net_ctrl_ack *ack;
};
struct vring_virtqueue {
    struct virtqueue vq;
};

void hp_dma_trace_publish(void *vdev, u32 op, u32 dir, u64 size, void *addr,
                          u32 use_dma);
void hp_dma_trace_vq_state(void *vq, u32 opcode, u64 aux, const char *kind);
extern void *memcpy(void *, const void *, unsigned long);

#define HP_DMA_EVENT_OP_MAP        0x04u
#define HP_DMA_EVENT_OP_VQ_GET_BUF 0x0bu

/* Positive case: the MAP event's traced address is the mapped buffer that
 * header was read from; the VQ_GET_BUF event's virtqueue pointer is the
 * queue that owns the used ring. */
u32 read_dma_trace(struct vring_virtqueue *vrv, struct virtio_net_hdr *header,
                   void *vdev) {
    u8 buf[16];
    struct vring_used *used = vrv->vq.used;
    hp_dma_trace_publish(vdev, HP_DMA_EVENT_OP_MAP, 2, sizeof(buf), header, 1);
    hp_dma_trace_vq_state(&vrv->vq, HP_DMA_EVENT_OP_VQ_GET_BUF, 0, "used");
    memcpy(buf, header, (size_t)header->gso_size);
    // The copied payload keeps the memcpy alive under optimization; the
    // traced address flows into its destination argument.
    return header->gso_size + used->idx + buf[0];
}

/* Negative case: only unrelated events name this function's buffers. The
 * traced address names another buffer and the vq-state event names another
 * queue, so the ack load has no provenance and no telemetry: telemetry
 * alone never creates a source. */
u32 read_ack_unrelated(struct vring_virtqueue *vrv,
                       struct vring_virtqueue *other_vrv, void *vdev) {
    u8 unrelated[16];
    struct virtio_net_ctrl_ack *ack = vrv->vq.ack;
    hp_dma_trace_publish(vdev, HP_DMA_EVENT_OP_MAP, 2, sizeof(unrelated),
                         unrelated, 1);
    hp_dma_trace_vq_state(&other_vrv->vq, HP_DMA_EVENT_OP_VQ_GET_BUF, 0,
                          "used");
    return ack->ack;
}
