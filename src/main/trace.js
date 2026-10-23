'use strict';
// Startup timing for development: run with IMP_TRACE=1 to print milestones
// (milliseconds since the process started).
const enabled = !!process.env.IMP_TRACE;
const seen = new Set();

function mark(label, once = true) {
  if (!enabled || (once && seen.has(label))) return;
  seen.add(label);
  console.log(`[trace] ${String(Math.round(performance.now())).padStart(5)} ms  ${label}`);
}

module.exports = { mark };
