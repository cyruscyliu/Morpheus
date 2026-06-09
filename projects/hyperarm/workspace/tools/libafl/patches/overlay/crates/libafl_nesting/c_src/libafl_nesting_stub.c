#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
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
#define LAUNCH_MARKER_PATH RUNTIME_DIR "/launch-l2.marker"
#define QEMU_TRACE_LOG_PATH RUNTIME_DIR "/morpheus-qemu-trace.log"
#define NQC2_TRACE_PATH RUNTIME_DIR "/morpheus-nqc2.trace"

static uint8_t FUZZ_INPUT[INPUT_LEN];

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

static unsigned run_window_ms(const uint8_t *data) {
  uint16_t lo = data[3];
  uint16_t hi = data[4];
  uint32_t raw = ((uint32_t)hi << 8) | lo;
  return 5000U + (raw % 5000U);
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

static bool launch_l2(const uint8_t *data) {
  char period_ms[32];
  char vintid[32];
  bool have_vintid = injected_vintid(data, vintid, sizeof(vintid));

  injected_period_ms(data, period_ms, sizeof(period_ms));

  pid_t pid = fork();
  if (pid < 0) {
    lqprintf("stub: fork failed\n");
    return false;
  }

  if (pid == 0) {
    setenv("MORPHEUS_QEMU_INPUT_PATH", INPUT_PATH, 1);
    setenv("MORPHEUS_L2_RUNTIME_DIR", RUNTIME_DIR, 1);
    setenv("MORPHEUS_QEMU_INJECT_VIRQ_PERIOD_MS", period_ms, 1);
    if (have_vintid) {
      setenv("MORPHEUS_QEMU_INJECT_VIRQ", vintid, 1);
    } else {
      unsetenv("MORPHEUS_QEMU_INJECT_VIRQ");
    }
    execl("/bin/bash", "/bin/bash", "/root/launch-l2.sh", NULL);
    _exit(127);
  }

  lqprintf("stub: launched l2 pid=%u\n", (unsigned)pid);
  usleep(run_window_ms(data) * 1000U);

  int status = 0;
  pid_t wait_ret = waitpid(pid, &status, WNOHANG);
  if (wait_ret == 0) {
    log_process_state(pid);
    log_file_state(LAUNCH_STDOUT_PATH, "launch-l2.stdout");
    log_file_state(LAUNCH_STDERR_PATH, "launch-l2.stderr");
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
    log_process_state(pid);
    log_file_state(LAUNCH_STDOUT_PATH, "launch-l2.stdout");
    log_file_state(LAUNCH_STDERR_PATH, "launch-l2.stderr");
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
    lqprintf("stub: l2 exited status=%d\n", WEXITSTATUS(status));
    return WEXITSTATUS(status) == 0;
  }
  if (WIFSIGNALED(status)) {
    lqprintf("stub: l2 killed by signal=%d\n", WTERMSIG(status));
  }
  return false;
}

int main(void) {
  lqprintf("libafl_nesting stub ready\n");

  while (1) {
    size_t len = (size_t)libafl_qemu_start_virt(FUZZ_INPUT, INPUT_LEN);
    if (len > INPUT_LEN) {
      len = INPUT_LEN;
    }

    bool ok = write_input_snapshot(FUZZ_INPUT, len) && launch_l2(FUZZ_INPUT);

    libafl_qemu_end(ok ? LIBAFL_QEMU_END_OK : LIBAFL_QEMU_END_CRASH);
  }
}
