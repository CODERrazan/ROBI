import fs from 'node:fs';
import path from 'node:path';
const folder=path.resolve('screenshots/appearance');fs.mkdirSync(folder,{recursive:true});
const report={method:'Real Edge browser CDP interaction with React UI and live backend; no mocked network',api:[],consoleErrors:[],steps:[]};
const pages=await fetch('http://127.0.0.1:'+(process.env.ROBI_BROWSER_DEBUG_PORT||'9223')+'/json/list').then(r=>r.json());
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
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Log.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('nav')");await delay(1600);report.consoleErrors=[];await send('Log.clear');
 await message('هلا كيفك؟','greeting');
 await message('أبي بنطلون وبلوزة سوداء كيوت بميزانية 100 Robux.','generate');
 await waitFor("!!document.querySelector('.outfit-option')",5000);
 await evaluate("document.querySelector('.outfit-option button').click()");
 await waitFor("document.querySelector('[data-dressing-state]')?.dataset.dressingState==='ready'",65000);
 await screenshot('02-live-options.png');
 const ids=await evaluate("[...document.querySelectorAll('[data-selected-asset-id]')].map(x=>x.dataset.selectedAssetId).join(',')");
 await message('وش أحلى شي؟','advice');
 const after=await evaluate("[...document.querySelectorAll('[data-selected-asset-id]')].map(x=>x.dataset.selectedAssetId).join(',')");
 if(ids!==after)throw new Error('Advice changed selected outfit');
 report.advicePreservedSelection=true;
 await message('غيري البنطلون إلى أبيض وخلي البلوزة نفسها.','modify');
 await waitFor("document.querySelector('[data-dressing-state]')?.dataset.dressingState==='ready'",65000);
 await screenshot('03-live-modification.png');
 report.finalIds=await evaluate("[...document.querySelectorAll('[data-selected-asset-id]')].map(x=>x.dataset.selectedAssetId)");
 const modifications=report.api.filter(x=>x.url.endsWith('/api/outfits/compose'));
 report.preservedShirt=modifications.length>=2&&modifications[0].result.selected_items.find(x=>x.category==='shirt')?.asset_id===modifications.at(-1).result.selected_items.find(x=>x.category==='shirt')?.asset_id;
 if(!report.preservedShirt)throw new Error('Shirt preservation failed');
 await evaluate("document.querySelectorAll('nav button.l')[2].click()");
 await waitFor("!!document.querySelector('input[type=color]')");
 await evaluate("(()=>{const el=document.querySelector('input[type=color]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'#A07050');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()");
 await evaluate("document.querySelector('.px').click()");
 await waitFor("document.querySelector('[data-dressing-state]')?.dataset.dressingState==='ready'",65000);
 await screenshot('04-skin-tone.png');
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;}
finally{
 await Promise.all([...bodyTasks]);
 // Never persist per-design approval capabilities from the handoff response.
 for(const entry of report.api){if(entry.result?.approval_secret)delete entry.result.approval_secret;if(entry.result?.code)entry.result.code='[redacted]';}
 fs.writeFileSync(path.join(folder,'workflow-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,capability:report.capability,handoffUI:report.handoffUI,mobile:report.mobile,consoleErrors:report.consoleErrors}));ws.close();
}
