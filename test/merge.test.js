const {test} = require('node:test');
const assert = require('node:assert/strict');
const merge = require('../src/Merge');

function clean(base, local, parent, expected) {
  const plan = merge.plan(base, local, parent);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(merge.resolve(plan), expected);
}

test('unchanged, one-sided, and identical edits', () => {
  clean('hello', 'hello', 'hello', 'hello');
  clean('hello', 'hello!', 'hello', 'hello!');
  clean('hello', 'hello', 'hello!', 'hello!');
  clean('hello', 'hello!', 'hello!', 'hello!');
  clean('', '', 'new', 'new');
  clean('gone', '', '', '');
});

test('independent words in the same paragraph merge', () => {
  clean('Launch Monday in Paris.', 'Launch Tuesday in Paris.', 'Launch Monday in London.', 'Launch Tuesday in London.');
});

test('separate paragraphs and appended text merge', () => {
  clean('First\nSecond\nThird', 'First locally\nSecond\nThird', 'First\nSecond\nThird remotely', 'First locally\nSecond\nThird remotely');
});

test('appending a local paragraph does not conflict with a parent edit to the preceding word', () => {
  clean('Monday.\nMeet in Paris.', 'Tuesday.\nMeet in Paris.\nLocal note.', 'Monday.\nMeet in London.', 'Tuesday.\nMeet in London.\nLocal note.');
});

test('overlapping replacements require explicit choice', () => {
  const plan = merge.plan('Ship Monday.', 'Ship Tuesday.', 'Ship Friday.');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0].base, 'Monday');
  assert.equal(merge.resolve(plan, {c0: {kind: 'local'}}), 'Ship Tuesday.');
  assert.equal(merge.resolve(plan, {c0: {kind: 'parent'}}), 'Ship Friday.');
  assert.equal(merge.resolve(plan, {c0: {kind: 'custom', text: 'next week'}}), 'Ship next week.');
  assert.equal(merge.resolve(plan, {c0: {kind: 'custom', text: ''}}), 'Ship .');
  assert.throws(() => merge.resolve(plan), /every conflict/);
  assert.throws(() => merge.resolve(plan, {c0: {kind: 'bogus'}}), /every conflict/);
});

test('concurrent insertions and deletion versus edit conflict', () => {
  assert.equal(merge.plan('', 'ours', 'theirs').conflicts.length, 1);
  assert.equal(merge.plan('Keep this paragraph.', '', 'Keep this new paragraph.').conflicts.length, 1);
});

test('independent edits remain present when resolving conflicts', () => {
  const plan = merge.plan('A one.\nB two.\nC three.', 'A local.\nB local.\nC three.', 'A parent.\nB two.\nC parent.');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(merge.resolve(plan, {c0: {kind:'parent'}}), 'A parent.\nB local.\nC parent.');
});

test('conservative fallback bounds a large diff and still roundtrips', () => {
  const base = Array.from({length:1600}, (_,i) => `a${i}`).join(' ');
  const parent = Array.from({length:1600}, (_,i) => `b${i}`).join(' ');
  clean(base, base, parent, parent);
  clean(base, base + ' local', parent, parent + ' local');
  assert.equal(merge.plan(base, base.replace('a10 ', 'local '), parent).conflicts.length, 1);
});

test('UTF-16 patches preserve whole Unicode characters and exact whitespace', () => {
  const before = '😀 café\n東京 👩‍💻\n';
  const after = '😀 café!\n大阪 👩‍💻\n';
  let text = before;
  merge.patches(before, after).reverse().forEach(edit => { text = text.slice(0,edit.start) + edit.text + text.slice(edit.end); });
  assert.equal(text, after);
  clean('😀 hi\n', '😀 hello\n', '😎 hi\n', '😎 hello\n');
});

test('seeded random diff reconstruction and three-way identities', () => {
  let seed = 122;
  const random = max => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed % max; };
  const alphabet = ['a','b',' ','\n','😀','é','東','.','\t'];
  for (let trial = 0; trial < 700; trial++) {
    const base = Array.from({length:random(45)}, () => alphabet[random(alphabet.length)]).join('');
    const changed = Array.from({length:random(45)}, () => alphabet[random(alphabet.length)]).join('');
    let rebuilt = base;
    merge.patches(base,changed).reverse().forEach(edit => { rebuilt = rebuilt.slice(0,edit.start) + edit.text + rebuilt.slice(edit.end); });
    assert.equal(rebuilt, changed);
    clean(base,base,changed,changed);
    clean(base,changed,base,changed);
    clean(base,changed,changed,changed);
  }
});
