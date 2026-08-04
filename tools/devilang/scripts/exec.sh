#!/usr/bin/env bash
set -euo pipefail

tool_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${tool_root}/../_shared/scripts/parallelism.sh"
repo_root="$(cd "${tool_root}/../.." && pwd)"
workspace_root="${MORPHEUS_DEVILANG_WORKSPACE:-${MORPHEUS_SCRIPT_WORKSPACE:-}}"
runtime_helper_default="$(cd "${tool_root}/../llbase/scripts" && pwd)/runtime.sh"
result_file="${MORPHEUS_DEVILANG_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_DEVILANG_OUTPUT:?}"
build_dir="${MORPHEUS_DEVILANG_BUILD_DIR:-${tool_root}/build}"
clang="${MORPHEUS_DEVILANG_CLANG:-15}"
llbase_contract="${MORPHEUS_DEVILANG_LLBASE_CONTRACT:-}"
llbic_json="${MORPHEUS_DEVILANG_LLBIC_JSON:-}"
llcg_build_dir="${MORPHEUS_DEVILANG_LLCG_BUILD_DIR:-}"
devilang_cpus="${MORPHEUS_DEVILANG_CPUS:-${MORPHEUS_DEVILANG_JOBS:-$(morpheus_default_jobs)}}"
module_file="${MORPHEUS_DEVILANG_MODULE_FILE:-}"
module_inline="${MORPHEUS_DEVILANG_MODULE:-}"
module_relative_file="${MORPHEUS_DEVILANG_MODULE_RELATIVE_FILE:-}"
module_relative_inline="${MORPHEUS_DEVILANG_MODULE_RELATIVE:-}"
booting_entry_file="${MORPHEUS_DEVILANG_BOOTING_ENTRY_FILE:-}"
booting_entry_inline="${MORPHEUS_DEVILANG_BOOTING_ENTRY:-}"
runtime_entry_file="${MORPHEUS_DEVILANG_RUNTIME_ENTRY_FILE:-}"
runtime_entry_inline="${MORPHEUS_DEVILANG_RUNTIME_ENTRY:-}"
booting_entry_list="${MORPHEUS_DEVILANG_BOOTING_ENTRY_LIST:-}"
runtime_entry_list="${MORPHEUS_DEVILANG_RUNTIME_ENTRY_LIST:-}"
filter_path="${MORPHEUS_DEVILANG_FILTER:-}"
kallgraph_text="${MORPHEUS_DEVILANG_KALLGRAPH_TEXT:-}"
llcg_dot="${MORPHEUS_DEVILANG_LLCG_DOT:-}"
points_to_json="${MORPHEUS_DEVILANG_POINTS_TO_JSON:-${MORPHEUS_DEVILANG_KALLGRAPH_POINTS_TO_JSON:-}}"
booting_machine_name="${MORPHEUS_DEVILANG_BOOTING_MACHINE_NAME:-booting}"
runtime_machine_name="${MORPHEUS_DEVILANG_RUNTIME_MACHINE_NAME:-runtime}"
log_file="${output_dir}/devilang.log"
manifest_file="${output_dir}/devilang-manifest.json"

mkdir -p "${output_dir}"
: > "${log_file}"
[ -n "${llbase_contract}" ] || {
  echo "devilang exec requires --llbase-contract so the managed run uses the shared llbase container runtime" >&2
  exit 1
}
[[ "${devilang_cpus}" =~ ^([0-9]+([.][0-9]+)?|[.][0-9]+)$ ]] || {
  echo "devilang exec requires numeric MORPHEUS_DEVILANG_CPUS/MORPHEUS_DEVILANG_JOBS when set" >&2
  exit 1
}

runtime_helper="$(
  node - "${llbase_contract}" "${runtime_helper_default}" <<'EOF'
const fs = require("fs");
const [contractPath, fallbackPath] = process.argv.slice(2);
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
process.stdout.write(String(contract.helperScripts?.runtime || fallbackPath));
EOF
)"
source "${runtime_helper}"
kernel_version=""
if [ -n "${llbic_json}" ] && [ -f "${llbic_json}" ]; then
  kernel_version="$(
    node - "${llbic_json}" <<'EOF'
const fs = require("fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(payload.kernel_version || ""));
EOF
  )"
fi
llbase_prepare_runtime "${llbase_contract}" "${kernel_version}" "${clang}"

collect_list() {
  local file_path="$1"
  local inline_text="$2"
  local -n output_ref=$3
  output_ref=()
  if [ -n "${inline_text}" ]; then
    while IFS= read -r item; do
      [ -n "${item}" ] || continue
      output_ref+=("${item}")
    done <<< "${inline_text}"
    return
  fi
  if [ -n "${file_path}" ] && [ -s "${file_path}" ]; then
    while IFS= read -r item; do
      [ -n "${item}" ] || continue
      output_ref+=("${item}")
    done < "${file_path}"
  fi
}

resolve_relative_modules() {
  local llbic_json_path="$1"
  shift
  node - "${llbic_json_path}" "$@" <<'EOF'
const fs = require("fs");
const path = require("path");

const [llbicJsonPath, ...items] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(llbicJsonPath, "utf8"));
const root = String(payload.bitcode_root || "");
if (!root) {
  process.exit(2);
}
for (const item of items) {
  process.stdout.write(path.resolve(root, item) + "\n");
}
EOF
}

resolve_input_path() {
  local input_path="${1:-}"
  local normalized=""

  [ -n "${input_path}" ] || return 0
  if [[ "${input_path}" == /* ]]; then
    printf '%s\n' "${input_path}"
    return 0
  fi

  normalized="${input_path#./}"
  if [ -n "${workspace_root}" ] && [ -e "${workspace_root}/${normalized}" ]; then
    printf '%s\n' "${workspace_root}/${normalized}"
    return 0
  fi
  if [ -e "${repo_root}/${normalized}" ]; then
    printf '%s\n' "${repo_root}/${normalized}"
    return 0
  fi
  if [ -n "${workspace_root}" ]; then
    printf '%s\n' "${workspace_root}/${normalized}"
    return 0
  fi
  printf '%s\n' "${repo_root}/${normalized}"
}

filter_path="$(resolve_input_path "${filter_path}")"
booting_entry_list="$(resolve_input_path "${booting_entry_list}")"
runtime_entry_list="$(resolve_input_path "${runtime_entry_list}")"
kallgraph_text="$(resolve_input_path "${kallgraph_text}")"
llcg_dot="$(resolve_input_path "${llcg_dot}")"
points_to_json="$(resolve_input_path "${points_to_json}")"

collect_list "${module_file}" "${module_inline}" module_paths
collect_list "${module_relative_file}" "${module_relative_inline}" module_relative_paths
if [ -n "${booting_entry_list}" ]; then
  collect_list "${booting_entry_list}" "" booting_entries
else
  collect_list "${booting_entry_file}" "${booting_entry_inline}" booting_entries
fi
if [ -n "${runtime_entry_list}" ]; then
  collect_list "${runtime_entry_list}" "" runtime_entries
else
  collect_list "${runtime_entry_file}" "${runtime_entry_inline}" runtime_entries
fi

resolve_modules_for_entries() {
  local llbic_json_path="$1"
  shift
  local entries=("$@")
  node - "${llbic_json_path}" "${entries[@]}" <<'EOF'
const fs = require("fs");
const { spawnSync } = require("child_process");

  const [llbicJsonPath, ...entries] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(llbicJsonPath, "utf8"));
const listFile =
  payload.bitcode_list_file ||
  (payload.paths && payload.paths.bitcode_list_file && payload.paths.bitcode_list_file.resolved_path) ||
  "";
if (!listFile) {
  console.error("llbic json does not expose bitcode_list_file");
  process.exit(2);
}
const modules = fs.readFileSync(listFile, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
  const tools = ["llvm-nm-15", "llvm-nm"];
  let nmTool = null;
  for (const tool of tools) {
    const probe = spawnSync(tool, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      nmTool = tool;
      break;
    }
  }
  if (!nmTool) {
    console.error("missing llvm-nm-15/llvm-nm");
    process.exit(4);
  }
  const matched = [];
  for (const modulePath of modules) {
    const nm = spawnSync(nmTool, ["--defined-only", modulePath], { encoding: "utf8" });
  if (nm.status !== 0) {
    continue;
  }
  const stdout = String(nm.stdout || "");
  let hit = false;
  for (const entry of entries) {
    const pattern = new RegExp(String.raw`(?:^|\s)[TtWw]\s+${entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m");
    if (pattern.test(stdout)) {
      hit = true;
      break;
    }
  }
  if (hit) {
    matched.push(modulePath);
  }
}
for (const modulePath of matched) {
  process.stdout.write(modulePath + "\n");
}
if (matched.length === 0) {
  process.exit(3);
}
EOF
}

resolve_modules_from_filter() {
  local llbic_json_path="$1"
  local filter_list_path="$2"
  node - "${llbic_json_path}" "${filter_list_path}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [llbicJsonPath, filterListPath] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(llbicJsonPath, "utf8"));
const bitcodeRoot =
  payload.bitcode_root ||
  (payload.paths && payload.paths.bitcode_root && payload.paths.bitcode_root.resolved_path) ||
  "";
const sourceRoot = String(payload.source_dir || "");
const portableSourceRoot =
  (payload.paths && payload.paths.source_dir && payload.paths.source_dir.portable) ||
  (payload.paths && payload.paths.source_dir && payload.paths.source_dir.runtime_path) ||
  "";
if (!bitcodeRoot || !sourceRoot) {
  console.error("llbic json does not expose bitcode_root/source_dir");
  process.exit(2);
}
const wanted = new Set(
  fs.readFileSync(filterListPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
);
const matched = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(next);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".cmd")) {
      continue;
    }
    const text = fs.readFileSync(next, "utf8");
    const match = text.match(/^source_(.+?) := (.+)$/m);
    if (!match) {
      continue;
    }
    const objectRel = match[1].trim();
    const sourceAbs = match[2].trim();
    let sourceRel = "";
    if (sourceAbs === sourceRoot || sourceAbs.startsWith(`${sourceRoot}${path.sep}`)) {
      sourceRel = path.relative(sourceRoot, sourceAbs);
    } else if (portableSourceRoot && (sourceAbs === portableSourceRoot || sourceAbs.startsWith(`${portableSourceRoot}${path.sep}`))) {
      sourceRel = path.relative(portableSourceRoot, sourceAbs);
    } else {
      const sourceRootBase = path.basename(sourceRoot);
      const marker = `${sourceRootBase}${path.sep}`;
      const index = sourceAbs.indexOf(marker);
      if (index >= 0) {
        sourceRel = sourceAbs.slice(index + marker.length);
      } else {
        sourceRel = path.relative(sourceRoot, sourceAbs);
      }
    }
    sourceRel = sourceRel.split(path.sep).join("/");
    if (!wanted.has(sourceRel)) {
      continue;
    }
    matched.push(path.resolve(bitcodeRoot, objectRel));
  }
}

walk(bitcodeRoot);
matched.sort();
for (const modulePath of matched) {
  process.stdout.write(modulePath + "\n");
}
if (matched.length === 0) {
  process.exit(3);
}
EOF
}

resolve_all_modules() {
  local llbic_json_path="$1"
  node - "${llbic_json_path}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [llbicJsonPath] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(llbicJsonPath, "utf8"));
const listFile =
  payload.bitcode_list_file ||
  (payload.paths && payload.paths.bitcode_list_file && payload.paths.bitcode_list_file.resolved_path) ||
  "";
const bitcodeRoot =
  payload.bitcode_root ||
  (payload.paths && payload.paths.bitcode_root && payload.paths.bitcode_root.resolved_path) ||
  "";
if (!listFile) {
  console.error("llbic json does not expose bitcode_list_file");
  process.exit(2);
}
for (const line of fs.readFileSync(listFile, "utf8").split(/\r?\n/)) {
  const item = line.trim();
  if (!item) {
    continue;
  }
  process.stdout.write((path.isAbsolute(item) || !bitcodeRoot ? item : path.resolve(bitcodeRoot, item)) + "\n");
}
EOF
}

if [ "${#module_relative_paths[@]}" -gt 0 ]; then
  [ -n "${llbic_json}" ] || {
    echo "devilang exec with --module-relative requires --llbic-json" >&2
    exit 1
  }
  while IFS= read -r resolved; do
    [ -n "${resolved}" ] || continue
    module_paths+=("${resolved}")
  done < <(resolve_relative_modules "${llbic_json}" "${module_relative_paths[@]}")
fi

if [ "${#module_paths[@]}" -eq 0 ] && [ -n "${filter_path}" ]; then
  [ -n "${llbic_json}" ] || {
    echo "devilang exec with --filter requires --llbic-json" >&2
    exit 1
  }
  while IFS= read -r resolved; do
    [ -n "${resolved}" ] || continue
    module_paths+=("${resolved}")
  done < <(resolve_modules_from_filter "${llbic_json}" "${filter_path}")
fi

if [ "${#module_paths[@]}" -eq 0 ] && [ -n "${llbic_json}" ]; then
  while IFS= read -r resolved; do
    [ -n "${resolved}" ] || continue
    module_paths+=("${resolved}")
  done < <(resolve_all_modules "${llbic_json}")
fi

[ "${#module_paths[@]}" -gt 0 ] || {
  echo "devilang exec requires explicit --module/--module-relative or an --llbic-json input for module resolution" >&2
  exit 1
}
[ "${#booting_entries[@]}" -gt 0 ] || [ "${#runtime_entries[@]}" -gt 0 ] || {
  echo "devilang exec requires at least one --booting-entry or --runtime-entry" >&2
  exit 1
}

for module_path in "${module_paths[@]}"; do
  [ -f "${module_path}" ] || {
    echo "missing LLVM module: ${module_path}" >&2
    exit 1
  }
done

cli_bin="${build_dir}/bin/devilang"
svf_extapi_bc=""
[ -n "${llcg_build_dir}" ] && svf_extapi_bc="${llcg_build_dir}/svf/lib/extapi.bc"
[ -x "${cli_bin}" ] || {
  echo "missing devilang CLI: ${cli_bin}. Run devilang build first." >&2
  exit 1
}

cmd=("${cli_bin}")
for module_path in "${module_paths[@]}"; do
  cmd+=("--module" "${module_path}")
done
if [ "${#booting_entries[@]}" -gt 0 ]; then
  cmd+=("--booting-output" "${output_dir}/booting.state")
  cmd+=("--booting-machine-name" "${booting_machine_name}")
  for entry in "${booting_entries[@]}"; do
    cmd+=("--booting-entry" "${entry}")
  done
fi
if [ "${#runtime_entries[@]}" -gt 0 ]; then
  cmd+=("--runtime-output" "${output_dir}/runtime.state")
  cmd+=("--runtime-machine-name" "${runtime_machine_name}")
  for entry in "${runtime_entries[@]}"; do
    cmd+=("--runtime-entry" "${entry}")
  done
fi
if [ -n "${kallgraph_text}" ]; then
  [ -f "${kallgraph_text}" ] || {
    echo "missing kallgraph text: ${kallgraph_text}" >&2
    exit 1
  }
  kallgraph_copy="${output_dir}/$(basename "${kallgraph_text}")"
  cp "${kallgraph_text}" "${kallgraph_copy}"
  cmd+=("--kallgraph-text" "${kallgraph_copy}")
fi
if [ -n "${llcg_dot}" ]; then
  [ -f "${llcg_dot}" ] || {
    echo "missing llcg dot: ${llcg_dot}" >&2
    exit 1
  }
  llcg_dot_copy="${output_dir}/$(basename "${llcg_dot}")"
  if [ "${llcg_dot}" != "${llcg_dot_copy}" ]; then
    cp "${llcg_dot}" "${llcg_dot_copy}"
  fi
  cmd+=("--llcg-dot" "${llcg_dot_copy}")
fi
if [ -n "${points_to_json}" ]; then
  [ -f "${points_to_json}" ] || {
    echo "missing points-to json: ${points_to_json}" >&2
    exit 1
  }
  points_to_copy="${output_dir}/$(basename "${points_to_json}")"
  if [ "${points_to_json}" != "${points_to_copy}" ]; then
    cp "${points_to_json}" "${points_to_copy}"
  fi
  cmd+=("--points-to-json" "${points_to_copy}")
fi
cmd+=("--generated-points-to-json" "${output_dir}/devilang-svf-points.json")
if [ -n "${svf_extapi_bc}" ] && [ -f "${svf_extapi_bc}" ]; then
  cp -f "${svf_extapi_bc}" "${build_dir}/bin/extapi.bc"
  cmd+=("--svf-extapi" "${svf_extapi_bc}")
fi

set +e
LLBASE_CONTAINER_CPUS="${devilang_cpus}" \
llbase_exec_in_container \
  "${tool_root}" \
  "${build_dir}" \
  "${output_dir}" \
  "${llbase_contract}" \
  "${llbic_json}" \
  "${module_paths[@]}" \
  -- \
  "${cmd[@]}" \
  > >(tee "${log_file}") \
  2> >(tee -a "${log_file}" >&2)
devilang_rc=$?
set -e

node - "${result_file}" "${manifest_file}" "${log_file}" "${output_dir}" "${devilang_rc}" "${booting_machine_name}" "${runtime_machine_name}" "${devilang_cpus}" <<'EOF'
const fs = require("fs");
const path = require("path");

const [
  resultFileArg,
  manifestFileArg,
  logFileArg,
  outputDirArg,
  rawExitCodeArg,
  bootingMachineName,
  runtimeMachineName,
  cpuLimitArg,
] = process.argv.slice(2);
const resultFile = path.resolve(resultFileArg);
const manifestFile = path.resolve(manifestFileArg);
const logFile = path.resolve(logFileArg);
const outputDir = path.resolve(outputDirArg);
const rawExitCode = Number(rawExitCodeArg || "1");
const artifacts = [
  { path: "output-dir", location: outputDir },
  { path: "manifest", location: manifestFile },
  { path: "log-file", location: logFile },
];
const bootingState = path.join(outputDir, "booting.state");
const runtimeState = path.join(outputDir, "runtime.state");
const pointsToJson = path.join(outputDir, "devilang-svf-points.json");
if (fs.existsSync(bootingState)) {
  artifacts.push({ path: "booting-state", location: bootingState });
}
if (fs.existsSync(runtimeState)) {
  artifacts.push({ path: "runtime-state", location: runtimeState });
}
if (fs.existsSync(pointsToJson)) {
  artifacts.push({ path: "points-to-json", location: pointsToJson });
}
const payload = {
  summary: rawExitCode === 0 ? "generated devilang state artifacts" : "devilang state generation failed",
  details: {
    output: outputDir,
    booting_machine_name: String(bootingMachineName || ""),
    runtime_machine_name: String(runtimeMachineName || ""),
    cpu_limit: String(cpuLimitArg || ""),
    llbase_contract: process.env.MORPHEUS_DEVILANG_LLBASE_CONTRACT || "",
    llcg_build_dir: process.env.MORPHEUS_DEVILANG_LLCG_BUILD_DIR || "",
  },
  artifacts,
};
fs.writeFileSync(manifestFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
fs.writeFileSync(resultFile, JSON.stringify(payload, null, 2) + "\n", "utf8");
process.exit(rawExitCode);
EOF
