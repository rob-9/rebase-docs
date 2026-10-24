const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Sync = require('../src/Sync');

function harness(base='Launch Monday in Paris.') {
  const states = new Map(), docs = new Map();
  let revision = 0, writes = 0, beforeWrite = null, afterWrite = null, beforeSave = null, beforeRead = null;
  const edit = (id,text) => docs.set(id,{id,title:id,tabId:'tab',text,revision:String(++revision)});
  edit('parent',base); edit('child',base);
  const io = {
    read(id) { if (beforeRead) beforeRead(id); if (!docs.has(id)) throw Error('Access denied'); return structuredClone(docs.get(id)); },
    load(id) { return structuredClone(states.get(id) || null); },
    save(id,state) { if (beforeSave) beforeSave(id,state); states.set(id,structuredClone(state)); },
    remove(id) { states.delete(id); },
    copy(id,name) { edit('newcopy',docs.get(id).text); docs.get('newcopy').title = name; return 'newcopy'; },
    write(id,expected,requests) {
      if (beforeWrite) beforeWrite();
      assert.equal(docs.get(id).revision,expected,'stale revision');
      let text = docs.get(id).text;
      requests.forEach(request => {
        if (request.deleteContentRange) { const r = request.deleteContentRange.range; text = text.slice(0,r.startIndex-1)+text.slice(r.endIndex-1); }
        if (request.insertText) { const r = request.insertText; text = text.slice(0,r.location.index-1)+r.text+text.slice(r.location.index-1); }
      });
      writes++; edit(id,text);
      if (afterWrite) afterWrite();
    },
    hash: text => crypto.createHash('sha256').update(text).digest('hex'),
    uuid: () => crypto.randomUUID(), now: () => '2026-10-24T12:00:00.000Z'
  };
  return {service:Sync.create(io),io,states,docs,edit,get writes(){return writes;},
    set beforeWrite(fn){beforeWrite=fn;},set afterWrite(fn){afterWrite=fn;},set beforeSave(fn){beforeSave=fn;},set beforeRead(fn){beforeRead=fn;}};
}

test('linked copies rebase parent changes while keeping local edits and leaving parent intact', () => {
  const h = harness(); h.service.link('child','parent');
  h.edit('child','Launch Tuesday in Paris.'); h.edit('parent','Launch Monday in London.');
  assert.equal(h.service.sync('child').status,'synced');
  assert.equal(h.docs.get('child').text,'Launch Tuesday in London.');
  assert.equal(h.docs.get('parent').text,'Launch Monday in London.');
  assert.equal(h.service.sync('child').status,'current'); assert.equal(h.writes,1);
});

test('conflicts cause no writes until resolved, and local choices survive subsequent syncs', () => {
  const h = harness(); h.service.link('child','parent');
  h.edit('child','Launch Tuesday in Paris.'); h.edit('parent','Launch Friday in Paris.');
  assert.equal(h.service.sync('child').status,'conflict'); assert.equal(h.writes,0);
  const preview = h.service.preview('child');
  h.service.resolve('child',preview.token,{c0:{kind:'local'}});
  assert.equal(h.service.sync('child').status,'current');
  h.edit('parent','Launch Friday in London.');
  h.service.sync('child');
  assert.equal(h.docs.get('child').text,'Launch Tuesday in London.');
});

test('custom conflict text is applied', () => {
  const h = harness('hello'); h.service.link('child','parent');
  h.edit('child','local'); h.edit('parent','parent');
  h.service.resolve('child',h.service.preview('child').token,{c0:{kind:'custom',text:'combined'}});
  assert.equal(h.docs.get('child').text,'combined');
});

test('stale decisions are rejected after either document changes', () => {
  for (const changed of ['child','parent']) {
    const h = harness('hello'); h.service.link('child','parent');
    h.edit('child','local'); h.edit('parent','parent'); const preview = h.service.preview('child');
    h.edit(changed,'newer');
    assert.throws(() => h.service.resolve('child',preview.token,{c0:{kind:'parent'}}),/Reload/);
    assert.equal(h.writes,0);
  }
});

test('optimistic write revision rejects edits made after the last read', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','new');
  h.beforeWrite = () => h.edit('child','concurrent collaborator text');
  assert.throws(() => h.service.sync('child'),/stale revision/);
  assert.equal(h.docs.get('child').text,'concurrent collaborator text');
  assert.equal(h.states.get('child').base,'hello');
  assert.equal(h.service.sync('child').status,'recovery');
});

test('parent edits during sync abort before writing', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','new');
  let reads = 0; h.beforeRead = id => { if (id === 'parent' && ++reads === 2) h.edit('parent','newer'); };
  assert.throws(() => h.service.sync('child'),/parent changed/); assert.equal(h.writes,0);
});

test('failed document write retries safely when its original revision is unchanged', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','new');
  h.beforeWrite = () => { throw Error('temporarily unavailable'); };
  assert.throws(() => h.service.sync('child'),/unavailable/);
  assert.ok(h.states.get('child').pending);
  h.beforeWrite = null; h.service.sync('child');
  assert.equal(h.docs.get('child').text,'new'); assert.equal(h.writes,1);
});

test('a lost API response recovers an applied write without duplicating it', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','hello new');
  h.afterWrite = () => { throw Error('network response lost'); };
  assert.throws(() => h.service.sync('child'),/lost/);
  h.afterWrite = null;
  assert.equal(h.service.sync('child').status,'current');
  assert.equal(h.docs.get('child').text,'hello new'); assert.equal(h.writes,1);
  assert.equal(h.states.get('child').pending,null);
});

test('failed state commit recovers from the durable pre-write journal', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','new');
  h.beforeSave = (id,state) => { if (!state.pending) throw Error('storage failure'); };
  assert.throws(() => h.service.sync('child'),/storage failure/);
  assert.equal(h.docs.get('child').text,'new'); assert.ok(h.states.get('child').pending);
  h.beforeSave = null; h.service.sync('child');
  assert.equal(h.writes,1); assert.equal(h.states.get('child').base,'new');
});

test('failure saving the journal prevents all document writes', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','new');
  h.beforeSave = () => { throw Error('storage full'); };
  assert.throws(() => h.service.sync('child'),/storage full/); assert.equal(h.writes,0);
});

test('ambiguous recovery requires a fresh explicit decision and preserves current text', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.edit('parent','new');
  h.afterWrite = () => { h.edit('child','new plus collaborator'); throw Error('interrupted'); };
  assert.throws(() => h.service.sync('child'),/interrupted/); h.afterWrite = null;
  assert.equal(h.service.sync('child').status,'recovery'); const preview = h.service.preview('child');
  assert.equal(preview.after,'new'); assert.equal(preview.current,'new plus collaborator');
  assert.throws(() => h.service.disconnect('child'),/interrupted/);
  h.edit('child','new plus more');
  assert.throws(() => h.service.resolveRecovery('child',preview.token,true),/Reload/);
  h.service.resolveRecovery('child',h.service.preview('child').token,true);
  assert.equal(h.states.get('child').base,'new'); assert.equal(h.docs.get('child').text,'new plus more');
  assert.equal(h.service.sync('child').status,'current');
});

test('pause stops automatic sync but permits manual sync and disconnect leaves text intact', () => {
  const h = harness(); h.service.link('child','parent'); h.service.settings('child',false,false);
  h.edit('parent','changed'); assert.equal(h.service.sync('child',true).status,'paused'); assert.equal(h.writes,0);
  h.service.sync('child',false); assert.equal(h.writes,1);
  h.service.disconnect('child'); assert.equal(h.docs.get('child').text,'changed');
  assert.equal(h.service.sync('child').status,'unlinked');
});

test('linking rejects missing ancestry, self-parenting, existing links, and cycles', () => {
  const h = harness('same');
  assert.throws(() => h.service.link('child','child'),/own parent/);
  h.edit('child','different'); assert.throws(() => h.service.link('child','parent'),/common starting point/);
  h.edit('child','same'); h.service.link('child','parent');
  assert.throws(() => h.service.link('child','parent'),/already linked/);
  assert.throws(() => h.service.link('parent','child'),/cycle/);
});

test('new copies use the actual copied snapshot as their base', () => {
  const h = harness('original');
  h.io.copy = (id,name) => { h.edit('parent','changed during copy'); h.edit('newcopy','changed during copy'); return 'newcopy'; };
  const service = Sync.create(h.io); const copy = service.createCopy('parent','A copy');
  assert.equal(copy.id,'newcopy'); assert.equal(h.states.get('newcopy').base,'changed during copy');
  assert.equal(service.sync('newcopy').status,'current');
});

test('loss of parent access never advances the saved baseline', () => {
  const h = harness('hello'); h.service.link('child','parent'); h.docs.delete('parent');
  assert.throws(() => h.service.sync('child'),/Access denied/);
  assert.equal(h.states.get('child').base,'hello'); assert.equal(h.writes,0);
});
