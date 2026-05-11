#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_PKVM_AARCH64_SOURCE:?}"
run_dir="${MORPHEUS_PKVM_AARCH64_RUN_DIR:?}"
platform="${MORPHEUS_PKVM_AARCH64_PLATFORM:-virt}"
qemu="${MORPHEUS_PKVM_AARCH64_QEMU:-}"
make_arg_file="${MORPHEUS_PKVM_AARCH64_MAKE_ARG_FILE:-}"
detach="${MORPHEUS_PKVM_AARCH64_DETACH:-false}"
result_file="${MORPHEUS_PKVM_AARCH64_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

mkdir -p "${run_dir}"

if [ ! -f "${source_dir}/Makefile" ]; then
  echo "missing pKVM source tree: ${source_dir}" >&2
  exit 1
fi

make_args=()
if [ -n "${make_arg_file}" ] && [ -s "${make_arg_file}" ]; then
  mapfile -t make_args < "${make_arg_file}"
else
  make_args=(-j4)
fi

manifest_file="${run_dir}/manifest.json"
work_dir="${PWD}"
make_cmd=(
  make
  "PLATFORM=${platform}"
)
if [ -n "${qemu}" ]; then
  make_cmd+=("QEMU=${qemu}")
  export PATH="$(dirname "${qemu}"):${PATH}"
fi
make_cmd+=("${make_args[@]}")
make_cmd+=(run)

if [ "${detach}" = "true" ]; then
  (
    cd "${source_dir}"
    "${make_cmd[@]}"
  ) < /dev/null &
  pid="$!"
  sleep 1
  if ! kill -0 "${pid}" 2>/dev/null; then
    cat > "${result_file}" <<EOF
{"command":"exec","status":"error","exit_code":1,"summary":"local pKVM run failed","error":{"code":"pkvm_aarch64_failed","message":"local pKVM run failed"}}
EOF
    exit 1
  fi
  cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"pkvm-aarch64","command":"exec","status":"running","run_dir":"${run_dir}","pid":${pid},"platform":"${platform}","detached":true}
EOF
  cat > "${result_file}" <<EOF
{"details":{"pid":${pid},"detached":true,"run_dir":"${run_dir}"}}
EOF
  printf 'detached runtime started\n'
  exit 0
fi

exit_code=0
cd "${source_dir}"
"${make_cmd[@]}" || exit_code="$?"
cd "${work_dir}"

if [ "${exit_code}" != "0" ]; then
  exit "${exit_code}"
fi

cat > "${manifest_file}" <<EOF
{"schemaVersion":1,"tool":"pkvm-aarch64","command":"exec","status":"success","run_dir":"${run_dir}","pid":null,"platform":"${platform}","detached":false}
EOF
cat > "${result_file}" <<EOF
{"details":{"pid":null,"detached":false}}
EOF
