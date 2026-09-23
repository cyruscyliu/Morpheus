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
#include <spawn.h>
#include <time.h>
#include <unistd.h>

#include "lqemu.h"

#define INPUT_LEN 4096
#define RUNTIME_DIR "/run/morpheus-libafl"
#define INPUT_PATH RUNTIME_DIR "/morpheus-qemu-input.bin"
#define LAUNCH_MARKER_PATH RUNTIME_DIR "/launch-l2.marker"
#define LAUNCH_STDOUT_PATH RUNTIME_DIR "/launch-l2.stdout.log"
#define LAUNCH_STDERR_PATH RUNTIME_DIR "/launch-l2.stderr.log"
#define QEMU_STDOUT_PATH RUNTIME_DIR "/qemu.stdout.log"
#define QEMU_STDERR_PATH RUNTIME_DIR "/qemu.stderr.log"
#define QEMU_INPUT_STATUS_PATH RUNTIME_DIR "/qemu-input.status"
#define L2_CONSOLE_PATH RUNTIME_DIR "/l2-console.log"
#define L2_CONSOLE_ALT_PATH "/mnt/morpheus-l2-runtime/l2-console.log"
#define L2_CONSOLE_ALT2_PATH "/run/morpheus-l2-runtime/l2-console.log"
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
#define HOST_SHARE_DIR "/mnt"
#define HOST_SHARE_FALLBACK_DIR "/host"
#define HOST_SHARE_TAG "host"
#define HOSTSTACK_LAUNCH_PATH HOST_SHARE_DIR "/launch-l2-hoststack.sh"
#define HOSTSTACK_FALLBACK_LAUNCH_PATH \
  HOST_SHARE_FALLBACK_DIR "/launch-l2-hoststack.sh"
#define HOSTSTACK_LOCAL_LAUNCH_PATH "/root/launch-l2-hoststack.sh"
#define L2_CPU_TCG "cortex-a57"
#define L2_CPU_KVM "host"
#define L2_READY_POLL_MS 250U
#define RUNTIME_DUMP_MAX_BYTES (2048U * 1024U)
#define RUNTIME_DUMP_CHUNK_BYTES 512U
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
#define RUNTIME_CAPTURE_FW_CFG \
  "/sys/firmware/qemu_fw_cfg/by_name/opt/morpheus/capture-runtime/raw"
#define DMI_ENTRIES_DIR "/sys/firmware/dmi/entries"
#define L2_DISABLE_NQC2_DMI "morpheus.l2_disable_nqc2_plugin=1"
#define L2_RUN_WINDOW_DMI "morpheus.l2_run_window_ms="
#define L2_MODE_DMI "morpheus.l2_mode="
#define L2_ACCEL_DMI "morpheus.l2_accel="
#define L2_CPU_DMI "morpheus.l2_cpu="
#define RUNTIME_CAPTURE_DMI "morpheus.capture_runtime=1"
#define PROC_CMDLINE_PATH "/proc/cmdline"
#define L2_DISABLE_NQC2_CMDLINE "morpheus.l2_disable_nqc2_plugin=1"
#define L2_RUN_WINDOW_CMDLINE "morpheus.l2_run_window_ms="
#define L2_MODE_CMDLINE "morpheus.l2_mode="
#define L2_ACCEL_CMDLINE "morpheus.l2_accel="
#define L2_CPU_CMDLINE "morpheus.l2_cpu="
#define RUNTIME_CAPTURE_CMDLINE "morpheus.capture_runtime=1"
#define RUNTIME_CAPTURE_ENV "MORPHEUS_CAPTURE_RUNTIME"
#define TRACE_DEBUG_ENV "MORPHEUS_L2_TRACE_DEBUG"
#define L2_MODE_ENV "MORPHEUS_L2_MODE"
#define L2_RUN_WINDOW_ENV "MORPHEUS_L2_RUN_WINDOW_MS"
#define L2_MEASURE_STARTUP_ENV "MORPHEUS_L2_MEASURE_STARTUP"
#define L2_STARTUP_TIMING_POLL_MS 25U

static uint8_t FUZZ_INPUT[INPUT_LEN];
static const char *selected_hoststack_launch_path = NULL;
extern char **environ;

static bool ensure_runtime_dir(void);

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

static bool env_l2_mode(bool *out) {
  const char *value = getenv(L2_MODE_ENV);
  return value && parse_l2_mode(value, out);
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

static bool env_run_window_ms(unsigned *out) {
  const char *value = getenv(L2_RUN_WINDOW_ENV);
  return value && parse_run_window_ms(value, out);
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

static unsigned run_window_ms(void) {
  static bool configured_checked = false;
  static unsigned configured_window = 0;

  if (!configured_checked) {
    configured_checked = true;
    (void)(fw_cfg_run_window_ms(&configured_window) ||
           env_run_window_ms(&configured_window) ||
           proc_cmdline_run_window_ms(&configured_window) ||
           dmi_run_window_ms(&configured_window));
  }
  if (configured_window != 0) {
    return configured_window;
  }

  return 5000U;
}

static bool l2_startup_measurement_enabled(void) {
  const char *value = getenv(L2_MEASURE_STARTUP_ENV);
  return value && (value[0] == '1' || strcasecmp(value, "true") == 0 ||
                   strcasecmp(value, "yes") == 0);
}

static uint64_t monotonic_time_ns(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) {
    return 0;
  }
  return ((uint64_t)now.tv_sec * 1000000000ULL) + (uint64_t)now.tv_nsec;
}

static void log_l2_startup_timing(uint64_t qemu_exec_start_ns,
                                  uint64_t buildroot_ready_ns) {
  uint64_t duration_ns;

  if (qemu_exec_start_ns == 0 || buildroot_ready_ns == 0 ||
      buildroot_ready_ns < qemu_exec_start_ns) {
    lqprintf("stub-l2-startup-timing-incomplete start_seen=%u ready_seen=%u\n",
             (unsigned)(qemu_exec_start_ns != 0),
             (unsigned)(buildroot_ready_ns != 0));
    return;
  }

  duration_ns = buildroot_ready_ns - qemu_exec_start_ns;
  lqprintf("stub-l2-startup-timing start_ns=%llu ready_ns=%llu "
           "duration_ns=%llu\n",
           (unsigned long long)qemu_exec_start_ns,
           (unsigned long long)buildroot_ready_ns,
           (unsigned long long)duration_ns);
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

static bool dmi_has_token(const char *token) {
  DIR *dir = opendir(DMI_ENTRIES_DIR);
  struct dirent *entry = NULL;
  bool found = false;
  const size_t token_len = strlen(token);

  if (!dir) {
    return false;
  }

  while (!found && (entry = readdir(dir)) != NULL) {
    char raw_path[256];
    int written;
    FILE *raw;
    char data[512];
    size_t len;

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
    len = fread(data, 1, sizeof(data), raw);
    fclose(raw);
    if (len >= token_len && memmem(data, len, token, token_len) != NULL) {
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
      QEMU_STDOUT_PATH,
      QEMU_STDERR_PATH,
      QEMU_INPUT_STATUS_PATH,
      L2_CONSOLE_PATH,
      L2_CONSOLE_ALT_PATH,
      L2_CONSOLE_ALT2_PATH,
      L2_CONSOLE_PTY_PATH,
      RUNTIME_DIR "/launch-l2.ldd",
      QEMU_TRACE_EVENTS_PATH,
      QEMU_TRACE_LOG_PATH,
      NQC2_TRACE_PATH,
  };
  if (!ensure_runtime_dir()) {
    lqprintf("stub: runtime directory unavailable errno=%d\n", errno);
    return false;
  }
  for (size_t i = 0; i < sizeof(runtime_files) / sizeof(runtime_files[0]); i++) {
    unlink(runtime_files[i]);
  }

  int fd = open(INPUT_PATH, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd < 0) {
    int error_number = errno;
    lqprintf("stub: input open failed errno=%d\n", error_number);
    errno = error_number;
    return false;
  }

  bool ok = true;
  size_t offset = 0;
  while (offset < len) {
    ssize_t written = write(fd, data + offset, len - offset);
    if (written < 0) {
      int error_number = errno;
      lqprintf("stub: input write failed errno=%d offset=%zu\n",
               error_number, offset);
      errno = error_number;
      ok = false;
      break;
    }
    if (written == 0) {
      lqprintf("stub: input write failed errno=%d offset=%zu\n", EIO,
               offset);
      errno = EIO;
      ok = false;
      break;
    }
    offset += (size_t)written;
  }

  if (close(fd) != 0) {
    int error_number = errno;
    lqprintf("stub: input close failed errno=%d\n", error_number);
    errno = error_number;
    ok = false;
  }
  if (ok) {
    lqprintf("stub: input path=%s input-size=%zu\n", INPUT_PATH, len);
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

static bool trace_debug_enabled(void) {
  const char *value = getenv(TRACE_DEBUG_ENV);

  return value && value[0] == '1';
}

static void dump_runtime_file(const char *name, const char *path) {
  static const char hex_digits[] = "0123456789abcdef";
  uint8_t buf[RUNTIME_DUMP_CHUNK_BYTES];
  char hex[(RUNTIME_DUMP_CHUNK_BYTES * 2U) + 1U];
  char line[512];
  size_t line_len = 0;
  bool text_mode;
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

  text_mode = trace_debug_enabled() &&
              strcmp(name, "morpheus-qemu-trace.log") == 0;

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

    if (text_mode) {
      for (ssize_t i = 0; i < nread; i++) {
        if (buf[i] == '\n') {
          line[line_len] = '\0';
          lqprintf("l2-mmio %s\n", line);
          line_len = 0;
        } else if (line_len + 1 < sizeof(line)) {
          line[line_len++] = (char)buf[i];
        }
      }
    } else {
      for (ssize_t i = 0; i < nread; i++) {
        hex[(size_t)i * 2U] = hex_digits[buf[i] >> 4];
        hex[((size_t)i * 2U) + 1U] = hex_digits[buf[i] & 0x0fU];
      }
      hex[(size_t)nread * 2U] = '\0';
      lqprintf("stub-runtime data name=%s offset=%zu hex=%s\n", name, offset,
               hex);
    }
    offset += (size_t)nread;
  }

  if (text_mode && line_len > 0) {
    line[line_len] = '\0';
    lqprintf("l2-mmio %s\n", line);
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
      "qemu.stdout.log",
      "qemu.stderr.log",
      "qemu-input.status",
      "l2-console.log",
      "l2-console-alt.log",
      "l2-console-alt2.log",
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
  dump_runtime_file("l2-console.alt.log", L2_CONSOLE_ALT_PATH);
  dump_runtime_file("l2-console.alt2.log", L2_CONSOLE_ALT2_PATH);
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

enum l2_outcome {
  L2_OUTCOME_HARNESS_ERROR,
  L2_OUTCOME_COMPLETE,
  L2_OUTCOME_RUN_WINDOW_COMPLETE,
  L2_OUTCOME_KERNEL_PANIC,
  L2_OUTCOME_LAUNCHER_EXIT,
  L2_OUTCOME_LAUNCHER_SIGNAL,
};

static const char *l2_outcome_name(enum l2_outcome outcome) {
  switch (outcome) {
    case L2_OUTCOME_COMPLETE:
      return "complete";
    case L2_OUTCOME_RUN_WINDOW_COMPLETE:
      return "run-window-complete";
    case L2_OUTCOME_KERNEL_PANIC:
      return "kernel-panic";
    case L2_OUTCOME_LAUNCHER_EXIT:
      return "launcher-exit";
    case L2_OUTCOME_LAUNCHER_SIGNAL:
      return "launcher-signal";
    case L2_OUTCOME_HARNESS_ERROR:
      return "harness-error";
  }
  return "harness-error";
}

static void log_l2_outcome(enum l2_outcome outcome, int detail) {
  lqprintf("stub-outcome kind=%s detail=%d\n", l2_outcome_name(outcome),
           detail);
}

static bool l2_kernel_panic_logged(void) {
  static const char *needles[] = {
      "Kernel panic",
  };

  /* These files carry L2 console output. Launcher and QEMU stderr can report
   * host-side failures, so they are diagnostic artifacts, not panic evidence. */
  return file_contains_any(L2_CONSOLE_PATH, needles,
                           sizeof(needles) / sizeof(needles[0])) ||
         file_contains_any(QEMU_STDOUT_PATH, needles,
                           sizeof(needles) / sizeof(needles[0]));
}

static bool runtime_capture_enabled(void) {
  static bool resolved = false;
  static bool enabled = false;

  if (!resolved) {
    const char *environment = getenv(RUNTIME_CAPTURE_ENV);

    enabled = environment && environment[0] == '1';
    FILE *fw_cfg = fopen(RUNTIME_CAPTURE_FW_CFG, "rb");
    if (!enabled && fw_cfg) {
      char value[8] = {0};
      size_t n = fread(value, 1, sizeof(value) - 1, fw_cfg);
      fclose(fw_cfg);
      enabled = n > 0 && value[0] == '1';
    } else if (fw_cfg) {
      fclose(fw_cfg);
    }
    if (!enabled) {
      enabled = dmi_has_token(RUNTIME_CAPTURE_DMI);
    }
    if (!enabled) {
      enabled = proc_cmdline_has_token(RUNTIME_CAPTURE_CMDLINE);
    }
    lqprintf("stub: runtime-capture=%u source=%s\n", (unsigned)enabled,
             environment && environment[0] == '1' ? "env" : "metadata");
    resolved = true;
  }
  return enabled;
}

static void log_cvm_evidence(void);
static bool l2_qemu_exec_started(void);
static bool resolve_l2_cvm_mode(void);

static void dump_l2_diagnostics(void) {
  log_file_state(LAUNCH_MARKER_PATH, "launch-l2.marker");
  log_file_state(LAUNCH_STDOUT_PATH, "launch-l2.stdout.log");
  log_file_state(LAUNCH_STDERR_PATH, "launch-l2.stderr.log");
  log_file_state(QEMU_STDOUT_PATH, "qemu.stdout.log");
  log_file_state(QEMU_STDERR_PATH, "qemu.stderr.log");
  log_file_state(L2_CONSOLE_PATH, "l2-console.log");
  log_file_state(L2_CONSOLE_PTY_PATH, "l2-console.pty");
  log_file_state(LAUNCH_MARKER_PATH, "launch-l2.marker");
  log_file_state(QEMU_TRACE_LOG_PATH, "morpheus-qemu-trace.log");
  log_file_state(NQC2_TRACE_PATH, "morpheus-nqc2.trace");

  FILE *stdout_fp = fopen(QEMU_STDOUT_PATH, "rb");
  FILE *stderr_fp = fopen(QEMU_STDERR_PATH, "rb");
  if (stdout_fp) {
    fseek(stdout_fp, 0, SEEK_END);
    lqprintf("stub: qemu.stdout.log size=%ld\n", ftell(stdout_fp));
    fclose(stdout_fp);
  }
  if (stderr_fp) {
    fseek(stderr_fp, 0, SEEK_END);
    lqprintf("stub: qemu.stderr.log size=%ld\n", ftell(stderr_fp));
    fclose(stderr_fp);
  }

  dump_runtime_snapshot();
  if (resolve_l2_cvm_mode()) {
    if (l2_qemu_exec_started()) {
      log_cvm_evidence();
    } else {
      lqprintf("stub: cvm evidence not applicable: nested qemu was not "
               "started\n");
    }
  }
}

static int open_launch_log(const char *path) {
  return open(path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
}

struct launch_env_override {
  const char *key;
  const char *entry;
};

static bool env_entry_has_key(const char *entry, const char *key) {
  size_t key_len = strlen(key);
  return strncmp(entry, key, key_len) == 0 && entry[key_len] == '=';
}

static bool env_entry_is_overridden(
    const char *entry, const struct launch_env_override *overrides,
    size_t override_count) {
  for (size_t i = 0; i < override_count; i++) {
    if (env_entry_has_key(entry, overrides[i].key)) {
      return true;
    }
  }
  return false;
}

static char **build_launch_environment(
    const struct launch_env_override *overrides, size_t override_count) {
  size_t inherited_count = 0;
  size_t env_count = 0;
  char **environment;

  for (char **entry = environ; entry && *entry; entry++) {
    if (!env_entry_is_overridden(*entry, overrides, override_count)) {
      inherited_count++;
    }
  }

  environment = calloc(inherited_count + override_count + 1,
                       sizeof(*environment));
  if (!environment) {
    return NULL;
  }

  for (char **entry = environ; entry && *entry; entry++) {
    if (!env_entry_is_overridden(*entry, overrides, override_count)) {
      environment[env_count++] = *entry;
    }
  }
  for (size_t i = 0; i < override_count; i++) {
    if (overrides[i].entry) {
      environment[env_count++] = (char *)overrides[i].entry;
    }
  }
  environment[env_count] = NULL;
  return environment;
}

static bool path_exists(const char *path) {
  return access(path, F_OK) == 0;
}

static bool path_executable(const char *path) {
  return access(path, X_OK) == 0;
}

static bool ensure_directory(const char *path, mode_t mode) {
  struct stat st;

  if (mkdir(path, mode) == 0) {
    return true;
  }
  if (errno != EEXIST) {
    return false;
  }
  if (stat(path, &st) != 0) {
    return false;
  }
  if (!S_ISDIR(st.st_mode)) {
    errno = ENOTDIR;
    return false;
  }
  return true;
}

static bool mount_runtime_tmpfs(void) {
  int mount_errno;

  if (mount("tmpfs", "/run", "tmpfs", MS_NOSUID | MS_NODEV,
            "mode=0755") == 0) {
    return true;
  }
  mount_errno = errno;
  lqprintf("stub: runtime mount-run-tmpfs failed errno=%d\n", mount_errno);
  errno = mount_errno;
  return mount_errno == EBUSY;
}

static bool ensure_runtime_dir(void) {
  static bool prepared = false;
  static bool root_remount_attempted = false;
  static bool tmpfs_attempted = false;
  struct stat st;
  int error_number;

  if (prepared && stat(RUNTIME_DIR, &st) == 0 && S_ISDIR(st.st_mode)) {
    return true;
  }

  if (!root_remount_attempted) {
    root_remount_attempted = true;
    if (mount(NULL, "/", NULL, MS_REMOUNT, NULL) != 0) {
      error_number = errno;
      lqprintf("stub: runtime remount-root failed errno=%d\n", error_number);
      errno = error_number;
    }
  }

  if (stat("/run", &st) != 0) {
    if (mkdir("/run", 0755) != 0 && errno != EEXIST) {
      error_number = errno;
      lqprintf("stub: runtime mkdir-run failed errno=%d\n", error_number);
      errno = error_number;
    }
  }

  if (stat("/run", &st) != 0 || !S_ISDIR(st.st_mode) ||
      access("/run", W_OK) != 0) {
    if (!tmpfs_attempted) {
      tmpfs_attempted = true;
      (void)mount_runtime_tmpfs();
    }
  }

  if (!ensure_directory(RUNTIME_DIR, 0700)) {
    error_number = errno;
    lqprintf("stub: runtime mkdir failed path=%s errno=%d\n", RUNTIME_DIR,
             error_number);
    errno = error_number;
    if (!tmpfs_attempted) {
      tmpfs_attempted = true;
      if (mount_runtime_tmpfs() && ensure_directory(RUNTIME_DIR, 0700)) {
        prepared = true;
      }
    }
    if (!prepared) {
      return false;
    }
  }

  if (chmod(RUNTIME_DIR, 0700) != 0) {
    error_number = errno;
    lqprintf("stub: runtime chmod failed path=%s errno=%d\n", RUNTIME_DIR,
             error_number);
    errno = error_number;
    return false;
  }
  prepared = true;
  return true;
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

static bool try_mount_host_share(const char *share_dir,
                                 const char *launch_path,
                                 const char *mount_opts) {
  int mount_errno = 0;

  if (path_executable(launch_path)) {
    selected_hoststack_launch_path = launch_path;
    return true;
  }
  if (!ensure_directory(share_dir, 0755)) {
    lqprintf("stub: failed to create %s errno=%d\n", share_dir, errno);
    return false;
  }
  if (mount(HOST_SHARE_TAG, share_dir, "9p", 0, mount_opts) == 0) {
    if (path_executable(launch_path)) {
      selected_hoststack_launch_path = launch_path;
      return true;
    }
  }
  mount_errno = errno;
  if (mount_errno == EBUSY && path_executable(launch_path)) {
    selected_hoststack_launch_path = launch_path;
    return true;
  }
  return false;
}

static bool mount_host_share_if_needed(void) {
  static const char *mount_opts = "trans=virtio,version=9p2000.L,msize=1048576";
  static const char *share_dirs[] = {
      HOST_SHARE_DIR,
      HOST_SHARE_FALLBACK_DIR,
  };
  static const char *launch_paths[] = {
      HOSTSTACK_LAUNCH_PATH,
      HOSTSTACK_FALLBACK_LAUNCH_PATH,
  };
  int mount_errno = 0;

  for (size_t i = 0; i < sizeof(launch_paths) / sizeof(launch_paths[0]);
       i++) {
    if (path_executable(launch_paths[i])) {
      selected_hoststack_launch_path = launch_paths[i];
      return true;
    }
  }

  try_modprobe_module("9p");
  try_modprobe_module("9pnet");
  try_modprobe_module("9pnet_virtio");

  for (size_t i = 0; i < sizeof(share_dirs) / sizeof(share_dirs[0]); i++) {
    if (try_mount_host_share(share_dirs[i], launch_paths[i], mount_opts)) {
      return true;
    }
    mount_errno = errno;
  }

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

static bool l2_qemu_exec_started(void) {
  static const char *needle = "qemu-exec-start";

  /* qemu-input.status is written by the wrapper before it executes the
   * generated launcher.  The launch marker is the authoritative boundary. */
  return file_contains_any(LAUNCH_MARKER_PATH, &needle, 1);
}

static bool l2_boot_ready_logged(void) {
  static const char *needles[] = {
      "buildroot login:",
      "Welcome to Buildroot",
  };
  const size_t needle_count = sizeof(needles) / sizeof(needles[0]);

  /* The direct buildroot launcher writes L2 serial output here.  This is a
   * guest readiness signal, not a fuzz result, so it only shortens the
   * normal boot path; panic and launcher-failure paths still classify below. */
  return file_contains_any(QEMU_STDOUT_PATH, needles, needle_count) ||
         file_contains_any(L2_CONSOLE_PATH, needles, needle_count);
}

static bool l2_buildroot_login_logged(void) {
  static const char *needles[] = {"buildroot login:"};

  /* Startup calibration uses the same login-prompt boundary as the nvirsh
   * observer.  The earlier welcome banner is useful for normal readiness
   * diagnostics, but it is not the endpoint of this measurement. */
  return file_contains_any(QEMU_STDOUT_PATH, needles, 1) ||
         file_contains_any(L2_CONSOLE_PATH, needles, 1);
}

static void log_l2_launcher_phase(void) {
  if (l2_qemu_exec_started()) {
    lqprintf("stub: l2 launcher phase=post-qemu\n");
  } else {
    lqprintf("stub: pre-qemu launcher failure: nested qemu was not started\n");
  }
}

static void log_cvm_evidence(void) {
  static const char *needle = "Realm shared GPA mask:";

  if (log_first_matching_line(QEMU_STDOUT_PATH, needle, "cvm evidence:")) {
    return;
  }
  if (log_first_matching_line(QEMU_STDERR_PATH, needle, "cvm evidence:")) {
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

static bool log_l2_input_source(const char *needle, const char *label) {
  if (log_first_matching_line(QEMU_INPUT_STATUS_PATH, needle, label)) {
    return true;
  }
  if (log_first_matching_line(QEMU_STDOUT_PATH, needle, label)) {
    return true;
  }
  if (log_first_matching_line(QEMU_STDERR_PATH, needle, label)) {
    return true;
  }
  if (log_first_matching_line(LAUNCH_STDOUT_PATH, needle, label)) {
    return true;
  }
  if (log_first_matching_line(LAUNCH_STDERR_PATH, needle, label)) {
    return true;
  }
  return false;
}

static void log_l2_input_evidence(void) {
  bool handoff_logged;

  if (!runtime_capture_enabled()) {
    return;
  }
  handoff_logged = log_first_matching_line(LAUNCH_MARKER_PATH,
                                           "input-status-path=",
                                           "input handoff:");
  if (log_l2_input_source("input-path=", "input evidence:") ||
      log_l2_input_source("input-size=", "input evidence:")) {
    return;
  }
  if (log_l2_input_source("input-status-path=", "input evidence:")) {
    return;
  }
  lqprintf("stub: input %s\n",
           handoff_logged ? "handoff evidence missing"
                          : "launch marker missing input status");
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
  if (env_l2_mode(&enabled)) {
    cached_enabled = enabled;
  } else if (fw_cfg_l2_mode(&enabled)) {
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

static void log_wait_status(pid_t pid, int status) {
  int process_group = getpgid(pid);
  int core_dumped = 0;
#ifdef WCOREDUMP
  core_dumped = WCOREDUMP(status) ? 1 : 0;
#endif

  if (process_group < 0) {
    lqprintf("stub: l2 wait pid=%u pgid=unavailable errno=%d raw-status=%d\n",
             (unsigned)pid, errno, status);
  } else {
    lqprintf("stub: l2 wait pid=%u pgid=%u raw-status=%d\n", (unsigned)pid,
             (unsigned)process_group, status);
  }
  lqprintf("stub: l2 wait exited=%u exit-status=%d signaled=%u signal=%d "
           "core-dumped=%u stopped=%u continued=%u\n",
           (unsigned)WIFEXITED(status), WIFEXITED(status) ? WEXITSTATUS(status) : -1,
           (unsigned)WIFSIGNALED(status),
           WIFSIGNALED(status) ? WTERMSIG(status) : 0, (unsigned)core_dumped,
           (unsigned)WIFSTOPPED(status), WIFSTOPPED(status) ? WSTOPSIG(status) : 0,
           (unsigned)WIFCONTINUED(status));
}

static const char *resolve_l2_shell(void) {
  /* Buildroot commonly makes /bin/sh a symlink to bash. Keep the launcher
   * invocation consistent with the original /bin/bash contract and use sh
   * only for images that do not ship bash. */
  if (path_executable("/bin/bash")) {
    return "/bin/bash";
  }
  if (path_executable("/bin/sh")) {
    return "/bin/sh";
  }
  return NULL;
}

static bool prepare_l2_launcher(const char **shell_out,
                                const char **launch_script_out) {
  const bool l2_cvm = resolve_l2_cvm_mode();
  const char *launch_script = ROOT_LAUNCH_PATH;
  const char *shell = resolve_l2_shell();
  char shell_target[128];
  ssize_t shell_target_len;

  write_text_file(LAUNCH_MARKER_PATH, "stub-launch-start\n");
  append_marker("cvm=%u\n", (unsigned)l2_cvm);
  append_marker("input-path=%s\n", INPUT_PATH);
  append_marker("runtime-dir=%s\n", RUNTIME_DIR);

  if (l2_cvm) {
    if (!mount_host_share_if_needed()) {
      append_marker("mount-host-share=failed\n");
      return false;
    }
    launch_script = selected_hoststack_launch_path;
    append_marker("hoststack-launch=%s\n", launch_script);
  }

  if (!shell) {
    append_marker("missing-launch-shell\n");
    return false;
  }
  append_marker("launch-shell=%s\n", shell);
  if (access(shell, X_OK) != 0) {
    append_marker("launch-shell-access-failed errno=%d\n", errno);
  }
  shell_target_len = readlink(shell, shell_target, sizeof(shell_target) - 1);
  if (shell_target_len >= 0) {
    shell_target[shell_target_len] = '\0';
    append_marker("launch-shell-target=%s\n", shell_target);
  }
  if (!path_executable(launch_script)) {
    append_marker("missing-launch-script=%s\n", launch_script);
    return false;
  }

  append_marker("launch-script=%s\n", launch_script);
  *shell_out = shell;
  *launch_script_out = launch_script;
  return true;
}

static void signal_l2_process_group(pid_t pid, int signal_number) {
  if (pid <= 0) {
    return;
  }

  /* The launcher owns the nested QEMU descendants. Kill the whole
   * process group so a shell waiting on QEMU cannot hold up the next input. */
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

static bool launch_l2(enum l2_outcome *outcome, int *outcome_detail) {
  char input_env[128];
  char runtime_env[128];
  char nqc2_env[128];
  const char *shell = NULL;
  const char *launch_script = NULL;
  struct launch_env_override overrides[3];
  size_t override_count = 0;
  char **launch_environment = NULL;
  int launch_stdout_fd = -1;
  int launch_stderr_fd = -1;
  posix_spawn_file_actions_t file_actions;
  posix_spawnattr_t spawn_attributes;
  bool file_actions_initialized = false;
  bool spawn_attributes_initialized = false;
  int setup_error = 0;
  int spawn_error;
  pid_t pid;
  char *argv[3];
  bool measure_startup;
  uint64_t qemu_exec_start_ns = 0;
  uint64_t buildroot_ready_ns = 0;
  *outcome = L2_OUTCOME_HARNESS_ERROR;
  *outcome_detail = 0;

  /* Keep process creation in posix_spawn. LibAFL/QEMU has worker threads, and
   * a raw fork can inherit libc state that is unsafe for the child launcher. */
  if (!prepare_l2_launcher(&shell, &launch_script)) {
    return false;
  }

  append_marker("launcher-shell-trace=%s\n",
                getenv("MORPHEUS_L2_SHELL_TRACE")
                    ? getenv("MORPHEUS_L2_SHELL_TRACE")
                    : "0");

  if (snprintf(input_env, sizeof(input_env),
               "MORPHEUS_QEMU_INPUT_PATH=%s", INPUT_PATH) < 0 ||
      snprintf(runtime_env, sizeof(runtime_env),
               "MORPHEUS_L2_RUNTIME_DIR=%s", RUNTIME_DIR) < 0) {
    append_marker("launcher-environment-format-failed\n");
    return false;
  }

  overrides[override_count++] = (struct launch_env_override){
      "MORPHEUS_QEMU_INPUT_PATH", input_env};
  overrides[override_count++] = (struct launch_env_override){
      "MORPHEUS_L2_RUNTIME_DIR", runtime_env};

  if (l2_disable_nqc2_plugin_enabled() ||
      getenv("MORPHEUS_L2_DISABLE_NQC2_PLUGIN")) {
    snprintf(nqc2_env, sizeof(nqc2_env),
             "MORPHEUS_L2_DISABLE_NQC2_PLUGIN=1");
    overrides[override_count++] = (struct launch_env_override){
        "MORPHEUS_L2_DISABLE_NQC2_PLUGIN", nqc2_env};
  }

  launch_stdout_fd = open_launch_log(LAUNCH_STDOUT_PATH);
  if (launch_stdout_fd < 0) {
    int error_number = errno;
    append_marker("launcher-stdout-open-failed errno=%d\n", error_number);
    return false;
  }
  launch_stderr_fd = open_launch_log(LAUNCH_STDERR_PATH);
  if (launch_stderr_fd < 0) {
    int error_number = errno;
    append_marker("launcher-stderr-open-failed errno=%d\n", error_number);
    close(launch_stdout_fd);
    return false;
  }

  launch_environment =
      build_launch_environment(overrides, override_count);
  if (!launch_environment) {
    append_marker("launcher-environment-alloc-failed\n");
    close(launch_stdout_fd);
    close(launch_stderr_fd);
    return false;
  }

  setup_error = posix_spawn_file_actions_init(&file_actions);
  if (setup_error != 0) {
    goto spawn_setup_failed;
  }
  file_actions_initialized = true;
  setup_error = posix_spawn_file_actions_adddup2(
      &file_actions, launch_stdout_fd, STDOUT_FILENO);
  if (setup_error != 0) {
    goto spawn_setup_failed;
  }
  setup_error = posix_spawn_file_actions_adddup2(
      &file_actions, launch_stderr_fd, STDERR_FILENO);
  if (setup_error != 0) {
    goto spawn_setup_failed;
  }
  if (launch_stdout_fd > STDERR_FILENO) {
    setup_error =
        posix_spawn_file_actions_addclose(&file_actions, launch_stdout_fd);
    if (setup_error != 0) {
      goto spawn_setup_failed;
    }
  }
  if (launch_stderr_fd > STDERR_FILENO &&
      launch_stderr_fd != launch_stdout_fd) {
    setup_error =
        posix_spawn_file_actions_addclose(&file_actions, launch_stderr_fd);
    if (setup_error != 0) {
      goto spawn_setup_failed;
    }
  }

  setup_error = posix_spawnattr_init(&spawn_attributes);
  if (setup_error != 0) {
    goto spawn_setup_failed;
  }
  spawn_attributes_initialized = true;
  setup_error = posix_spawnattr_setflags(&spawn_attributes,
                                         POSIX_SPAWN_SETPGROUP);
  if (setup_error != 0) {
    goto spawn_setup_failed;
  }
  setup_error = posix_spawnattr_setpgroup(&spawn_attributes, 0);
  if (setup_error != 0) {
    goto spawn_setup_failed;
  }

  argv[0] = (char *)shell;
  argv[1] = (char *)launch_script;
  argv[2] = NULL;
  spawn_error = posix_spawn(&pid, shell, &file_actions, &spawn_attributes,
                            argv, launch_environment);
  posix_spawnattr_destroy(&spawn_attributes);
  spawn_attributes_initialized = false;
  posix_spawn_file_actions_destroy(&file_actions);
  file_actions_initialized = false;
  close(launch_stdout_fd);
  close(launch_stderr_fd);
  free(launch_environment);
  launch_environment = NULL;
  if (spawn_error != 0) {
    append_marker("launcher-spawn-failed errno=%d\n", spawn_error);
    lqprintf("stub: launcher spawn failed shell=%s script=%s errno=%d\n",
             shell, launch_script, spawn_error);
    return false;
  }

  /* The spawn attributes establish the group before the launcher runs. */
  if (setpgid(pid, pid) != 0 && errno != EACCES && errno != ESRCH) {
    lqprintf("stub: setpgid failed pid=%u errno=%d\n", (unsigned)pid, errno);
  }

  lqprintf("stub: launched l2 pid=%u\n", (unsigned)pid);
  lqprintf("stub: entering l2 run window pid=%u\n", (unsigned)pid);
  measure_startup = l2_startup_measurement_enabled();
  unsigned window_ms = run_window_ms();
  unsigned evidence_wait_ms = window_ms < 5000U ? window_ms : 5000U;
  bool boot_ready = false;
  unsigned elapsed_ms = evidence_wait_ms;
  lqprintf("stub: l2 run window ms=%u\n", window_ms);
  if (measure_startup) {
    append_marker("l2-startup-measurement=enabled\n");
    elapsed_ms = 0;
    while (!boot_ready && elapsed_ms < window_ms) {
      if (qemu_exec_start_ns == 0 && l2_qemu_exec_started()) {
        qemu_exec_start_ns = monotonic_time_ns();
        append_marker("l2-qemu-exec-start-monotonic-ns=%llu\n",
                      (unsigned long long)qemu_exec_start_ns);
      }
      if (qemu_exec_start_ns != 0 && l2_buildroot_login_logged()) {
        buildroot_ready_ns = monotonic_time_ns();
        append_marker("l2-buildroot-ready-monotonic-ns=%llu\n",
                      (unsigned long long)buildroot_ready_ns);
        boot_ready = true;
        break;
      }
      usleep(L2_STARTUP_TIMING_POLL_MS * 1000U);
      elapsed_ms += L2_STARTUP_TIMING_POLL_MS;
    }
    log_l2_startup_timing(qemu_exec_start_ns, buildroot_ready_ns);
  } else {
    usleep(evidence_wait_ms * 1000U);
    boot_ready = l2_boot_ready_logged();
    while (!boot_ready && elapsed_ms < window_ms) {
      unsigned sleep_ms = window_ms - elapsed_ms;
      if (sleep_ms > L2_READY_POLL_MS) {
        sleep_ms = L2_READY_POLL_MS;
      }
      usleep(sleep_ms * 1000U);
      elapsed_ms += sleep_ms;
      boot_ready = l2_boot_ready_logged();
    }
  }
  if (boot_ready) {
    append_marker("parent-boot-ready\n");
    /* Reaching the login prompt only means the L2 guest has booted.  Keep
     * the process alive for the configured fuzzing window; terminating here
     * kills the inner fuzzer before its first execution. */
    lqprintf("stub: l2 boot ready; continuing run window\n");
  }
  append_marker("parent-before-wait\n");
  log_process_state(pid);

  int status = 0;
  pid_t wait_ret = waitpid(pid, &status, WNOHANG);
  if (wait_ret == 0) {
    const bool kernel_panic_logged = l2_kernel_panic_logged();
    /* A run-window completion is the hot path. Diagnostics are emitted only
     * after outcome classification, unless runtime capture is explicitly on. */
    if (kernel_panic_logged) {
      lqprintf("stub: l2 kernel panic found before timeout kill\n");
      *outcome = L2_OUTCOME_KERNEL_PANIC;
    } else {
      *outcome = L2_OUTCOME_RUN_WINDOW_COMPLETE;
    }
    signal_l2_process_group(pid, SIGTERM);
    if (!reap_l2_process(pid, &status)) {
      lqprintf("stub: failed to reap l2 process group\n");
      return *outcome == L2_OUTCOME_KERNEL_PANIC;
    }
    log_l2_input_evidence();
    lqprintf("stub: l2 run window ended and was terminated\n");
    return true;
  }
  if (wait_ret < 0) {
    lqprintf("stub: waitpid failed pid=%u errno=%d\n", (unsigned)pid, errno);
    return false;
  }
  append_marker("parent-after-wait\n");
  log_wait_status(pid, status);
  if (WIFEXITED(status)) {
    const int exit_status = WEXITSTATUS(status);
    const bool kernel_panic_logged = l2_kernel_panic_logged();
    lqprintf("stub: l2 exited status=%d\n", exit_status);
    if (exit_status != 0) {
      log_l2_launcher_phase();
    }
    if (kernel_panic_logged) {
      lqprintf("stub: l2 kernel panic found\n");
      *outcome = L2_OUTCOME_KERNEL_PANIC;
    } else if (exit_status != 0) {
      lqprintf("stub: l2 launcher exited without kernel panic evidence\n");
      *outcome = L2_OUTCOME_LAUNCHER_EXIT;
      *outcome_detail = exit_status;
    } else {
      *outcome = L2_OUTCOME_COMPLETE;
    }
    log_l2_input_evidence();
    return true;
  }
  if (WIFSIGNALED(status)) {
    *outcome = L2_OUTCOME_LAUNCHER_SIGNAL;
    *outcome_detail = WTERMSIG(status);
    lqprintf("stub: l2 launcher killed by signal=%d\n", *outcome_detail);
    log_l2_launcher_phase();
    log_l2_input_evidence();
    return true;
  }
  return false;

spawn_setup_failed:
  if (spawn_attributes_initialized) {
    posix_spawnattr_destroy(&spawn_attributes);
  }
  if (file_actions_initialized) {
    posix_spawn_file_actions_destroy(&file_actions);
  }
  if (launch_stdout_fd >= 0) {
    close(launch_stdout_fd);
  }
  if (launch_stderr_fd >= 0 && launch_stderr_fd != launch_stdout_fd) {
    close(launch_stderr_fd);
  }
  free(launch_environment);
  append_marker("launcher-spawn-setup-failed errno=%d\n", setup_error);
  return false;

}

int main(void) {
  lqprintf("libafl_nesting stub ready\n");

  while (1) {
    size_t len = (size_t)libafl_qemu_start_virt(FUZZ_INPUT, INPUT_LEN);
    if (len > INPUT_LEN) {
      len = INPUT_LEN;
    }

    enum l2_outcome outcome = L2_OUTCOME_HARNESS_ERROR;
    int outcome_detail = 0;
    bool launched = write_input_snapshot(FUZZ_INPUT, len) &&
                    launch_l2(&outcome, &outcome_detail);

    if (!launched && outcome == L2_OUTCOME_HARNESS_ERROR) {
      lqprintf("stub: l2 harness operation failed\n");
    }
    log_l2_outcome(outcome, outcome_detail);
    if (outcome == L2_OUTCOME_KERNEL_PANIC ||
        outcome == L2_OUTCOME_LAUNCHER_EXIT ||
        outcome == L2_OUTCOME_LAUNCHER_SIGNAL ||
        outcome == L2_OUTCOME_HARNESS_ERROR ||
        (outcome == L2_OUTCOME_RUN_WINDOW_COMPLETE &&
         runtime_capture_enabled())) {
      dump_l2_diagnostics();
    }

    libafl_qemu_end(outcome == L2_OUTCOME_KERNEL_PANIC
                        ? LIBAFL_QEMU_END_CRASH
                        : LIBAFL_QEMU_END_OK);
  }
}
