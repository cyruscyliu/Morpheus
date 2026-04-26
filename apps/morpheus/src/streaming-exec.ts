// @ts-nocheck
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { writeStdoutLine } = require("./io");

function appendLogChunk(logFile, chunk) {
  if (!logFile || !chunk) {
    return;
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, chunk, "utf8");
}

function emitStreamEvent(command, stream, chunk) {
  writeStdoutLine(JSON.stringify({
    command,
    status: "stream",
    exit_code: 0,
    details: {
      event: "log",
      stream,
      chunk,
    },
  }));
}

async function runStreamingExec(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      appendLogChunk(options.logFile, chunk);
      if (options.jsonMode) {
        emitStreamEvent(options.eventCommand || "run", "stdout", chunk);
      } else if (!options.quietStdout) {
        process.stdout.write(chunk);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      appendLogChunk(options.logFile, chunk);
      if (options.jsonMode) {
        emitStreamEvent(options.eventCommand || "run", "stderr", chunk);
      } else {
        process.stderr.write(chunk);
      }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        status: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

module.exports = {
  runStreamingExec,
};
