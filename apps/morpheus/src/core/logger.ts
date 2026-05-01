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

function currentEventContext() {
  const raw = process.env.MORPHEUS_EVENT_CONTEXT || "";
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function appendJsonl(record) {
  const filePath = currentLogFile();
  if (!filePath) {
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function emitEvent(event, data = {}, options = {}) {
  const context = currentEventContext();
  appendJsonl({
    ts: new Date().toISOString(),
    producer: options.producer || "morpheus",
    level: options.level || "info",
    scope: options.scope || "workflow",
    event,
    workflow_id: options.workflowId || context.workflow_id || null,
    step_id: options.stepId || context.step_id || null,
    tool: options.tool || context.tool || null,
    data: data || {},
  });
}

function consoleLine(scope, message, fields) {
  return `[morpheus:${scope}] ${message}${formatFields(fields)}\n`;
}

function withLogFile(filePath, callback) {
  const previous = process.env.MORPHEUS_EVENT_LOG_FILE;
  process.env.MORPHEUS_EVENT_LOG_FILE = filePath;
  const restore = () => {
    if (previous == null) {
      delete process.env.MORPHEUS_EVENT_LOG_FILE;
    } else {
      process.env.MORPHEUS_EVENT_LOG_FILE = previous;
    }
  };
  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function withEventContext(context, callback) {
  const previous = process.env.MORPHEUS_EVENT_CONTEXT;
  process.env.MORPHEUS_EVENT_CONTEXT = JSON.stringify({
    ...currentEventContext(),
    ...(context || {}),
  });
  const restore = () => {
    if (previous == null) {
      delete process.env.MORPHEUS_EVENT_CONTEXT;
    } else {
      process.env.MORPHEUS_EVENT_CONTEXT = previous;
    }
  };
  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function logDebug(scope, message, fields) {
  if (!isVerboseEnabled()) {
    return;
  }
  const text = consoleLine(scope, message, fields);
  emitEvent("console.stderr", { text }, { level: "debug", scope });
  fs.writeSync(2, text);
}

function logInfo(scope, message, fields) {
  const text = consoleLine(scope, message, fields);
  emitEvent("console.stderr", { text }, { level: "info", scope });
  if (process.env.MORPHEUS_NO_PROGRESS === "1" || process.env.MORPHEUS_NO_PROGRESS === "true") {
    return;
  }
  fs.writeSync(2, text);
}

module.exports = {
  emitEvent,
  isVerboseEnabled,
  logDebug,
  logInfo,
  withEventContext,
  withLogFile,
};
