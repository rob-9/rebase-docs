/* Pure merge engine, shared by Apps Script and the local tests/demo. */
var RebaseMerge = (function () {
  'use strict';
  var MAX_CELLS = 2000000;

  function tokens(text) {
    return text.match(/[\p{L}\p{N}\p{M}_]+|[^\S\n]+|\n|[^\p{L}\p{N}\p{M}_\s]/gu) || [];
  }

  // Edits are in base-token coordinates. Large diffs conservatively become one
  // edit, bounding memory and preferring a conflict over an unsafe guessed merge.
  function diff(base, changed) {
    var prefix = 0;
    while (prefix < base.length && prefix < changed.length && base[prefix] === changed[prefix]) prefix++;
    var aEnd = base.length, bEnd = changed.length;
    while (aEnd > prefix && bEnd > prefix && base[aEnd - 1] === changed[bEnd - 1]) { aEnd--; bEnd--; }
    var n = aEnd - prefix, m = bEnd - prefix;
    if (!n && !m) return [];
    if (!n || !m || (n + 1) * (m + 1) > MAX_CELLS) {
      return [{ start: prefix, end: aEnd, text: changed.slice(prefix, bEnd).join('') }];
    }
    var width = m + 1, table = new Uint32Array((n + 1) * width);
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        table[i * width + j] = base[prefix + i] === changed[prefix + j]
          ? 1 + table[(i + 1) * width + j + 1]
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    var edits = [], active = null;
    i = 0; j = 0;
    function flush() { if (active) edits.push(active); active = null; }
    while (i < n || j < m) {
      if (i < n && j < m && base[prefix + i] === changed[prefix + j]) {
        flush(); i++; j++;
      } else {
        if (!active) active = { start: prefix + i, end: prefix + i, text: '' };
        if (j < m && (i === n || table[i * width + j + 1] > table[(i + 1) * width + j])) {
          active.text += changed[prefix + j++];
        } else { i++; active.end = prefix + i; }
      }
    }
    flush();
    return edits;
  }

  function overlaps(a, b) {
    if (a.start === a.end && b.start === b.end) return a.start === b.start;
    // Insertions at a replacement's boundaries have an unambiguous order:
    // before the replacement at its start, or after it at its end.
    if (a.start === a.end) return a.start > b.start && a.start < b.end;
    if (b.start === b.end) return b.start > a.start && b.start < a.end;
    return a.start < b.end && b.start < a.end;
  }

  function applyRegion(base, start, end, edits) {
    var result = '', cursor = start;
    edits.forEach(function (edit) {
      result += base.slice(cursor, edit.start).join('') + edit.text;
      cursor = edit.end;
    });
    return result + base.slice(cursor, end).join('');
  }

  function plan(baseText, localText, parentText) {
    var base = tokens(baseText);
    var edits = diff(base, tokens(localText)).map(function (e) { return Object.assign({ side: 'local' }, e); })
      .concat(diff(base, tokens(parentText)).map(function (e) { return Object.assign({ side: 'parent' }, e); }))
      .sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var groups = [];
    edits.forEach(function (edit) {
      var last = groups[groups.length - 1];
      if (last && last.edits.some(function (other) { return overlaps(edit, other); })) {
        last.end = Math.max(last.end, edit.end); last.edits.push(edit);
      } else groups.push({ start: edit.start, end: edit.end, edits: [edit] });
    });
    var parts = [], conflicts = [], cursor = 0;
    groups.forEach(function (group) {
      parts.push({ text: base.slice(cursor, group.start).join('') });
      var local = group.edits.filter(function (e) { return e.side === 'local'; });
      var parent = group.edits.filter(function (e) { return e.side === 'parent'; });
      var localResult = applyRegion(base, group.start, group.end, local);
      var parentResult = applyRegion(base, group.start, group.end, parent);
      if (!parent.length || localResult === parentResult) parts.push({ text: localResult });
      else if (!local.length) parts.push({ text: parentResult });
      else {
        var conflict = {
          id: 'c' + conflicts.length,
          base: base.slice(group.start, group.end).join(''),
          local: localResult,
          parent: parentResult,
          before: base.slice(Math.max(0, group.start - 12), group.start).join(''),
          after: base.slice(group.end, group.end + 12).join('')
        };
        conflicts.push(conflict); parts.push({ conflict: conflict.id });
      }
      cursor = group.end;
    });
    parts.push({ text: base.slice(cursor).join('') });
    return { parts: parts, conflicts: conflicts };
  }

  function resolve(plan, choices) {
    choices = choices || {};
    var byId = {};
    plan.conflicts.forEach(function (conflict) {
      var choice = choices[conflict.id];
      if (!choice || ['local', 'parent', 'custom'].indexOf(choice.kind) === -1) {
        throw new Error('Choose a resolution for every conflict.');
      }
      if (choice.kind === 'custom' && typeof choice.text !== 'string') throw new Error('Enter custom resolution text.');
      byId[conflict.id] = choice.kind === 'custom' ? choice.text : conflict[choice.kind];
    });
    return plan.parts.map(function (part) { return part.conflict ? byId[part.conflict] : part.text; }).join('');
  }

  // Return UTF-16 offsets, as required by Google Docs, without splitting emoji.
  function patches(before, after) {
    var source = tokens(before), offsets = [0];
    source.forEach(function (token) { offsets.push(offsets[offsets.length - 1] + token.length); });
    return diff(source, tokens(after)).map(function (edit) {
      return { start: offsets[edit.start], end: offsets[edit.end], text: edit.text };
    });
  }

  return { plan: plan, resolve: resolve, patches: patches, diff: diff, tokens: tokens };
})();
if (typeof module !== 'undefined') module.exports = RebaseMerge;
