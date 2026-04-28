// @ts-nocheck

const fs = require("node:fs");

function writeStdout(value) {
  fs.writeSync(1, value);
}

function writeStdoutLine(value) {
  fs.writeSync(1, `${value}\n`);
}

function writeStderrLine(value) {
  fs.writeSync(2, `${value}\n`);
}

module.exports = {
  writeStdout,
  writeStdoutLine,
  writeStderrLine
};

