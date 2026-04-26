// @ts-nocheck
const fs = require("node:fs");
const path = require("node:path");

function isVerboseEnabled() {
  return (
    process.argv.includes("--verbose") ||
    process.env.MORPHEUS_DEBUG === "1" ||
    process.env.MORPHEUS_DEBUG === "true"
  );
}

function formatFields(fields) {
  if (!fields || Object.keys(fields).length === 0) {
    return "";
  }
  return ` ${JSON.stringify(fields)}`;
}

function currentLogFile() {
  return process.env.MORPHEUS_EVENT_LOG_FILE || null;
}

function appendJsonl(level, scope, message, fields) {
  const filePath = currentLogFile();
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    fields: fields || {},
  })}\n`, "utf8");
}

function withLogFile(filePath, callback) {
  const previous = process.env.MORPHEUS_EVENT_LOG_FILE;
  process.env.MORPHEUS_EVENT_LOG_FILE = filePath;
  try {
    return callback();
  } finally {
    if (previous == null) {
      delete process.env.MORPHEUS_EVENT_LOG_FILE;
    } else {
      process.env.MORPHEUS_EVENT_LOG_FILE = previous;
    }
  }
}

function logDebug(scope, message, fields) {
  appendJsonl("debug", scope, message, fields);
  if (!isVerboseEnabled()) {
    return;
  }
  fs.writeSync(2, `[morpheus:${scope}] ${message}${formatFields(fields)}\n`);
}

function logInfo(scope, message, fields) {
  appendJsonl("info", scope, message, fields);
  if (process.env.MORPHEUS_NO_PROGRESS === "1" || process.env.MORPHEUS_NO_PROGRESS === "true") {
    return;
  }
  fs.writeSync(2, `[morpheus:${scope}] ${message}${formatFields(fields)}\n`);
}

module.exports = {
  isVerboseEnabled,
  logDebug,
  logInfo,
  withLogFile,
};
