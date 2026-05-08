#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "qemu-plugin.h"

QEMU_PLUGIN_EXPORT int qemu_plugin_version = QEMU_PLUGIN_VERSION;

enum {
    TYPE_EXEC = 1,
    TYPE_INFO = 0x4554,
    TYPE_ARCH = 5,
};

enum etrace_info_flags {
    ETRACE_INFO_F_TB_CHAINING = (1u << 0),
};

struct etrace_hdr {
    uint16_t type;
    uint16_t unit_id;
    uint32_t len;
} __attribute__((packed));

struct etrace_info_data {
    uint64_t attr;
    struct {
        uint16_t major;
        uint16_t minor;
    } version;
} __attribute__((packed));

struct etrace_arch_guest_host {
    uint32_t arch_id;
    uint8_t arch_bits;
    uint8_t big_endian;
} __attribute__((packed));

struct etrace_arch_data {
    struct etrace_arch_guest_host guest;
    struct etrace_arch_guest_host host;
} __attribute__((packed));

struct etrace_entry64 {
    uint32_t duration;
    uint64_t start;
    uint64_t end;
} __attribute__((packed));

struct etrace_exec_prefix {
    uint64_t start_time;
} __attribute__((packed));

typedef struct tb_record {
    uint64_t start;
    uint64_t end;
} tb_record;

typedef struct elog_buffer {
    bool in_use;
    bool queued;
    unsigned int unit_id;
    uint64_t start_time;
    size_t count;
    struct etrace_entry64 *entries;
} elog_buffer;

typedef struct plugin_state {
    FILE *fp;
    pthread_t writer_thread;
    pthread_mutex_t lock;
    pthread_cond_t has_work;
    pthread_cond_t has_empty;
    bool writer_started;
    bool stop_requested;
    size_t entries_per_buffer;
    size_t buffer_count;
    elog_buffer *buffers;
    int *active_buffer_by_vcpu;
    unsigned int vcpu_count;
} plugin_state;

static plugin_state g_state = {
    .fp = NULL,
    .lock = PTHREAD_MUTEX_INITIALIZER,
    .has_work = PTHREAD_COND_INITIALIZER,
    .has_empty = PTHREAD_COND_INITIALIZER,
    .writer_started = false,
    .stop_requested = false,
    .entries_per_buffer = 4096,
    .buffer_count = 4,
    .buffers = NULL,
    .active_buffer_by_vcpu = NULL,
    .vcpu_count = 0,
};

static const char *default_trace_file = "nqc2.trace";

static bool host_is_big_endian(void)
{
    const uint16_t test = 0x0102;
    const uint8_t *bytes = (const uint8_t *) &test;
    return bytes[0] == 0x01;
}

static uint8_t guess_guest_bits(const char *target_name)
{
    if (!target_name) {
        return 64;
    }
    if (strstr(target_name, "64")) {
        return 64;
    }
    return 32;
}

static void write_info_block(FILE *fp)
{
    struct etrace_hdr hdr = {
        .type = TYPE_INFO,
        .unit_id = 0,
        .len = sizeof(struct etrace_info_data),
    };
    struct etrace_info_data info = {
        .attr = ETRACE_INFO_F_TB_CHAINING,
        .version = {
            .major = 0,
            .minor = 1,
        },
    };

    fwrite(&hdr, sizeof(hdr), 1, fp);
    fwrite(&info, sizeof(info), 1, fp);
}

static void write_arch_block(FILE *fp, const qemu_info_t *info)
{
    struct etrace_hdr hdr = {
        .type = TYPE_ARCH,
        .unit_id = 0,
        .len = sizeof(struct etrace_arch_data),
    };
    struct etrace_arch_data arch = {
        .guest = {
            .arch_id = 0,
            .arch_bits = guess_guest_bits(info ? info->target_name : NULL),
            .big_endian = 0,
        },
        .host = {
            .arch_id = 0,
            .arch_bits = (uint8_t) (sizeof(void *) * 8),
            .big_endian = host_is_big_endian() ? 1 : 0,
        },
    };

    fwrite(&hdr, sizeof(hdr), 1, fp);
    fwrite(&arch, sizeof(arch), 1, fp);
}

static void emit_exec_buffer(FILE *fp, const elog_buffer *buffer)
{
    struct etrace_hdr hdr = {
        .type = TYPE_EXEC,
        .unit_id = (uint16_t) buffer->unit_id,
        .len = (uint32_t) (sizeof(struct etrace_exec_prefix)
            + buffer->count * sizeof(struct etrace_entry64)),
    };
    struct etrace_exec_prefix prefix = {
        .start_time = buffer->start_time,
    };

    fwrite(&hdr, sizeof(hdr), 1, fp);
    fwrite(&prefix, sizeof(prefix), 1, fp);
    fwrite(buffer->entries, sizeof(struct etrace_entry64), buffer->count, fp);
}

static int acquire_empty_buffer_locked(void)
{
    size_t index;

    for (;;) {
        for (index = 0; index < g_state.buffer_count; index++) {
            elog_buffer *buffer = &g_state.buffers[index];
            if (buffer->in_use || buffer->queued) {
                continue;
            }
            buffer->in_use = true;
            buffer->count = 0;
            buffer->start_time = 0;
            return (int) index;
        }
        pthread_cond_wait(&g_state.has_empty, &g_state.lock);
    }
}

static void queue_active_buffer_locked(unsigned int vcpu_index)
{
    int active_index;
    elog_buffer *buffer;

    if (vcpu_index >= g_state.vcpu_count) {
        return;
    }

    active_index = g_state.active_buffer_by_vcpu[vcpu_index];
    if (active_index < 0) {
        return;
    }

    buffer = &g_state.buffers[active_index];
    if (buffer->count == 0) {
        buffer->in_use = false;
        g_state.active_buffer_by_vcpu[vcpu_index] = -1;
        pthread_cond_broadcast(&g_state.has_empty);
        return;
    }

    buffer->queued = true;
    buffer->in_use = false;
    g_state.active_buffer_by_vcpu[vcpu_index] = -1;
    pthread_cond_signal(&g_state.has_work);
}

static void *writer_thread_main(void *opaque)
{
    (void) opaque;

    for (;;) {
        size_t index;
        int queued_index = -1;
        elog_buffer snapshot;

        pthread_mutex_lock(&g_state.lock);
        while (!g_state.stop_requested) {
            for (index = 0; index < g_state.buffer_count; index++) {
                if (g_state.buffers[index].queued) {
                    queued_index = (int) index;
                    break;
                }
            }
            if (queued_index >= 0) {
                break;
            }
            pthread_cond_wait(&g_state.has_work, &g_state.lock);
        }

        if (queued_index < 0 && g_state.stop_requested) {
            for (index = 0; index < g_state.buffer_count; index++) {
                if (g_state.buffers[index].queued) {
                    queued_index = (int) index;
                    break;
                }
            }
            if (queued_index < 0) {
                pthread_mutex_unlock(&g_state.lock);
                return NULL;
            }
        }

        snapshot = g_state.buffers[queued_index];
        g_state.buffers[queued_index].queued = false;
        pthread_mutex_unlock(&g_state.lock);

        emit_exec_buffer(g_state.fp, &snapshot);
        fflush(g_state.fp);

        pthread_mutex_lock(&g_state.lock);
        g_state.buffers[queued_index].count = 0;
        g_state.buffers[queued_index].start_time = 0;
        pthread_cond_broadcast(&g_state.has_empty);
        pthread_mutex_unlock(&g_state.lock);
    }
}

static void flush_all_pending_locked(void)
{
    unsigned int vcpu_index;

    for (vcpu_index = 0; vcpu_index < g_state.vcpu_count; vcpu_index++) {
        queue_active_buffer_locked(vcpu_index);
    }
}

static void flush_all_pending(qemu_plugin_id_t id, void *userdata)
{
    (void) id;
    (void) userdata;

    if (!g_state.fp) {
        return;
    }

    pthread_mutex_lock(&g_state.lock);
    flush_all_pending_locked();
    g_state.stop_requested = true;
    pthread_cond_broadcast(&g_state.has_work);
    pthread_mutex_unlock(&g_state.lock);

    if (g_state.writer_started) {
        pthread_join(g_state.writer_thread, NULL);
        g_state.writer_started = false;
    }

    fclose(g_state.fp);
    g_state.fp = NULL;
}

static void tb_exec_cb(unsigned int vcpu_index, void *userdata)
{
    tb_record *record = (tb_record *) userdata;
    int active_index;
    elog_buffer *buffer;

    if (!g_state.fp || !record || vcpu_index >= g_state.vcpu_count) {
        return;
    }

    pthread_mutex_lock(&g_state.lock);

    active_index = g_state.active_buffer_by_vcpu[vcpu_index];
    if (active_index < 0) {
        active_index = acquire_empty_buffer_locked();
        g_state.active_buffer_by_vcpu[vcpu_index] = active_index;
        g_state.buffers[active_index].unit_id = vcpu_index;
    }

    buffer = &g_state.buffers[active_index];

    /*
     * Optimization 1: merge immediately adjacent TBs in the collector buffer.
     * This mirrors the paper's range coalescing and shrinks the write volume
     * before the async writer thread ever sees the data.
     */
    if (buffer->count > 0
        && buffer->entries[buffer->count - 1].end == record->start) {
        buffer->entries[buffer->count - 1].end = record->end;
        pthread_mutex_unlock(&g_state.lock);
        return;
    }

    /*
     * Optimization 2: multi-buffering. When the active buffer fills, hand it
     * to the writer thread and switch the producer over to the next empty
     * buffer instead of blocking on file I/O in the exec callback.
     */
    if (buffer->count == g_state.entries_per_buffer) {
        queue_active_buffer_locked(vcpu_index);
        active_index = acquire_empty_buffer_locked();
        g_state.active_buffer_by_vcpu[vcpu_index] = active_index;
        buffer = &g_state.buffers[active_index];
        buffer->unit_id = vcpu_index;
    }

    if (buffer->count == 0) {
        buffer->start_time = 0;
    }

    buffer->entries[buffer->count].duration = 0;
    buffer->entries[buffer->count].start = record->start;
    buffer->entries[buffer->count].end = record->end;
    buffer->count += 1;

    pthread_mutex_unlock(&g_state.lock);
}

static void vcpu_exit_cb(qemu_plugin_id_t id, unsigned int vcpu_index)
{
    (void) id;

    if (!g_state.fp) {
        return;
    }

    pthread_mutex_lock(&g_state.lock);
    queue_active_buffer_locked(vcpu_index);
    pthread_mutex_unlock(&g_state.lock);
}

static void tb_trans_cb(qemu_plugin_id_t id, struct qemu_plugin_tb *tb)
{
    size_t insn_count;
    struct qemu_plugin_insn *insn;
    tb_record *record;
    uint64_t start;
    uint64_t end;

    (void) id;

    insn_count = qemu_plugin_tb_n_insns(tb);
    if (insn_count == 0) {
        return;
    }

    start = qemu_plugin_tb_vaddr(tb);
    insn = qemu_plugin_tb_get_insn(tb, insn_count - 1);
    end = qemu_plugin_insn_vaddr(insn) + qemu_plugin_insn_size(insn);

    record = malloc(sizeof(*record));
    if (!record) {
        return;
    }
    record->start = start;
    record->end = end;
    qemu_plugin_register_vcpu_tb_exec_cb(tb, tb_exec_cb,
                                         QEMU_PLUGIN_CB_NO_REGS, record);
}

static const char *get_arg_value(const char *arg, const char *prefix)
{
    size_t len = strlen(prefix);

    if (strncmp(arg, prefix, len) != 0) {
        return NULL;
    }
    return arg + len;
}

QEMU_PLUGIN_EXPORT int qemu_plugin_install(qemu_plugin_id_t id,
                                           const qemu_info_t *info,
                                           int argc, char **argv)
{
    const char *trace_file = default_trace_file;
    unsigned int vcpu_count = 1;
    size_t index;
    int i;

    if (info && info->system_emulation && info->system.max_vcpus > 0) {
        vcpu_count = (unsigned int) info->system.max_vcpus;
    }

    for (i = 0; i < argc; i++) {
        const char *value;

        value = get_arg_value(argv[i], "trace=");
        if (value && *value) {
            trace_file = value;
            continue;
        }
        value = get_arg_value(argv[i], "file=");
        if (value && *value) {
            trace_file = value;
            continue;
        }
    }

    g_state.fp = fopen(trace_file, "wb");
    if (!g_state.fp) {
        fprintf(stderr, "nqc2: failed to open trace file %s: %s\n",
                trace_file, strerror(errno));
        return -1;
    }

    g_state.vcpu_count = vcpu_count;
    g_state.active_buffer_by_vcpu = calloc(vcpu_count, sizeof(*g_state.active_buffer_by_vcpu));
    g_state.buffers = calloc(g_state.buffer_count, sizeof(*g_state.buffers));
    if (!g_state.active_buffer_by_vcpu || !g_state.buffers) {
        fclose(g_state.fp);
        g_state.fp = NULL;
        return -1;
    }

    for (i = 0; i < (int) vcpu_count; i++) {
        g_state.active_buffer_by_vcpu[i] = -1;
    }
    for (index = 0; index < g_state.buffer_count; index++) {
        g_state.buffers[index].entries = calloc(
            g_state.entries_per_buffer,
            sizeof(struct etrace_entry64)
        );
        if (!g_state.buffers[index].entries) {
            fclose(g_state.fp);
            g_state.fp = NULL;
            return -1;
        }
    }

    write_info_block(g_state.fp);
    write_arch_block(g_state.fp, info);
    fflush(g_state.fp);

    if (pthread_create(&g_state.writer_thread, NULL, writer_thread_main, NULL) != 0) {
        fclose(g_state.fp);
        g_state.fp = NULL;
        return -1;
    }
    g_state.writer_started = true;

    qemu_plugin_register_vcpu_tb_trans_cb(id, tb_trans_cb);
    qemu_plugin_register_vcpu_exit_cb(id, vcpu_exit_cb);
    qemu_plugin_register_atexit_cb(id, flush_all_pending, NULL);
    return 0;
}
