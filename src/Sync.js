/* All Google services are injected so failure and concurrency paths are testable. */
var RebaseSync = (function () {
  'use strict';

  function create(io) {
    var merge = typeof RebaseMerge !== 'undefined' ? RebaseMerge : require('./Merge.js');
    var documentModel = typeof RebaseDocument !== 'undefined' ? RebaseDocument : require('./Document.js');
    function load(id) {
      var state = io.load(id);
      if (!state) throw new Error('This document is not linked to a parent yet.');
      return state;
    }
    function token(state, child, parent) {
      return io.hash(JSON.stringify([state.version, state.base, state.pending || null, child.revision, parent && parent.revision]));
    }
    function status(state, name, extra) {
      return Object.assign({ status: name, parentId: state.parentId, parentTitle: state.parentTitle,
        auto: state.auto, background: state.background, lastSync: state.lastSync || null }, extra || {});
    }
    function save(state) { state.version = io.uuid(); io.save(state.childId, state); }

    function newLink(child, parent, base) {
      if (child.id === parent.id) throw new Error('A document cannot be its own parent.');
      if (io.load(child.id)) throw new Error('This copy is already linked. Disconnect it before choosing a different parent.');
      var seen = {}, cursor = parent.id;
      while (cursor) {
        if (cursor === child.id || seen[cursor]) throw new Error('That link would create a parent cycle.');
        seen[cursor] = true;
        var ancestor = io.load(cursor); cursor = ancestor && ancestor.parentId;
      }
      var state = { schema: 1, childId: child.id, parentId: parent.id, parentTitle: parent.title,
        base: base, auto: true, background: false, lastSync: io.now(), pending: null };
      save(state);
      return status(state, 'current');
    }

    function link(childId, parentId) {
      var child = io.read(childId), parent = io.read(parentId);
      if (child.text !== parent.text) throw new Error('These documents already differ, so their common starting point is unknown. Use Create linked copy from the parent, or link copies whose text still matches.');
      return newLink(child, parent, parent.text);
    }

    function createCopy(parentId, name) {
      var parent = io.read(parentId);
      var copyId = io.copy(parentId, (name || parent.title + ' — linked copy').trim().slice(0, 180));
      try {
        var child = io.read(copyId);
        // The actual copied text is the common ancestor, even if the parent was
        // edited between the initial read and Drive's atomic copy operation.
        newLink(child, parent, child.text);
        return { id: copyId, url: 'https://docs.google.com/document/d/' + copyId + '/edit', title: child.title };
      } catch (error) {
        throw new Error('The copy was created at https://docs.google.com/document/d/' + copyId + '/edit but linking failed: ' + error.message);
      }
    }

    function recover(state, child) {
      if (!state.pending) return true;
      if (child.text === state.pending.after) {
        state.base = state.pending.parent; state.pending = null; state.lastSync = io.now(); save(state);
        return true;
      }
      if (child.revision === state.pending.beforeRevision && child.text === state.pending.before) {
        state.pending = null; save(state); return true;
      }
      return false;
    }

    function inspect(id) {
      var state = load(id), child = io.read(id);
      if (!recover(state, child)) {
        return { state: state, child: child, recovery: true, token: token(state, child, null) };
      }
      var parent = io.read(state.parentId);
      state.parentTitle = parent.title;
      return { state: state, child: child, parent: parent,
        plan: merge.plan(state.base, child.text, parent.text), token: token(state, child, parent) };
    }

    function commit(view, target) {
      documentModel.validateText(target);
      var state = view.state;
      // Check the parent again immediately before applying. Google cannot commit
      // across two docs atomically; a later parent edit is picked up next time.
      if (io.read(state.parentId).revision !== view.parent.revision) throw new Error('The parent changed during sync. Check again to merge its latest edits.');
      var requests = documentModel.requests(view.child, target);
      if (requests.length) {
        state.pending = { before: view.child.text, beforeRevision: view.child.revision,
          after: target, parent: view.parent.text };
        save(state); // A durable journal MUST exist before any document write.
        io.write(view.child.id, view.child.revision, requests);
      }
      state.base = view.parent.text; state.pending = null; state.lastSync = io.now(); save(state);
      return status(state, 'synced', { changed: requests.length > 0 });
    }

    function sync(id, automatic) {
      var state = io.load(id);
      if (!state) return { status: 'unlinked' };
      if (automatic && !state.auto) return status(state, 'paused');
      var view = inspect(id);
      if (view.recovery) return status(view.state, 'recovery', { token: view.token });
      if (view.plan.conflicts.length) return status(view.state, 'conflict', { count: view.plan.conflicts.length, token: view.token });
      if (view.parent.text === view.state.base) return status(view.state, 'current');
      return commit(view, merge.resolve(view.plan));
    }

    function preview(id) {
      var view = inspect(id);
      if (view.recovery) return { status: 'recovery', token: view.token,
        before: view.state.pending.before, after: view.state.pending.after, current: view.child.text };
      return { status: view.plan.conflicts.length ? 'conflict' : 'current', token: view.token,
        conflicts: view.plan.conflicts, parentTitle: view.parent.title, childTitle: view.child.title };
    }

    function resolve(id, expectedToken, choices) {
      var view = inspect(id);
      if (view.recovery || expectedToken !== view.token) throw new Error('A document changed while you were reviewing. Reload the latest conflicts before applying.');
      return commit(view, merge.resolve(view.plan, choices));
    }

    function resolveRecovery(id, expectedToken, applied) {
      if (typeof applied !== 'boolean') throw new Error('Choose whether the interrupted sync was applied.');
      var state = load(id), child = io.read(id);
      if (!state.pending || expectedToken !== token(state, child, null)) throw new Error('The document changed. Reload recovery before continuing.');
      if (applied) state.base = state.pending.parent;
      state.pending = null; save(state);
      // Only acknowledge the journal here. The next check re-merges fresh text.
      return status(state, 'recovered');
    }

    function settings(id, auto, background) {
      if (typeof auto !== 'boolean' || typeof background !== 'boolean') throw new Error('Invalid sync settings.');
      var state = load(id);
      state.auto = auto; state.background = background; save(state);
      return status(state, auto ? 'current' : 'paused');
    }

    return { link: link, createCopy: createCopy, sync: sync, preview: preview, resolve: resolve,
      resolveRecovery: resolveRecovery, settings: settings,
      disconnect: function (id) {
        var state = load(id);
        if (state.pending) throw new Error('Resolve the interrupted sync before disconnecting.');
        io.remove(id); return { status: 'unlinked' };
      } };
  }
  return { create: create };
})();
if (typeof module !== 'undefined') module.exports = RebaseSync;
