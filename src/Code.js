function onOpen() {
  DocumentApp.getUi().createAddonMenu()
    .addItem('Open Docs Rebase', 'showSidebar')
    .addItem('Review conflicts', 'showConflicts')
    .addToUi();
}

function onInstall(e) { onOpen(e); }

function showSidebar() {
  DocumentApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Docs Rebase'));
}

function showConflicts() {
  DocumentApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('Conflicts')
    .setWidth(880).setHeight(650), 'Resolve sync conflicts');
}

function activeId_() {
  var doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error('Open Docs Rebase from a Google document.');
  return doc.getId();
}

function lock_(callback) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('Another sync is in progress. Try again in a moment.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function store_() {
  return RebaseStore.create(PropertiesService.getUserProperties(), {
    encode: function (text) { return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text)).getBytes()); },
    decode: function (text) { return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(text), 'application/gzip')).getDataAsString(); },
    bytes: function (text) { return Utilities.newBlob(text).getBytes().length; }
  });
}

function read_(id) {
  return RebaseDocument.snapshot(Docs.Documents.get(id, { includeTabsContent: true, suggestionsViewMode: 'SUGGESTIONS_INLINE' }));
}

function service_() {
  var store = store_();
  return RebaseSync.create({
    load: store.load, save: store.save, remove: store.remove, read: read_,
    write: function (id, revision, requests) {
      Docs.Documents.batchUpdate({ requests: requests, writeControl: { requiredRevisionId: revision } }, id);
    },
    hash: function (text) {
      return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
    },
    now: function () { return new Date().toISOString(); }, uuid: function () { return Utilities.getUuid(); },
    copy: function (id, name) { return DriveApp.getFileById(id).makeCopy(name).getId(); }
  });
}

function parseParentId_(input) {
  var value = String(input || '').trim();
  var url = value.match(/^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/);
  if (url) return url[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(value)) return value;
  throw new Error('Paste a Google Docs document URL or document ID.');
}

function getInitialState() {
  return lock_(function () {
    var id = activeId_(), state = store_().load(id);
    return { documentTitle: DocumentApp.getActiveDocument().getName(),
      status: state ? (state.auto ? 'ready' : 'paused') : 'unlinked',
      parentId: state && state.parentId, parentTitle: state && state.parentTitle,
      auto: state && state.auto, background: state && state.background, lastSync: state && state.lastSync,
      backgroundError: PropertiesService.getUserProperties().getProperty('dr-error:' + id) };
  });
}

function createLinkedCopy(name) {
  return lock_(function () { return service_().createCopy(activeId_(), name); });
}

function linkExistingCopy(parentInput) {
  return lock_(function () { return service_().link(activeId_(), parseParentId_(parentInput)); });
}

function checkForUpdates(automatic) {
  return lock_(function () { return service_().sync(activeId_(), automatic === true); });
}

function getConflictPreview() {
  return lock_(function () { return service_().preview(activeId_()); });
}

function applyResolutions(token, choices) {
  return lock_(function () { return service_().resolve(activeId_(), token, choices); });
}

function acknowledgeRecovery(token, applied) {
  return lock_(function () { return service_().resolveRecovery(activeId_(), token, applied); });
}

function saveSyncSettings(auto, background) {
  return lock_(function () {
    if (background) ensureBackgroundTrigger_();
    var result = service_().settings(activeId_(), auto, background);
    removeUnusedTrigger_();
    return result;
  });
}

function disconnectCopy() {
  return lock_(function () {
    var id = activeId_();
    var result = service_().disconnect(id);
    PropertiesService.getUserProperties().deleteProperty('dr-error:' + id);
    removeUnusedTrigger_(); return result;
  });
}

function ensureBackgroundTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === 'backgroundSync'; });
  if (!exists) ScriptApp.newTrigger('backgroundSync').timeBased().everyHours(1).create();
}

function removeUnusedTrigger_() {
  var store = store_();
  if (store.ids().some(function (id) { return store.load(id).background; })) return;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'backgroundSync') ScriptApp.deleteTrigger(trigger);
  });
}

function backgroundSync() {
  // Never opens UI from a clock trigger. The sidebar recomputes and surfaces
  // conflicts when the document is next open with the sidebar active.
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) return;
  try {
    var start = Date.now(), store = store_(), props = PropertiesService.getUserProperties();
    var ids = store.ids().filter(function (id) { var state = store.load(id); return state.auto && state.background; });
    // Rotate between runs so one slow document cannot starve the others.
    var cursor = Number(props.getProperty('dr-cursor') || 0);
    for (var count = 0; count < ids.length && Date.now() - start < 18000; count++) {
      var index = (cursor + count) % ids.length, id = ids[index];
      try {
        service_().sync(id, true);
        props.deleteProperty('dr-error:' + id);
      } catch (error) {
        props.setProperty('dr-error:' + id, String(error.message || error).slice(0, 1500));
      }
      props.setProperty('dr-cursor', String((index + 1) % ids.length));
    }
  } finally { lock.releaseLock(); }
}
