// @ts-nocheck

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
  process.stderr.write(`[morpheus:${scope}] ${message}${formatFields(fields)}\n`);
}

module.exports = {
  isVerboseEnabled,
  logDebug
};
