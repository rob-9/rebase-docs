const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..','src');
const files = fs.readdirSync(root);
const scripts = files.filter(file => file.endsWith('.js'));
for (const file of scripts) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
for (const file of files.filter(file => file.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root,file),'utf8');
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1],{filename:file});
}
// Apps Script must load in any file order without Node's require/module globals.
for (const order of [scripts,[...scripts].reverse()]) {
  const context = vm.createContext({});
  for (const file of order) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  vm.runInContext("RebaseSync.create({}); RebaseDocument.requests({text:'before',tabId:'tab'},'after');",context);
}
JSON.parse(fs.readFileSync(path.join(root,'appsscript.json'),'utf8'));
console.log('Server scripts, browser scripts, manifest, and Apps Script load order passed.');
