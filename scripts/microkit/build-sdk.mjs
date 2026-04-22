#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const flags = {};
  const booleanFlags = new Set(["json", "help", "force"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return flags;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/microkit/build-sdk.mjs [options]",
    "",
    "Options:",
    "  --config PATH           Morpheus config path, default: morpheus.yaml",
    "  --microkit-dir DIR      Microkit source directory (must contain build_sdk.py)",
    "  --sel4-dir DIR          seL4 source directory",
    "  --sdk-out DIR           SDK output directory (default: tools.microkit-sdk.path or workspace-managed path)",
    "  --force                 Replace existing SDK output directory",
    "  --json                  Emit machine-readable output",
    "  --help                  Print help",
  ].join("\n");
}

function emitJson(value) {
  fs.writeSync(1, `${JSON.stringify(value)}\n`);
}

function countIndent(line) {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

function parseToolSection(raw, toolName) {
  const lines = raw.split(/\r?\n/);
  const toolsIndex = lines.findIndex((line) => /^\s*tools:\s*$/.test(line));
  if (toolsIndex < 0) {
    return null;
  }

  const toolsIndent = countIndent(lines[toolsIndex]);
  let toolIndent = null;
  let toolStart = -1;

  for (let index = toolsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    const indent = countIndent(line);
    if (indent <= toolsIndent) {
      break;
    }
    if (new RegExp(`^\\s*${toolName}:\\s*$`).test(line)) {
      toolIndent = indent;
      toolStart = index;
      break;
    }
  }

  if (toolStart < 0 || toolIndent == null) {
    return null;
  }

  const value = {};
  for (let index = toolStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = countIndent(line);
    if (indent <= toolIndent) {
      break;
    }
    const match = /^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (rawValue === "" || rawValue === "|" || rawValue === ">") {
      continue;
    }
    value[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return value;
}

function parseWorkspaceRoot(raw) {
  const lines = raw.split(/\r?\n/);
  const workspaceIndex = lines.findIndex((line) => /^\s*workspace:\s*$/.test(line));
  if (workspaceIndex < 0) {
    return null;
  }
  const workspaceIndent = countIndent(lines[workspaceIndex]);
  for (let index = workspaceIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = countIndent(line);
    if (indent <= workspaceIndent) {
      break;
    }
    const match = /^\s*root:\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    return match[1].replace(/^["']|["']$/g, "");
  }
  return null;
}

function resolveLocalPath(baseDir, inputPath) {
  if (!inputPath) {
    return null;
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(baseDir, inputPath);
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ensureEmptyDir(targetPath, force) {
  if (fs.existsSync(targetPath)) {
    if (!force) {
      throw new Error(`sdk output already exists: ${targetPath}`);
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
  fs.mkdirSync(targetPath, { recursive: true });
}

function extractPythonFlag(helpText, candidates) {
  const lines = helpText.split(/\r?\n/);
  for (const candidate of candidates) {
    const needle = `--${candidate}`;
    if (lines.some((line) => line.includes(needle))) {
      return `--${candidate}`;
    }
  }
  return null;
}

function buildMicrokitSdk({ microkitDir, sel4Dir, sdkOut, force }) {
  const buildScript = path.join(microkitDir, "build_sdk.py");
  if (!fs.existsSync(buildScript)) {
    throw new Error(`microkit-dir does not contain build_sdk.py: ${buildScript}`);
  }
  if (!sel4Dir || !fs.existsSync(sel4Dir)) {
    throw new Error(`sel4-dir does not exist: ${sel4Dir || ""}`);
  }

  ensureEmptyDir(sdkOut, force);

  const help = runCommand("python3", [buildScript, "--help"], { cwd: microkitDir });
  if (help.status !== 0) {
    throw new Error(help.stderr || help.stdout || "failed to query build_sdk.py --help");
  }

  const sel4Flag = extractPythonFlag(help.stdout, ["sel4-dir", "sel4", "sel4_source", "sel4-source"]);
  const outputFlag = extractPythonFlag(help.stdout, ["sdk-out", "sdk-dir", "sdk", "output", "output-dir", "out"]);
  if (!sel4Flag) {
    throw new Error("build_sdk.py does not advertise a --sel4 flag; update the script candidates list");
  }
  if (!outputFlag) {
    throw new Error("build_sdk.py does not advertise an output flag; update the script candidates list");
  }

  const result = runCommand(
    "python3",
    [buildScript, sel4Flag, sel4Dir, outputFlag, sdkOut],
    { cwd: microkitDir }
  );
  const logFile = path.join(sdkOut, "build.log");
  fs.writeFileSync(logFile, `${result.stdout || ""}${result.stderr || ""}`, "utf8");
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "microkit SDK build failed");
  }

  return { logFile, sel4Flag, outputFlag };
}

function defaultSdkOut({ workspaceRoot, microkitVersion }) {
  const root = workspaceRoot || "./hyperarm-workspace";
  if (microkitVersion) {
    return path.join(root, "tools", "microkit-sdk", "sdk", `microkit-sdk-${microkitVersion}`);
  }
  return path.join(root, "tools", "microkit-sdk", "sdk", "microkit-sdk");
}

function main(argv) {
  const flags = parseArgs(argv);
  if (flags.help) {
    fs.writeSync(1, `${usage()}\n`);
    return 0;
  }

  const configPath = path.resolve(String(flags.config || "morpheus.yaml"));
  if (!fs.existsSync(configPath)) {
    throw new Error(`config does not exist: ${configPath}`);
  }

  const configDir = path.dirname(configPath);
  const rawConfig = fs.readFileSync(configPath, "utf8");
  const workspaceRoot = resolveLocalPath(configDir, parseWorkspaceRoot(rawConfig));
  const microkitConfig = parseToolSection(rawConfig, "microkit-sdk") || {};
  const sel4Config = parseToolSection(rawConfig, "sel4") || {};

  const microkitDir = resolveLocalPath(configDir, flags["microkit-dir"] || microkitConfig["microkit-dir"] || microkitConfig.source);
  const sel4Dir = resolveLocalPath(configDir, flags["sel4-dir"] || sel4Config.path || sel4Config.source);
  const microkitVersion = flags["microkit-version"] || microkitConfig["microkit-version"] || microkitConfig.microkitVersion || null;
  const sdkOut = resolveLocalPath(
    configDir,
    flags["sdk-out"] || microkitConfig.path || defaultSdkOut({ workspaceRoot, microkitVersion })
  );

  if (!microkitDir) {
    throw new Error("missing --microkit-dir (or tools.microkit-sdk.microkit-dir/source in morpheus.yaml)");
  }
  if (!sel4Dir) {
    throw new Error("missing --sel4-dir (or tools.sel4.path in morpheus.yaml)");
  }

  const startedAt = new Date().toISOString();
  const output = buildMicrokitSdk({
    microkitDir,
    sel4Dir,
    sdkOut,
    force: Boolean(flags.force),
  });

  const payload = {
    command: "microkit build-sdk",
    status: "success",
    exit_code: 0,
    summary: "built Microkit SDK from source",
    details: {
      config: path.relative(process.cwd(), configPath),
      started_at: startedAt,
      microkit_dir: path.relative(process.cwd(), microkitDir),
      sel4_dir: path.relative(process.cwd(), sel4Dir),
      sdk_out: path.relative(process.cwd(), sdkOut),
      build_log: path.relative(process.cwd(), output.logFile),
      detected_flags: {
        sel4: output.sel4Flag,
        output: output.outputFlag,
      },
    },
  };

  if (flags.json) {
    emitJson(payload);
  } else {
    fs.writeSync(1, `${payload.summary}\n`);
    fs.writeSync(1, `sdk: ${payload.details.sdk_out}\n`);
    fs.writeSync(1, `log: ${payload.details.build_log}\n`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (process.argv.includes("--json")) {
    emitJson({
      command: "microkit build-sdk",
      status: "error",
      exit_code: 1,
      summary: message,
      error: { code: "microkit_build_sdk_error", message },
    });
  } else {
    fs.writeSync(2, `${message}\n`);
  }
  process.exitCode = 1;
}
