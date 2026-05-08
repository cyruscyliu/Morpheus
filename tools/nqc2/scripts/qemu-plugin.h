#ifndef NQC2_QEMU_PLUGIN_H
#define NQC2_QEMU_PLUGIN_H

#include <inttypes.h>
#include <stdbool.h>
#include <stddef.h>

#if defined _WIN32 || defined __CYGWIN__
#  define QEMU_PLUGIN_EXPORT __declspec(dllexport)
#  define QEMU_PLUGIN_API __declspec(dllimport)
#  define QEMU_PLUGIN_LOCAL
#else
#  define QEMU_PLUGIN_EXPORT __attribute__((visibility("default")))
#  define QEMU_PLUGIN_API
#  define QEMU_PLUGIN_LOCAL __attribute__((visibility("hidden")))
#endif

typedef uint64_t qemu_plugin_id_t;

typedef struct qemu_info_t {
    const char *target_name;
    struct {
        int min;
        int cur;
    } version;
    bool system_emulation;
    union {
        struct {
            int smp_vcpus;
            int max_vcpus;
        } system;
    };
} qemu_info_t;

extern QEMU_PLUGIN_EXPORT int qemu_plugin_version;
#define QEMU_PLUGIN_VERSION 1

struct qemu_plugin_tb;
struct qemu_plugin_insn;
struct qemu_plugin_hwaddr;

enum qemu_plugin_cb_flags {
    QEMU_PLUGIN_CB_NO_REGS,
    QEMU_PLUGIN_CB_R_REGS,
    QEMU_PLUGIN_CB_RW_REGS,
};

typedef void (*qemu_plugin_vcpu_udata_cb_t)(unsigned int vcpu_index, void *userdata);
typedef void (*qemu_plugin_vcpu_simple_cb_t)(qemu_plugin_id_t id, unsigned int vcpu_index);
typedef void (*qemu_plugin_simple_cb_t)(qemu_plugin_id_t id);
typedef void (*qemu_plugin_udata_cb_t)(qemu_plugin_id_t id, void *userdata);
typedef void (*qemu_plugin_vcpu_tb_trans_cb_t)(qemu_plugin_id_t id, struct qemu_plugin_tb *tb);

QEMU_PLUGIN_EXPORT int qemu_plugin_install(qemu_plugin_id_t id,
                                           const qemu_info_t *info,
                                           int argc, char **argv);
QEMU_PLUGIN_API void qemu_plugin_uninstall(qemu_plugin_id_t id, qemu_plugin_simple_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_reset(qemu_plugin_id_t id, qemu_plugin_simple_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_init_cb(qemu_plugin_id_t id,
                                       qemu_plugin_vcpu_simple_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_exit_cb(qemu_plugin_id_t id,
                                       qemu_plugin_vcpu_simple_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_idle_cb(qemu_plugin_id_t id,
                                       qemu_plugin_vcpu_simple_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_resume_cb(qemu_plugin_id_t id,
                                         qemu_plugin_vcpu_simple_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_tb_trans_cb(qemu_plugin_id_t id,
                                           qemu_plugin_vcpu_tb_trans_cb_t cb);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_tb_exec_cb(struct qemu_plugin_tb *tb,
                                          qemu_plugin_vcpu_udata_cb_t cb,
                                          enum qemu_plugin_cb_flags flags,
                                          void *userdata);
QEMU_PLUGIN_API size_t qemu_plugin_tb_n_insns(const struct qemu_plugin_tb *tb);
QEMU_PLUGIN_API uint64_t qemu_plugin_tb_vaddr(const struct qemu_plugin_tb *tb);
QEMU_PLUGIN_API struct qemu_plugin_insn *qemu_plugin_tb_get_insn(const struct qemu_plugin_tb *tb, size_t idx);
QEMU_PLUGIN_API const void *qemu_plugin_insn_data(const struct qemu_plugin_insn *insn);
QEMU_PLUGIN_API size_t qemu_plugin_insn_size(const struct qemu_plugin_insn *insn);
QEMU_PLUGIN_API uint64_t qemu_plugin_insn_vaddr(const struct qemu_plugin_insn *insn);
QEMU_PLUGIN_API void *qemu_plugin_insn_haddr(const struct qemu_plugin_insn *insn);
QEMU_PLUGIN_API void qemu_plugin_register_vcpu_insn_exec_cb(struct qemu_plugin_insn *insn,
                                            qemu_plugin_vcpu_udata_cb_t cb,
                                            enum qemu_plugin_cb_flags flags,
                                            void *userdata);
QEMU_PLUGIN_API void qemu_plugin_register_atexit_cb(qemu_plugin_id_t id,
                                    qemu_plugin_udata_cb_t cb, void *userdata);

#endif
