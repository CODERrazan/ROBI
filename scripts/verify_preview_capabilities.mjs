import fs from 'node:fs';
import path from 'node:path';
const folder=path.resolve('screenshots/real-dressing');fs.mkdirSync(folder,{recursive:true});
const report={method:'Real Edge browser CDP interaction with React UI and live backend; no mocked network',api:[],consoleErrors:[],steps:[]};
const pages=await fetch('http://127.0.0.1:'+(process.env.ROBI_BROWSER_DEBUG_PORT||'9222')+'/json/list').then(r=>r.json());
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
 const r=await fetch('http://127.0.0.1:8000/api/avatar/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{assetId:17331596106,assetType:11},{assetId:9694994699,assetType:12},{assetId:6439158354,assetType:2},{assetId:88305103859479,assetType:67}]})});const resolved=await r.json();if(!r.ok)throw new Error('Resolution failed');
 const old=JSON.parse(await evaluate("localStorage.getItem('robi-designs')||'[]'"));
 const source=old.find(x=>x.name==='Live classic dressing check');
 const config={...source.config,items:resolved.items.map(i=>({slot:i.slot,source:'roblox',assetId:i.asset_id,assetType:i.asset_type,name:i.name,verified:true,price:i.price,availability:i.availability,accessoryType:i.accessory_type}))};
 old.unshift({id:900002,name:'Live graphic and layered capability check',date:'2026-11-03',config,budget:200});
 await evaluate("localStorage.setItem('robi-designs',"+JSON.stringify(JSON.stringify(old))+");");
 await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('nav')");await delay(1400);report.consoleErrors=[];await send('Log.clear');
 await evaluate("document.querySelectorAll('nav button.l')[1].click()");await waitFor("!!document.querySelector('.design-card')");await evaluate("document.querySelector('.design-card .row button').click()");
 await waitFor("document.querySelector('[data-dressing-state]')?.dataset.dressingState==='partially_supported'",65000);await delay(1000);
 report.capability=await evaluate("({state:document.querySelector('[data-dressing-state]').dataset.dressingState,ids:document.querySelector('[data-applied-ids]').dataset.appliedIds})");
 if(!report.capability.ids.includes('6439158354')||report.capability.ids.includes('88305103859479'))throw new Error('Capability state is inaccurate');
 await screenshot('03-graphic-layered-capability.png');
 await evaluate("document.querySelector('aside>.btn').click()");await waitFor("!!document.querySelector('.handoff-code')",30000);
 report.handoffUI=await evaluate("({dialog:!!document.querySelector('.roblox-handoff'),codeVisible:/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(document.querySelector('.handoff-code').textContent),url:document.querySelector('.roblox-handoff a').href})");
 await screenshot('04-roblox-code-handoff.png');
 await evaluate("document.querySelector('.roblox-handoff>button:last-child').click()");
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(1200);
 report.mobile=await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,state:document.querySelector('[data-dressing-state]').dataset.dressingState})");
 await screenshot('05-mobile-preview.png');
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 report.passed=true;
}catch(e){report.passed=false;report.error=e.message;}
finally{
 await Promise.all([...bodyTasks]);
 // Never persist per-design approval capabilities from the handoff response.
 for(const entry of report.api){if(entry.result?.approval_secret)delete entry.result.approval_secret;if(entry.result?.code)entry.result.code='[redacted]';}
 fs.writeFileSync(path.join(folder,'capability-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,error:report.error,capability:report.capability,handoffUI:report.handoffUI,mobile:report.mobile,consoleErrors:report.consoleErrors}));ws.close();
}
