#!/usr/bin/env python3
"""kernel_scan.py - Common library functions for Linux kernel call graph analysis.

All functions are pure utilities; no preset configuration lives here.
Callers supply pre_presets / presets dicts explicitly.
"""
import json
import re
import shutil
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

START_RE = re.compile(
    r"^\s*(?:static\s+)?(?:const\s+)?struct\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{\s*$"
)
ENTRY_RE = re.compile(r"^\s*\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^,]+),")
END_RE = re.compile(r"^\s*\};\s*$")
IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MACROISH_RE = re.compile(r"^(?:[A-Z][A-Z0-9_]*|__.*|[A-Z].*)$")
SYSCALL_DEFINE_RE = re.compile(
    r"\b(?:COMPAT_)?SYSCALL_DEFINE\d+\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

_KCONFIG_TEMP_ROOTS: List[Path] = []

# ---------------------------------------------------------------------------
# Kconfig helpers
# ---------------------------------------------------------------------------


def load_kconfig(kernel_root: Path, arch: str = "arm64"):
    """Load and return a kconfiglib.Kconfig instance for the given kernel root.

    Sets up required environment variables (ARCH, SRCARCH, srctree) if not
    already set. Parsed only once and reused by callers.
    """
    try:
        import kconfiglib  # type: ignore
    except ImportError:
        raise ImportError("kconfiglib is required: pip install kconfiglib")

    import os

    srcarch = arch
    cc_default = "clang-15"
    cc_name = Path(cc_default).name

    def _pick_default_ld() -> str:
        if "clang" not in cc_name:
            return "ld"

        suffix = cc_name.removeprefix("clang")
        candidates = []
        if suffix:
            candidates.append(f"ld.lld{suffix}")
        candidates.extend(["ld.lld", "ld"])

        for candidate in candidates:
            if shutil.which(candidate):
                return candidate
        return "ld.lld"

    if "clang" in cc_name:
        os.environ.setdefault("CLANG_FLAGS", "-fintegrated-as")
    os.environ.setdefault("CC", cc_default)
    os.environ.setdefault("LD", _pick_default_ld())
    os.environ["ARCH"] = arch
    os.environ["SRCARCH"] = srcarch
    os.environ["srctree"] = str(kernel_root)

    try:
        return kconfiglib.Kconfig(str(kernel_root / "Kconfig"), warn=False)
    except kconfiglib.KconfigError as exc:
        if "transitional" not in str(exc):
            raise

    temp_root = Path(tempfile.mkdtemp(prefix="llcg-kconfig-"))
    sanitized_root = temp_root / kernel_root.name
    sanitized_root.mkdir()

    for child in kernel_root.iterdir():
        (sanitized_root / child.name).symlink_to(child, target_is_directory=child.is_dir())

    def _materialize_dir(rel_dir: Path) -> None:
        current = sanitized_root
        for part in rel_dir.parts:
            next_path = current / part
            if next_path.is_symlink():
                target = next_path.resolve()
                next_path.unlink()
                next_path.mkdir()
                for child in target.iterdir():
                    (next_path / child.name).symlink_to(child, target_is_directory=child.is_dir())
            elif not next_path.exists():
                next_path.mkdir()
            current = next_path

    unsupported_lines = {"transitional", "modules"}

    for path in kernel_root.rglob("Kconfig*"):
        if not path.is_file():
            continue
        text = path.read_text(errors="ignore")
        lines = text.splitlines(keepends=True)
        if not any(line.strip() in unsupported_lines for line in lines):
            continue
        rel_path = path.relative_to(kernel_root)
        sanitized_path = sanitized_root / rel_path
        _materialize_dir(rel_path.parent)
        sanitized_path.unlink()
        sanitized = "".join(
            line for line in lines if line.strip() not in unsupported_lines
        )
        sanitized_path.write_text(sanitized)

    os.environ["srctree"] = str(sanitized_root)
    kconf = kconfiglib.Kconfig(str(sanitized_root / "Kconfig"), warn=False)
    _KCONFIG_TEMP_ROOTS.append(temp_root)
    return kconf


def kconfig_required_configs(
    kernel_root: Path, config_name: str, kconf=None, arch: str = "arm64"
) -> Dict[str, str]:
    """Return all CONFIG_ symbols transitively required by config_name.

    Follows two edges recursively:
      - 'depends on'  — configs that must already be enabled
      - 'select'      — configs that get force-enabled

    Returns a dict mapping CONFIG_<name> -> folder relative to kernel_root
    where the symbol is defined (empty string if unknown).

    Pass a pre-loaded kconf (from load_kconfig) to avoid re-parsing Kconfig files.
    """
    try:
        import kconfiglib  # type: ignore
    except ImportError:
        raise ImportError("kconfiglib is required: pip install kconfiglib")

    if kconf is None:
        kconf = load_kconfig(kernel_root, arch=arch)

    sym_name = config_name.removeprefix("CONFIG_")
    if sym_name not in kconf.syms:
        raise KeyError(f"Symbol {config_name!r} not found in Kconfig")

    def _sym_folder(sym) -> str:
        if not sym.nodes:
            return ""
        kconfig_file = Path(sym.nodes[0].filename)
        try:
            return kconfig_file.relative_to(kernel_root).parent.as_posix()
        except ValueError:
            return kconfig_file.parent.as_posix()

    def _expr_syms(expr):
        if expr is None:
            return
        if isinstance(expr, kconfiglib.Symbol):
            if not expr.is_constant:
                yield expr
        elif isinstance(expr, tuple):
            for item in expr[1:]:
                yield from _expr_syms(item)

    result: Dict[str, str] = {}

    def _walk(sym) -> None:
        if f"CONFIG_{sym.name}" in result or sym.is_constant:
            return
        result[f"CONFIG_{sym.name}"] = _sym_folder(sym)
        for dep in _expr_syms(sym.direct_dep):
            _walk(dep)
        for selected_sym, *_ in sym.selects:
            _walk(selected_sym)

    _walk(kconf.syms[sym_name])
    result.pop(config_name if config_name.startswith("CONFIG_") else f"CONFIG_{sym_name}", None)
    return result


def expand_preset(
    kernel_root: Path,
    key_config: str,
    kconf=None,
    required: Optional[Dict[str, str]] = None,
    arch: str = "arm64",
    pre_presets: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, List[str]]:
    """Derive scan_dirs and enable_configs for a preset from its key_config.

    enable_configs = key_config + transitive deps/selects + pre_presets configs
    scan_dirs      = folders where those configs are defined + pre_presets scan_dirs

    Pass a pre-loaded kconf (from load_kconfig) to avoid re-parsing Kconfig files.
    Pass required (a config->folder dict) to skip kconfig_required_configs entirely.
    Pass pre_presets to prepend fixed scan_dirs/enable_configs to the expansion.
    """
    if pre_presets is None:
        pre_presets = {"scan_dirs": [], "enable_configs": [], "excluded_dirs": [], "excluded_files": []}

    if required is None:
        required = kconfig_required_configs(kernel_root, key_config, kconf=kconf, arch=arch)

    seen_configs: Set[str] = set()
    enable_configs: List[str] = []
    for cfg in [key_config] + list(required.keys()) + pre_presets["enable_configs"]:
        if cfg not in seen_configs:
            seen_configs.add(cfg)
            enable_configs.append(cfg)

    excluded_dirs: List[str] = list(pre_presets.get("excluded_dirs", []))

    def _is_excluded(folder: str) -> bool:
        for exc in excluded_dirs:
            if folder == exc or folder.startswith(exc + "/"):
                return True
        return False

    seen_dirs: Set[str] = set()
    scan_dirs: List[str] = []
    for folder in list(required.values()) + pre_presets["scan_dirs"]:
        if folder and folder != "." and folder not in seen_dirs and not _is_excluded(folder):
            seen_dirs.add(folder)
            scan_dirs.append(folder)

    excluded_files: List[str] = list(pre_presets.get("excluded_files", []))

    return {"scan_dirs": scan_dirs, "enable_configs": enable_configs, "excluded_dirs": excluded_dirs, "excluded_files": excluded_files}


# ---------------------------------------------------------------------------
# Kernel version
# ---------------------------------------------------------------------------


def parse_kernel_version(kernel_root: Path) -> str:
    mk = kernel_root / "Makefile"
    text = mk.read_text(errors="ignore")
    vals: Dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"^(VERSION|PATCHLEVEL|SUBLEVEL|EXTRAVERSION)\s*=\s*(.*)$", line)
        if m:
            vals[m.group(1)] = m.group(2).strip()
    v = vals.get("VERSION", "0")
    p = vals.get("PATCHLEVEL", "0")
    s = vals.get("SUBLEVEL", "0")
    e = vals.get("EXTRAVERSION", "")
    return f"{v}.{p}.{s}{e}"


# ---------------------------------------------------------------------------
# Groups file helpers
# ---------------------------------------------------------------------------


def parse_blocks_labels(text: str) -> Set[str]:
    labels: Set[str] = set()
    blocks: List[List[str]] = []
    cur: List[str] = []
    for ln in text.splitlines():
        if ln.strip() == "":
            if cur:
                blocks.append(cur)
                cur = []
            continue
        cur.append(ln)
    if cur:
        blocks.append(cur)

    for block in blocks:
        label = None
        for ln in block:
            s = ln.strip()
            if not s or s.startswith("#"):
                continue
            if s.startswith("["):
                parts = s.split(None, 1)
                if len(parts) == 2:
                    label = parts[1].strip()
            else:
                label = s
            break
        if label:
            labels.add(label)
    return labels


def is_fn_like(value: str) -> bool:
    value = value.strip()
    if not IDENT_RE.match(value):
        return False
    if value in {"NULL", "true", "false", "THIS_MODULE"}:
        return False
    if MACROISH_RE.match(value) and value.lower() != value:
        return False
    return True


def is_ops_struct(struct_type: str, struct_name: str, fn_count: int = 0) -> bool:
    """Decide whether a struct initializer is an operations / callback table.

    Uses two complementary strategies:
      1. Name heuristics — struct type or instance name contains well-known
         ops-like suffixes/keywords (cheap, catches the obvious cases).
      2. Content heuristic — when at least *min_fn_fields* of the assigned
         fields look like function pointers, treat the struct as an ops table
         regardless of its name.  This catches things like ``struct proto``,
         ``struct irq_chip``, ``struct scsi_host_template``, etc.
    """
    MIN_FN_FIELDS = 3

    # --- name-based (fast path) ---
    st = struct_type.lower()
    sn = struct_name.lower()
    if (
        "operations" in st
        or st.endswith("_ops")
        or sn.endswith("_ops")
        or "operations" in sn
        or sn.endswith("_fops")
        or sn.endswith("_aops")
        or "driver" in st
        or sn.endswith("_driver")
    ):
        return True

    # --- content-based (catches everything else) ---
    return fn_count >= MIN_FN_FIELDS


def extract_groups_from_file(
    path: Path, kernel_root: Path
) -> List[Tuple[str, List[str], str, int, str]]:
    text = path.read_text(errors="ignore")
    lines = text.splitlines()
    out: List[Tuple[str, List[str], str, int, str]] = []

    i = 0
    while i < len(lines):
        m = START_RE.match(lines[i])
        if not m:
            i += 1
            continue

        struct_type, struct_name = m.group(1), m.group(2)
        j = i + 1
        fns: List[str] = []
        while j < len(lines):
            if END_RE.match(lines[j]):
                break
            em = ENTRY_RE.match(lines[j])
            if em:
                val = em.group(2).strip()
                if is_fn_like(val):
                    fns.append(val)
            j += 1

        if is_ops_struct(struct_type, struct_name, fn_count=len(fns)):
            uniq: List[str] = []
            seen: Set[str] = set()
            for fn in fns:
                if fn not in seen:
                    seen.add(fn)
                    uniq.append(fn)
            if uniq:
                rel = path.relative_to(kernel_root).as_posix()
                out.append((struct_name, uniq, rel, i + 1, struct_type))

        i = j + 1

    return out


# ---------------------------------------------------------------------------
# Makefile parsing
# ---------------------------------------------------------------------------


def _iter_logical_lines(text: str) -> List[str]:
    lines: List[str] = []
    buf = ""
    for raw in text.splitlines():
        line = raw
        if "#" in line:
            line = line.split("#", 1)[0]
        line = line.rstrip()
        if not line and not buf:
            continue
        if line.endswith("\\"):
            buf += line[:-1] + " "
            continue
        logical = (buf + line).strip()
        if logical:
            lines.append(logical)
        buf = ""
    if buf.strip():
        lines.append(buf.strip())
    return lines


def _strip_wrapping_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _resolve_make_expr(value: str, enabled_configs: Set[str]) -> str:
    value = _strip_wrapping_quotes(value.strip())
    if not value:
        return ""
    m = re.fullmatch(r"\$\(CONFIG_([A-Za-z0-9_]+)\)", value)
    if m:
        return "y" if f"CONFIG_{m.group(1)}" in enabled_configs else ""
    if "$(" in value or "$" in value:
        return ""
    return value


def _eval_make_cond(line: str, enabled_configs: Set[str]) -> bool:
    m = re.match(r"^(ifeq|ifneq)\s*\((.*)\)\s*$", line)
    if m:
        op = m.group(1)
        expr = m.group(2)
        left, right = expr.split(",", 1) if "," in expr else (expr, "")
        left_v = _resolve_make_expr(left, enabled_configs)
        right_v = _resolve_make_expr(right, enabled_configs)
        return left_v == right_v if op == "ifeq" else left_v != right_v

    m = re.match(r"^(ifdef|ifndef)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", line)
    if m:
        op, var = m.group(1), m.group(2)
        defined = var.startswith("CONFIG_") and var in enabled_configs
        return defined if op == "ifdef" else not defined

    return False  # unsupported conditional form → skip the block


def _selector_enabled(selector: str, enabled_configs: Set[str]) -> bool:
    selector = selector.strip()
    if selector in ("y", "objs"):
        return True
    m = re.fullmatch(r"\$\(CONFIG_([A-Za-z0-9_]+)\)", selector)
    if m:
        return f"CONFIG_{m.group(1)}" in enabled_configs
    return False


def _tokenize_rhs(rhs: str) -> List[str]:
    return [tok for tok in rhs.split() if tok]


def _expand_make_vars(s: str, make_vars: Dict[str, str]) -> str:
    """Expand $(VAR) references using a local variable table (single pass)."""
    if "$(" not in s:
        return s
    for var, val in make_vars.items():
        s = s.replace(f"$({var})", val)
    return s


def _inline_includes(
    text: str, makefile_dir: Path, kernel_root: Path, _seen: Optional[Set[Path]] = None
) -> str:
    """Recursively inline `include` directives, resolving $(srctree)."""
    if _seen is None:
        _seen = set()
    out: List[str] = []
    for line in text.splitlines():
        m = re.match(r"^\s*include\s+(.+?)\s*$", line)
        if not m:
            out.append(line)
            continue
        raw = m.group(1).replace("$(srctree)", str(kernel_root))
        inc = Path(raw) if Path(raw).is_absolute() else (makefile_dir / raw).resolve()
        if inc in _seen or not inc.exists():
            continue
        _seen.add(inc)
        inlined = _inline_includes(inc.read_text(errors="ignore"), inc.parent, kernel_root, _seen)
        out.extend(inlined.splitlines())
    return "\n".join(out)


def _parse_makefile_objy(
    makefile: Path,
    enabled_configs: Set[str],
    kernel_root: Optional[Path] = None,
) -> Tuple[List[str], Dict[str, List[str]]]:
    text = makefile.read_text(errors="ignore")
    if kernel_root is not None:
        text = _inline_includes(text, makefile.parent, kernel_root)

    objy: List[str] = []
    target_lists: Dict[str, List[str]] = {}
    make_vars: Dict[str, str] = {}  # simple string variables for $(VAR) expansion

    assign_re = re.compile(r"^([A-Za-z0-9_./+\-$()]+)\s*([:+?]?=)\s*(.*)$")
    target_re = re.compile(r"^([A-Za-z0-9_./+-]+)-(.+)$")
    cond_stack: List[Tuple[bool, bool]] = []
    active = True

    for line in _iter_logical_lines(text):
        if line.startswith("if"):
            cond = _eval_make_cond(line, enabled_configs)
            cond_stack.append((cond, cond))
            active = all(x[0] for x in cond_stack)
            continue
        if line == "else":
            if cond_stack:
                cur, seen_true = cond_stack[-1]
                new_cur = not seen_true
                cond_stack[-1] = (new_cur, seen_true or new_cur)
                active = all(x[0] for x in cond_stack)
            continue
        if line == "endif":
            if cond_stack:
                cond_stack.pop()
                active = all(x[0] for x in cond_stack)
            continue
        if not active:
            continue

        m = assign_re.match(line)
        if not m:
            continue
        lhs, op, rhs = m.group(1), m.group(2), m.group(3)
        rhs_expanded = _expand_make_vars(rhs, make_vars)
        tokens = _tokenize_rhs(rhs_expanded)

        if lhs == "obj-y":
            if op == ":=":
                objy = tokens[:]
            else:
                objy.extend(tokens)
            continue

        if lhs.startswith("obj-"):
            selector = lhs[4:]
            if _selector_enabled(selector, enabled_configs):
                if op == ":=":
                    objy = tokens[:]
                else:
                    objy.extend(tokens)
            continue

        tm = target_re.match(lhs)
        if tm:
            target_stem, selector = tm.group(1), tm.group(2)
            if _selector_enabled(selector, enabled_configs):
                key = f"{target_stem}-y"
                if op == ":=":
                    target_lists[key] = tokens[:]
                else:
                    target_lists.setdefault(key, []).extend(tokens)
            continue

        # Simple variable assignment — track for $(VAR) expansion in subsequent lines.
        val = rhs_expanded.strip()
        if op == "?=" and lhs in make_vars:
            pass  # conditional assignment: don't override an existing value
        elif op == "+=":
            make_vars[lhs] = (make_vars.get(lhs, "") + " " + val).strip()
        else:  # =, :=, ?= (not yet set)
            make_vars[lhs] = val

    return objy, target_lists


def _resolve_obj_to_c(
    obj_token: str,
    base_dir: Path,
    target_lists: Dict[str, List[str]],
    out_files: Set[Path],
    seen_objs: Set[str],
) -> None:
    if obj_token in seen_objs:
        return
    seen_objs.add(obj_token)

    # Path-prefixed token (e.g. ../../../virt/kvm/kvm_main.o from Makefile.kvm).
    # Resolve relative to base_dir to get the real source file location.
    if "/" in obj_token:
        obj_path = (base_dir / obj_token[:-2]).resolve()
        cfile = obj_path.with_suffix(".c")
        if cfile.exists():
            out_files.add(cfile)
        key = f"{obj_path.name}-y"
        for dep in target_lists.get(key, []):
            if dep.endswith(".o"):
                _resolve_obj_to_c(dep, obj_path.parent, target_lists, out_files, seen_objs)
        return

    stem = obj_token[:-2]
    cfile = base_dir / f"{stem}.c"
    if cfile.exists():
        out_files.add(cfile.resolve())

    key = f"{stem}-y"
    for dep in target_lists.get(key, []):
        if dep.endswith(".o"):
            _resolve_obj_to_c(dep, base_dir, target_lists, out_files, seen_objs)


def _collect_from_makefile(
    makefile: Path,
    kernel_root: Path,
    out_files: Set[Path],
    seen_makefiles: Set[Path],
    enabled_configs: Set[str],
    excluded_dirs: Optional[List[str]] = None,
) -> None:
    makefile = makefile.resolve()
    if makefile in seen_makefiles or not makefile.exists():
        return
    seen_makefiles.add(makefile)

    objy, target_lists = _parse_makefile_objy(makefile, enabled_configs, kernel_root=kernel_root)
    base_dir = makefile.parent

    for tok in objy:
        if "$(" in tok or "$" in tok:
            continue
        if tok.endswith("/"):
            sub_dir = base_dir / tok
            if excluded_dirs:
                try:
                    rel = sub_dir.resolve().relative_to(kernel_root.resolve()).as_posix()
                    if any(rel == exc or rel.startswith(exc + "/") for exc in excluded_dirs):
                        continue
                except ValueError:
                    pass
            _collect_from_makefile(
                sub_dir / "Makefile",
                kernel_root,
                out_files,
                seen_makefiles,
                enabled_configs,
                excluded_dirs,
            )
            continue
        if tok.endswith(".o"):
            _resolve_obj_to_c(tok, base_dir, target_lists, out_files, set())


def find_c_files(
    kernel_root: Path, scan_dirs: List[str], enabled_configs: Set[str],
    excluded_dirs: Optional[List[str]] = None,
    excluded_files: Optional[List[str]] = None,
) -> List[Path]:
    files: Set[Path] = set()
    seen_makefiles: Set[Path] = set()

    for rel in scan_dirs:
        d = kernel_root / rel
        if not d.exists() or not d.is_dir():
            continue
        _collect_from_makefile(d / "Makefile", kernel_root, files, seen_makefiles, enabled_configs, excluded_dirs)

    if excluded_files:
        resolved_root = kernel_root.resolve()
        exc_set = set(excluded_files)
        files = {f for f in files
                 if f.resolve().relative_to(resolved_root).as_posix() not in exc_set}

    return sorted(files)


def c_to_bc_relpath(c_path: Path, kernel_root: Path) -> str:
    rel = c_path.relative_to(kernel_root).as_posix()
    if rel.endswith(".c"):
        return rel[:-2] + ".bc"
    return rel + ".bc"


# ---------------------------------------------------------------------------
# Syscall extraction
# ---------------------------------------------------------------------------


def extract_syscall_names_from_file(path: Path) -> List[str]:
    text = path.read_text(errors="ignore")
    names: List[str] = []
    seen: Set[str] = set()
    for m in SYSCALL_DEFINE_RE.finditer(text):
        name = m.group(1)
        if name not in seen:
            seen.add(name)
            names.append(name)
    return names


def syscall_entry_variants(name: str) -> List[str]:
    return [f"__do_sys_{name}", f"__se_sys_{name}"]


def collect_syscall_entries_from_files(files: List[Path]) -> Tuple[List[str], List[str]]:
    syscall_names: List[str] = []
    seen_syscall_names: Set[str] = set()
    for path in files:
        for name in extract_syscall_names_from_file(path):
            if name in seen_syscall_names:
                continue
            seen_syscall_names.add(name)
            syscall_names.append(name)

    entry_funcs: List[str] = []
    seen_entry_funcs: Set[str] = set()
    for name in syscall_names:
        for fn in syscall_entry_variants(name):
            if fn not in seen_entry_funcs:
                seen_entry_funcs.add(fn)
                entry_funcs.append(fn)
    return syscall_names, entry_funcs


# ---------------------------------------------------------------------------
# High-level scan helpers
# ---------------------------------------------------------------------------


def collect_interface_scan(
    kernel_root: Path,
    interface: str,
    presets: Dict[str, Dict],
    expanded_presets: Optional[Dict[str, Dict[str, List[str]]]] = None,
    kconf=None,
    arch: str = "arm64",
    pre_presets: Optional[Dict[str, List[str]]] = None,
) -> Dict[str, object]:
    """Collect file/syscall information for a single interface preset.

    Args:
        presets: The full PRESETS dict (to look up key_config on cache miss).
        expanded_presets: Pre-computed {interface: {scan_dirs, enable_configs}}.
                          Avoids re-running kconfig expansion when provided.
        pre_presets: Fallback pre_presets when expanding on cache miss.
    """
    if expanded_presets and interface in expanded_presets:
        expanded = expanded_presets[interface]
    else:
        pp = pre_presets or {"scan_dirs": [], "enable_configs": [], "excluded_dirs": [], "excluded_files": []}
        expanded = expand_preset(
            kernel_root, presets[interface]["key_config"], kconf=kconf, arch=arch, pre_presets=pp
        )
    scan_dirs = expanded["scan_dirs"]
    enabled_configs = set(expanded["enable_configs"])
    excluded_dirs = expanded.get("excluded_dirs", [])
    excluded_files = expanded.get("excluded_files", [])
    files = find_c_files(kernel_root, scan_dirs, enabled_configs, excluded_dirs, excluded_files)
    c_files = [p.relative_to(kernel_root).as_posix() for p in files]
    syscall_names, syscall_entry_functions = collect_syscall_entries_from_files(files)
    return {
        "scan_dirs": scan_dirs[:],
        "enabled_configs": sorted(enabled_configs),
        "scanned_c_files": len(files),
        "c_files": c_files,
        "syscalls": syscall_names,
        "syscall_entry_functions": syscall_entry_functions,
    }


def write_interfaces_manifest(
    out_dir: Path,
    kernel_version: str,
    kernel_root: Path,
    presets: Dict[str, Dict],
    selected_interfaces: List[str],
    expanded_presets: Optional[Dict[str, Dict[str, List[str]]]] = None,
    kconf=None,
    arch: str = "arm64",
) -> None:
    """Write per-interface JSON manifest files to out_dir."""
    arch_tag = re.sub(r"[^A-Za-z0-9_.-]+", "_", arch)
    for iface in selected_interfaces:
        iface_data = collect_interface_scan(
            kernel_root,
            iface,
            presets,
            expanded_presets=expanded_presets,
            kconf=kconf,
            arch=arch,
        )
        iface_path = out_dir / f"{iface}-subsystem-{kernel_version}-{arch_tag}.json"
        iface_payload = {
            "interface": iface,
            **iface_data,
        }
        iface_path.write_text(json.dumps(iface_payload, indent=2) + "\n")
