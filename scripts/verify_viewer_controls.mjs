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
await send('Runtime.enable');await send('Page.enable');await send('Page.bringToFront');await send('Page.setWebLifecycleState',{state:'active'});await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('nav')");await delay(1500);await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
await evaluate("document.querySelectorAll('nav button.l')[1].click()");
await waitFor("!!document.querySelector('.design-card')");
await evaluate("document.querySelector('.design-card .row button').click()");
await waitFor("!!document.querySelector('.viewer canvas')&&['ready','partially_supported'].includes(document.querySelector('[data-dressing-state]')?.dataset.dressingState)",65000);
await evaluate("document.querySelector('aside')?.removeAttribute('style');document.querySelector('.ctl button:last-child').click()");
await delay(1800);console.log('reset');
const rect=await evaluate("(()=>{const r=document.querySelector('.viewer canvas').getBoundingClientRect();return {x:r.x+60,y:r.y+90,width:r.width-120,height:r.height-240,scale:1}})()");
console.log('rect',rect);
const capture=async()=>{const v=await send('Page.captureScreenshot',{format:'png',clip:rect});return v.data;};
const initial=await capture();console.log('initial');
const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+120,y:y+10,buttons:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+120,y:y+10,button:'left',buttons:0,clickCount:1});
await delay(1400);const rotated=await capture();console.log('rotated');
await evaluate("document.querySelector('.viewer canvas').dispatchEvent(new WheelEvent('wheel',{deltaY:-180,deltaX:0,bubbles:true,cancelable:true}))");await delay(1400);const zoomed=await capture();console.log('zoomed');
await evaluate("document.querySelector('.ctl button:last-child').click()");await delay(1800);const reset=await capture();
report.controls={rotationChanged:initial!==rotated,zoomChanged:rotated!==zoomed,resetChanged:reset!==zoomed,resetExactPixels:reset===initial};
await screenshot('06-final-desktop.png');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(1000);
await screenshot('07-final-mobile.png');
report.mobile=await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,noteBottom:document.querySelector('.preview-note').getBoundingClientRect().bottom,controlsTop:document.querySelector('.ctl').getBoundingClientRect().top})");
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
report.passed=Object.values(report.controls).slice(0,3).every(Boolean)&&report.mobile.noteBottom<report.mobile.controlsTop;
}catch(e){report.error=e.message;report.passed=false;}
finally{fs.writeFileSync(path.join(folder,'controls-browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));ws.close();}
