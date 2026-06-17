#!/usr/bin/env bash

morpheus_json_field() {
  local file="$1"
  local field="$2"
  node -e '
const fs = require("fs");
const [file, field] = process.argv.slice(1);
try {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const value = data[field];
  process.stdout.write(value == null ? "" : String(value));
} catch {
  process.stdout.write("");
}
' "${file}" "${field}"
}

morpheus_hash_files_from_stdin() {
  local files=()
  local file=""

  while IFS= read -r file; do
    [ -n "${file}" ] || continue
    files+=("${file}")
  done

  {
    local path=""
    for path in "${files[@]}"; do
      printf '%s\n' "${path}"
      if [ -f "${path}" ]; then
        cat "${path}"
      elif [ -L "${path}" ]; then
        printf 'symlink:%s\n' "$(readlink "${path}")"
      fi
    done
  } | sha256sum | awk '{print $1}'
}

morpheus_hash_tree() {
  local root="$1"
  if [ ! -d "${root}" ]; then
    printf '%s' ""
    return 0
  fi

  find "${root}" \( -type f -o -type l \) | sort | morpheus_hash_files_from_stdin
}

morpheus_state_matches() {
  local state_file="$1"
  local field="$2"
  local value="$3"

  [ -f "${state_file}" ] || return 1
  [ "$(morpheus_json_field "${state_file}" "${field}")" = "${value}" ]
}

morpheus_patch_state_matches() {
  local state_file="$1"
  local fingerprint="$2"
  morpheus_state_matches "${state_file}" "fingerprint" "${fingerprint}"
}

morpheus_write_state_json() {
  local state_file="$1"
  shift
  node -e '
const fs = require("fs");
const args = process.argv.slice(1);
const file = args.shift();
const data = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1] ?? "";
  data[key] = value;
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
' "${state_file}" "$@"
}

morpheus_write_patch_state() {
  local state_file="$1"
  local patch_dir="$2"
  local fingerprint="$3"

  morpheus_write_state_json \
    "${state_file}" \
    "appliedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "dir" "${patch_dir}" \
    "fingerprint" "${fingerprint}"
}
