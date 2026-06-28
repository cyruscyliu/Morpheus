#!/usr/bin/env bash
set -euo pipefail

result_file="${MORPHEUS_DRIVER_CALLGRAPH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
output_dir="${MORPHEUS_DRIVER_CALLGRAPH_OUTPUT:?}"
llcg_manifest="${MORPHEUS_DRIVER_CALLGRAPH_LLCG_MANIFEST:?}"
title="${MORPHEUS_DRIVER_CALLGRAPH_TITLE:-HyperArm Driver Init / Deinit Base Graph}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [ ! -f "${llcg_manifest}" ] && [[ "${llcg_manifest}" != /* ]]; then
  llcg_manifest="${repo_root}/${llcg_manifest#./}"
fi

if [ ! -f "${llcg_manifest}" ]; then
  echo "missing llcg manifest: ${llcg_manifest}" >&2
  exit 1
fi

mkdir -p "${output_dir}"

manifest_path="${output_dir}/driver-callgraph-manifest.json"
dot_path="${output_dir}/driver-callgraph.dot"
svg_path="${output_dir}/driver-callgraph.svg"
pdf_path="${output_dir}/driver-callgraph.pdf"
log_path="${output_dir}/build.log"

python3 - "${llcg_manifest}" "${title}" "${dot_path}" "${manifest_path}" > "${log_path}" <<'PY'
import json
import sys
from pathlib import Path

llcg_manifest = Path(sys.argv[1]).resolve()
title = sys.argv[2]
dot_path = Path(sys.argv[3]).resolve()
manifest_path = Path(sys.argv[4]).resolve()

payload = json.loads(llcg_manifest.read_text())
details = payload.get("details", {})

kernel_version = str(details.get("kernel_version", "unknown"))
arch = str(details.get("arch", "unknown"))
interface = str(details.get("interface", "unknown"))
run_id = str(details.get("run_id", "unknown"))

graph_label = f"{title}\\nllcg scope={interface} kernel={kernel_version} arch={arch}"

dot = f'''digraph driver_callgraph {{
  graph [
    rankdir=TB,
    splines=ortho,
    nodesep=0.55,
    ranksep=0.8,
    labelloc=t,
    labeljust=l,
    fontsize=18,
    fontname="Helvetica",
    label="{graph_label}"
  ];

  node [
    shape=box,
    style="rounded,filled",
    fontname="Helvetica",
    fontsize=12,
    color="#3b342f",
    penwidth=1.4
  ];

  edge [
    color="#4a443e",
    penwidth=1.5,
    arrowsize=0.8,
    fontname="Helvetica",
    fontsize=11
  ];

  pdev [label="pdev\\nplatform_device", shape=component, fillcolor="#f5e7c5"];
  platform_match [label="platform device/driver\\nmatch()", shape=box, fillcolor="#f1efe9"];
  pdrv [label="virtio_mmio_driver\\nplatform_driver", shape=component, fillcolor="#f5e7c5"];
  virtio_mmio_probe [label="virtio_mmio_driver->probe()", shape=box, fillcolor="#fbeecf"];

  vm_dev [label="vm_dev\\nvirtio_device", shape=component, fillcolor="#d7efe6"];
  virtio_match [label="virtio device/driver\\nmatch()", shape=box, fillcolor="#eef6f3"];
  virtio_driver [label="virtio_net_driver\\nvirtio_driver", shape=component, fillcolor="#d7efe6"];
  virtnet_validate [label="virtio_net_driver->validate()", shape=box, fillcolor="#e3f5ee"];
  virtnet_probe [label="virtio_net_driver->probe()", shape=box, fillcolor="#dff4ec"];
  virtnet_config_changed [label="virtio_net_driver->config_changed()", shape=box, fillcolor="#e8f8f2"];

  subgraph cluster_platform_match {{
    label="";
    color="#cdbf9e";
    style="rounded,dashed";
    penwidth=1.0;
    ranksep=0.35;
    nodesep=0.25;
    pdev;
    platform_match;
    pdrv;
    pdev -> pdrv [style=invis, weight=30];
  }}

  subgraph cluster_virtio_match {{
    label="";
    color="#b7d9cf";
    style="rounded,dashed";
    penwidth=1.0;
    ranksep=0.35;
    nodesep=0.25;
    vm_dev;
    virtio_match;
    virtio_driver;
    vm_dev -> virtio_driver [style=invis, weight=30];
  }}

  pdev -> platform_match [color="#7b6d60", style=dashed, penwidth=1.3, arrowsize=0.7];
  pdrv -> platform_match [color="#7b6d60", style=dashed, penwidth=1.3, arrowsize=0.7];
  platform_match -> virtio_mmio_probe [color="#2f5d50", style=solid, penwidth=1.8, arrowsize=0.85];

  vm_dev -> virtio_match [color="#7b6d60", style=dashed, penwidth=1.3, arrowsize=0.7];
  virtio_driver -> virtio_match [color="#7b6d60", style=dashed, penwidth=1.3, arrowsize=0.7];
  virtio_match -> virtnet_validate [color="#2f5d50", style=solid, penwidth=1.8, arrowsize=0.85];
  virtio_match -> virtnet_probe [color="#2f5d50", style=solid, penwidth=1.8, arrowsize=0.85];
  virtnet_probe -> virtnet_config_changed [color="#2f5d50", style=solid, penwidth=1.8, arrowsize=0.85];

  platform_match -> virtio_match [style=invis, weight=20];
  pdrv -> vm_dev [style=invis, weight=20];
  virtio_mmio_probe -> virtnet_validate [style=invis, weight=20];
  virtnet_validate -> virtnet_probe [style=invis, weight=20];

}}
'''

dot_path.write_text(dot)

driver_manifest = {
    "command": "build",
    "status": "success",
    "summary": "generated driver lifecycle base graph from llcg manifest",
    "details": {
        "title": title,
        "llcg_manifest": str(llcg_manifest),
        "llcg_run_id": run_id,
        "kernel_version": kernel_version,
        "arch": arch,
        "interface": interface,
    },
}
manifest_path.write_text(json.dumps(driver_manifest, indent=2) + "\n")
print(f"generated {dot_path}")
print(f"kernel_version={kernel_version} arch={arch} interface={interface} llcg_run_id={run_id}")
PY

dot -Tsvg "${dot_path}" -o "${svg_path}"
dot -Tpdf "${dot_path}" -o "${pdf_path}"

cat > "${result_file}" <<EOF
{
  "summary": "generated driver lifecycle base graph from llcg manifest",
  "details": {
    "output": "${output_dir}",
    "llcg_manifest": "${llcg_manifest}",
    "dot": "${dot_path}",
    "svg": "${svg_path}",
    "pdf": "${pdf_path}",
    "manifest": "${manifest_path}",
    "log": "${log_path}"
  },
  "artifacts": [
    { "path": "output-dir", "location": "${output_dir}" },
    { "path": "manifest", "location": "${manifest_path}" },
    { "path": "graph-dot", "location": "${dot_path}" },
    { "path": "graph-svg", "location": "${svg_path}" },
    { "path": "graph-pdf", "location": "${pdf_path}" },
    { "path": "build-log", "location": "${log_path}" }
  ]
}
EOF
