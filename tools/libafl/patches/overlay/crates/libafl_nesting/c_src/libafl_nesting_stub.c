#define _GNU_SOURCE
#include <errno.h>
#include <dirent.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#include "lqemu.h"

#define INPUT_LEN 512
#define RUNTIME_DIR "/run/morpheus-libafl"
#define INPUT_PATH RUNTIME_DIR "/morpheus-qemu-input.bin"
#define LAUNCH_MARKER_PATH RUNTIME_DIR "/launch-l2.marker"
#define LAUNCH_STDOUT_PATH RUNTIME_DIR "/launch-l2.stdout.log"
#define LAUNCH_STDERR_PATH RUNTIME_DIR "/launch-l2.stderr.log"
#define LKVM_STDOUT_PATH RUNTIME_DIR "/lkvm.stdout.log"
#define LKVM_STDERR_PATH RUNTIME_DIR "/lkvm.stderr.log"
#define L2_CONSOLE_PATH RUNTIME_DIR "/l2-console.log"
#define L2_CONSOLE_PTY_PATH RUNTIME_DIR "/l2-console.pty"
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
#define ROOT_LAUNCH_PATH "/root/launch-l2.sh"
#define HOST_SHARE_DIR "/host"
#define HOST_SHARE_TAG "host"
#define HOSTSTACK_LAUNCH_PATH HOST_SHARE_DIR "/launch-l2-hoststack.sh"
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
#define L2_MODE_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-mode/raw"
#define L2_ACCEL_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-accel/raw"
#define L2_CPU_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/l2-cpu/raw"
#define DMI_ENTRIES_DIR "/sys/firmware/dmi/entries"
#define L2_DISABLE_NQC2_DMI "morpheus.l2_disable_nqc2_plugin=1"
#define L2_RUN_WINDOW_DMI "morpheus.l2_run_window_ms="
#define L2_MODE_DMI "morpheus.l2_mode="
#define L2_ACCEL_DMI "morpheus.l2_accel="
#define L2_CPU_DMI "morpheus.l2_cpu="
#define PROC_CMDLINE_PATH "/proc/cmdline"
#define L2_DISABLE_NQC2_CMDLINE "morpheus.l2_disable_nqc2_plugin=1"
#define L2_RUN_WINDOW_CMDLINE "morpheus.l2_run_window_ms="
#define L2_MODE_CMDLINE "morpheus.l2_mode="
#define L2_ACCEL_CMDLINE "morpheus.l2_accel="
#define L2_CPU_CMDLINE "morpheus.l2_cpu="
#define RUNTIME_CAPTURE_CMDLINE "morpheus.capture_runtime=1"

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

static bool parse_l2_mode(const char *value, bool *out) {
  if (!value || !out) {
    return false;
  }
  if (strncmp(value, "cvm", 3) == 0 || strncmp(value, "realm", 5) == 0 ||
      strncmp(value, "true", 4) == 0 || strncmp(value, "1", 1) == 0) {
    *out = true;
    return true;
  }
  if (strncmp(value, "vm", 2) == 0 || strncmp(value, "false", 5) == 0 ||
      strncmp(value, "0", 1) == 0) {
    *out = false;
    return true;
  }
  return false;
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

static bool fw_cfg_l2_mode(bool *out) {
  char value[16] = {0};
  FILE *fp = fopen(L2_MODE_FW_CFG, "rb");
  size_t n;

  if (!fp) {
    return false;
  }
  n = fread(value, 1, sizeof(value) - 1, fp);
  fclose(fp);
  return n > 0 ? parse_l2_mode(value, out) : false;
}

static const char *proc_cmdline_l2_accel(void) {
  char value[16] = {0};
  if (!read_text_prefix_value(PROC_CMDLINE_PATH, L2_ACCEL_CMDLINE,
                              value, sizeof(value))) {
    return NULL;
  }
  return parse_l2_accel(value);
}

static bool proc_cmdline_l2_mode(bool *out) {
  char value[16] = {0};
  if (!read_text_prefix_value(PROC_CMDLINE_PATH, L2_MODE_CMDLINE,
                              value, sizeof(value))) {
    return false;
  }
  return parse_l2_mode(value, out);
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

static bool dmi_l2_mode(bool *out) {
  DIR *dir = opendir(DMI_ENTRIES_DIR);
  struct dirent *entry = NULL;
  const size_t prefix_len = strlen(L2_MODE_DMI);

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
      if (memcmp(&data[i], L2_MODE_DMI, prefix_len) == 0) {
        bool found = parse_l2_mode(&data[i + prefix_len], out);
        closedir(dir);
        return found;
      }
    }
  }
  closedir(dir);
  return false;
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
  static bool configured_checked = false;
  static unsigned configured_window = 0;

  if (!configured_checked) {
    configured_checked = true;
    (void)(fw_cfg_run_window_ms(&configured_window) ||
           proc_cmdline_run_window_ms(&configured_window) ||
           dmi_run_window_ms(&configured_window));
  }
  if (configured_window != 0) {
    return configured_window;
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
  static const char *runtime_files[] = {
      INPUT_PATH,
      LAUNCH_MARKER_PATH,
      LAUNCH_STDOUT_PATH,
      LAUNCH_STDERR_PATH,
      LKVM_STDOUT_PATH,
      LKVM_STDERR_PATH,
      L2_CONSOLE_PATH,
      L2_CONSOLE_PTY_PATH,
      RUNTIME_DIR "/launch-l2.ldd",
      QEMU_TRACE_EVENTS_PATH,
      QEMU_TRACE_LOG_PATH,
      NQC2_TRACE_PATH,
  };
  mkdir(RUNTIME_DIR, 0700);
  for (size_t i = 0; i < sizeof(runtime_files) / sizeof(runtime_files[0]); i++) {
    unlink(runtime_files[i]);
  }
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
      "launch-l2.stdout.log",
      "launch-l2.stderr.log",
      "lkvm.stdout.log",
      "lkvm.stderr.log",
      "l2-console.log",
      "l2-console.pty",
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

  return file_contains_any(L2_CONSOLE_PATH, needles,
                           sizeof(needles) / sizeof(needles[0])) ||
         file_contains_any(LAUNCH_STDOUT_PATH, needles,
                           sizeof(needles) / sizeof(needles[0])) ||
         file_contains_any(LAUNCH_STDERR_PATH, needles,
                           sizeof(needles) / sizeof(needles[0])) ||
         file_contains_any(LKVM_STDERR_PATH, needles,
                           sizeof(needles) / sizeof(needles[0])) ||
         file_contains_any(LKVM_STDOUT_PATH, needles,
                           sizeof(needles) / sizeof(needles[0]));
}

static bool runtime_capture_enabled(void) {
  static bool resolved = false;
  static bool enabled = false;

  if (!resolved) {
    enabled = proc_cmdline_has_token(RUNTIME_CAPTURE_CMDLINE);
    resolved = true;
  }
  return enabled;
}

static void log_cvm_evidence(void);
static bool resolve_l2_cvm_mode(void);

static void dump_l2_diagnostics(void) {
  log_file_state(LAUNCH_MARKER_PATH, "launch-l2.marker");
  log_file_state(LAUNCH_STDOUT_PATH, "launch-l2.stdout.log");
  log_file_state(LAUNCH_STDERR_PATH, "launch-l2.stderr.log");
  log_file_state(LKVM_STDOUT_PATH, "lkvm.stdout.log");
  log_file_state(LKVM_STDERR_PATH, "lkvm.stderr.log");
  log_file_state(L2_CONSOLE_PATH, "l2-console.log");
  log_file_state(L2_CONSOLE_PTY_PATH, "l2-console.pty");
  log_file_state(LAUNCH_MARKER_PATH, "launch-l2.marker");
  log_file_state(QEMU_TRACE_LOG_PATH, "morpheus-qemu-trace.log");
  log_file_state(NQC2_TRACE_PATH, "morpheus-nqc2.trace");

  FILE *stdout_fp = fopen(LKVM_STDOUT_PATH, "rb");
  FILE *stderr_fp = fopen(LKVM_STDERR_PATH, "rb");
  if (stdout_fp) {
    fseek(stdout_fp, 0, SEEK_END);
    lqprintf("stub: lkvm.stdout.log size=%ld\n", ftell(stdout_fp));
    fclose(stdout_fp);
  }
  if (stderr_fp) {
    fseek(stderr_fp, 0, SEEK_END);
    lqprintf("stub: lkvm.stderr.log size=%ld\n", ftell(stderr_fp));
    fclose(stderr_fp);
  }

  dump_runtime_snapshot();
  if (resolve_l2_cvm_mode()) {
    log_cvm_evidence();
  }
}

static void maybe_dump_l2_diagnostics(void) {
  if (runtime_capture_enabled()) {
    dump_l2_diagnostics();
  }
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

static bool ensure_directory(const char *path, mode_t mode) {
  if (mkdir(path, mode) == 0 || errno == EEXIST) {
    return true;
  }
  return false;
}

static bool run_command(char *const argv[]) {
  pid_t pid = fork();
  int status = 0;

  if (pid < 0) {
    return false;
  }
  if (pid == 0) {
    execv(argv[0], argv);
    _exit(127);
  }
  if (waitpid(pid, &status, 0) < 0) {
    return false;
  }
  return WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

static void try_modprobe_module(const char *module) {
  static const char *modprobe_bins[] = {
      "/sbin/modprobe",
      "/usr/sbin/modprobe",
      "/bin/modprobe",
      "/usr/bin/modprobe",
  };

  for (size_t i = 0; i < sizeof(modprobe_bins) / sizeof(modprobe_bins[0]);
       i++) {
    if (!path_executable(modprobe_bins[i])) {
      continue;
    }
    char *const argv[] = {(char *)modprobe_bins[i], (char *)module, NULL};
    if (run_command(argv)) {
      return;
    }
  }
}

static bool mount_host_share_if_needed(void) {
  static const char *mount_opts = "trans=virtio,version=9p2000.L,msize=1048576";
  int mount_errno = 0;

  if (path_executable(HOSTSTACK_LAUNCH_PATH)) {
    return true;
  }
  if (!ensure_directory(HOST_SHARE_DIR, 0755)) {
    lqprintf("stub: failed to create %s errno=%d\n", HOST_SHARE_DIR, errno);
    return false;
  }
  if (mount(HOST_SHARE_TAG, HOST_SHARE_DIR, "9p", 0, mount_opts) == 0) {
    return path_executable(HOSTSTACK_LAUNCH_PATH);
  }
  if (errno == EBUSY && path_executable(HOSTSTACK_LAUNCH_PATH)) {
    return true;
  }

  try_modprobe_module("9p");
  try_modprobe_module("9pnet");
  try_modprobe_module("9pnet_virtio");

  if (mount(HOST_SHARE_TAG, HOST_SHARE_DIR, "9p", 0, mount_opts) == 0) {
    return path_executable(HOSTSTACK_LAUNCH_PATH);
  }
  if (errno == EBUSY && path_executable(HOSTSTACK_LAUNCH_PATH)) {
    return true;
  }

  mount_errno = errno;
  lqprintf("stub: failed to mount host share errno=%d\n", mount_errno);
  return false;
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

static bool log_first_matching_line(const char *path, const char *needle,
                                    const char *label) {
  char buf[4096];
  FILE *fp = fopen(path, "rb");

  if (!fp) {
    return false;
  }

  while (fgets(buf, sizeof(buf), fp)) {
    if (!strstr(buf, needle)) {
      continue;
    }
    if (strchr(buf, '\n')) {
      lqprintf("stub: %s %s", label, buf);
    } else {
      lqprintf("stub: %s %s\n", label, buf);
    }
    fclose(fp);
    return true;
  }

  fclose(fp);
  return false;
}

static void log_cvm_evidence(void) {
  static const char *needle = "Realm shared GPA mask:";

  if (log_first_matching_line(LKVM_STDOUT_PATH, needle, "cvm evidence:")) {
    return;
  }
  if (log_first_matching_line(LKVM_STDERR_PATH, needle, "cvm evidence:")) {
    return;
  }
  if (log_first_matching_line(LAUNCH_STDOUT_PATH, needle, "cvm evidence:")) {
    return;
  }
  if (log_first_matching_line(LAUNCH_STDERR_PATH, needle, "cvm evidence:")) {
    return;
  }
  if (log_first_matching_line(L2_CONSOLE_PATH, needle, "cvm evidence:")) {
    return;
  }
  lqprintf("stub: cvm evidence missing\n");
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

static bool resolve_l2_cvm_mode(void) {
  static bool resolved = false;
  static bool cached_enabled = false;
  bool enabled = false;

  if (resolved) {
    return cached_enabled;
  }
  if (fw_cfg_l2_mode(&enabled)) {
    cached_enabled = enabled;
  } else if (dmi_l2_mode(&enabled)) {
    cached_enabled = enabled;
  } else if (proc_cmdline_l2_mode(&enabled)) {
    cached_enabled = enabled;
  }
  resolved = true;
  return cached_enabled;
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

static void exec_l2_launcher(void) {
  const bool l2_cvm = resolve_l2_cvm_mode();
  const char *launch_script = ROOT_LAUNCH_PATH;
  char *argv[] = {"/bin/bash", (char *)launch_script, NULL};

  write_text_file(LAUNCH_MARKER_PATH, "stub-launch-start\n");
  append_marker("cvm=%u\n", (unsigned)l2_cvm);
  append_marker("input-path=%s\n", INPUT_PATH);
  append_marker("runtime-dir=%s\n", RUNTIME_DIR);

  if (l2_cvm) {
    if (!mount_host_share_if_needed()) {
      append_marker("mount-host-share=failed\n");
      _exit(2);
    }
    launch_script = HOSTSTACK_LAUNCH_PATH;
    argv[1] = (char *)launch_script;
  }

  if (!path_executable(launch_script)) {
    append_marker("missing-launch-script=%s\n", launch_script);
    _exit(127);
  }

  append_marker("launch-script=%s\n", launch_script);
  execv(argv[0], argv);
  append_marker("launcher-execv-failed\n");
  _exit(127);
}

static void signal_l2_process_group(pid_t pid, int signal_number) {
  if (pid <= 0) {
    return;
  }

  /* The launcher owns the nested lkvm/QEMU descendants. Kill the whole
   * process group so a shell waiting on lkvm cannot hold up the next input. */
  (void)kill(-pid, signal_number);
  (void)kill(pid, signal_number);
}

static bool reap_l2_process(pid_t pid, int *status) {
  for (unsigned attempt = 0; attempt < 50U; attempt++) {
    pid_t wait_ret = waitpid(pid, status, WNOHANG);
    if (wait_ret == pid) {
      return true;
    }
    if (wait_ret < 0) {
      if (errno == EINTR) {
        attempt--;
        continue;
      }
      return false;
    }
    usleep(10000U);
  }

  signal_l2_process_group(pid, SIGKILL);
  while (waitpid(pid, status, 0) < 0) {
    if (errno != EINTR) {
      return false;
    }
  }
  return true;
}

static bool launch_l2(const uint8_t *data, size_t len, bool *oracle_hit) {
  char period_ms[32];
  char vintid[32];
  bool enable_oracle_bug = true;
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
    (void)setpgid(0, 0);
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
    exec_l2_launcher();
  }

  (void)setpgid(pid, pid);

  lqprintf("stub: launched l2 pid=%u\n", (unsigned)pid);
  lqprintf("stub: entering l2 run window pid=%u\n", (unsigned)pid);
  unsigned window_ms = run_window_ms(data);
  unsigned evidence_wait_ms = window_ms < 5000U ? window_ms : 5000U;
  lqprintf("stub: l2 run window ms=%u\n", window_ms);
  usleep(evidence_wait_ms * 1000U);
  if (window_ms > evidence_wait_ms) {
    usleep((window_ms - evidence_wait_ms) * 1000U);
  }
  log_process_state(pid);

  int status = 0;
  pid_t wait_ret = waitpid(pid, &status, WNOHANG);
  if (wait_ret == 0) {
    /* Normal timeout is the hot path. Avoid serializing every runtime file
     * through the L1 hypercall log; retain the full snapshot only for an
     * actual guest crash when runtime capture is explicitly enabled. */
    if (l2_guest_crash_logged()) {
      maybe_dump_l2_diagnostics();
      lqprintf("stub: l2 guest crash marker found before timeout kill\n");
      *oracle_hit = true;
    }
    signal_l2_process_group(pid, SIGTERM);
    if (!reap_l2_process(pid, &status)) {
      lqprintf("stub: failed to reap l2 process group\n");
      return false;
    }
    lqprintf("stub: l2 timed out and was terminated\n");
    return true;
  }
  if (wait_ret < 0) {
    lqprintf("stub: waitpid failed\n");
    return false;
  }
  if (WIFEXITED(status)) {
    const int exit_status = WEXITSTATUS(status);
    const bool crash_logged = l2_guest_crash_logged();
    lqprintf("stub: l2 exited status=%d\n", exit_status);
    if (exit_status != 0 || crash_logged) {
      maybe_dump_l2_diagnostics();
      if (crash_logged) {
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
    maybe_dump_l2_diagnostics();
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
