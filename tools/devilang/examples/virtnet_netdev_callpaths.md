# virtnet_netdev SG Analysis

Source baseline:
- `drivers/net/virtio_net.c`
- `drivers/virtio/virtio_ring.c`
- `include/linux/scatterlist.h`

Cached tree used:
- `/home/debian/Morpheus/.cache/hyperarm/tools/buildroot/builds/arm64-dev/output/build/linux-6.18.16`

This note starts from the `virtnet_netdev` function pointers in
`drivers/net/virtio_net.c` and does intra-procedural SG analysis on the real
code paths that reach:
- `virtqueue_add_inbuf`
- `virtqueue_add_inbuf_premapped`
- `virtqueue_add_outbuf`
- `virtqueue_add_outbuf_premapped`
- `virtqueue_add_sgs`
- `vm_notify`
- `virtio_mmio_config_ops.set`

Conventions:
- `in` means device-writable SG submitted via `virtqueue_add_inbuf*`.
- `out` means device-readable SG submitted via `virtqueue_add_outbuf*` or
  `virtqueue_add_sgs(..., out_num, in_num, ...)`.
- If a precise C type is clear from the local function, it is used.
- Otherwise the entry is listed as `raw bytes`.
- If a size is symbolic in code, the table keeps the same symbolic form.

Direction basis:
- `virtqueue_add_inbuf()` calls `virtqueue_add(vq, &sg, num, 0, 1, ...)`.
- `virtqueue_add_inbuf_premapped()` calls
  `virtqueue_add(vq, &sg, num, 0, 1, ..., true, ...)`.
- So every SG in these RX paths is `in`.
- References:
  `drivers/virtio/virtio_ring.c:2573-2579`,
  `drivers/virtio/virtio_ring.c:2621-2627`.

## net_device_ops Coverage

| netdev op | queue path | SG summary |
| --- | --- | --- |
| `virtnet_open` | yes | RX refill SGs to `virtqueue_add_inbuf*` |
| `virtnet_close` | no | no SG submission on this path |
| `start_xmit` | yes | TX SGs to `virtqueue_add_outbuf` |
| `virtnet_set_mac_address` | yes | control-VQ SGs via `virtqueue_add_sgs`; legacy MMIO write path has no SG |
| `virtnet_set_rx_mode` | yes | deferred control-VQ SGs via `virtqueue_add_sgs` |
| `virtnet_vlan_rx_add_vid` | yes | control-VQ SG via `virtqueue_add_sgs` |
| `virtnet_vlan_rx_kill_vid` | yes | control-VQ SG via `virtqueue_add_sgs` |
| `virtnet_xdp` | indirect | reconfig paths call control-VQ helpers and RX refill helpers |
| `virtnet_xdp_xmit` | yes | TX SGs to `virtqueue_add_outbuf` |
| `virtnet_xsk_wakeup` | indirect | deferred TX path to `virtqueue_add_outbuf_premapped` |
| `virtnet_set_features` | yes | control-VQ SGs via guest offload / RSS helpers |
| `virtnet_tx_timeout` | no | no SG submission on this path |

## 1. `virtnet_open`

Entry:
- `drivers/net/virtio_net.c:3220-3248`

Path root:
- `virtnet_open`
  -> `try_fill_recv`
  -> one of:
  `add_recvbuf_small`,
  `add_recvbuf_big`,
  `add_recvbuf_mergeable`,
  `virtnet_add_recvbuf_xsk`
  -> `virtqueue_add_inbuf*`
  -> `virtqueue_notify`
  -> `vm_notify` / `vm_notify_with_data`

### path1
`virtnet_open -> try_fill_recv -> add_recvbuf_big -> virtqueue_add_inbuf -> virtqueue_add`

Refs:
- `try_fill_recv`: `drivers/net/virtio_net.c:2833-2864`
- `add_recvbuf_big`: `drivers/net/virtio_net.c:2706-2752`

`sg buf count`: `vi->big_packets_num_skbfrags + 2`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `in` | `struct padded_vnet_hdr` | `vi->hdr_len` | `p` | `drivers/net/virtio_net.c:2739` |
| `buf1` | `in` | `raw bytes` | `PAGE_SIZE - sizeof(struct padded_vnet_hdr)` | `p + offset` | `drivers/net/virtio_net.c:2742-2743` |
| `buf2..bufN` | `in` | `raw bytes` | `PAGE_SIZE` | `page_address(first)` | `drivers/net/virtio_net.c:2716-2723` |

Notes:
- `buf0` and `buf1` share the same page from `p = page_address(first)`.
- `buf2..bufN` covers `i = 2 .. vi->big_packets_num_skbfrags + 1`.

### path2
`virtnet_open -> try_fill_recv -> add_recvbuf_mergeable -> virtqueue_add_inbuf_premapped -> virtqueue_add`

Refs:
- `try_fill_recv`: `drivers/net/virtio_net.c:2833-2864`
- `add_recvbuf_mergeable`: `drivers/net/virtio_net.c:2772-2824`
- `virtnet_rq_init_one_sg`: `drivers/net/virtio_net.c:987-1007`

`sg buf count`: `1`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `in` | `raw bytes` | `len` | premapped DMA for `buf + headroom` | `drivers/net/virtio_net.c:2800,2814,2817` |

Notes:
- `buf0` is created by `sg_init_table(rq->sg, 1)` plus
  `sg_fill_dma(rq->sg, addr, len)`.
- `len = get_mergeable_buf_len(rq, &rq->mrg_avg_pkt_len, room)`, then may be
  adjusted by the local hole logic.

### path3
`virtnet_open -> try_fill_recv -> add_recvbuf_small -> virtqueue_add_inbuf_premapped -> virtqueue_add`

Refs:
- `try_fill_recv`: `drivers/net/virtio_net.c:2833-2864`
- `add_recvbuf_small`: `drivers/net/virtio_net.c:2674-2704`
- `virtnet_rq_init_one_sg`: `drivers/net/virtio_net.c:987-1007`

`sg buf count`: `1`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `in` | `raw bytes` | `vi->hdr_len + GOOD_PACKET_LEN` | premapped DMA for `buf + VIRTNET_RX_PAD + xdp_headroom` | `drivers/net/virtio_net.c:2693,2695,2697` |

### path4
`virtnet_open -> try_fill_recv -> virtnet_add_recvbuf_xsk -> virtqueue_add_inbuf_premapped -> virtqueue_add`

Refs:
- `try_fill_recv`: `drivers/net/virtio_net.c:2833-2864`
- XSK SG setup: `drivers/net/virtio_net.c:1477-1480`

`sg buf count`: `1`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `in` | `raw bytes` | `len` | premapped DMA at `addr = xsk_buff_xdp_get_dma(...) - vi->hdr_len` | `drivers/net/virtio_net.c:1477-1480` |

Notes:
- `len = xsk_pool_get_rx_frame_size(pool) + vi->hdr_len` on this path.

## 2. `start_xmit`

Entry:
- `drivers/net/virtio_net.c:3376-3435`

Path:
- `start_xmit`
  -> `xmit_skb`
  -> `virtnet_add_outbuf`
  -> `virtqueue_add_outbuf`
  -> `virtqueue_notify`
  -> `vm_notify` / `vm_notify_with_data`

SG setup:
- `drivers/net/virtio_net.c:3337-3373`

### path1
`start_xmit -> xmit_skb(can_push == false) -> virtqueue_add_outbuf -> virtqueue_add`

`sg buf count`: `skb_shinfo(skb)->nr_frags + 2`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_hdr_v1_hash_tunnel` | `hdr_len` | `hdr` | `drivers/net/virtio_net.c:3345,3365` |
| `buf1..bufN` | `out` | `raw bytes` | `skb_to_sgvec(...)` derived | `skb` payload and frags | `drivers/net/virtio_net.c:3366-3369` |

### path2
`start_xmit -> xmit_skb(can_push == true) -> virtqueue_add_outbuf -> virtqueue_add`

`sg buf count`: `skb_shinfo(skb)->nr_frags + 1`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0..bufN` | `out` | `raw bytes` | `skb_to_sgvec(...)` derived | pushed `skb` data including virtio header | `drivers/net/virtio_net.c:3357-3363` |

Notes:
- Here the virtio header is pushed into the skb head and folded into the first
  SG element rather than created by an explicit `sg_set_buf()`.

## 3. `virtnet_xdp_xmit`

Entry:
- `drivers/net/virtio_net.c:1722-1778`

Path:
- `virtnet_xdp_xmit`
  -> `__virtnet_xdp_xmit_one`
  -> `virtnet_add_outbuf`
  -> `virtqueue_add_outbuf`
  -> `virtqueue_notify`
  -> `vm_notify` / `vm_notify_with_data`

SG setup:
- `drivers/net/virtio_net.c:1640-1678`

`sg buf count`: `nr_frags + 1`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `raw bytes` | `xdpf->len` | `xdpf->data` | `drivers/net/virtio_net.c:1661-1669` |
| `buf1..bufN` | `out` | `raw bytes` | `skb_frag_size(frag)` | `skb_frag_page(frag)` + `skb_frag_off(frag)` | `drivers/net/virtio_net.c:1670-1674` |

Notes:
- `xdpf->data` is first moved backward by `vi->hdr_len`.
- The front of `buf0` therefore contains a zeroed virtio net header.

## 4. `virtnet_xsk_wakeup`

Entry:
- `drivers/net/virtio_net.c:1609-1638`

Path:
- `virtnet_xsk_wakeup`
  -> deferred TX NAPI
  -> `virtnet_xsk_xmit_one`
  -> `virtqueue_add_outbuf_premapped`
  -> `virtqueue_notify`
  -> `vm_notify` / `vm_notify_with_data`

SG setup:
- `drivers/net/virtio_net.c:1516-1518`

`sg buf count`: `2`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `raw bytes` | `vi->hdr_len` | premapped DMA at `sq->xsk_hdr_dma_addr` | `drivers/net/virtio_net.c:1516-1517` |
| `buf1` | `out` | `raw bytes` | `desc->len` | premapped DMA at `addr = xsk_buff_raw_get_dma(pool, desc->addr)` | `drivers/net/virtio_net.c:1518` |

## 5. `virtnet_set_mac_address`

Entry:
- `drivers/net/virtio_net.c:3663-3707`

### control-vq path
`virtnet_set_mac_address -> virtnet_send_command -> virtnet_send_command_reply -> virtqueue_add_sgs`

Refs:
- payload SG: `drivers/net/virtio_net.c:3682-3685`
- control wrapper: `drivers/net/virtio_net.c:3600-3654`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `raw bytes` | `dev->addr_len` | `addr->sa_data` | `drivers/net/virtio_net.c:3683` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

### legacy mmio path
`virtnet_set_mac_address -> virtio_cwrite8 -> vm_set`

Refs:
- `drivers/net/virtio_net.c:3691-3699`

Notes:
- This path reaches `virtio_mmio_config_ops.set`.
- It does not build SGs.

## 6. `virtnet_set_rx_mode`

Entry:
- `drivers/net/virtio_net.c:3957-3963`

Deferred worker:
- `drivers/net/virtio_net.c:3868-3955`

### promisc path
`virtnet_set_rx_mode -> virtnet_rx_mode_work -> virtnet_send_command -> virtqueue_add_sgs`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `u8` | `sizeof(*promisc_allmulti)` | `promisc_allmulti` | `drivers/net/virtio_net.c:3894-3898` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

### allmulti path
`virtnet_set_rx_mode -> virtnet_rx_mode_work -> virtnet_send_command -> virtqueue_add_sgs`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `u8` | `sizeof(*promisc_allmulti)` | `promisc_allmulti` | `drivers/net/virtio_net.c:3902-3906` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

### mac filter table path
`virtnet_set_rx_mode -> virtnet_rx_mode_work -> virtnet_send_command -> virtqueue_add_sgs`

`sg buf count`: `4`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `struct virtio_net_ctrl_mac` prefix + unicast MAC array | `sizeof(mac_data->entries) + (uc_count * ETH_ALEN)` | `mac_data` | `drivers/net/virtio_net.c:3926-3933` |
| `buf2` | `out` | `struct virtio_net_ctrl_mac` prefix + multicast MAC array | `sizeof(mac_data->entries) + (mc_count * ETH_ALEN)` | shifted `mac_data` | `drivers/net/virtio_net.c:3936-3946` |
| `buf3` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

## 7. `virtnet_vlan_rx_add_vid`

Entry:
- `drivers/net/virtio_net.c:3965-3983`

Path:
- `virtnet_vlan_rx_add_vid`
  -> `virtnet_send_command`
  -> `virtqueue_add_sgs`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `__virtio16` | `sizeof(*_vid)` | `_vid` | `drivers/net/virtio_net.c:3976-3979` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

## 8. `virtnet_vlan_rx_kill_vid`

Entry:
- `drivers/net/virtio_net.c:3985-4002`

Path:
- `virtnet_vlan_rx_kill_vid`
  -> `virtnet_send_command`
  -> `virtqueue_add_sgs`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `__virtio16` | `sizeof(*_vid)` | `_vid` | `drivers/net/virtio_net.c:3996-3999` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

## 9. `virtnet_xdp`

Entry:
- `drivers/net/virtio_net.c:6165-6175`

This is a dispatcher. The SG-relevant subpaths are:
- `XDP_SETUP_PROG`
  -> `virtnet_xdp_set`
  -> may call `virtnet_set_queues`
  -> `virtnet_commit_rss_command` or `virtnet_send_command`
- `XDP_SETUP_PROG`
  -> `virtnet_xdp_set`
  -> `virtnet_rx_resume_all`
  -> `try_fill_recv`
  -> same RX SG paths as `virtnet_open`
- `XDP_SETUP_XSK_POOL`
  -> `virtnet_xsk_pool_setup`
  -> later wakeups use the same deferred XSK TX SG path as `virtnet_xsk_wakeup`

### queue-pairs control path
`virtnet_xdp -> virtnet_xdp_set -> virtnet_set_queues -> virtnet_send_command -> virtqueue_add_sgs`

Refs:
- `drivers/net/virtio_net.c:6049-6163`
- `drivers/net/virtio_net.c:3771-3837`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `struct virtio_net_ctrl_mq` | `sizeof(*mq)` | `mq` | `drivers/net/virtio_net.c:3819-3823` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

### rss control path
`virtnet_xdp -> virtnet_xdp_set -> virtnet_set_queues -> virtnet_commit_rss_command -> virtqueue_add_sgs`

`sg buf count`: `4`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `struct virtio_net_rss_config_hdr` | `virtnet_rss_hdr_size(vi)` | `vi->rss_hdr` | `drivers/net/virtio_net.c:4262-4263` |
| `buf2` | `out` | `struct virtio_net_rss_config_trailer` | `virtnet_rss_trailer_size(vi)` | `&vi->rss_trailer` | `drivers/net/virtio_net.c:4262-4264` |
| `buf3` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

### guest offload clear/restore path
`virtnet_xdp -> virtnet_xdp_set -> virtnet_clear_guest_offloads/virtnet_restore_guest_offloads -> virtnet_set_guest_offloads -> virtqueue_add_sgs`

Refs:
- `drivers/net/virtio_net.c:6111-6114`
- `drivers/net/virtio_net.c:6126-6130`
- `drivers/net/virtio_net.c:5824-5840`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `__virtio64` | `sizeof(*_offloads)` | `_offloads` | `drivers/net/virtio_net.c:5830-5835` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

## 10. `virtnet_set_features`

Entry:
- `drivers/net/virtio_net.c:6193-6226`

### guest offloads path
`virtnet_set_features -> virtnet_set_guest_offloads -> virtnet_send_command -> virtqueue_add_sgs`

Refs:
- `drivers/net/virtio_net.c:6200-6214`
- `drivers/net/virtio_net.c:5824-5840`

`sg buf count`: `3`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `__virtio64` | `sizeof(*_offloads)` | `_offloads` | `drivers/net/virtio_net.c:5830-5835` |
| `buf2` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

### rss path
`virtnet_set_features -> virtnet_commit_rss_command -> virtnet_send_command -> virtqueue_add_sgs`

Refs:
- `drivers/net/virtio_net.c:6216-6223`
- `drivers/net/virtio_net.c:4256-4275`

`sg buf count`: `4`

| buf | dir | type | size | source | ref |
| --- | --- | --- | --- | --- | --- |
| `buf0` | `out` | `struct virtio_net_ctrl_hdr` | `sizeof(vi->ctrl->hdr)` | `&vi->ctrl->hdr` | `drivers/net/virtio_net.c:3614-3618` |
| `buf1` | `out` | `struct virtio_net_rss_config_hdr` | `virtnet_rss_hdr_size(vi)` | `vi->rss_hdr` | `drivers/net/virtio_net.c:4262-4263` |
| `buf2` | `out` | `struct virtio_net_rss_config_trailer` | `virtnet_rss_trailer_size(vi)` | `&vi->rss_trailer` | `drivers/net/virtio_net.c:4262-4264` |
| `buf3` | `in` | `u8` | `sizeof(vi->ctrl->status)` | `&vi->ctrl->status` | `drivers/net/virtio_net.c:3623-3625` |

## 11. No Direct SG Path

These `virtnet_netdev` entries do not build SGs on their own direct path:
- `virtnet_close`
- `virtnet_tx_timeout`

Indirect-only:
- `virtnet_xsk_wakeup` schedules later TX work.
- `virtnet_xdp` dispatches into reconfiguration and refill helpers rather than
  building SGs directly in the top-level function body.
