/* Negative fixture: DMA pointers with no provenance produce no sources.
 *
 * The avail ring is driver-written (Virtio 1.3 section 2.7.8), so its loads
 * are not device-controlled sources. Packed descriptors change ownership
 * with the AVAIL/USED wrap bits and are not proven by type. The control
 * request header is driver-to-device.
 */

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef unsigned long long u64;

struct vring_avail {
    u16 flags;
    u16 idx;
    u16 ring[];
};

struct vring_packed_desc {
    u64 addr;
    u32 len;
    u16 id;
    u16 flags;
};

struct virtio_net_ctrl_hdr {
    u8 class;
    u8 cmd;
};

u32 read_avail(struct vring_avail *avail) {
    return avail->idx + avail->flags;
}

u32 read_packed(struct vring_packed_desc *desc) {
    return desc->len + desc->id;
}

u32 read_ctrl_request(struct virtio_net_ctrl_hdr *request) {
    return request->class + request->cmd;
}
