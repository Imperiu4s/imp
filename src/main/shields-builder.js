'use strict';
// Runs in a utility process, so the main process never stalls on it: merges the
// downloaded filter engines into one (or, if no prebuilt engine fits this
// library version, parses the filter lists themselves) and sends the result
// back serialized.
const { FiltersEngine } = require('@ghostery/adblocker');

process.parentPort.once('message', ({ data }) => {
  try {
    let engine;
    if (data.engines) {
      const parts = data.engines.map((bytes) => FiltersEngine.deserialize(new Uint8Array(bytes)));
      engine = parts.length === 1 ? parts[0] : FiltersEngine.merge(parts, { useBinaryMerge: true });
    } else {
      engine = FiltersEngine.parse(data.lists.join('\n'), { enableCompression: true });
      if (data.resources) engine.updateResources(data.resources, data.resourcesChecksum || String(data.resources.length));
    }
    process.parentPort.postMessage({ bytes: engine.serialize() });
  } catch (err) {
    process.parentPort.postMessage({ error: String((err && err.stack) || err) });
  }
});
