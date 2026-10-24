const {test} = require('node:test');
const assert = require('node:assert/strict');
const doc = require('../src/Document');

function fixture(text = 'Hello 😀\nWorld\n') {
  let index = 1;
  return {documentId:'doc',title:'Test',revisionId:'r1',tabs:[{tabProperties:{tabId:'tab1'},documentTab:{body:{content:[
    {sectionBreak:{},endIndex:1},
    ...text.match(/[^\n]*\n/g).map(content => {
      const startIndex = index; index += content.length;
      return {startIndex,endIndex:index,paragraph:{elements:[{startIndex,endIndex:index,textRun:{content,textStyle:{bold:true}}}]}};
    })
  ]}}}]};
}

test('reads exact text, removes only the terminal newline, and keeps revision and tab', () => {
  assert.deepEqual(doc.snapshot(fixture()), {id:'doc',title:'Test',revision:'r1',tabId:'tab1',text:'Hello 😀\nWorld'});
  assert.equal(doc.snapshot(fixture('\n')).text, '');
  assert.equal(doc.snapshot(fixture('Hello\n\n')).text, 'Hello\n');
});

test('patches apply in reverse order, target the tab, and never delete terminal newline', () => {
  const snapshot = doc.snapshot(fixture());
  const requests = doc.requests(snapshot, 'Hi 😎\nEveryone');
  let text = snapshot.text + '\n';
  for (const request of requests) {
    if (request.deleteContentRange) {
      const range = request.deleteContentRange.range;
      assert.equal(range.tabId,'tab1');
      assert.ok(range.endIndex <= text.length);
      text = text.slice(0,range.startIndex-1) + text.slice(range.endIndex-1);
    } else {
      const {location,text:inserted} = request.insertText;
      assert.equal(location.tabId,'tab1');
      text = text.slice(0,location.index-1) + inserted + text.slice(location.index-1);
    }
  }
  assert.equal(text,'Hi 😎\nEveryone\n');
  assert.deepEqual(doc.requests(snapshot,snapshot.text),[]);
  assert.equal(doc.requests(snapshot,'')[0].deleteContentRange.range.endIndex,snapshot.text.length+1);
});

test('rejects unsupported structures and suggested edits instead of flattening them', () => {
  const mutations = [
    d => d.tabs.push(structuredClone(d.tabs[0])),
    d => d.tabs[0].childTabs = [structuredClone(d.tabs[0])],
    d => d.tabs[0].documentTab.body.content[1] = {table:{},startIndex:1},
    d => d.tabs[0].documentTab.body.content[1].paragraph.elements[0].suggestedInsertionIds = ['suggestion'],
    d => d.tabs[0].documentTab.body.content[1].paragraph.elements[0].textRun.suggestedTextStyleChanges = {id:{textStyle:{bold:false}}},
    d => d.tabs[0].documentTab.headers = {h1:{}},
    d => d.tabs[0].documentTab.positionedObjects = {image:{}},
    d => delete d.tabs[0].documentTab.body.content[1].paragraph.elements[0].textRun,
    d => d.tabs[0].documentTab.body.content[1].paragraph.elements[0].startIndex = 4,
    d => delete d.revisionId
  ];
  mutations.forEach(mutate => { const data = fixture(); mutate(data); assert.throws(() => doc.snapshot(data)); });
});

test('validates size, Google-stripped characters, and unpaired surrogates', () => {
  assert.throws(() => doc.validateText('a'.repeat(20001)),/20,000/);
  assert.throws(() => doc.validateText('\u0000'),/characters/);
  assert.throws(() => doc.validateText('\uE001'),/characters/);
  assert.throws(() => doc.validateText('\uD800'),/Unicode/);
  assert.throws(() => doc.validateText('\uDC00'),/Unicode/);
  doc.validateText('😀\n\t東京');
});
