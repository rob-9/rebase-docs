// Local-only preview of the actual sidebar and conflict UI, backed by the same
// merge/sync service with in-memory Google Docs. No Google account is contacted.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Sync = require('../src/Sync');

function createDemo() {
  const states = new Map(), documents = new Map();
  let revision = 0, copyNumber = 0, linked = true;
  const setDoc = (id,text,title) => documents.set(id,{id,text,title:title || id,revision:String(++revision),tabId:'demo-tab'});
  const base = 'Launch brief\nWe launch on Monday.\nThe launch budget is $20,000.\nThe team will meet in Paris.';
  setDoc('parent',base,'Launch brief · parent'); setDoc('child',base,'Launch brief · your copy');
  const service = Sync.create({
    load:id => structuredClone(states.get(id) || null),
    save:(id,state) => states.set(id,structuredClone(state)), remove:id => states.delete(id),
    read:id => { if (!documents.has(id)) throw Error('Document not found in this local preview.'); return structuredClone(documents.get(id)); },
    write:(id,expected,requests) => {
      const doc = documents.get(id); if (doc.revision !== expected) throw Error('Document changed. Reload.');
      let text = doc.text;
      requests.forEach(request => {
        if (request.deleteContentRange) { const r=request.deleteContentRange.range; text=text.slice(0,r.startIndex-1)+text.slice(r.endIndex-1); }
        if (request.insertText) { const r=request.insertText; text=text.slice(0,r.location.index-1)+r.text+text.slice(r.location.index-1); }
      });
      setDoc(id,text,doc.title);
    },
    copy:(id,title) => { const copyId='copy'+(++copyNumber); setDoc(copyId,documents.get(id).text,title); return copyId; },
    hash:text => crypto.createHash('sha256').update(text).digest('hex'),
    now:() => new Date().toISOString(),uuid:crypto.randomUUID
  });
  service.link('child','parent');
  setDoc('child',base.replace('Monday','Tuesday').replace('$20,000','$25,000')+'\nLocal note: invite the design team.','Launch brief · your copy');
  setDoc('parent',base.replace('Monday','Friday').replace('$20,000','$30,000').replace('Paris','London'),'Launch brief · parent');

  const handlers = {
    getInitialState:() => Object.assign({documentTitle:documents.get('child').title}, linked ? {
      status:'ready',parentId:'parent',parentTitle:documents.get('parent').title,...states.get('child')
    } : {status:'unlinked'}),
    getConflictPreview:() => service.preview('child'),
    checkForUpdates:automatic => service.sync('child',automatic),
    applyResolutions:(token,choices) => service.resolve('child',token,choices),
    acknowledgeRecovery:(token,applied) => service.resolveRecovery('child',token,applied),
    saveSyncSettings:(auto,background) => service.settings('child',auto,background),
    disconnectCopy:() => { linked=false; return service.disconnect('child'); },
    createLinkedCopy:() => ({url:'/sidebar',title:'Preview copy'}),
    linkExistingCopy:() => { throw Error('Linking real Google documents is available after installing the add-on.'); }
  };

  const bridge = `<script>
    window.google={script:{host:{close:()=>{document.body.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Preview closed. Reload to try again.'}));}}}};
    function runner(success,failure){return new Proxy({}, {get:(_,name)=>{
      if(name==='withSuccessHandler')return fn=>runner(fn,failure);
      if(name==='withFailureHandler')return fn=>runner(success,fn);
      return (...args)=>{
        if(name==='showConflicts'){window.open('/','rebase-conflicts','width=900,height=730'); if(success)success(); return;}
        fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})})
          .then(r=>r.json()).then(r=>{if(r.error)throw Error(r.error);if(success)success(r.value);}).catch(e=>{if(failure)failure(e);});
      };
    }});}
    google.script.run=runner();
  </script>`;

  const server = http.createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if (req.method === 'POST' && req.url === '/api') {
      res.setHeader('Content-Type','application/json');
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) { res.writeHead(403); res.end(JSON.stringify({error:'Origin rejected'})); return; }
      try {
        let body='';
        for await (const chunk of req) { body+=chunk; if(body.length>100000)throw Error('Request too large'); }
        const {name,args}=JSON.parse(body);
        if(!Object.hasOwn(handlers,name)||!Array.isArray(args))throw Error('Unknown preview action');
        res.end(JSON.stringify({value:handlers[name](...args)}));
      } catch(error) { res.writeHead(400); res.end(JSON.stringify({error:error.message})); }
    } else if (req.method === 'GET' && ['/', '/sidebar'].includes(req.url)) {
      const filename=req.url==='/'?'Conflicts.html':'Sidebar.html';
      const html=fs.readFileSync(path.join(__dirname,'..','src',filename),'utf8');
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(html.replace('<head>','<head>'+bridge));
    } else { res.writeHead(404); res.end('Not found'); }
  });
  return {server,documents,service,setDoc};
}

if (require.main === module) {
  const port=Number(process.env.PORT || 4173);
  createDemo().server.listen(port,'127.0.0.1',() => {
    console.log(`Conflict preview: http://127.0.0.1:${port}/`);
    console.log(`Sidebar preview:  http://127.0.0.1:${port}/sidebar`);
  });
}
module.exports={createDemo};
