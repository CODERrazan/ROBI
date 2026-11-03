import fs from 'node:fs';
import path from 'node:path';
const folder=path.resolve('screenshots/real-dressing');fs.mkdirSync(folder,{recursive:true});
const report={method:'Real Edge browser CDP interaction with React UI and live backend; no mocked network',api:[],consoleErrors:[],steps:[]};
const pages=await fetch('http://127.0.0.1:9223/json/list').then(r=>r.json());
const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://localhost:5173'));
if(!page)throw new Error('ROBI browser tab not found');
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let nextId=0;const pending=new Map();const requests=new Map();const responses=new Map();const bodyTasks=new Set();
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++nextId;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
ws.onmessage=event=>{
 const data=JSON.parse(event.data);
 if(data.id){const item=pending.get(data.id);if(item){clearTimeout(item.timer);pending.delete(data.id);data.error?item.reject(new Error(data.error.message)):item.resolve(data.result);}return;}
 if(data.method==='Runtime.exceptionThrown')report.consoleErrors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);
 if(data.method==='Log.entryAdded'&&data.params.entry.level==='error')report.consoleErrors.push(data.params.entry.text);
 if(data.method==='Network.requestWillBeSent'){
  const {requestId,request}=data.params;
  if(request.url.includes('/api/')&&request.method==='POST'){let body;try{body=JSON.parse(request.postData||'{}');}catch{}requests.set(requestId,{url:request.url,body,started:Date.now()});}
 }
 if(data.method==='Network.responseReceived'&&requests.has(data.params.requestId))responses.set(data.params.requestId,data.params.response);
 if(data.method==='Network.loadingFinished'&&responses.has(data.params.requestId)){
  const id=data.params.requestId,request=requests.get(id),response=responses.get(id);
  const task=send('Network.getResponseBody',{requestId:id}).then(value=>{const text=value.base64Encoded?Buffer.from(value.body,'base64').toString('utf8'):value.body;let result;try{result=JSON.parse(text);}catch{result={unparsed:true};}report.api.push({url:request.url,request:request.body,http_status:response.status,seconds:(Date.now()-request.started)/1000,result});}).catch(error=>report.consoleErrors.push('Response capture: '+error.message));
  bodyTasks.add(task);task.finally(()=>bodyTasks.delete(task));
 }
};
async function evaluate(expression){const data=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(data.exceptionDetails)throw new Error(data.exceptionDetails.text+': '+data.exceptionDetails.exception?.description);return data.result?.value;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(expression,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await delay(300);}throw new Error('Browser condition timeout: '+expression);}
async function screenshot(name){const data=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(folder,name),Buffer.from(data.data,'base64'));report.steps.push({screenshot:name});}
async function message(text,label){
 const before=await evaluate("document.querySelectorAll('#msgs .m').length");const start=Date.now();
 await evaluate("(()=>{const input=document.querySelector('section .row input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,"+JSON.stringify(text)+");input.dispatchEvent(new Event('input',{bubbles:true}));})()");
 await delay(150);await evaluate("document.querySelector('section .row button.ic.pr').click()");
 await waitFor("(()=>{const rows=[...document.querySelectorAll('#msgs .m')];return rows.length>"+before+"&&rows.at(-1)?.classList.contains('l')&&!rows.at(-1)?.classList.contains('dots')&&!document.querySelector('section .row button.ic.pr').disabled;})()");
 await Promise.all([...bodyTasks]);
 const reply=await evaluate("document.querySelector('#msgs .m:last-child .tx').innerText");
 report.steps.push({label,message:text,reply,seconds:(Date.now()-start)/1000});
 console.log('BROWSER_STEP',label,'SECONDS',(Date.now()-start)/1000,'REPLY',reply);
}

try{
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Log.enable');await send('Page.bringToFront');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 const response=await fetch('http://127.0.0.1:8000/api/avatar/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{assetId:17331596106,assetType:11},{assetId:114915582025729,assetType:12}]})});
 const resolved=await response.json();if(response.status!==200||resolved.items.some(i=>i.resolution_status!=='resolved'))throw new Error('Real assets not resolved');
 report.resolution=resolved;
 const config={version:1,rigType:'R15',bodyColors:Object.fromEntries(['head','torso','leftArm','rightArm','leftLeg','rightLeg'].map(k=>[k,'#E8B590'])),scales:{height:1,width:1,head:1,bodyType:0,proportion:0},items:resolved.items.map(i=>({slot:i.slot,source:'roblox',assetId:i.asset_id,assetType:i.asset_type,name:i.name,verified:true,price:i.price,availability:i.availability}))};
 const old=await evaluate("localStorage.getItem('robi-designs')||'[]'");report.savedDesignSeed='Previously selected real Roblox IDs, revalidated through live backend; no mocked asset responses';
 const saved=JSON.parse(old).filter(x=>x.name!=='Live classic dressing check');
 saved.unshift({id:900001,name:'Live classic dressing check',date:'2026-11-03',config,budget:100});
 await evaluate("localStorage.setItem('robi-designs',"+JSON.stringify(JSON.stringify(saved))+");localStorage.setItem('robi-lang','en');");
 await send('Page.reload',{ignoreCache:true});await waitFor("document.readyState==='complete'&&!!document.querySelector('nav')");await delay(1500);report.consoleErrors=[];await send('Log.clear');
 await evaluate("document.querySelectorAll('nav button.l')[1].click()");
 await waitFor("!!document.querySelector('.design-card')");
 await evaluate("document.querySelector('.design-card .row button').click()");
 await waitFor("document.querySelector('[data-dressing-state]')?.dataset.dressingState==='ready'",65000);
 await evaluate("document.querySelector('.ctl button:last-child').click()");
 await delay(600);
 report.initialState=await evaluate("({state:document.querySelector('[data-dressing-state]').dataset.dressingState,ids:document.querySelector('[data-applied-ids]').dataset.appliedIds})");
 await screenshot('01-classic-black-shirt-pants.png');
 await evaluate("window.__dressingCanvas=document.querySelector('.viewer canvas')");
 await message('\u063a\u064a\u0631\u064a \u0627\u0644\u0628\u0646\u0637\u0644\u0648\u0646 \u0625\u0644\u0649 \u0623\u0628\u064a\u0636 \u0641\u0642\u0637\u060c \u062e\u0644\u064a \u0627\u0644\u0628\u0644\u0648\u0632\u0629 \u0646\u0641\u0633\u0647\u0627 \u0648\u0627\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629 100.','white-pants');
 await waitFor("document.querySelector('[data-dressing-state]')?.dataset.dressingState==='ready'",65000);
 report.modified=await evaluate("({state:document.querySelector('[data-dressing-state]').dataset.dressingState,ids:document.querySelector('[data-applied-ids]').dataset.appliedIds,selected:[...document.querySelectorAll('[data-selected-asset-id]')].map(x=>+x.dataset.selectedAssetId),sameCanvas:window.__dressingCanvas===document.querySelector('.viewer canvas')})");
 await screenshot('02-classic-white-pants.png');
 if(!report.modified.selected.includes(17331596106)||report.modified.selected.includes(114915582025729))throw new Error('Pants modification did not preserve shirt');
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;try{await screenshot('error-state.png');}catch{}}
finally{await Promise.all([...bodyTasks]);fs.writeFileSync(path.join(folder,'dressing-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,initial:report.initialState,modified:report.modified,consoleErrors:report.consoleErrors}));ws.close();}
