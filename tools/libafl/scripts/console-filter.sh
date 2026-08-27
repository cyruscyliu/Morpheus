#!/usr/bin/env bash
set -euo pipefail

# Keep host-side qemu_nesting progress visible while optionally suppressing the
# guest console streams.  The caller has already copied the unmodified stream
# to launcher.stdout.log; this filter only controls what reaches the terminal.
show_console="${1:-false}"
case "${show_console}" in
  true|TRUE|True|1|yes|YES|on|ON)
    show_console=true
    ;;
  false|FALSE|False|0|no|NO|off|OFF|"")
    show_console=false
    ;;
  *)
    echo "show-console must be a boolean (true/false)" >&2
    exit 2
    ;;
esac

in_l1_console=false
in_l2_console=false

is_l1_console_line() {
  local line="$1"
  # Linux printk lines can arrive after the guest stub is reached (for
  # example, a late driver message), so classify timestamped lines globally.
  if [[ "${line}" =~ ^[[:space:]]*\[[[:space:]]*[0-9]+(\.[0-9]+)?\] ]]; then
    return 0
  fi
  case "${line}" in
    $'\033'*|NOTICE:*|INFO:*|SMC_*|RMM*|Dynamic\ VA*|Reserve\ mem:*|\
    Static\ *|xlat_*|No\ SMMU*|Invalid\ SMMU*|SMMUv3:*|\
    Realm\ device*|GPT:*|PPS/T:*|PGS/P:*|L0GPTSZ/S:*|PAS\ count:*|\
    GIC*|Maximum\ SPI*|Found\ [0-9]*\ cpus|RAM\ [0-9]*:*|\
    Cpu\ topology:*|Boot\ Manifest*|RMI\ ABI*|RSI\ ABI*|FIRME*|\
    UEFI\ Interactive\ Shell*|EDK\ II*|Mapping\ table*|FS[0-9]:*|\
    BLK[0-9]:*|Shell\>*|Seg\ \ Bus\ Dev\ Func|---)
      return 0
      ;;
  esac
  return 1
}

is_l2_console_line() {
  case "$1" in
    # The Rust stub prints human-readable snapshots with these labels.
    "LQPRINTF: stub: qemu stdout:"*|\
    "LQPRINTF: stub: qemu stderr:"*|\
    "LQPRINTF: stub: l2 console:"*|\
    "LQPRINTF: stub: l2 console pty:"*)
      return 0
      ;;
    # The C stub serializes the same files as runtime records.  These records
    # can be large, so suppress begin/data/end and size lines as one class.
    *)
      if [[ "${1}" == "LQPRINTF: stub-runtime "* ]] &&
         [[ "${1}" == *"name=launch-l2.stdout.log"* ||
            "${1}" == *"name=launch-l2.stderr.log"* ||
            "${1}" == *"name=qemu.stdout.log"* ||
            "${1}" == *"name=qemu.stderr.log"* ||
            "${1}" == *"name=l2-console.log"* ||
            "${1}" == *"name=l2-console.pty"* ]]; then
        return 0
      fi
      case "${1}" in
        "LQPRINTF: stub: launch-l2.stdout.log "*|\
        "LQPRINTF: stub: launch-l2.stderr.log "*|\
        "LQPRINTF: stub: qemu.stdout.log "*|\
        "LQPRINTF: stub: qemu.stderr.log "*|\
        "LQPRINTF: stub: l2-console.log "*|\
        "LQPRINTF: stub: l2-console.pty "*)
          return 0
          ;;
      esac
      ;;
  esac
  return 1
}

is_l2_terminal_line() {
  case "$1" in
    "LQPRINTF: stub-outcome "*|\
    "LQPRINTF: stub: l2 timed out and was terminated"*|\
    "LQPRINTF: stub: l2 exited status="*|\
    "LQPRINTF: stub: l2 launcher killed by signal="*|\
    "LQPRINTF: stub: l2 harness operation failed"*)
      return 0
      ;;
  esac
  return 1
}

while IFS= read -r line || [ -n "${line}" ]; do
  # `read` strips the LF delimiter but leaves a CR from CRLF guest output.
  # Normalize it before classification so a single guest line never becomes
  # an apparent blank line on the host terminal.
  while [[ "${line}" == *$'\r' ]]; do
    line="${line%$'\r'}"
  done
  if [ "${show_console}" = "true" ]; then
    printf '%s\n' "${line}"
    continue
  fi

  # Empty lines are part of the raw artifact, but do not carry useful host
  # progress when the guest streams are hidden.
  if [ -z "${line}" ]; then
    continue
  fi

  # The outer QEMU writes firmware and L1 Linux serial output between these
  # two qemu_nesting lifecycle markers.  Keep the markers themselves because
  # they are useful host-side progress, but hide the guest stream in between.
  if [[ "${line}" == *"[libafl/qemu_nesting] starting outer QEMU"* ]]; then
    in_l1_console=true
    printf '%s\n' "${line}"
    continue
  fi
  if [ "${in_l1_console}" = "true" ]; then
    if [[ "${line}" == *"[libafl/qemu_nesting] outer QEMU reached guest stub"* ]]; then
      in_l1_console=false
      printf '%s\n' "${line}"
    elif [[ "${line}" == \[libafl/* ]]; then
      # Preserve host-side errors/progress even if outer QEMU never reaches
      # the guest stub and therefore never emits the closing marker.
      printf '%s\n' "${line}"
    fi
    continue
  fi
  if is_l1_console_line "${line}"; then
    continue
  fi

  # Most nested QEMU output is captured by the stub and reported through
  # LQPRINTF.  Hide only the console-bearing records, retaining outcome,
  # evidence, and execution-progress records.  If a launcher leaks raw L2
  # serial output directly, it is bounded by the launched/outcome markers.
  if [[ "${line}" == "LQPRINTF: stub: launched l2 pid="* ]]; then
    in_l2_console=true
    printf '%s\n' "${line}"
    continue
  fi
  if [ "${in_l2_console}" = "true" ] && is_l2_terminal_line "${line}"; then
    in_l2_console=false
    printf '%s\n' "${line}"
    continue
  fi
  if [ "${in_l2_console}" = "true" ] && [[ "${line}" != LQPRINTF:* ]]; then
    continue
  fi
  if [ "${in_l2_console}" = "true" ] && [[ "${line}" == "LQPRINTF: stub-outcome "* ]]; then
    in_l2_console=false
    printf '%s\n' "${line}"
    continue
  fi
  if is_l2_console_line "${line}"; then
    continue
  fi

  printf '%s\n' "${line}"
done
