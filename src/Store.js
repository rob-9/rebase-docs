/* Per-user, compressed, chunked, double-buffered snapshots. Call under user lock. */
var RebaseStore = (function () {
  'use strict';
  function create(properties, codec) {
    function prefix(id) {
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid document ID.');
      return 'dr:' + id + ':';
    }
    function head(id) {
      var raw = properties.getProperty(prefix(id) + 'head');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!['a', 'b'].includes(parsed.slot) || !Number.isInteger(parsed.count) || parsed.count < 1 || parsed.count > 100) throw new Error('Invalid saved sync state.');
      return parsed;
    }
    function load(id) {
      var current = head(id);
      if (!current) return null;
      var encoded = '';
      for (var i = 0; i < current.count; i++) {
        var chunk = properties.getProperty(prefix(id) + current.slot + ':' + i);
        if (chunk === null) throw new Error('A saved sync snapshot is incomplete. Sync was stopped.');
        encoded += chunk;
      }
      var state = JSON.parse(codec.decode(encoded));
      if (state.schema !== 1 || state.childId !== id || typeof state.base !== 'string') throw new Error('Unrecognized saved sync state.');
      return state;
    }
    function cleanSlot(id, slot) {
      var slotPrefix = prefix(id) + slot + ':';
      Object.keys(properties.getProperties()).forEach(function (key) {
        if (key.startsWith(slotPrefix)) properties.deleteProperty(key);
      });
    }
    function save(id, state) {
      var current = head(id), slot = current && current.slot === 'a' ? 'b' : 'a';
      cleanSlot(id, slot);
      var encoded = codec.encode(JSON.stringify(state)), chunks = {};
      for (var offset = 0; offset < encoded.length; offset += 6000) chunks[prefix(id) + slot + ':' + offset / 6000] = encoded.slice(offset, offset + 6000);
      var existing = properties.getProperties();
      var bytes = Object.keys(existing).reduce(function (n, key) { return n + codec.bytes(key) + codec.bytes(existing[key]); }, 0);
      bytes += Object.keys(chunks).reduce(function (n, key) { return n + codec.bytes(key) + codec.bytes(chunks[key]); }, 0);
      if (bytes > 450000) throw new Error('Snapshot storage is full. Disconnect an unused copy, or shorten the documents, then retry.');
      properties.setProperties(chunks, false);
      // Only this small pointer publishes the newly written snapshot.
      properties.setProperty(prefix(id) + 'head', JSON.stringify({ slot: slot, count: Object.keys(chunks).length }));
      // A cleanup failure must not make a successful commit look unsuccessful.
      if (current) { try { cleanSlot(id, current.slot); } catch (_) {} }
    }
    function ids() {
      return Object.keys(properties.getProperties()).filter(function (key) { return /^dr:[A-Za-z0-9_-]+:head$/.test(key); })
        .map(function (key) { return key.slice(3, -5); });
    }
    function remove(id) {
      properties.deleteProperty(prefix(id) + 'head');
      cleanSlot(id, 'a'); cleanSlot(id, 'b');
    }
    return { load: load, save: save, remove: remove, ids: ids };
  }
  return { create: create };
})();
if (typeof module !== 'undefined') module.exports = RebaseStore;
