var RebaseDocument = (function () {
  'use strict';
  var MAX_LENGTH = 20000;

  function validateText(text) {
    if (typeof text !== 'string' || text.length > MAX_LENGTH) throw new Error('This prototype supports up to 20,000 UTF-16 characters per document.');
    if (/[\u0000-\u0008\u000B-\u001F\uE000-\uF8FF]/u.test(text)) throw new Error('The text contains characters that the Google Docs API cannot insert reliably.');
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        var next = text.charCodeAt(++i);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new Error('The text contains an incomplete Unicode character.');
      } else if (code >= 0xDC00 && code <= 0xDFFF) throw new Error('The text contains an incomplete Unicode character.');
    }
  }

  function hasSuggestions(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.keys(value).some(function (key) {
      var child = value[key];
      return (/^suggest(ed|ion)/i.test(key) && child && typeof child === 'object' && Object.keys(child).length > 0) || hasSuggestions(child);
    });
  }

  function snapshot(doc) {
    var tabs = doc.tabs || [];
    if (tabs.length !== 1 || (tabs[0].childTabs || []).length) throw new Error('Sync is paused: this prototype supports documents with one tab.');
    var tab = tabs[0], body = tab.documentTab;
    if (!body || !body.body || !tab.tabProperties || !tab.tabProperties.tabId) throw new Error('Could not read the document tab.');
    if (!doc.revisionId) throw new Error('Sync needs edit access to both documents so it can check revisions.');
    if (hasSuggestions(doc)) throw new Error('Sync is paused: accept or reject suggested edits in both documents first.');
    ['headers', 'footers', 'footnotes', 'inlineObjects', 'positionedObjects'].forEach(function (key) {
      if (body[key] && Object.keys(body[key]).length) throw new Error('Sync is paused: headers, footers, footnotes, and images are not supported yet.');
    });
    var text = '', index = 1;
    (body.body.content || []).forEach(function (element, position) {
      if (position === 0 && element.sectionBreak && element.endIndex === 1) return;
      if (!element.paragraph || element.startIndex !== index) throw new Error('Sync is paused: tables, section breaks, and other non-text content are not supported yet.');
      (element.paragraph.elements || []).forEach(function (run) {
        if (!run.textRun || typeof run.textRun.content !== 'string' || run.startIndex !== index) throw new Error('Sync is paused: only text paragraphs are supported (no images, chips, or embedded objects).');
        text += run.textRun.content; index += run.textRun.content.length;
        if (run.endIndex !== index) throw new Error('Unexpected document indexes. Sync was stopped.');
      });
      if (element.endIndex !== index) throw new Error('Unexpected paragraph indexes. Sync was stopped.');
    });
    if (!text.endsWith('\n')) throw new Error('The document is missing its final paragraph boundary.');
    // Docs owns the last newline. Never delete or replace it.
    text = text.slice(0, -1);
    validateText(text);
    return { id: doc.documentId, title: doc.title, revision: doc.revisionId, tabId: tab.tabProperties.tabId, text: text };
  }

  function requests(snapshot, target) {
    var merge = typeof RebaseMerge !== 'undefined' ? RebaseMerge : require('./Merge.js');
    validateText(target);
    var result = [];
    merge.patches(snapshot.text, target).reverse().forEach(function (edit) {
      if (edit.end > edit.start) result.push({ deleteContentRange: { range: { tabId: snapshot.tabId, startIndex: 1 + edit.start, endIndex: 1 + edit.end } } });
      if (edit.text) result.push({ insertText: { location: { tabId: snapshot.tabId, index: 1 + edit.start }, text: edit.text } });
    });
    if (result.length > 500) throw new Error('Too many changes for one sync. Reduce the number of edits before retrying.');
    return result;
  }

  return { snapshot: snapshot, requests: requests, validateText: validateText };
})();
if (typeof module !== 'undefined') module.exports = RebaseDocument;
