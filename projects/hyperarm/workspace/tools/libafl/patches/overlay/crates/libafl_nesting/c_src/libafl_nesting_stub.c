#define _GNU_SOURCE
#include <dirent.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include "lqemu.h"

#define INPUT_LEN 512
#define RUNTIME_DIR "/run/morpheus-libafl"
#define INPUT_PATH RUNTIME_DIR "/morpheus-qemu-input.bin"
#define LAUNCH_STDOUT_PATH RUNTIME_DIR "/launch-l2.stdout"
#define LAUNCH_STDERR_PATH RUNTIME_DIR "/launch-l2.stderr"
#define LAUNCH_SERIAL_PATH RUNTIME_DIR "/launch-l2.serial"
#define LAUNCH_MARKER_PATH RUNTIME_DIR "/launch-l2.marker"
#define QEMU_TRACE_EVENTS_PATH RUNTIME_DIR "/morpheus-qemu-trace-events.txt"
#define QEMU_TRACE_LOG_PATH RUNTIME_DIR "/morpheus-qemu-trace.log"
#define NQC2_TRACE_PATH RUNTIME_DIR "/morpheus-nqc2.trace"
#define KVM_PATH "/dev/kvm"
#define QEMU_BIN_PATH "/root/morpheus-qemu/bin/qemu-system-aarch64"
#define QEMU_FALLBACK_BIN_PATH "/usr/bin/qemu-system-aarch64"
#define QEMU_DATA_DIR "/root/morpheus-qemu/share/qemu"
#define QEMU_SRC_DATA_DIR "/root/morpheus-qemu-src/pc-bios"
#define QEMU_FALLBACK_DATA_DIR "/usr/share/qemu"
#define L2_KERNEL_PATH "/root/nvirsh-images/Image"
#define L2_INITRD_PATH "/root/nvirsh-images/rootfs.cpio.gz"
#define NQC2_PLUGIN_PATH "/root/morpheus-nqc2/lib/nqc2/nqc2-plugin.so"
#define L2_CPU_TCG "cortex-a57"
#define L2_CPU_KVM "host"
#define L2_MEMORY_MB "1024"
#define RUNTIME_DUMP_MAX_BYTES (256U * 1024U)
#define RUNTIME_DUMP_CHUNK_BYTES 128U
#define ORACLE_TEST_MAGIC0 0xa5U
#define ORACLE_TEST_MAGIC1 0x5aU
#define L2_DISABLE_NQC2_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-disable-nqc2-plugin/raw"
#define L2_RUN_WINDOW_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-run-window-ms/raw"
#define L2_ACCEL_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-accel/raw"
#define L2_CPU_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-cpu/raw"
#define DMI_ENTRIES_DIR "/sys/firmware/dmi/entries"
#define L2_DISABLE_NQC2_DMI "morpheus.l2_disable_nqc2_plugin=1"
#define L2_RUN_WINDOW_DMI "morpheus.l2_run_window_ms="
#define L2_ACCEL_DMI "morpheus.l2_accel="
#define L2_CPU_DMI "morpheus.l2_cpu="
#define PROC_CMDLINE_PATH "/proc/cmdline"
#define L2_DISABLE_NQC2_CMDLINE "morpheus.l2_disable_nqc2_plugin=1"
#define L2_RUN_WINDOW_CMDLINE "morpheus.l2_run_window_ms="
#define L2_ACCEL_CMDLINE "morpheus.l2_accel="
#define L2_CPU_CMDLINE "morpheus.l2_cpu="

static uint8_t FUZZ_INPUT[INPUT_LEN];

static bool read_text_prefix_value(const char *path, const char *prefix,
                                   char *out, size_t out_len) {
  FILE *fp = fopen(path, "rb");
  char buf[4096];
  size_t len;
  const char *found = NULL;
  const char *end = NULL;
  size_t prefix_len = strlen(prefix);

  if (!fp) {
    return false;
  }
  len = fread(buf, 1, sizeof(buf) - 1, fp);
  fclose(fp);
  buf[len] = '\0';

  found = strstr(buf, prefix);
  if (!found) {
    return false;
  }
  found += prefix_len;
  end = found;
  while (*end != '\0' && *end != ' ' && *end != '\n' && *end != '\r') {
    end++;
  }
  if (end == found) {
    return false;
  }
  snprintf(out, out_len, "%.*s", (int)(end - found), found);
  return true;
}

static bool proc_cmdline_has_token(const char *token) {
  FILE *fp = fopen(PROC_CMDLINE_PATH, "rb");
  char buf[4096];
  size_t len;
  bool found = false;

  if (!fp) {
    return false;
  }
  len = fread(buf, 1, sizeof(buf) - 1, fp);
  fclose(fp);
  buf[len] = '\0';
  found = strstr(buf, token) != NULL;
  return found;
}

static void injected_period_ms(const uint8_t *data, char *out, size_t out_len) {
  uint16_t lo = data[1];
  uint16_t hi = data[2];
  uint32_t raw = ((uint32_t)hi << 8) | lo;
  uint32_t bounded = 10 + (raw % 5000);
  snprintf(out, out_len, "%u", bounded);
}

static bool injected_vintid(const uint8_t *data, char *out, size_t out_len) {
  uint8_t raw = data[0];
  if (raw == 0) {
    return false;
  }
  snprintf(out, out_len, "%u", ((unsigned)raw % 64U) + 1U);
  return true;
}

static bool parse_run_window_ms(const char *value, unsigned *out) {
  char *end = NULL;
  unsigned long parsed = strtoul(value, &end, 10);
  if (end != value && parsed >= 1000UL && parsed <= 900000UL) {
    *out = (unsigned)parsed;
    return true;
  }
  return false;
}

static const char *parse_l2_accel(const char *value) {
  if (strncmp(value, "kvm", 3) == 0) {
    return "kvm";
  }
  if (strncmp(value, "tcg", 3) == 0) {
    return "tcg";
  }
  return NULL;
}

static const char *parse_l2_cpu(const char *value) {
  if (strncmp(value, "host", 4) == 0) {
    return "host";
  }
  if (strncmp(value, "max", 3) == 0) {
    return "max";
  }
  if (strncmp(value, "cortex-a57", 10) == 0) {
    return "cortex-a57";
  }
  return NULL;
}

static const char *fw_cfg_l2_cpu(void) {
  char value[32] = {0};
  FILE *fp = fopen(L2_CPU_FW_CFG, "rb");
  size_t n;

  if (!fp) {
    return NULL;
  }
  n = fread(value, 1, sizeof(value) - 1, fp);
  fclose(fp);
  return n > 0 ? parse_l2_cpu(value) : NULL;
}

static const char *proc_cmdline_l2_cpu(void) {
  char value[32] = {0};
  if (!read_text_prefix_value(PROC_CMDLINE_PATH, L2_CPU_CMDLINE,
                              value, sizeof(value))) {
    return NULL;
  }
  return parse_l2_cpu(value);
}

static const char *dmi_l2_cpu(void) {
  DIR *dir = opendir(DMI_ENTRIES_DIR);
  struct dirent *entry = NULL;
  const size_t prefix_len = strlen(L2_CPU_DMI);

  if (!dir) {
    return NULL;
  }

  while ((entry = readdir(dir)) != NULL) {
    char raw_path[256];
    FILE *raw = NULL;
    char data[512];
    size_t len;
    int written;

    if (entry->d_name[0] == '.') {
      continue;
    }
    written = snprintf(raw_path, sizeof(raw_path), "%s/%s/raw", DMI_ENTRIES_DIR,
                       entry->d_name);
    if (written < 0 || (size_t)written >= sizeof(raw_path)) {
      continue;
    }
    raw = fopen(raw_path, "rb");
    if (!raw) {
      continue;
    }
    len = fread(data, 1, sizeof(data) - 1, raw);
    fclose(raw);
    data[len] = '\0';
    for (size_t i = 0; i + prefix_len < len; i++) {
      if (memcmp(&data[i], L2_CPU_DMI, prefix_len) == 0) {
        const char *parsed = parse_l2_cpu(&data[i + prefix_len]);
        closedir(dir);
        return parsed;
      }
    }
  }
  closedir(dir);
  return NULL;
}

static const char *fw_cfg_l2_accel(void) {
  char value[16] = {0};
  FILE *fp = fopen(L2_ACCEL_FW_CFG, "rb");
  size_t n;

  if (!fp) {
    return NULL;
  }
  n = fread(value, 1, sizeof(value) - 1, fp);
  fclose(fp);
  return n > 0 ? parse_l2_accel(value) : NULL;
}

static const char *proc_cmdline_l2_accel(void) {
  char value[16] = {0};
  if (!read_text_prefix_value(PROC_CMDLINE_PATH, L2_ACCEL_CMDLINE,
                              value, sizeof(value))) {
    return NULL;
  }
  return parse_l2_accel(value);
}

static const char *dmi_l2_accel(void) {
  DIR *dir = opendir(DMI_ENTRIES_DIR);
  struct dirent *entry = NULL;
  const size_t prefix_len = strlen(L2_ACCEL_DMI);

  if (!dir) {
    return NULL;
  }

  while ((entry = readdir(dir)) != NULL) {
    char raw_path[256];
    FILE *raw = NULL;
    char data[512];
    size_t len;
    int written;

    if (strncmp(entry->d_name, "11-", 3) != 0) {
      continue;
    }

    written = snprintf(raw_path, sizeof(raw_path), "%s/%s/raw",
                       DMI_ENTRIES_DIR, entry->d_name);
    if (written < 0 || (size_t)written >= sizeof(raw_path)) {
      continue;
    }

    raw = fopen(raw_path, "rb");
    if (!raw) {
      continue;
    }
    len = fread(data, 1, sizeof(data) - 1, raw);
    fclose(raw);
    data[len] = '\0';

    for (size_t i = 0; i + prefix_len < len; i++) {
      if (memcmp(&data[i], L2_ACCEL_DMI, prefix_len) == 0) {
        const char *accel = parse_l2_accel(&data[i + prefix_len]);
        if (accel) {
          closedir(dir);
          return accel;
        }
      }
    }
  }

  closedir(dir);
  return NULL;
}

static bool fw_cfg_run_window_ms(unsigned *out) {
  char value[32] = {0};
  FILE *fp = fopen(L2_RUN_WINDOW_FW_CFG, "rb");
  size_t n;

  if (!fp) {
    return false;
  }
  n = fread(value, 1, sizeof(value) - 1, fp);
  fclose(fp);
  return n > 0 && parse_run_window_ms(value, out);
}

static bool proc_cmdline_run_window_ms(unsigned *out) {
  char value[32] = {0};
  if (!read_text_prefix_value(PROC_CMDLINE_PATH, L2_RUN_WINDOW_CMDLINE,
                              value, sizeof(value))) {
    return false;
  }
  return parse_run_window_ms(value, out);
}

static bool dmi_run_window_ms(unsigned *out) {
  DIR *dir = opendir(DMI_ENTRIES_DIR);
  struct dirent *entry = NULL;
  const size_t prefix_len = strlen(L2_RUN_WINDOW_DMI);

  if (!dir) {
    return false;
  }

  while ((entry = readdir(dir)) != NULL) {
    char raw_path[256];
    FILE *raw = NULL;
    char data[512];
    size_t len;
    int written;

    if (strncmp(entry->d_name, "11-", 3) != 0) {
      continue;
    }

    written = snprintf(raw_path, sizeof(raw_path), "%s/%s/raw",
                       DMI_ENTRIES_DIR, entry->d_name);
    if (written < 0 || (size_t)written >= sizeof(raw_path)) {
      continue;
    }

    raw = fopen(raw_path, "rb");
    if (!raw) {
      continue;
    }
    len = fread(data, 1, sizeof(data) - 1, raw);
    fclose(raw);
    data[len] = '\0';

    for (size_t i = 0; i + prefix_len < len; i++) {
      if (memcmp(&data[i], L2_RUN_WINDOW_DMI, prefix_len) == 0 &&
          parse_run_window_ms(&data[i + prefix_len], out)) {
        closedir(dir);
        return true;
      }
    }
  }

  closedir(dir);
  return false;
}

static unsigned run_window_ms(const uint8_t *data) {
  unsigned configured = 0;

  if (fw_cfg_run_window_ms(&configured) ||
      proc_cmdline_run_window_ms(&configured) ||
      dmi_run_window_ms(&configured)) {
    return configured;
  }

  uint16_t lo = data[3];
  uint16_t hi = data[4];
  uint32_t raw = ((uint32_t)hi << 8) | lo;
  return 5000U + (raw % 5000U);
}

static bool oracle_test_bug_enabled(const uint8_t *data, size_t len) {
  if (len < 2) {
    return false;
  }
  for (size_t i = 0; i + 1 < len; i++) {
    if (data[i] == ORACLE_TEST_MAGIC0 && data[i + 1] == ORACLE_TEST_MAGIC1) {
      return true;
    }
  }
  return false;
}

static bool l2_disable_nqc2_plugin_enabled(void) {
  char value[8] = {0};
  FILE *fp = fopen(L2_DISABLE_NQC2_FW_CFG, "rb");
  if (fp) {
    size_t n = fread(value, 1, sizeof(value) - 1, fp);
    fclose(fp);
    if (n > 0 && value[0] == '1') {
      return true;
    }
  }

  if (proc_cmdline_has_token(L2_DISABLE_NQC2_CMDLINE)) {
    return true;
  }

  DIR *dir = opendir(DMI_ENTRIES_DIR);
  if (!dir) {
    return false;
  }

  bool found = false;
  struct dirent *entry = NULL;
  while (!found && (entry = readdir(dir)) != NULL) {
    if (strncmp(entry->d_name, "11-", 3) != 0) {
      continue;
    }

    char raw_path[256];
    int written = snprintf(raw_path, sizeof(raw_path), "%s/%s/raw",
                           DMI_ENTRIES_DIR, entry->d_name);
    if (written < 0 || (size_t)written >= sizeof(raw_path)) {
      continue;
    }

    FILE *raw = fopen(raw_path, "rb");
    if (!raw) {
      continue;
    }
    char data[512];
    size_t len = fread(data, 1, sizeof(data), raw);
    fclose(raw);
    if (len >= strlen(L2_DISABLE_NQC2_DMI) &&
        memmem(data, len, L2_DISABLE_NQC2_DMI,
               strlen(L2_DISABLE_NQC2_DMI))) {
      found = true;
    }
  }
  closedir(dir);
  return found;
}

static bool write_input_snapshot(const uint8_t *data, size_t len) {
  mkdir(RUNTIME_DIR, 0700);
  FILE *fp = fopen(INPUT_PATH, "wb");
  if (!fp) {
    lqprintf("stub: failed to open input snapshot file\n");
    return false;
  }
  bool ok = fwrite(data, 1, len, fp) == len;
  fclose(fp);
  if (!ok) {
    lqprintf("stub: failed to write input snapshot\n");
  }
  return ok;
}

static void log_file_state(const char *path, const char *label) {
  struct stat st;
  if (stat(path, &st) == 0) {
    lqprintf("stub: %s size=%ld\n", label, (long)st.st_size);
  } else {
    lqprintf("stub: %s missing\n", label);
  }
}

static void dump_runtime_file(const char *name, const char *path) {
  static const char hex_digits[] = "0123456789abcdef";
  uint8_t buf[RUNTIME_DUMP_CHUNK_BYTES];
  char hex[(RUNTIME_DUMP_CHUNK_BYTES * 2U) + 1U];
  struct stat st;
  size_t dumped = 0;
  size_t offset = 0;
  int fd = open(path, O_RDONLY);

  if (fd < 0) {
    return;
  }

  if (fstat(fd, &st) != 0) {
    close(fd);
    return;
  }

  if (st.st_size > 0) {
    unsigned long long size = (unsigned long long)st.st_size;
    dumped = size > RUNTIME_DUMP_MAX_BYTES ? RUNTIME_DUMP_MAX_BYTES
                                           : (size_t)size;
  }

  lqprintf("stub-runtime begin name=%s size=%llu dumped=%zu truncated=%u\n",
           name, (unsigned long long)st.st_size, dumped,
           (unsigned)(st.st_size > (off_t)dumped));

  while (offset < dumped) {
    size_t want = dumped - offset;
    ssize_t nread;

    if (want > sizeof(buf)) {
      want = sizeof(buf);
    }

    nread = read(fd, buf, want);
    if (nread <= 0) {
      break;
    }

    for (ssize_t i = 0; i < nread; i++) {
      hex[(size_t)i * 2U] = hex_digits[buf[i] >> 4];
      hex[((size_t)i * 2U) + 1U] = hex_digits[buf[i] & 0x0fU];
    }
    hex[(size_t)nread * 2U] = '\0';
    lqprintf("stub-runtime data name=%s offset=%zu hex=%s\n", name, offset,
             hex);
    offset += (size_t)nread;
  }

  close(fd);
  lqprintf("stub-runtime end name=%s\n", name);
}

static void dump_runtime_snapshot(void) {
  static const char *files[] = {
      "morpheus-qemu-input.bin",
      "launch-l2.marker",
      "launch-l2.stdout",
      "launch-l2.stderr",
      "launch-l2.serial",
      "launch-l2.ldd",
      "morpheus-qemu-trace-events.txt",
      "morpheus-qemu-trace.log",
      "morpheus-nqc2.trace",
  };
  char path[256];

  for (size_t i = 0; i < sizeof(files) / sizeof(files[0]); i++) {
    snprintf(path, sizeof(path), RUNTIME_DIR "/%s", files[i]);
    dump_runtime_file(files[i], path);
  }
  lqprintf("stub: dumped runtime files to log\n");
}

static bool file_contains_any(const char *path, const char **needles,
                              size_t needle_count) {
  char buf[4096];
  bool found = false;
  FILE *fp = fopen(path, "rb");

  if (!fp) {
    return false;
  }

  while (!found && fgets(buf, sizeof(buf), fp)) {
    for (size_t i = 0; i < needle_count; i++) {
      if (strstr(buf, needles[i])) {
        found = true;
        break;
      }
    }
  }

  fclose(fp);
  return found;
}

static bool l2_guest_crash_logged(void) {
  static const char *needles[] = {
      "HyperArm oracle",
      "Kernel panic",
      "Oops",
      "BUG:",
      "KASAN",
  };

  return file_contains_any(LAUNCH_STDOUT_PATH, needles,
                           sizeof(needles) / sizeof(needles[0])) ||
         file_contains_any(LAUNCH_SERIAL_PATH, needles,
                           sizeof(needles) / sizeof(needles[0]));
}

static void redirect_child_log(const char *path, int target_fd) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) {
    return;
  }
  dup2(fd, target_fd);
  close(fd);
}

static bool path_exists(const char *path) {
  return access(path, F_OK) == 0;
}

static bool path_executable(const char *path) {
  return access(path, X_OK) == 0;
}

static bool write_text_file(const char *path, const char *text) {
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) {
    return false;
  }
  size_t len = strlen(text);
  ssize_t written = write(fd, text, len);
  close(fd);
  return written == (ssize_t)len;
}

static void append_marker(const char *fmt, ...) {
  va_list ap;
  FILE *fp = fopen(LAUNCH_MARKER_PATH, "a");
  if (!fp) {
    return;
  }
  va_start(ap, fmt);
  vfprintf(fp, fmt, ap);
  va_end(ap);
  fclose(fp);
}

static const char *resolve_qemu_bin(void) {
  if (path_executable(QEMU_BIN_PATH)) {
    return QEMU_BIN_PATH;
  }
  return QEMU_FALLBACK_BIN_PATH;
}

static const char *resolve_qemu_data_dir(void) {
  if (path_exists(QEMU_DATA_DIR)) {
    return QEMU_DATA_DIR;
  }
  if (path_exists(QEMU_SRC_DATA_DIR)) {
    return QEMU_SRC_DATA_DIR;
  }
  return QEMU_FALLBACK_DATA_DIR;
}

static const char *resolve_l2_accel(void) {
  const char *configured = fw_cfg_l2_accel();
  if (!configured) {
    configured = dmi_l2_accel();
  }
  if (!configured) {
    configured = proc_cmdline_l2_accel();
  }
  if (configured) {
    return configured;
  }
  return path_exists(KVM_PATH) ? "kvm" : "tcg";
}

static const char *resolve_l2_cpu(bool use_kvm, const char **source) {
  const char *configured = fw_cfg_l2_cpu();

  if (configured) {
    *source = "fw_cfg";
    return configured;
  }
  configured = dmi_l2_cpu();
  if (configured) {
    *source = "dmi";
    return configured;
  }
  configured = proc_cmdline_l2_cpu();
  if (configured) {
    *source = "cmdline";
    return configured;
  }
  *source = "default";
  return use_kvm ? L2_CPU_KVM : L2_CPU_TCG;
}

static bool l2_accel_is_kvm(const char *accel) {
  return strcmp(accel, "kvm") == 0;
}

static void log_process_state(pid_t pid) {
  char path[64];
  char buf[256];
  FILE *fp = NULL;

  snprintf(path, sizeof(path), "/proc/%u/cmdline", (unsigned)pid);
  fp = fopen(path, "rb");
  if (fp) {
    size_t n = fread(buf, 1, sizeof(buf) - 1, fp);
    fclose(fp);
    if (n > 0) {
      for (size_t i = 0; i + 1 < n; i++) {
        if (buf[i] == '\0') {
          buf[i] = ' ';
        }
      }
      buf[n] = '\0';
      lqprintf("stub: child cmdline=%s\n", buf);
    }
  } else {
    lqprintf("stub: child cmdline unavailable\n");
  }
}

static void exec_l2_qemu(bool enable_oracle_bug) {
  const char *qemu_bin = resolve_qemu_bin();
  const char *qemu_data_dir = resolve_qemu_data_dir();
  const char *l2_accel = resolve_l2_accel();
  const bool use_kvm = l2_accel_is_kvm(l2_accel);
  const char *l2_machine = use_kvm ? "virt,gic-version=3"
                                  : "virt,virtualization=on,gic-version=3";
  const char *l2_cpu_source = "unset";
  const char *l2_cpu = resolve_l2_cpu(use_kvm, &l2_cpu_source);
  bool disable_nqc2_plugin = l2_disable_nqc2_plugin_enabled() ||
                             getenv("MORPHEUS_L2_DISABLE_NQC2_PLUGIN");
  bool have_plugin = path_exists(NQC2_PLUGIN_PATH);
  char trace_arg[256];
  char plugin_arg[256];
  char append_arg[256];
  const char *argv[64];
  size_t argc = 0;

  if (!path_executable(qemu_bin)) {
    append_marker("missing-qemu=%s\n", qemu_bin);
    _exit(127);
  }

  snprintf(trace_arg, sizeof(trace_arg), "events=%s,file=%s",
           QEMU_TRACE_EVENTS_PATH, QEMU_TRACE_LOG_PATH);
  snprintf(plugin_arg, sizeof(plugin_arg), "%s,trace=%s", NQC2_PLUGIN_PATH,
           NQC2_TRACE_PATH);
  snprintf(append_arg, sizeof(append_arg),
           "console=ttyAMA0 earlycon=pl011,0x09000000 "
           "oops=panic panic_on_oops=1 panic_on_warn=1 panic=-1 "
           "kasan.fault=panic nokaslr kpti=off%s",
           enable_oracle_bug ? " virtio_mmio.hyperarm_oracle_bug=1" : "");

  write_text_file(QEMU_TRACE_EVENTS_PATH,
                  "virtio_mmio_fuzz_read\nvirtio_mmio_dma_fuzz\n");
  write_text_file(LAUNCH_MARKER_PATH, "stub-direct-start\n");
  append_marker("resolved-qemu=%s\n", qemu_bin);
  append_marker("data-dir=%s\n", qemu_data_dir);
  append_marker("accel=%s\n", l2_accel);
  append_marker("machine=%s\n", l2_machine);
  append_marker("memory-mb=%s\n", L2_MEMORY_MB);
  append_marker("cpu=%s\n", l2_cpu);
  append_marker("cpu-source=%s\n", l2_cpu_source);
  append_marker("net-transport=virtio-mmio\n");
  append_marker("trace-events-ready\n");
  append_marker("plugin-file=%s\n", have_plugin ? "present" : "missing");
  append_marker("plugin-disabled=%u\n",
                (unsigned)(disable_nqc2_plugin || !have_plugin));
  append_marker("append=%s\n", append_arg);
  append_marker("input-path=%s\n", INPUT_PATH);

  argv[argc++] = qemu_bin;
  if (path_exists(qemu_data_dir)) {
    argv[argc++] = "-L";
    argv[argc++] = qemu_data_dir;
  }
  argv[argc++] = "-trace";
  argv[argc++] = trace_arg;
  if (have_plugin && !disable_nqc2_plugin) {
    argv[argc++] = "-plugin";
    argv[argc++] = plugin_arg;
  }
  argv[argc++] = "-machine";
  argv[argc++] = l2_machine;
  argv[argc++] = "-accel";
  argv[argc++] = l2_accel;
  argv[argc++] = "-device";
  argv[argc++] = "pvpanic-pci";
  argv[argc++] = "-action";
  argv[argc++] = "panic=exit-failure";
  argv[argc++] = "-cpu";
  argv[argc++] = l2_cpu;
  argv[argc++] = "-m";
  argv[argc++] = L2_MEMORY_MB;
  argv[argc++] = "-display";
  argv[argc++] = "none";
  argv[argc++] = "-monitor";
  argv[argc++] = "none";
  argv[argc++] = "-serial";
  argv[argc++] = "file:" LAUNCH_SERIAL_PATH;
  argv[argc++] = "-kernel";
  argv[argc++] = L2_KERNEL_PATH;
  argv[argc++] = "-initrd";
  argv[argc++] = L2_INITRD_PATH;
  argv[argc++] = "-netdev";
  argv[argc++] = "user,id=net0";
  argv[argc++] = "-device";
  argv[argc++] = "virtio-net-device,netdev=net0";
  argv[argc++] = "-append";
  argv[argc++] = append_arg;
  argv[argc] = NULL;

  append_marker("qemu-exec-start\n");
  execv(qemu_bin, (char *const *)argv);
  append_marker("execv-failed\n");
  _exit(127);
}

static bool launch_l2(const uint8_t *data, size_t len, bool *oracle_hit) {
  char period_ms[32];
  char vintid[32];
  bool enable_oracle_bug = oracle_test_bug_enabled(data, len);
  bool have_vintid = !enable_oracle_bug &&
                     injected_vintid(data, vintid, sizeof(vintid));
  *oracle_hit = false;

  injected_period_ms(data, period_ms, sizeof(period_ms));
  if (enable_oracle_bug) {
    lqprintf("stub: enabling l2 oracle test bug\n");
  }

  pid_t pid = fork();
  if (pid < 0) {
    lqprintf("stub: fork failed\n");
    return false;
  }

  if (pid == 0) {
    redirect_child_log(LAUNCH_STDOUT_PATH, STDOUT_FILENO);
    redirect_child_log(LAUNCH_STDERR_PATH, STDERR_FILENO);
    setenv("MORPHEUS_QEMU_INPUT_PATH", INPUT_PATH, 1);
    setenv("MORPHEUS_L2_RUNTIME_DIR", RUNTIME_DIR, 1);
    setenv("MORPHEUS_QEMU_INJECT_VIRQ_PERIOD_MS", period_ms, 1);
    if (l2_disable_nqc2_plugin_enabled() ||
        getenv("MORPHEUS_L2_DISABLE_NQC2_PLUGIN")) {
      setenv("MORPHEUS_L2_DISABLE_NQC2_PLUGIN", "1", 1);
    }
    if (enable_oracle_bug) {
      setenv("MORPHEUS_L2_ENABLE_ORACLE_TEST_BUG", "1", 1);
    } else {
      unsetenv("MORPHEUS_L2_ENABLE_ORACLE_TEST_BUG");
    }
    if (have_vintid) {
      setenv("MORPHEUS_QEMU_INJECT_VIRQ", vintid, 1);
    } else {
      unsetenv("MORPHEUS_QEMU_INJECT_VIRQ");
    }
    exec_l2_qemu(enable_oracle_bug);
  }

  lqprintf("stub: launched l2 pid=%u\n", (unsigned)pid);
  lqprintf("stub: entering l2 run window pid=%u\n", (unsigned)pid);
  unsigned window_ms = run_window_ms(data);
  lqprintf("stub: l2 run window ms=%u\n", window_ms);
  usleep(window_ms * 1000U);
  log_process_state(pid);

  int status = 0;
  pid_t wait_ret = waitpid(pid, &status, WNOHANG);
  if (wait_ret == 0) {
    log_file_state(LAUNCH_STDOUT_PATH, "launch-l2.stdout");
    log_file_state(LAUNCH_STDERR_PATH, "launch-l2.stderr");
    log_file_state(LAUNCH_SERIAL_PATH, "launch-l2.serial");
    log_file_state(LAUNCH_MARKER_PATH, "launch-l2.marker");
    log_file_state(QEMU_TRACE_LOG_PATH, "morpheus-qemu-trace.log");
    log_file_state(NQC2_TRACE_PATH, "morpheus-nqc2.trace");
    FILE *stdout_fp = fopen(LAUNCH_STDOUT_PATH, "rb");
    FILE *stderr_fp = fopen(LAUNCH_STDERR_PATH, "rb");
    if (stdout_fp) {
      fseek(stdout_fp, 0, SEEK_END);
      lqprintf("stub: launch-l2.stdout size=%ld\n", ftell(stdout_fp));
      fclose(stdout_fp);
    }
    if (stderr_fp) {
      fseek(stderr_fp, 0, SEEK_END);
      lqprintf("stub: launch-l2.stderr size=%ld\n", ftell(stderr_fp));
      fclose(stderr_fp);
    }
    dump_runtime_snapshot();
    if (l2_guest_crash_logged()) {
      lqprintf("stub: l2 guest crash marker found before timeout kill\n");
      *oracle_hit = true;
    }
    kill(pid, SIGTERM);
    waitpid(pid, &status, 0);
    lqprintf("stub: l2 timed out and was terminated\n");
    return true;
  }
  if (wait_ret < 0) {
    lqprintf("stub: waitpid failed\n");
    return false;
  }
  if (WIFEXITED(status)) {
    log_file_state(LAUNCH_STDOUT_PATH, "launch-l2.stdout");
    log_file_state(LAUNCH_STDERR_PATH, "launch-l2.stderr");
    log_file_state(LAUNCH_SERIAL_PATH, "launch-l2.serial");
    log_file_state(LAUNCH_MARKER_PATH, "launch-l2.marker");
    log_file_state(QEMU_TRACE_LOG_PATH, "morpheus-qemu-trace.log");
    log_file_state(NQC2_TRACE_PATH, "morpheus-nqc2.trace");
    FILE *stdout_fp = fopen(LAUNCH_STDOUT_PATH, "rb");
    FILE *stderr_fp = fopen(LAUNCH_STDERR_PATH, "rb");
    if (stdout_fp) {
      fseek(stdout_fp, 0, SEEK_END);
      lqprintf("stub: launch-l2.stdout size=%ld\n", ftell(stdout_fp));
      fclose(stdout_fp);
    }
    if (stderr_fp) {
      fseek(stderr_fp, 0, SEEK_END);
      lqprintf("stub: launch-l2.stderr size=%ld\n", ftell(stderr_fp));
      fclose(stderr_fp);
    }
    dump_runtime_snapshot();
    lqprintf("stub: l2 exited status=%d\n", WEXITSTATUS(status));
    if (WEXITSTATUS(status) != 0) {
      if (l2_guest_crash_logged()) {
        lqprintf("stub: l2 guest crash marker found\n");
        *oracle_hit = true;
      } else {
        lqprintf("stub: l2 exited without guest crash marker\n");
      }
    }
    return true;
  }
  if (WIFSIGNALED(status)) {
    lqprintf("stub: l2 killed by signal=%d\n", WTERMSIG(status));
    dump_runtime_snapshot();
    *oracle_hit = true;
    return true;
  }
  return true;
}

int main(void) {
  lqprintf("libafl_nesting stub ready\n");

  while (1) {
    size_t len = (size_t)libafl_qemu_start_virt(FUZZ_INPUT, INPUT_LEN);
    if (len > INPUT_LEN) {
      len = INPUT_LEN;
    }

    bool oracle_hit = false;
    bool ok = write_input_snapshot(FUZZ_INPUT, len) &&
              launch_l2(FUZZ_INPUT, len, &oracle_hit);

    libafl_qemu_end((ok && !oracle_hit) ? LIBAFL_QEMU_END_OK
                                        : LIBAFL_QEMU_END_CRASH);
  }
}
