const {test} = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../src/Store');

function fixture() {
  const data = {}, fail = {key:null};
  const props = {
    getProperty:key => data[key] ?? null,
    getProperties:() => ({...data}),
    deleteProperty:key => { delete data[key]; },
    setProperty(key,value) { if (key === fail.key) throw Error('write failed'); data[key] = value; },
    setProperties(entries) { for (const [key,value] of Object.entries(entries)) this.setProperty(key,value); }
  };
  return {data,fail,store:Store.create(props,{encode:text => Buffer.from(text).toString('base64'),decode:text => Buffer.from(text,'base64').toString(),bytes:Buffer.byteLength})};
}
const state = base => ({schema:1,childId:'doc',base});

test('Unicode snapshots spanning chunks roundtrip and obsolete generations are removed', () => {
  const {store,data} = fixture(); const first = state('😀abc'.repeat(4000));
  store.save('doc',first); assert.deepEqual(store.load('doc'),first); assert.deepEqual(store.ids(),['doc']);
  assert.ok(Object.values(data).every(value => Buffer.byteLength(value) <= 6000));
  store.save('doc',state('new')); assert.equal(store.load('doc').base,'new');
  assert.equal(Object.keys(data).length,2);
  store.remove('doc'); assert.equal(store.load('doc'),null); assert.deepEqual(store.ids(),[]);
});

test('failed chunk or pointer writes preserve the previous committed snapshot', () => {
  for (const key of ['dr:doc:b:1','dr:doc:head']) {
    const {store,fail} = fixture(); store.save('doc',state('original')); fail.key=key;
    assert.throws(() => store.save('doc',state('large'.repeat(4000))),/failed/);
    assert.equal(store.load('doc').base,'original');
    fail.key=null; store.save('doc',state('recovered')); assert.equal(store.load('doc').base,'recovered');
  }
});

test('missing chunks and invalid schemas fail closed', () => {
  const {store,data} = fixture(); store.save('doc',state('hello')); delete data['dr:doc:a:0'];
  assert.throws(() => store.load('doc'),/incomplete/);
  store.save('doc',{schema:2,childId:'doc',base:'hello'});
  assert.throws(() => store.load('doc'),/Unrecognized/);
});

test('quota guard rejects oversized state before changing the active pointer', () => {
  const {store} = fixture(); store.save('doc',state('hello'));
  assert.throws(() => store.save('doc',state('x'.repeat(400000))),/storage is full/);
  assert.equal(store.load('doc').base,'hello');
});
