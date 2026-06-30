# virtnet_netdev Call Paths

Source baseline:
- `drivers/net/virtio_net.c`
- `drivers/virtio/virtio_mmio.c`
- `drivers/virtio/virtio_ring.c`
- `include/linux/virtio_config.h`

Cached tree used:
- `/home/debian/Morpheus/.cache/hyperarm/tools/buildroot/builds/arm64-dev/output/build/linux-6.18.16`

This note starts from the `virtnet_netdev` function pointers in
`drivers/net/virtio_net.c` and traces the paths that reach:
- `virtio_mmio_config_ops`
- `virtqueue_add_outbuf`
- `virtqueue_add_inbuf`
- `virtqueue_add_sgs`
- `vm_notify`

It also tracks `sg_init_table` and `sg_set_buf` plus their argument flow.

## Queue Provenance

All runtime `rq->vq`, `sq->vq`, and `vi->cvq` handles come from this setup
path:

```text
virtnet_probe
  -> init_vqs
    -> virtnet_alloc_queues
    -> virtnet_find_vqs
      -> virtio_find_vqs
        -> vdev->config->find_vqs
          -> vm_find_vqs
            -> vm_setup_vq
              -> vring_create_virtqueue(..., notify, ...)
```

Inside `vm_setup_vq`:

```text
if (__virtio_test_bit(vdev, VIRTIO_F_NOTIFICATION_DATA))
    notify = vm_notify_with_data;
else
    notify = vm_notify;
```

So every later:

```text
virtqueue_kick_prepare(vq)
virtqueue_notify(vq)
```

ends in:

```text
virtqueue_notify
  -> vq->notify(vq)
    -> vm_notify(vq) or vm_notify_with_data(vq)
```

For MMIO transport:
- `vm_notify(vq)` does `writel(vq->index, base + VIRTIO_MMIO_QUEUE_NOTIFY)`
- `vm_notify_with_data(vq)` does
  `data = vring_notification_data(vq)` then
  `writel(data, base + VIRTIO_MMIO_QUEUE_NOTIFY)`

## net_device_ops Summary

From `virtnet_netdev`:

| netdev op | direct path to target |
| --- | --- |
| `virtnet_open` | yes, RX refill to `virtqueue_add_inbuf*` then notify |
| `virtnet_close` | no direct queue submission |
| `start_xmit` | yes, TX to `virtqueue_add_outbuf` then notify |
| `virtnet_set_mac_address` | yes, control VQ via `virtqueue_add_sgs`; legacy fallback reaches `vm_set` |
| `virtnet_set_rx_mode` | yes, deferred control VQ via `virtqueue_add_sgs` |
| `virtnet_vlan_rx_add_vid` | yes, control VQ via `virtqueue_add_sgs` |
| `virtnet_vlan_rx_kill_vid` | yes, control VQ via `virtqueue_add_sgs` |
| `virtnet_xdp` | no direct queue submission from this entry point |
| `virtnet_xdp_xmit` | yes, TX to `virtqueue_add_outbuf` then notify |
| `virtnet_xsk_wakeup` | indirect; schedules TX NAPI which reaches `virtqueue_add_outbuf_premapped` then notify |
| `virtnet_set_features` | yes, control VQ via `virtqueue_add_sgs` on some feature changes |
| `virtnet_tx_timeout` | no direct queue submission |

## 1. `virtnet_open`

### Main path

```text
virtnet_open
  loop i in [0, max_queue_pairs)
    if i < curr_queue_pairs
      -> try_fill_recv(vi, &vi->rq[i], GFP_KERNEL)
    -> virtnet_enable_queue_pair(vi, i)
```

### RX refill path

```text
try_fill_recv
  if rq->xsk_pool
    -> virtnet_add_recvbuf_xsk
      -> virtqueue_add_inbuf_premapped
  else if vi->mergeable_rx_bufs
    -> add_recvbuf_mergeable
      -> virtqueue_add_inbuf_premapped
  else if vi->big_packets
    -> add_recvbuf_big
      -> virtqueue_add_inbuf
  else
    -> add_recvbuf_small
      -> virtqueue_add_inbuf_premapped

  -> virtqueue_kick_prepare(rq->vq)
  -> virtqueue_notify(rq->vq)
  -> vm_notify / vm_notify_with_data
```

### SG details

#### `virtnet_add_recvbuf_xsk`

```text
len  = xsk_pool_get_rx_frame_size(pool) + vi->hdr_len
addr = xsk_buff_xdp_get_dma(xsk_buffs[i]) - vi->hdr_len

sg_init_table(rq->sg, 1)
sg_fill_dma(rq->sg, addr, len)
virtqueue_add_inbuf_premapped(rq->vq, rq->sg, 1, xsk_buffs[i], NULL, gfp)
```

#### `add_recvbuf_small`

```text
buf += VIRTNET_RX_PAD + xdp_headroom
virtnet_rq_init_one_sg(rq, buf, vi->hdr_len + GOOD_PACKET_LEN)
virtqueue_add_inbuf_premapped(rq->vq, rq->sg, 1, buf, ctx, gfp)
```

`virtnet_rq_init_one_sg`:

```text
head   = page_address(rq->alloc_frag.page)
offset = buf - head
dma    = head
addr   = dma->addr - sizeof(*dma) + offset

sg_init_table(rq->sg, 1)
sg_fill_dma(rq->sg, addr, len)
```

#### `add_recvbuf_mergeable`

```text
virtnet_rq_init_one_sg(rq, buf, len)
ctx = mergeable_len_to_ctx(len + room, headroom)
virtqueue_add_inbuf_premapped(rq->vq, rq->sg, 1, buf, ctx, gfp)
```

#### `add_recvbuf_big`

```text
sg_init_table(rq->sg, vi->big_packets_num_skbfrags + 2)

for i = big_packets_num_skbfrags + 1 down to 2:
  sg_set_buf(&rq->sg[i], page_address(first), PAGE_SIZE)

sg_set_buf(&rq->sg[0], p, vi->hdr_len)
offset = sizeof(struct padded_vnet_hdr)
sg_set_buf(&rq->sg[1], p + offset, PAGE_SIZE - offset)

virtqueue_add_inbuf(rq->vq, rq->sg, vi->big_packets_num_skbfrags + 2, first, gfp)
```

## 2. `start_xmit`

### Main path

```text
start_xmit
  -> xmit_skb(sq, skb, !use_napi)
    -> virtnet_add_outbuf
      -> virtqueue_add_outbuf
  -> if kick
       virtqueue_kick_prepare(sq->vq)
       virtqueue_notify(sq->vq)
       vm_notify / vm_notify_with_data
```

### SG details in `xmit_skb`

```text
sg_init_table(sq->sg, skb_shinfo(skb)->nr_frags + (can_push ? 1 : 2))
```

Two cases:

#### `can_push == true`

```text
__skb_push(skb, hdr_len)
num_sg = skb_to_sgvec(skb, sq->sg, 0, skb->len)
__skb_pull(skb, hdr_len)
```

No `sg_set_buf` here because the pushed header is folded into the first SG
element created by `skb_to_sgvec`.

#### `can_push == false`

```text
sg_set_buf(sq->sg, hdr, hdr_len)
num_sg = skb_to_sgvec(skb, sq->sg + 1, 0, skb->len)
num_sg++
```

Then:

```text
virtnet_add_outbuf(sq, num_sg, skb, type)
  -> virtqueue_add_outbuf(sq->vq, sq->sg, num_sg, packed_ptr, GFP_ATOMIC)
```

## 3. `virtnet_xdp_xmit`

### Main path

```text
virtnet_xdp_xmit
  loop frames[i]
    -> __virtnet_xdp_xmit_one
      -> virtnet_add_outbuf
        -> virtqueue_add_outbuf
  if flags & XDP_XMIT_FLUSH
    -> virtqueue_kick_prepare(sq->vq)
    -> virtqueue_notify(sq->vq)
    -> vm_notify / vm_notify_with_data
```

### SG details in `__virtnet_xdp_xmit_one`

```text
sg_init_table(sq->sg, nr_frags + 1)
sg_set_buf(sq->sg, xdpf->data, xdpf->len)

for i in [0, nr_frags):
  sg_set_page(&sq->sg[i + 1],
              skb_frag_page(frag),
              skb_frag_size(frag),
              skb_frag_off(frag))

virtnet_add_outbuf(sq, nr_frags + 1, xdpf, VIRTNET_XMIT_TYPE_XDP)
  -> virtqueue_add_outbuf(sq->vq, sq->sg, nr_frags + 1, ..., GFP_ATOMIC)
```

## 4. `virtnet_xsk_wakeup`

This op is indirect. It does not submit to a queue itself.

```text
virtnet_xsk_wakeup
  -> xsk_wakeup(sq)
    -> virtqueue_napi_schedule(&sq->napi, sq->vq)
      -> TX NAPI later runs virtnet_poll_tx
        -> virtnet_xsk_xmit
          -> virtnet_xsk_xmit_batch
            -> virtnet_xsk_xmit_one
              -> virtqueue_add_outbuf_premapped
          -> virtqueue_kick_prepare(sq->vq)
          -> virtqueue_notify(sq->vq)
          -> vm_notify / vm_notify_with_data
```

### SG details in `virtnet_xsk_xmit_one`

```text
addr = xsk_buff_raw_get_dma(pool, desc->addr)

sg_init_table(sq->sg, 2)
sg_fill_dma(sq->sg,     sq->xsk_hdr_dma_addr, vi->hdr_len)
sg_fill_dma(sq->sg + 1, addr,                 desc->len)

virtqueue_add_outbuf_premapped(sq->vq, sq->sg, 2, virtnet_xsk_to_ptr(desc->len), GFP_ATOMIC)
```

No `sg_set_buf` here because the XSK path uses pre-mapped DMA entries.

## 5. `virtnet_set_mac_address`

Two relevant transport paths exist.

### Control-VQ path

When `VIRTIO_NET_F_CTRL_MAC_ADDR` is negotiated:

```text
virtnet_set_mac_address
  -> sg_init_one(&sg, addr->sa_data, dev->addr_len)
  -> virtnet_send_command
    -> virtnet_send_command_reply
      -> sg_init_one(&hdr,  &vi->ctrl->hdr,    sizeof(vi->ctrl->hdr))
      -> sg_init_one(&stat, &vi->ctrl->status, sizeof(vi->ctrl->status))
      -> virtqueue_add_sgs(vi->cvq, sgs, out_num, in_num, vi, GFP_ATOMIC)
      -> virtqueue_kick(vi->cvq)
      -> virtqueue_notify(vi->cvq)
      -> vm_notify / vm_notify_with_data
```

The user payload SG is:

```text
sg = addr->sa_data
len = dev->addr_len
```

### Legacy config-space write path

When `VIRTIO_NET_F_MAC` is present but `VIRTIO_F_VERSION_1` is absent:

```text
virtnet_set_mac_address
  loop i in [0, dev->addr_len):
    virtio_cwrite8(vdev, offsetof(struct virtio_net_config, mac) + i, addr->sa_data[i])
      -> vdev->config->set(vdev, offset, &val, sizeof(val))
      -> virtio_mmio_config_ops.set
      -> vm_set
```

This path reaches `virtio_mmio_config_ops` directly instead of a virtqueue.

## 6. `virtnet_set_rx_mode`

This one is deferred:

```text
virtnet_set_rx_mode
  -> schedule_work(&vi->rx_mode_work)
    -> virtnet_rx_mode_work
      -> control VQ commands
```

### Promisc / allmulti toggles

Each toggle does:

```text
sg_init_one(sg, promisc_allmulti, sizeof(*promisc_allmulti))
virtnet_send_command(...)
  -> virtqueue_add_sgs
  -> virtqueue_kick
  -> virtqueue_notify
  -> vm_notify / vm_notify_with_data
```

### MAC filter table update

```text
sg_init_table(sg, 2)
sg_set_buf(&sg[0], mac_data,
           sizeof(mac_data->entries) + uc_count * ETH_ALEN)
sg_set_buf(&sg[1], mac_data,
           sizeof(mac_data->entries) + mc_count * ETH_ALEN)
virtnet_send_command(...)
  -> virtqueue_add_sgs
  -> virtqueue_kick
  -> virtqueue_notify
  -> vm_notify / vm_notify_with_data
```

## 7. `virtnet_vlan_rx_add_vid`

```text
virtnet_vlan_rx_add_vid
  -> *_vid = cpu_to_virtio16(...)
  -> sg_init_one(&sg, _vid, sizeof(*_vid))
  -> virtnet_send_command(...)
    -> virtqueue_add_sgs
    -> virtqueue_kick
    -> virtqueue_notify
    -> vm_notify / vm_notify_with_data
```

## 8. `virtnet_vlan_rx_kill_vid`

Same shape as add:

```text
virtnet_vlan_rx_kill_vid
  -> sg_init_one(&sg, _vid, sizeof(*_vid))
  -> virtnet_send_command(...)
    -> virtqueue_add_sgs
    -> virtqueue_kick
    -> virtqueue_notify
    -> vm_notify / vm_notify_with_data
```

## 9. `virtnet_set_features`

Two relevant subpaths.

### Guest offloads path

If `NETIF_F_GRO_HW` toggles:

```text
virtnet_set_features
  -> virtnet_set_guest_offloads(vi, offloads)
    -> sg_init_one(&sg, _offloads, sizeof(*_offloads))
    -> virtnet_send_command(...)
      -> virtqueue_add_sgs
      -> virtqueue_kick
      -> virtqueue_notify
      -> vm_notify / vm_notify_with_data
```

### RSS path

If `NETIF_F_RXHASH` toggles:

```text
virtnet_set_features
  -> virtnet_commit_rss_command
    -> sg_init_table(sgs, 2)
    -> sg_set_buf(&sgs[0], vi->rss_hdr,     virtnet_rss_hdr_size(vi))
    -> sg_set_buf(&sgs[1], &vi->rss_trailer, virtnet_rss_trailer_size(vi))
    -> virtnet_send_command(...)
      -> virtqueue_add_sgs
      -> virtqueue_kick
      -> virtqueue_notify
      -> vm_notify / vm_notify_with_data
```

## 10. Ops with No Direct Target Path

These `virtnet_netdev` entries do not directly reach the requested endpoints in
their own call path:

- `virtnet_close`
- `virtnet_xdp`
- `virtnet_tx_timeout`
- `virtnet_stats`
- `virtnet_get_phys_port_name`
- `eth_validate_addr`
- `passthru_features_check`

`virtnet_xsk_wakeup` is not a direct submission path, but it is an important
deferred path because it schedules the TX NAPI that later reaches
`virtqueue_add_outbuf_premapped` and `vm_notify`.
