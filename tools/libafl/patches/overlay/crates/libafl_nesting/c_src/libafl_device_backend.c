/*
 * Small seed-driven vhost-user backend used by the nesting harness.
 *
 * This process is deliberately outside L2 QEMU.  It implements only the
 * subset of vhost-user needed by the generic vhost-user-test-device: feature
 * negotiation, shared-memory registration, split virtqueues, config reads,
 * and RX completions.  The input is the normal ScenarioInput wire format, so
 * no CVE or profile selector is needed in the launcher.
 */

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/un.h>
#include <setjmp.h>
#include <signal.h>
#include <unistd.h>

#define VHOST_USER_VERSION 1u
#define VHOST_USER_REPLY_MASK (1u << 2)
#define VHOST_USER_NEED_REPLY_MASK (1u << 3)
#define VHOST_USER_F_PROTOCOL_FEATURES 30u
#define VHOST_USER_PROTOCOL_F_MQ 0u
#define VHOST_USER_PROTOCOL_F_CONFIG 9u
#define VHOST_USER_PROTOCOL_F_GPA_ADDRESSES 21u

#define VHOST_USER_GET_FEATURES 1u
#define VHOST_USER_SET_FEATURES 2u
#define VHOST_USER_SET_OWNER 3u
#define VHOST_USER_RESET_OWNER 4u
#define VHOST_USER_SET_MEM_TABLE 5u
#define VHOST_USER_SET_LOG_FD 7u
#define VHOST_USER_SET_VRING_NUM 8u
#define VHOST_USER_SET_VRING_ADDR 9u
#define VHOST_USER_SET_VRING_BASE 10u
#define VHOST_USER_SET_VRING_KICK 12u
#define VHOST_USER_SET_VRING_CALL 13u
#define VHOST_USER_SET_VRING_ERR 14u
#define VHOST_USER_GET_PROTOCOL_FEATURES 15u
#define VHOST_USER_SET_PROTOCOL_FEATURES 16u
#define VHOST_USER_GET_QUEUE_NUM 17u
#define VHOST_USER_SET_VRING_ENABLE 18u
#define VHOST_USER_GET_CONFIG 24u
#define VHOST_USER_SET_STATUS 39u
#define VHOST_USER_GET_STATUS 40u

#define VIRTIO_F_VERSION_1 32u
#define VIRTIO_NET_F_MAC 5u
#define VIRTIO_NET_F_STATUS 16u
#define VIRTIO_NET_F_CTRL_VQ 17u
#define VIRTIO_NET_F_HASH_REPORT 57u

#define VHOST_USER_HDR_SIZE 12u
#define VHOST_USER_MAX_PAYLOAD 4096u
#define VHOST_USER_MAX_FDS 8u
#define VHOST_USER_MAX_RAM_SLOTS 8u
#define VHOST_USER_MAX_QUEUES 4u
#define VHOST_USER_DEVICE_QUEUE_COUNT 3u
#define VIRTQUEUE_MAX_SIZE 1024u
#define MAX_SEED_BYTES (1u << 20)
#define MAX_RX_ACTIONS 64u
#define MAX_CONFIG_SIZE 256u
#define MAX_RX_BYTES (1u << 20)

#define VRING_DESC_F_NEXT 1u
#define VRING_DESC_F_WRITE 2u
#define VRING_DESC_F_INDIRECT 4u

/* Generic virtio-mmio offsets.  These are used only to reconstruct queue
 * state when stock CCA QEMU cannot hand the protected ring to vhost-user. */
#define VIRTIO_MMIO_QUEUE_SEL 0x030u
#define VIRTIO_MMIO_QUEUE_NUM 0x038u
#define VIRTIO_MMIO_QUEUE_READY 0x044u
#define VIRTIO_MMIO_QUEUE_NOTIFY 0x050u
#define VIRTIO_MMIO_STATUS 0x070u
#define VIRTIO_MMIO_QUEUE_DESC_LOW 0x080u
#define VIRTIO_MMIO_QUEUE_DESC_HIGH 0x084u
#define VIRTIO_MMIO_QUEUE_AVAIL_LOW 0x090u
#define VIRTIO_MMIO_QUEUE_AVAIL_HIGH 0x094u
#define VIRTIO_MMIO_QUEUE_USED_LOW 0x0a0u
#define VIRTIO_MMIO_QUEUE_USED_HIGH 0x0a4u

enum rx_result {
  RX_ERROR = -1,
  RX_NO_WORK = 0,
  RX_COMPLETED = 1,
};

struct vhost_user_header {
  uint32_t request;
  uint32_t flags;
  uint32_t size;
};

struct vhost_user_memory_region {
  uint64_t guest_phys_addr;
  uint64_t memory_size;
  uint64_t userspace_addr;
  uint64_t mmap_offset;
};

struct vhost_user_vring_addr {
  uint32_t index;
  uint32_t flags;
  uint64_t desc_user_addr;
  uint64_t used_user_addr;
  uint64_t avail_user_addr;
  uint64_t log_guest_addr;
};

struct vring_desc {
  uint64_t addr;
  uint32_t len;
  uint16_t flags;
  uint16_t next;
} __attribute__((packed));

struct vring_used_elem {
  uint32_t id;
  uint32_t len;
} __attribute__((packed));

struct memory_slot {
  uint64_t gpa;
  uint64_t size;
  uint64_t qva;
  uint64_t mmap_offset;
  uint8_t *mapping;
  uint8_t *data;
};

struct queue_state {
  uint32_t num;
  uint64_t desc;
  uint64_t avail;
  uint64_t used;
  uint16_t last_avail;
  uint16_t used_idx;
  int kick_fd;
  int call_fd;
  bool addr_set;
  bool enabled;
  bool trace_notified;
  bool trace_fallback;
};

struct rx_action {
  uint16_t queue;
  uint32_t payload_len;
  uint32_t used_len;
};

struct backend_state {
  uint64_t features;
  uint64_t protocol_features;
  uint64_t negotiated_features;
  uint64_t negotiated_protocol_features;
  uint8_t config[MAX_CONFIG_SIZE];
  size_t config_size;
  struct rx_action rx[MAX_RX_ACTIONS];
  bool rx_consumed[MAX_RX_ACTIONS];
  size_t rx_count;
  struct memory_slot memory[VHOST_USER_MAX_RAM_SLOTS];
  size_t memory_count;
  struct queue_state queues[VHOST_USER_MAX_QUEUES];
  uint8_t *seed;
  size_t seed_len;
  const char *trace_path;
  off_t trace_offset;
  uint32_t trace_queue_sel;
  bool trace_error;
  FILE *log;
  uint8_t *payload;
};

struct wire_message {
  struct vhost_user_header header;
  uint8_t payload[VHOST_USER_MAX_PAYLOAD];
};

static uint16_t load_u16(const uint8_t *p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t load_u32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
         ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint64_t load_u64(const uint8_t *p) {
  return (uint64_t)load_u32(p) | ((uint64_t)load_u32(p + 4) << 32);
}

static void store_u16(uint8_t *p, uint16_t value) {
  p[0] = (uint8_t)value;
  p[1] = (uint8_t)(value >> 8);
}

static void store_u32(uint8_t *p, uint32_t value) {
  p[0] = (uint8_t)value;
  p[1] = (uint8_t)(value >> 8);
  p[2] = (uint8_t)(value >> 16);
  p[3] = (uint8_t)(value >> 24);
}

static void log_line(struct backend_state *state, const char *format, ...) {
  va_list args;

  if (!state->log) {
    return;
  }
  va_start(args, format);
  vfprintf(state->log, format, args);
  va_end(args);
  fputc('\n', state->log);
  fflush(state->log);
}

static bool write_full(int fd, const void *buffer, size_t length) {
  const uint8_t *bytes = buffer;

  while (length > 0) {
    ssize_t written = write(fd, bytes, length);
    if (written < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    if (written == 0) {
      return false;
    }
    bytes += (size_t)written;
    length -= (size_t)written;
  }
  return true;
}

static bool read_full(int fd, void *buffer, size_t length) {
  uint8_t *bytes = buffer;

  while (length > 0) {
    ssize_t read_count = read(fd, bytes, length);
    if (read_count < 0) {
      if (errno == EINTR) {
        continue;
      }
      return false;
    }
    if (read_count == 0) {
      return false;
    }
    bytes += (size_t)read_count;
    length -= (size_t)read_count;
  }
  return true;
}

static bool receive_message(int fd, struct wire_message *message, int *fds,
                            size_t *fd_count) {
  struct iovec iov = {
      .iov_base = &message->header,
      .iov_len = sizeof(message->header),
  };
  uint8_t control[CMSG_SPACE(sizeof(int) * VHOST_USER_MAX_FDS)];
  struct msghdr msghdr = {
      .msg_iov = &iov,
      .msg_iovlen = 1,
      .msg_control = control,
      .msg_controllen = sizeof(control),
  };
  ssize_t received;

  *fd_count = 0;
  do {
    received = recvmsg(fd, &msghdr, 0);
  } while (received < 0 && errno == EINTR);
  if (received <= 0) {
    return false;
  }
  if ((size_t)received < sizeof(message->header) &&
      !read_full(fd, (uint8_t *)&message->header + received,
                 sizeof(message->header) - (size_t)received)) {
    return false;
  }

  for (struct cmsghdr *cmsg = CMSG_FIRSTHDR(&msghdr); cmsg;
       cmsg = CMSG_NXTHDR(&msghdr, cmsg)) {
    if (cmsg->cmsg_level != SOL_SOCKET || cmsg->cmsg_type != SCM_RIGHTS) {
      continue;
    }
    size_t bytes = cmsg->cmsg_len - CMSG_LEN(0);
    size_t count = bytes / sizeof(int);
    if (count > VHOST_USER_MAX_FDS - *fd_count) {
      count = VHOST_USER_MAX_FDS - *fd_count;
    }
    memcpy(fds + *fd_count, CMSG_DATA(cmsg), count * sizeof(int));
    *fd_count += count;
  }

  if (message->header.size > VHOST_USER_MAX_PAYLOAD) {
    return false;
  }
  return read_full(fd, message->payload, message->header.size);
}

static bool send_reply(int fd, uint32_t request, const void *payload,
                       size_t payload_size) {
  struct {
    struct vhost_user_header header;
    uint8_t payload[VHOST_USER_MAX_PAYLOAD];
  } message = {
      .header = {
          .request = request,
          .flags = VHOST_USER_VERSION | VHOST_USER_REPLY_MASK,
          .size = (uint32_t)payload_size,
      },
  };

  if (payload_size > sizeof(message.payload)) {
    return false;
  }
  if (payload_size > 0) {
    memcpy(message.payload, payload, payload_size);
  }
  return write_full(fd, &message, sizeof(message.header) + payload_size);
}

static void close_fds(int *fds, size_t fd_count) {
  for (size_t i = 0; i < fd_count; i++) {
    if (fds[i] >= 0) {
      close(fds[i]);
    }
  }
}

static uint8_t *slot_pointer(const struct memory_slot *slot, uint64_t base,
                             uint64_t address, size_t length) {
  uint64_t offset;

  if (address < base) {
    return NULL;
  }
  offset = address - base;
  if (offset > slot->size || length > slot->size - offset) {
    return NULL;
  }
  return slot->data + offset;
}

/*
 * RME exposes a top-half shared GPA alias for the merged QEMU memory view.
 * Keep this generic: find an alias that lands in a registered memory slot
 * instead of baking the current IPA width into the backend.
 */
static uint8_t *rme_alias_pointer(struct backend_state *state, uint64_t address,
                                  size_t length, bool qemu_address) {
  for (size_t i = 0; i < state->memory_count; i++) {
    struct memory_slot *slot = &state->memory[i];
    uint64_t base = qemu_address ? slot->qva : slot->gpa;
    uint8_t *pointer = slot_pointer(slot, base, address, length);
    if (pointer) {
      return pointer;
    }
  }

  if (qemu_address) {
    return NULL;
  }

  for (unsigned bit = 63; bit > 0; bit--) {
    uint64_t mask = (UINT64_C(1) << bit) - 1;
    uint64_t alias = address & mask;

    if (alias == address) {
      continue;
    }
    for (size_t i = 0; i < state->memory_count; i++) {
      struct memory_slot *slot = &state->memory[i];
      uint64_t base = qemu_address ? slot->qva : slot->gpa;
      uint8_t *pointer = slot_pointer(slot, base, alias, length);
      if (pointer) {
        return pointer;
      }
    }
  }
  return NULL;
}

static uint8_t *guest_pointer(struct backend_state *state, uint64_t address,
                              size_t length) {
  return rme_alias_pointer(state, address, length, false);
}

/* SET_VRING_ADDR uses GPA addresses when GPA_ADDRESSES was negotiated. */
static uint8_t *qemu_pointer(struct backend_state *state, uint64_t address,
                             size_t length) {
  bool gpa_addresses =
      (state->negotiated_protocol_features &
       (UINT64_C(1) << VHOST_USER_PROTOCOL_F_GPA_ADDRESSES)) != 0;
  return rme_alias_pointer(state, address, length, gpa_addresses ? false : true);
}

static const char *queue_address_space(const struct backend_state *state,
                                       const struct queue_state *queue) {
  if (queue->trace_fallback) {
    return "trace-gpa";
  }
  if ((state->negotiated_protocol_features &
       (UINT64_C(1) << VHOST_USER_PROTOCOL_F_GPA_ADDRESSES)) != 0) {
    return "vhost-gpa";
  }
  return "vhost-qva";
}

static uint8_t *queue_pointer(struct backend_state *state,
                              const struct queue_state *queue,
                              uint64_t address, size_t length) {
  if (queue->trace_fallback) {
    return guest_pointer(state, address, length);
  }
  return qemu_pointer(state, address, length);
}

static void log_dma_access(struct backend_state *state,
                           const struct queue_state *queue, bool write,
                           const char *kind, const char *address_space,
                           uint64_t address, size_t length,
                           const void *pointer) {
  size_t queue_index = queue ? (size_t)(queue - state->queues) : 0;

  log_line(state,
           "dma-%s queue=%zu kind=%s space=%s address=0x%llx length=%zu status=%s",
           write ? "write" : "read", queue_index, kind, address_space,
           (unsigned long long)address, length,
           pointer ? "ok" : "unavailable");
}

static sigjmp_buf memory_probe_jump;
static volatile sig_atomic_t memory_probe_signal;

static void memory_probe_signal_handler(int signal_number) {
  memory_probe_signal = signal_number;
  siglongjmp(memory_probe_jump, 1);
}

/*
 * mmap() can succeed for a file descriptor whose pages are inaccessible from
 * this process (for example, a protected Realm mapping). Touch both ends so
 * an unusable vhost-user memory table fails during negotiation instead of
 * turning into a later, unexplained queue fault.
 */
static bool probe_memory_slot(struct memory_slot *slot) {
  struct sigaction action;
  struct sigaction old_bus_action;
  struct sigaction old_segv_action;
  bool usable = false;
  volatile uint8_t first;
  volatile uint8_t last;

  memset(&action, 0, sizeof(action));
  action.sa_handler = memory_probe_signal_handler;
  sigemptyset(&action.sa_mask);
  if (sigaction(SIGBUS, &action, &old_bus_action) != 0) {
    return false;
  }
  if (sigaction(SIGSEGV, &action, &old_segv_action) != 0) {
    sigaction(SIGBUS, &old_bus_action, NULL);
    return false;
  }

  memory_probe_signal = 0;
  if (sigsetjmp(memory_probe_jump, 1) == 0) {
    first = slot->data[0];
    last = slot->data[slot->size - 1];
    (void)first;
    (void)last;
    usable = true;
  }
  sigaction(SIGSEGV, &old_segv_action, NULL);
  sigaction(SIGBUS, &old_bus_action, NULL);
  return usable && memory_probe_signal == 0;
}

static void clear_memory(struct backend_state *state) {
  for (size_t i = 0; i < state->memory_count; i++) {
    struct memory_slot *slot = &state->memory[i];
    if (slot->mapping) {
      munmap(slot->mapping, slot->size + slot->mmap_offset);
    }
  }
  state->memory_count = 0;
}

static bool apply_config_value(struct backend_state *state, uint64_t offset,
                               uint64_t width, uint64_t value) {
  if (width == 0 || width > sizeof(value) || offset >= MAX_CONFIG_SIZE ||
      width > MAX_CONFIG_SIZE - offset) {
    return false;
  }
  for (uint64_t i = 0; i < width; i++) {
    state->config[offset + i] = (uint8_t)(value >> (i * 8));
  }
  return true;
}

static bool parse_seed(struct backend_state *state, const char *path) {
  FILE *file;
  long file_length;
  size_t length;

  if (!path || !*path) {
    return true;
  }
  file = fopen(path, "rb");
  if (!file) {
    return false;
  }
  if (fseek(file, 0, SEEK_END) != 0) {
    fclose(file);
    return false;
  }
  file_length = ftell(file);
  if (file_length < 0 || (uint64_t)file_length > MAX_SEED_BYTES ||
      fseek(file, 0, SEEK_SET) != 0) {
    fclose(file);
    return false;
  }
  length = (size_t)file_length;
  state->seed = malloc(length ? length : 1);
  if (!state->seed || (length && fread(state->seed, 1, length, file) != length)) {
    free(state->seed);
    state->seed = NULL;
    fclose(file);
    return false;
  }
  fclose(file);
  state->seed_len = length;

  size_t cursor = 0;
  while (cursor < length) {
    uint32_t action_count;
    if (length - cursor < 4) {
      return false;
    }
    action_count = load_u32(state->seed + cursor);
    cursor += 4;
    if (action_count == 0 || action_count > VIRTQUEUE_MAX_SIZE ||
        action_count > (length - cursor) / 40) {
      return false;
    }
    for (uint32_t i = 0; i < action_count; i++, cursor += 40) {
      const uint8_t *record = state->seed + cursor;
      uint8_t family = record[0];
      uint8_t opcode = record[1];
      uint16_t flags = load_u16(record + 2);
      uint64_t arg0 = load_u64(record + 8);
      uint64_t arg1 = load_u64(record + 16);
      uint64_t arg2 = load_u64(record + 24);
      uint64_t arg3 = load_u64(record + 32);

      if (family != 2) {
        continue;
      }
      if (opcode == 1 && (flags & 1u) != 0) {
        if (arg0 < 256 || arg0 - 256 >= state->config_size ||
            !apply_config_value(state, arg0 - 256, arg1, arg2)) {
          return false;
        }
      } else if (opcode == 8) {
        if (state->rx_count >= MAX_RX_ACTIONS ||
            arg0 >= VHOST_USER_MAX_QUEUES || arg0 > UINT16_MAX ||
            arg1 > UINT32_MAX || arg2 > UINT32_MAX) {
          return false;
        }
        state->rx[state->rx_count++] = (struct rx_action){
            .queue = (uint16_t)arg0,
            .payload_len = (uint32_t)arg1,
            .used_len = (uint32_t)arg2,
        };
      } else if (opcode == 9) {
        state->features = arg0 | (UINT64_C(1) << VHOST_USER_F_PROTOCOL_FEATURES);
      } else if (opcode == 10) {
        if (!apply_config_value(state, arg0, arg1, arg2)) {
          return false;
        }
      } else if (opcode == 11) {
        log_line(state,
                 "seed-dma-event addr=0x%llx len=%llu op=%llu dir=%llu "
                 "path=%llu sequence=%llu",
                 (unsigned long long)arg0, (unsigned long long)arg1,
                 (unsigned long long)(arg2 & 0xffu),
                 (unsigned long long)((arg2 >> 8) & 0xffu),
                 (unsigned long long)((arg2 >> 16) & 0xffu),
                 (unsigned long long)arg3);
      }
    }
  }
  return cursor == length;
}

static void initialize_defaults(struct backend_state *state) {
  state->features = (UINT64_C(1) << VHOST_USER_F_PROTOCOL_FEATURES) |
                    (UINT64_C(1) << VIRTIO_F_VERSION_1) |
                    (UINT64_C(1) << VIRTIO_NET_F_MAC) |
                    (UINT64_C(1) << VIRTIO_NET_F_STATUS) |
                    (UINT64_C(1) << VIRTIO_NET_F_CTRL_VQ);
  state->protocol_features = (UINT64_C(1) << VHOST_USER_PROTOCOL_F_MQ) |
                             (UINT64_C(1) << VHOST_USER_PROTOCOL_F_CONFIG) |
                             (UINT64_C(1) << VHOST_USER_PROTOCOL_F_GPA_ADDRESSES);
  state->config_size = 24;
  memset(state->config, 0, sizeof(state->config));
  state->config[0] = 0x52;
  state->config[1] = 0x54;
  state->config[2] = 0x00;
  state->config[3] = 0x12;
  state->config[4] = 0x34;
  state->config[5] = 0x56;
  store_u16(state->config + 6, 1);
  store_u16(state->config + 8, 1);
  store_u16(state->config + 10, 1500);
  store_u32(state->config + 12, UINT32_MAX);
  state->config[16] = 0xff;
  state->config[17] = 40;
  store_u16(state->config + 18, 128);
  store_u32(state->config + 20, 0x1ff);

  for (size_t i = 0; i < VHOST_USER_MAX_QUEUES; i++) {
    state->queues[i].kick_fd = -1;
    state->queues[i].call_fd = -1;
  }
}

static bool set_memory_table(struct backend_state *state, const uint8_t *payload,
                             size_t payload_size, int *fds, size_t fd_count) {
  uint32_t region_count;
  size_t required;

  if (payload_size < 8) {
    log_line(state, "memory-table-invalid reason=short-payload size=%zu",
             payload_size);
    return false;
  }
  region_count = load_u32(payload);
  required = 8 + (size_t)region_count * 32;
  if (region_count > VHOST_USER_MAX_RAM_SLOTS || required > payload_size ||
      fd_count < region_count) {
    log_line(state,
             "memory-table-invalid regions=%u payload=%zu fds=%zu",
             region_count, payload_size, fd_count);
    return false;
  }
  log_line(state, "memory-table=received regions=%u fds=%zu", region_count,
           fd_count);
  clear_memory(state);

  for (uint32_t i = 0; i < region_count; i++) {
    const uint8_t *raw = payload + 8 + (size_t)i * 32;
    uint64_t gpa = load_u64(raw);
    uint64_t size = load_u64(raw + 8);
    uint64_t qva = load_u64(raw + 16);
    uint64_t mmap_offset = load_u64(raw + 24);
    if (size == 0 || gpa > UINT64_MAX - size || qva > UINT64_MAX - size ||
        mmap_offset > SIZE_MAX - size) {
      log_line(state, "memory-table-invalid index=%u gpa=0x%llx qva=0x%llx size=%llu offset=%llu",
               i, (unsigned long long)gpa, (unsigned long long)qva,
               (unsigned long long)size, (unsigned long long)mmap_offset);
      return false;
    }
    void *mapping = mmap(NULL, (size_t)(size + mmap_offset),
                         PROT_READ | PROT_WRITE, MAP_SHARED, fds[i], 0);
    close(fds[i]);
    fds[i] = -1;
    if (mapping == MAP_FAILED) {
      log_line(state, "memory-probe=failed reason=mmap gpa=0x%llx size=%llu",
               (unsigned long long)gpa, (unsigned long long)size);
      return false;
    }
    state->memory[i] = (struct memory_slot){
        .gpa = gpa,
        .size = size,
        .qva = qva,
        .mmap_offset = mmap_offset,
        .mapping = mapping,
        .data = (uint8_t *)mapping + mmap_offset,
    };
    state->memory_count++;
    log_line(state,
             "memory-region index=%u gpa=0x%llx qva=0x%llx size=%llu offset=%llu",
             i, (unsigned long long)gpa, (unsigned long long)qva,
             (unsigned long long)size, (unsigned long long)mmap_offset);
    if (!probe_memory_slot(&state->memory[i])) {
      log_line(state,
               "memory-probe=failed reason=touch signal=%d gpa=0x%llx size=%llu",
               (int)memory_probe_signal, (unsigned long long)gpa,
               (unsigned long long)size);
      return false;
    }
  }
  log_line(state, "memory-probe=passed regions=%u", region_count);
  log_line(state, "memory-regions=%zu", state->memory_count);
  return true;
}

static bool read_desc(struct backend_state *state, struct queue_state *queue,
                      uint16_t index, struct vring_desc *desc) {
  uint8_t *raw;
  if (index >= queue->num) {
    return false;
  }
  uint64_t address = queue->desc + (uint64_t)index * 16;
  raw = queue_pointer(state, queue, address, 16);
  log_dma_access(state, queue, false, "descriptor",
                 queue_address_space(state, queue),
                 address, 16, raw);
  if (!raw) {
    return false;
  }
  desc->addr = load_u64(raw);
  desc->len = load_u32(raw + 8);
  desc->flags = load_u16(raw + 12);
  desc->next = load_u16(raw + 14);
  return true;
}

static bool write_chain(struct backend_state *state, struct queue_state *queue,
                        uint16_t head, const uint8_t *data, size_t length) {
  uint16_t index = head;
  size_t remaining = length;
  bool wrote = false;

  for (uint32_t count = 0; count < queue->num && remaining > 0; count++) {
    struct vring_desc desc;
    if (!read_desc(state, queue, index, &desc)) {
      log_line(state, "rx-desc-ring-unavailable index=%u", index);
      return false;
    }
    if ((desc.flags & VRING_DESC_F_INDIRECT) != 0) {
      log_line(state, "rx-indirect-desc-unsupported index=%u", index);
      return false;
    }
    if ((desc.flags & VRING_DESC_F_WRITE) != 0 && desc.len > 0) {
      size_t copy_length = remaining < desc.len ? remaining : desc.len;
      uint8_t *destination = guest_pointer(state, desc.addr, copy_length);
      log_dma_access(state, queue, true, "payload", "guest-gpa", desc.addr,
                     copy_length, destination);
      if (!destination) {
        log_line(state,
                 "rx-payload-buffer-unavailable addr=0x%llx len=%zu",
                 (unsigned long long)desc.addr, copy_length);
        return false;
      }
      memcpy(destination, data + (length - remaining), copy_length);
      remaining -= copy_length;
      wrote = true;
    }
    if ((desc.flags & VRING_DESC_F_NEXT) == 0) {
      break;
    }
    index = desc.next;
  }
  if (!wrote) {
    log_line(state, "rx-no-writable-descriptor head=%u payload=%zu", head,
             length);
  } else if (remaining != 0) {
    log_line(state, "rx-payload-partial head=%u requested=%zu remaining=%zu",
             head, length, remaining);
  }
  return wrote;
}

static int complete_output(struct backend_state *state, uint32_t queue_index) {
  struct queue_state *queue;
  uint8_t *avail_header;
  uint16_t avail_idx;
  uint16_t head;
  uint16_t used_idx;
  uint16_t ring_index;
  uint32_t written_length = 0;
  uint16_t index;

  if (queue_index >= VHOST_USER_MAX_QUEUES || queue_index == 0) {
    return RX_NO_WORK;
  }
  queue = &state->queues[queue_index];
  if (!queue->addr_set || !queue->enabled || queue->num == 0 ||
      queue->num > VIRTQUEUE_MAX_SIZE) {
    return RX_NO_WORK;
  }
  avail_header = queue_pointer(state, queue, queue->avail, 4);
  log_dma_access(state, queue, false, "avail-header",
                 queue_address_space(state, queue),
                 queue->avail, 4, avail_header);
  if (!avail_header) {
    log_line(state, "output-avail-ring-unavailable queue=%u addr=0x%llx",
             queue_index, (unsigned long long)queue->avail);
    return RX_ERROR;
  }
  avail_idx = load_u16(avail_header + 2);
  if (queue->last_avail == avail_idx) {
    return RX_NO_WORK;
  }
  uint64_t avail_entry_address = queue->avail + 4 +
      (uint64_t)(queue->last_avail % queue->num) * 2;
  uint8_t *avail_entry = queue_pointer(
      state, queue, queue->avail + 4 +
                 (uint64_t)(queue->last_avail % queue->num) * 2,
      2);
  log_dma_access(state, queue, false, "avail-entry",
                 queue_address_space(state, queue),
                 avail_entry_address, 2, avail_entry);
  if (!avail_entry) {
    log_line(state, "output-avail-entry-unavailable queue=%u addr=0x%llx",
             queue_index,
             (unsigned long long)(queue->avail + 4 +
                                  (uint64_t)(queue->last_avail % queue->num) * 2));
    return RX_ERROR;
  }
  head = load_u16(avail_entry);
  if (head >= queue->num) {
    log_line(state, "output-invalid-head queue=%u head=%u", queue_index, head);
    return RX_ERROR;
  }

  /* Complete TX/control requests. A control request ends in a one-byte
   * writable status descriptor; returning zero makes it succeed. TX requests
   * normally have no writable descriptor and complete with length zero. */
  index = head;
  for (uint32_t count = 0; count < queue->num; count++) {
    struct vring_desc desc;
    if (!read_desc(state, queue, index, &desc) ||
        (desc.flags & VRING_DESC_F_INDIRECT) != 0) {
      log_line(state, "output-desc-ring-unavailable queue=%u index=%u",
               queue_index, index);
      return RX_ERROR;
    }
    if ((desc.flags & VRING_DESC_F_WRITE) != 0 && desc.len > 0) {
      uint8_t *destination = guest_pointer(state, desc.addr, 1);
      log_dma_access(state, queue, true, "status", "guest-gpa", desc.addr, 1,
                     destination);
      if (!destination) {
        log_line(state,
                 "output-status-buffer-unavailable queue=%u addr=0x%llx",
                 queue_index, (unsigned long long)desc.addr);
        return RX_ERROR;
      }
      destination[0] = 0;
      written_length += 1;
    }
    if ((desc.flags & VRING_DESC_F_NEXT) == 0) {
      break;
    }
    index = desc.next;
  }

  uint8_t *used_header = queue_pointer(state, queue, queue->used, 4);
  log_dma_access(state, queue, false, "used-header",
                 queue_address_space(state, queue),
                 queue->used, 4, used_header);
  if (!used_header) {
    log_line(state, "output-used-ring-unavailable queue=%u addr=0x%llx",
             queue_index, (unsigned long long)queue->used);
    return RX_ERROR;
  }
  used_idx = load_u16(used_header + 2);
  ring_index = (uint16_t)(used_idx % queue->num);
  uint64_t used_element_address = queue->used + 4 +
      (uint64_t)ring_index * 8;
  uint8_t *used_element = queue_pointer(
      state, queue, queue->used + 4 + (uint64_t)ring_index * 8, 8);
  log_dma_access(state, queue, true, "used-entry",
                 queue_address_space(state, queue),
                 used_element_address, 8, used_element);
  if (!used_element) {
    log_line(state, "output-used-entry-unavailable queue=%u addr=0x%llx",
             queue_index,
             (unsigned long long)(queue->used + 4 +
                                  (uint64_t)ring_index * 8));
    return RX_ERROR;
  }
  store_u32(used_element, head);
  store_u32(used_element + 4, written_length);
  __sync_synchronize();
  log_dma_access(state, queue, true, "used-index",
                 queue_address_space(state, queue),
                 queue->used + 2, 2, used_header + 2);
  store_u16(used_header + 2, (uint16_t)(used_idx + 1));
  queue->used_idx = (uint16_t)(used_idx + 1);
  queue->last_avail++;
  if (queue->call_fd >= 0) {
    uint64_t one = 1;
    (void)write(queue->call_fd, &one, sizeof(one));
  }
  log_line(state, "output-complete queue=%u written=%u", queue_index,
           written_length);
  return RX_COMPLETED;
}

static int complete_rx(struct backend_state *state, uint32_t queue_index) {
  struct queue_state *queue;
  uint8_t *avail_header;
  uint16_t avail_idx;
  uint16_t head;
  struct rx_action action = {0, 0, 0};
  bool have_action = false;
  size_t packet_length;

  if (queue_index >= VHOST_USER_MAX_QUEUES || queue_index != 0) {
    return RX_NO_WORK;
  }
  queue = &state->queues[queue_index];
  if (!queue->addr_set || !queue->enabled || queue->num == 0 ||
      queue->num > VIRTQUEUE_MAX_SIZE) {
    return RX_NO_WORK;
  }
  avail_header = queue_pointer(state, queue, queue->avail, 4);
  log_dma_access(state, queue, false, "avail-header",
                 queue_address_space(state, queue),
                 queue->avail, 4, avail_header);
  if (!avail_header) {
    log_line(state, "rx-avail-ring-unavailable queue=%u addr=0x%llx",
             queue_index, (unsigned long long)queue->avail);
    return RX_ERROR;
  }
  avail_idx = load_u16(avail_header + 2);
  if (queue->last_avail == avail_idx) {
    return RX_NO_WORK;
  }
  uint64_t avail_entry_address = queue->avail + 4 +
      (uint64_t)(queue->last_avail % queue->num) * 2;
  uint8_t *avail_entry = queue_pointer(
      state, queue, queue->avail + 4 +
                 (uint64_t)(queue->last_avail % queue->num) * 2,
      2);
  log_dma_access(state, queue, false, "avail-entry",
                 queue_address_space(state, queue),
                 avail_entry_address, 2, avail_entry);
  if (!avail_entry) {
    log_line(state, "rx-avail-entry-unavailable queue=%u addr=0x%llx",
             queue_index,
             (unsigned long long)(queue->avail + 4 +
                                  (uint64_t)(queue->last_avail % queue->num) * 2));
    return RX_ERROR;
  }
  head = load_u16(avail_entry);
  if (head >= queue->num) {
    log_line(state, "rx-invalid-head queue=%u head=%u", queue_index, head);
    return RX_ERROR;
  }

  /* Do not consume an available descriptor until a matching seed action is
   * present.  A queue-1 action must not discard a queue-0 descriptor. */
  size_t action_index = MAX_RX_ACTIONS;
  for (size_t i = 0; i < state->rx_count; i++) {
    if (!state->rx_consumed[i] && state->rx[i].queue == queue_index) {
      action = state->rx[i];
      action_index = i;
      have_action = true;
      break;
    }
  }
  if (!have_action) {
    return RX_NO_WORK;
  }
  if (action.payload_len > MAX_RX_BYTES) {
    action.payload_len = MAX_RX_BYTES;
  }
  packet_length = 10 + action.payload_len;
  state->payload = realloc(state->payload, packet_length ? packet_length : 1);
  if (!state->payload) {
    log_line(state, "rx-payload-allocation-failed size=%zu", packet_length);
    return RX_ERROR;
  }
  memset(state->payload, 0, packet_length);
  if (action.payload_len >= 14) {
    memset(state->payload + 10, 0xff, 6);
    state->payload[16] = 0x08;
    state->payload[17] = 0x00;
  }
  if (!write_chain(state, queue, head, state->payload, packet_length)) {
    log_line(state, "rx-write-failed queue=%u head=%u payload=%zu", queue_index,
             head, packet_length);
    return RX_ERROR;
  }

  uint8_t *used_header = queue_pointer(state, queue, queue->used, 4);
  log_dma_access(state, queue, false, "used-header",
                 queue_address_space(state, queue),
                 queue->used, 4, used_header);
  if (!used_header) {
    log_line(state, "rx-used-ring-unavailable addr=0x%llx",
             (unsigned long long)queue->used);
    return RX_ERROR;
  }
  uint16_t used_idx = load_u16(used_header + 2);
  uint16_t ring_index = (uint16_t)(used_idx % queue->num);
  uint64_t used_element_address = queue->used + 4 +
      (uint64_t)ring_index * 8;
  uint8_t *used_element = queue_pointer(
      state, queue, queue->used + 4 + (uint64_t)ring_index * 8, 8);
  log_dma_access(state, queue, true, "used-entry",
                 queue_address_space(state, queue),
                 used_element_address, 8, used_element);
  if (!used_element) {
    log_line(state, "rx-used-entry-unavailable addr=0x%llx",
             (unsigned long long)(queue->used + 4 +
                                  (uint64_t)ring_index * 8));
    return RX_ERROR;
  }
  store_u32(used_element, head);
  store_u32(used_element + 4, action.used_len);
  __sync_synchronize();
  log_dma_access(state, queue, true, "used-index",
                 queue_address_space(state, queue),
                 queue->used + 2, 2, used_header + 2);
  store_u16(used_header + 2, (uint16_t)(used_idx + 1));
  queue->used_idx = (uint16_t)(used_idx + 1);
  state->rx_consumed[action_index] = true;
  queue->last_avail++;
  if (queue->call_fd >= 0) {
    uint64_t one = 1;
    (void)write(queue->call_fd, &one, sizeof(one));
  }
  log_line(state, "rx-complete queue=%u payload=%u used=%u", queue_index,
           action.payload_len, action.used_len);
  return RX_COMPLETED;
}

static void trace_reset_queue_state(struct backend_state *state) {
  for (size_t i = 0; i < VHOST_USER_MAX_QUEUES; i++) {
    struct queue_state *queue = &state->queues[i];

    queue->num = 0;
    queue->desc = 0;
    queue->avail = 0;
    queue->used = 0;
    queue->last_avail = 0;
    queue->used_idx = 0;
  queue->addr_set = false;
  queue->enabled = false;
  queue->trace_notified = false;
  queue->trace_fallback = false;
  }
  state->trace_queue_sel = 0;
}

static bool parse_trace_write(const char *line, uint64_t *offset,
                              uint64_t *value) {
  const char *offset_text;

  if (!strstr(line, "virtio_mmio_write_offset")) {
    return false;
  }
  offset_text = strstr(line, " offset 0x");
  if (!offset_text ||
      sscanf(offset_text, " offset 0x%" SCNx64 " value 0x%" SCNx64,
             offset, value) != 2) {
    return false;
  }
  return true;
}

static void trace_set_queue_address(struct queue_state *queue,
                                    uint64_t *part, uint64_t value,
                                    bool high) {
  if (high) {
    *part = (*part & UINT64_C(0xffffffff)) |
            ((value & UINT64_C(0xffffffff)) << 32);
  } else {
    *part = (*part & UINT64_C(0xffffffff00000000)) |
            (value & UINT64_C(0xffffffff));
  }
  if (queue->num != 0 && queue->desc != 0 && queue->avail != 0 &&
      queue->used != 0) {
    queue->addr_set = true;
  }
}

static void apply_trace_write(struct backend_state *state, uint64_t offset,
                              uint64_t value) {
  struct queue_state *queue;
  uint32_t queue_index;

  if (offset == VIRTIO_MMIO_QUEUE_SEL) {
    if (value < VHOST_USER_MAX_QUEUES) {
      state->trace_queue_sel = (uint32_t)value;
    }
    return;
  }
  if (offset == VIRTIO_MMIO_QUEUE_NOTIFY) {
    queue_index = (uint32_t)value;
    if (queue_index < VHOST_USER_MAX_QUEUES) {
      queue = &state->queues[queue_index];
      queue->trace_fallback = !queue->addr_set;
      queue->trace_notified = true;
      log_line(state, "trace-notify queue=%u", queue_index);
    }
    return;
  }
  if (offset == VIRTIO_MMIO_STATUS) {
    if (value == 0) {
      trace_reset_queue_state(state);
    } else if (value & 0x4u) {
      for (size_t i = 0; i < VHOST_USER_MAX_QUEUES; i++) {
        if (state->queues[i].addr_set) {
          state->queues[i].enabled = true;
        }
      }
    }
    return;
  }
  if (state->trace_queue_sel >= VHOST_USER_MAX_QUEUES) {
    return;
  }
  queue = &state->queues[state->trace_queue_sel];
  switch (offset) {
  case VIRTIO_MMIO_QUEUE_NUM:
    if (value > 0 && value <= VIRTQUEUE_MAX_SIZE) {
      queue->num = (uint32_t)value;
    }
    break;
  case VIRTIO_MMIO_QUEUE_READY:
    queue->enabled = value != 0;
    break;
  case VIRTIO_MMIO_QUEUE_DESC_LOW:
    trace_set_queue_address(queue, &queue->desc, value, false);
    break;
  case VIRTIO_MMIO_QUEUE_DESC_HIGH:
    trace_set_queue_address(queue, &queue->desc, value, true);
    break;
  case VIRTIO_MMIO_QUEUE_AVAIL_LOW:
    trace_set_queue_address(queue, &queue->avail, value, false);
    break;
  case VIRTIO_MMIO_QUEUE_AVAIL_HIGH:
    trace_set_queue_address(queue, &queue->avail, value, true);
    break;
  case VIRTIO_MMIO_QUEUE_USED_LOW:
    trace_set_queue_address(queue, &queue->used, value, false);
    break;
  case VIRTIO_MMIO_QUEUE_USED_HIGH:
    trace_set_queue_address(queue, &queue->used, value, true);
    break;
  default:
    break;
  }
}

static void process_trace_queues(struct backend_state *state) {
  if (!state->trace_path || state->memory_count == 0) {
    return;
  }

  for (size_t i = 0; i < VHOST_USER_MAX_QUEUES; i++) {
    struct queue_state *queue = &state->queues[i];
    int result;

    if (!queue->trace_notified || !queue->addr_set || !queue->enabled) {
      continue;
    }
    do {
      result = i == 0 ? complete_rx(state, (uint32_t)i)
                      : complete_output(state, (uint32_t)i);
    } while (result == RX_COMPLETED);
    if (result == RX_ERROR) {
      log_line(state, "queue-processing-failed queue=%zu reason=trace-fallback",
               i);
      state->trace_error = true;
      queue->trace_notified = false;
    }
  }
}

/*
 * Stock CCA QEMU can expose a virtio-mmio device but cannot map a Realm ring
 * through its vhost-user start path.  Its generic trace events still expose
 * the queue programming and notify writes.  Reconstruct only that transport
 * state here; the backend continues to obtain all data from the vhost memory
 * table and the seed action.
 */
static void refresh_trace(struct backend_state *state) {
  FILE *trace_file;
  char line[1024];
  off_t line_start;
  off_t end;

  if (!state->trace_path || !*state->trace_path) {
    return;
  }
  trace_file = fopen(state->trace_path, "r");
  if (!trace_file) {
    return;
  }
  if (fseeko(trace_file, 0, SEEK_END) != 0 ||
      (end = ftello(trace_file)) < 0) {
    fclose(trace_file);
    return;
  }
  if (end < state->trace_offset) {
    state->trace_offset = 0;
    trace_reset_queue_state(state);
  }
  if (fseeko(trace_file, state->trace_offset, SEEK_SET) != 0) {
    fclose(trace_file);
    return;
  }
  while ((line_start = ftello(trace_file)) >= 0 &&
         fgets(line, sizeof(line), trace_file) != NULL) {
    uint64_t offset;
    uint64_t value;
    off_t next = ftello(trace_file);

    /* Do not advance past a line that QEMU is still writing. */
    if (next < 0 || !strchr(line, '\n')) {
      fseeko(trace_file, line_start, SEEK_SET);
      break;
    }
    state->trace_offset = next;
    if (parse_trace_write(line, &offset, &value)) {
      apply_trace_write(state, offset, value);
    }
  }
  fclose(trace_file);
  process_trace_queues(state);
}

static bool handle_message(int fd, struct backend_state *state,
                           struct wire_message *message, int *fds,
                           size_t fd_count) {
  uint64_t value;

  log_line(state, "request=%u size=%u fds=%zu", message->header.request,
           message->header.size, fd_count);

  switch (message->header.request) {
  case VHOST_USER_GET_FEATURES:
    value = state->features;
    log_line(state, "get-features=0x%llx", (unsigned long long)value);
    return send_reply(fd, message->header.request, &value, sizeof(value));
  case VHOST_USER_SET_FEATURES:
    if (message->header.size < sizeof(value)) {
      return false;
    }
    state->negotiated_features = load_u64(message->payload);
    log_line(state, "set-features=0x%llx",
             (unsigned long long)state->negotiated_features);
    break;
  case VHOST_USER_SET_OWNER:
  case VHOST_USER_RESET_OWNER:
  case VHOST_USER_SET_LOG_FD:
    break;
  case VHOST_USER_SET_MEM_TABLE:
    if (!set_memory_table(state, message->payload, message->header.size, fds,
                           fd_count)) {
      return false;
    }
    break;
  case VHOST_USER_SET_VRING_NUM: {
    uint32_t index;
    if (message->header.size < 8) {
      return false;
    }
    index = load_u32(message->payload);
    if (index >= VHOST_USER_MAX_QUEUES ||
        load_u32(message->payload + 4) > VIRTQUEUE_MAX_SIZE) {
      return false;
    }
    state->queues[index].num = load_u32(message->payload + 4);
    log_line(state, "vring-num queue=%u num=%u", index,
             state->queues[index].num);
    break;
  }
  case VHOST_USER_SET_VRING_ADDR: {
    struct vhost_user_vring_addr address;
    if (message->header.size < sizeof(address)) {
      return false;
    }
    memcpy(&address, message->payload, sizeof(address));
    if (address.index >= VHOST_USER_MAX_QUEUES) {
      return false;
    }
    state->queues[address.index].desc = address.desc_user_addr;
    state->queues[address.index].avail = address.avail_user_addr;
    state->queues[address.index].used = address.used_user_addr;
    state->queues[address.index].addr_set = true;
    log_line(state, "vring-addr queue=%u desc=0x%llx avail=0x%llx used=0x%llx",
             address.index, (unsigned long long)address.desc_user_addr,
             (unsigned long long)address.avail_user_addr,
             (unsigned long long)address.used_user_addr);
    uint8_t *used = qemu_pointer(state, address.used_user_addr, 4);
    if (used) {
      state->queues[address.index].used_idx = load_u16(used + 2);
    }
    break;
  }
  case VHOST_USER_SET_VRING_BASE: {
    uint32_t index;
    if (message->header.size < 8) {
      return false;
    }
    index = load_u32(message->payload);
    if (index >= VHOST_USER_MAX_QUEUES) {
      return false;
    }
    state->queues[index].last_avail = load_u16(message->payload + 4);
    log_line(state, "vring-base queue=%u avail=%u", index,
             state->queues[index].last_avail);
    break;
  }
  case VHOST_USER_SET_VRING_KICK: {
    uint64_t descriptor;
    uint32_t index;
    if (message->header.size < sizeof(descriptor)) {
      return false;
    }
    descriptor = load_u64(message->payload);
    index = (uint32_t)(descriptor & 0xffu);
    if (index >= VHOST_USER_MAX_QUEUES) {
      return false;
    }
    if (state->queues[index].kick_fd >= 0) {
      close(state->queues[index].kick_fd);
    }
    state->queues[index].kick_fd = fd_count ? fds[0] : -1;
    log_line(state, "vring-kick queue=%u fd=%d", index,
             state->queues[index].kick_fd);
    if (fd_count) {
      fds[0] = -1;
    }
    break;
  }
  case VHOST_USER_SET_VRING_CALL: {
    uint64_t descriptor;
    uint32_t index;
    if (message->header.size < sizeof(descriptor)) {
      return false;
    }
    descriptor = load_u64(message->payload);
    index = (uint32_t)(descriptor & 0xffu);
    if (index >= VHOST_USER_MAX_QUEUES) {
      return false;
    }
    if (state->queues[index].call_fd >= 0) {
      close(state->queues[index].call_fd);
    }
    state->queues[index].call_fd = fd_count ? fds[0] : -1;
    log_line(state, "vring-call queue=%u fd=%d", index,
             state->queues[index].call_fd);
    if (fd_count) {
      fds[0] = -1;
    }
    break;
  }
  case VHOST_USER_SET_VRING_ERR: {
    uint64_t descriptor;
    uint32_t index;
    if (message->header.size < sizeof(descriptor)) {
      return false;
    }
    descriptor = load_u64(message->payload);
    index = (uint32_t)(descriptor & 0xffu);
    if (index >= VHOST_USER_MAX_QUEUES) {
      return false;
    }
    break;
  }
  case VHOST_USER_GET_PROTOCOL_FEATURES:
    value = state->protocol_features;
    return send_reply(fd, message->header.request, &value, sizeof(value));
  case VHOST_USER_SET_PROTOCOL_FEATURES:
    if (message->header.size < sizeof(value)) {
      return false;
    }
    state->negotiated_protocol_features = load_u64(message->payload);
    break;
  case VHOST_USER_GET_QUEUE_NUM:
    value = VHOST_USER_DEVICE_QUEUE_COUNT;
    return send_reply(fd, message->header.request, &value, sizeof(value));
  case VHOST_USER_SET_VRING_ENABLE: {
    uint32_t index;
    if (message->header.size < 8) {
      return false;
    }
    index = load_u32(message->payload);
    if (index >= VHOST_USER_MAX_QUEUES) {
      return false;
    }
    state->queues[index].enabled = load_u32(message->payload + 4) != 0;
    log_line(state, "vring-enable queue=%u enabled=%u", index,
             state->queues[index].enabled ? 1u : 0u);
    break;
  }
  case VHOST_USER_GET_CONFIG: {
    uint32_t requested_size;
    if (message->header.size < 12) {
      return false;
    }
    requested_size = load_u32(message->payload + 4);
    if (requested_size > MAX_CONFIG_SIZE) {
      return false;
    }
    uint8_t config_reply[12 + MAX_CONFIG_SIZE];
    memset(config_reply, 0, sizeof(config_reply));
    store_u32(config_reply + 4, requested_size);
    memcpy(config_reply + 12, state->config, requested_size);
    log_line(state, "get-config size=%u rss-key-size=%u", requested_size,
             state->config[17]);
    return send_reply(fd, message->header.request, config_reply,
                      12 + requested_size);
  }
  case VHOST_USER_SET_STATUS:
    if (message->header.size >= sizeof(value)) {
      value = load_u64(message->payload);
      log_line(state, "set-status=0x%llx", (unsigned long long)value);
    }
    break;
  case VHOST_USER_GET_STATUS:
    value = 0;
    return send_reply(fd, message->header.request, &value, sizeof(value));
  default:
    if ((message->header.flags & VHOST_USER_NEED_REPLY_MASK) != 0) {
      value = 0;
      return send_reply(fd, message->header.request, &value, sizeof(value));
    }
    break;
  }
  return true;
}

static int listen_socket(const char *path) {
  int fd;
  struct sockaddr_un address;

  if (!path || strlen(path) >= sizeof(address.sun_path)) {
    return -1;
  }
  fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    return -1;
  }
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", path);
  if (unlink(path) < 0 && errno != ENOENT) {
    close(fd);
    return -1;
  }
  if (bind(fd, (struct sockaddr *)&address, sizeof(address)) < 0 ||
      listen(fd, 1) < 0) {
    close(fd);
    return -1;
  }
  return fd;
}

static void close_backend(struct backend_state *state) {
  clear_memory(state);
  for (size_t i = 0; i < VHOST_USER_MAX_QUEUES; i++) {
    if (state->queues[i].kick_fd >= 0) {
      close(state->queues[i].kick_fd);
    }
    if (state->queues[i].call_fd >= 0) {
      close(state->queues[i].call_fd);
    }
  }
  free(state->seed);
  free(state->payload);
  if (state->log) {
    fclose(state->log);
  }
}

static void usage(const char *program) {
  fprintf(stderr,
          "usage: %s --socket PATH [--input PATH] [--trace PATH] [--log PATH]\n",
          program);
}

int main(int argc, char **argv) {
  const char *socket_path = NULL;
  const char *input_path = NULL;
  const char *trace_path = NULL;
  const char *log_path = NULL;
  struct backend_state state;
  int listener = -1;
  int connection = -1;
  int exit_code = 1;

  memset(&state, 0, sizeof(state));
  initialize_defaults(&state);
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--socket") == 0 && i + 1 < argc) {
      socket_path = argv[++i];
    } else if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
      input_path = argv[++i];
    } else if (strcmp(argv[i], "--trace") == 0 && i + 1 < argc) {
      trace_path = argv[++i];
    } else if (strcmp(argv[i], "--log") == 0 && i + 1 < argc) {
      log_path = argv[++i];
    } else {
      usage(argv[0]);
      goto done;
    }
  }
  if (!socket_path || !parse_seed(&state, input_path)) {
    fprintf(stderr, "invalid seed input or missing socket path\n");
    goto done;
  }
  if (log_path) {
    state.log = fopen(log_path, "w");
  }
  state.trace_path = trace_path;
  listener = listen_socket(socket_path);
  if (listener < 0) {
    fprintf(stderr, "failed to listen on vhost-user socket: %s\n",
            strerror(errno));
    goto done;
  }
  log_line(&state, "backend-ready rx-actions=%zu config-size=%zu",
           state.rx_count, state.config_size);
  connection = accept(listener, NULL, NULL);
  if (connection < 0) {
    goto done;
  }

  for (;;) {
    struct pollfd pollfds[1 + VHOST_USER_MAX_QUEUES];
    nfds_t poll_count = 1;
    pollfds[0] = (struct pollfd){.fd = connection, .events = POLLIN};
    for (size_t i = 0; i < VHOST_USER_MAX_QUEUES; i++) {
      if (state.queues[i].kick_fd >= 0) {
        pollfds[poll_count++] =
            (struct pollfd){.fd = state.queues[i].kick_fd, .events = POLLIN};
      }
    }
    int ready;
    do {
      ready = poll(pollfds, poll_count, state.trace_path ? 20 : -1);
    } while (ready < 0 && errno == EINTR);
    if (ready < 0) {
      break;
    }
    if (connection >= 0 &&
        (pollfds[0].revents & (POLLIN | POLLHUP | POLLERR)) != 0) {
      struct wire_message message;
      int fds[VHOST_USER_MAX_FDS];
      size_t fd_count = 0;
      if (!receive_message(connection, &message, fds, &fd_count) ||
          !handle_message(connection, &state, &message, fds, fd_count)) {
        close_fds(fds, fd_count);
        log_line(&state, "control-connection-closed trace-fallback=%s",
                 state.trace_path ? "available" : "unavailable");
        close(connection);
        connection = -1;
      } else {
        close_fds(fds, fd_count);
      }
    }
    for (nfds_t i = 1; i < poll_count; i++) {
      if ((pollfds[i].revents & POLLIN) == 0) {
        continue;
      }
      uint64_t count;
      (void)read(pollfds[i].fd, &count, sizeof(count));
      for (size_t queue = 0; queue < VHOST_USER_MAX_QUEUES; queue++) {
        if (state.queues[queue].kick_fd == pollfds[i].fd) {
          int result;
          do {
            result = queue == 0
                         ? complete_rx(&state, (uint32_t)queue)
                         : complete_output(&state, (uint32_t)queue);
          } while (result == RX_COMPLETED);
          if (result == RX_ERROR) {
            log_line(&state, "queue-processing-failed queue=%zu", queue);
            if (connection >= 0) {
              close(connection);
            }
            connection = -1;
          }
          break;
        }
      }
    }
    refresh_trace(&state);
    if (connection < 0 && !state.trace_path) {
      break;
    }
  }
  exit_code = 0;

done:
  if (connection >= 0) {
    close(connection);
  }
  if (listener >= 0) {
    close(listener);
  }
  close_backend(&state);
  return exit_code;
}
