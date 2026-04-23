// @ts-nocheck
const fs = require("node:fs");

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

function logDebug(scope, message, fields) {
  if (!isVerboseEnabled()) {
    return;
  }
  fs.writeSync(2, `[morpheus:${scope}] ${message}${formatFields(fields)}\n`);
}

function logInfo(scope, message, fields) {
  if (process.env.MORPHEUS_NO_PROGRESS === "1" || process.env.MORPHEUS_NO_PROGRESS === "true") {
    return;
  }
  if (!(process.argv.includes("--json") || isVerboseEnabled())) {
    return;
  }
  fs.writeSync(2, `[morpheus:${scope}] ${message}${formatFields(fields)}\n`);
}

module.exports = {
  isVerboseEnabled,
  logDebug,
  logInfo,
};
