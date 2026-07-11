#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:-}}"
state_c="${MORPHEUS_DEVILANG_STATE_C:-}"
state_h="${MORPHEUS_DEVILANG_STATE_H:-}"
trace_log="${MORPHEUS_DEVILANG_TRACE_LOG:-}"
output="${MORPHEUS_DEVILANG_OUTPUT:-}"
symbol_prefix="${MORPHEUS_DEVILANG_SYMBOL_PREFIX:-devilang}"
events_limit="${MORPHEUS_DEVILANG_EVENTS_LIMIT:-}"
base_filter="${MORPHEUS_DEVILANG_BASE_FILTER:-}"
cc_bin="${MORPHEUS_DEVILANG_CC:-cc}"
input_inline="${MORPHEUS_DEVILANG_INPUT:-}"
state_inputs=()

if [ -n "${input_inline}" ]; then
  while IFS= read -r item; do
    [ -n "${item}" ] || continue
    state_inputs+=("${item}")
  done <<< "${input_inline}"
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --input)
      state_inputs+=("$2")
      shift 2
      ;;
    --state-c)
      state_c="$2"
      shift 2
      ;;
    --state-h)
      state_h="$2"
      shift 2
      ;;
    --trace-log)
      trace_log="$2"
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    --symbol-prefix)
      symbol_prefix="$2"
      shift 2
      ;;
    --events-limit)
      events_limit="$2"
      shift 2
      ;;
    --base-filter)
      base_filter="$2"
      shift 2
      ;;
    --cc)
      cc_bin="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

[ -n "${trace_log}" ] || {
  echo "replay-trace requires --trace-log" >&2
  exit 1
}
[ -n "${output}" ] || {
  echo "replay-trace requires --output" >&2
  exit 1
}

mkdir -p "$(dirname "${output}")"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

if [ "${#state_inputs[@]}" -gt 0 ]; then
  state_c="${tmpdir}/${symbol_prefix}.c"
  state_h="${tmpdir}/${symbol_prefix}.h"
  cmd=(
    python3
    "${tool_root}/scripts/compile_state.py"
    --output-c "${state_c}"
    --output-h "${state_h}"
    --symbol-prefix "${symbol_prefix}"
  )
  for input_path in "${state_inputs[@]}"; do
    cmd+=(--input "${input_path}")
  done
  "${cmd[@]}"
fi

[ -n "${state_c}" ] || {
  echo "replay-trace requires either --state-c/--state-h or one or more --input" >&2
  exit 1
}
[ -n "${state_h}" ] || {
  echo "replay-trace requires either --state-c/--state-h or one or more --input" >&2
  exit 1
}

filtered_trace="${tmpdir}/trace.log"
python3 - "${trace_log}" "${filtered_trace}" "${base_filter}" "${events_limit}" <<'EOF'
import pathlib
import sys

src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])
base_filter = sys.argv[3]
limit_text = sys.argv[4]
limit = int(limit_text) if limit_text else None

count = 0
with src.open("r", encoding="utf-8") as infile, dst.open("w", encoding="utf-8") as out:
    for line in infile:
        if base_filter and f"base {base_filter}" not in line:
            continue
        if "virtio_mmio_read " not in line and "virtio_mmio_write " not in line \
           and "virtio_mmio_write_offset " not in line:
            continue
        out.write(line)
        count += 1
        if limit is not None and count >= limit:
            break
EOF

harness="${tmpdir}/replay_main.c"
python3 - "${harness}" "$(basename "${state_h}")" "${symbol_prefix}" <<'EOF'
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
header = sys.argv[2]
prefix = sys.argv[3]

out.write_text(
    f"""#include "{header}"
#include <stdio.h>
#include <string.h>

static struct {prefix}_machine machine;

int main(int argc, char **argv) {{
    FILE *trace_file;
    char line[4096];
    size_t line_no = 0;
    size_t event_count = 0;

    if (argc != 2) {{
        fprintf(stderr, "usage: %s TRACE_LOG\\n", argv[0]);
        return 1;
    }}

    trace_file = fopen(argv[1], "r");
    if (!trace_file) {{
        perror("fopen");
        return 1;
    }}

    {prefix}_init(&machine);
    while (fgets(line, sizeof(line), trace_file) != NULL) {{
        int rc;
        struct devilang_active_state candidates[256];
        struct devilang_active_state matched[256];
        size_t candidate_count;
        size_t matched_count;

        ++line_no;
        rc = {prefix}_feed_trace_line(&machine, line);
        if (rc < 0) {{
            continue;
        }}

        ++event_count;
        matched_count = {prefix}_collect_matched(&machine, matched, 256);
        candidate_count = {prefix}_collect_active(&machine, candidates, 256);
        printf("event %zu line %zu matched %zu candidates %zu\\n",
               event_count, line_no, matched_count, candidate_count);
        printf("trace %s", line);
        if (line[0] != '\\0' && line[strlen(line) - 1] != '\\n') {{
            printf("\\n");
        }}
        for (size_t i = 0; i < matched_count; ++i) {{
            printf("  matched %zu %s %s %s %u\\n",
                   i,
                   matched[i].phase,
                   matched[i].trace,
                   matched[i].block,
                   matched[i].score);
        }}
        for (size_t i = 0; i < candidate_count; ++i) {{
            printf("  active %zu %s %s %s %u\\n",
                   i,
                   candidates[i].phase,
                   candidates[i].trace,
                   candidates[i].block,
                   candidates[i].score);
        }}
        if (candidate_count == 0) {{
            printf("  <none>\\n");
        }}
        if (rc > 0) {{
            printf("halt unmatched_event\\n");
            fclose(trace_file);
            return 2;
        }}
    }}

    fclose(trace_file);
    return 0;
}}
""",
    encoding="utf-8",
)
EOF

binary="${tmpdir}/replay"
"${cc_bin}" -std=c11 -Wall -Wextra \
  -I "$(dirname "${state_h}")" \
  "${state_c}" \
  "${harness}" \
  -o "${binary}"

replay_rc=0
set +e
"${binary}" "${filtered_trace}" > "${output}"
replay_rc=$?
set -e

if [ "${replay_rc}" -ne 0 ] && [ "${replay_rc}" -ne 2 ]; then
  echo "replay failed with exit code ${replay_rc}" >&2
  exit "${replay_rc}"
fi

if [ -n "${result_file}" ]; then
  node - "${result_file}" "${output}" "${state_c}" "${state_h}" "${trace_log}" "${symbol_prefix}" "${base_filter}" "${events_limit}" "${replay_rc}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [
  resultFileArg,
  outputArg,
  stateCArg,
  stateHArg,
  traceLogArg,
  symbolPrefixArg,
  baseFilterArg,
  eventsLimitArg,
  replayRcArg,
] = process.argv.slice(2);

const replayRc = Number(replayRcArg || "0");
const haltedUnmatchedEvent = replayRc === 2;

const payload = {
  summary: haltedUnmatchedEvent
    ? "replayed devilang state machine against trace and halted on unmatched event"
    : "replayed devilang state machine against trace",
  details: {
    output: path.resolve(outputArg),
    state_c: path.resolve(stateCArg),
    state_h: path.resolve(stateHArg),
    trace_log: path.resolve(traceLogArg),
    symbol_prefix: String(symbolPrefixArg || "devilang"),
    base_filter: baseFilterArg ? String(baseFilterArg) : null,
    events_limit: eventsLimitArg ? Number(eventsLimitArg) : null,
    replay_exit_code: replayRc,
    halted_unmatched_event: haltedUnmatchedEvent,
  },
  artifacts: [
    { path: "output", location: path.resolve(outputArg) },
  ],
};
fs.writeFileSync(path.resolve(resultFileArg), JSON.stringify(payload, null, 2) + "\n");
EOF
fi
