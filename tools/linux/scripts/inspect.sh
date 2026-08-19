#!/usr/bin/env bash
set -euo pipefail

output_dir="${MORPHEUS_LINUX_OUTPUT:?}"
result_file="${MORPHEUS_LINUX_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

kernel_image="${output_dir}/arch/arm64/boot/Image"
vmlinux_path="${output_dir}/vmlinux"

node - "${result_file}" "${output_dir}" "${kernel_image}" "${vmlinux_path}" <<'NODE'
const fs = require("fs");
const [resultFile, outputDir, kernelImage, vmlinuxPath] = process.argv.slice(2);
const details = {
  output: outputDir,
  image: fs.existsSync(kernelImage) ? kernelImage : null,
  vmlinux: fs.existsSync(vmlinuxPath) ? vmlinuxPath : null,
};
const artifacts = [];
if (details.image) {
  artifacts.push({ path: "images/Image", location: details.image });
}
if (details.vmlinux) {
  artifacts.push({ path: "build/vmlinux", location: details.vmlinux });
}
fs.writeFileSync(resultFile, `${JSON.stringify({ details, artifacts }, null, 2)}\n`);
NODE
