import {useEffect,useState} from 'react';
const API=import.meta.env.VITE_ROBI_API_URL||'http://localhost:8000';
type Handoff={design_id:string;version:number;code:string;approval_secret:string;expires_at:number;launch_url:string};
type Claim={state:string;user_id?:number;claim_id?:string};
export default function RobloxHandoff({config,lang,onClose}:{config:unknown;lang:'ar'|'en';onClose:()=>void}) {
 const [handoff,setHandoff]=useState<Handoff>();const [claim,setClaim]=useState<Claim>();
 const [error,setError]=useState('');const [copied,setCopied]=useState(false);const [busy,setBusy]=useState(false);
 const ar=lang==='ar';

 const [username,setUsername]=useState('');
 const [recipient,setRecipient]=useState<{id:number;name:string;display_name?:string}>();
 useEffect(()=>{setHandoff(undefined);setClaim(undefined);},[config]);
 async function lookupRecipient(){
  if(busy)return;setBusy(true);setError('');setRecipient(undefined);
  try{
   const response=await fetch(API+'/api/roblox/recipient',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.trim()})});
   const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Check your Roblox username.');
   setRecipient(data);
  }catch(error){setError(error instanceof Error?error.message:'Lookup failed.');}finally{setBusy(false);}
 }
 async function createHandoff(){
  if(!recipient||busy)return;setBusy(true);setError('');
  try{
   const response=await fetch(API+'/api/designs/launch-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config,recipient_user_id:recipient.id})});
   const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not prepare the design.');
   setHandoff(data);
  }catch(error){setError(error instanceof Error?error.message:'Try again.');}finally{setBusy(false);}
 }
 useEffect(()=>{
  if(!handoff)return;const controller=new AbortController();let active=true;
  const poll=async()=>{
   try{
    const r=await fetch(API+'/api/designs/'+handoff.design_id+'/status',{headers:{'X-Design-Approval':handoff.approval_secret},signal:controller.signal});
    const data=await r.json();if(!r.ok)throw new Error(data.detail||'Handoff status unavailable.');if(active)setClaim(data);
   }catch(e){if(active)setError(e instanceof Error?e.message:'Connection failed.');}
  };
  void poll();const timer=window.setInterval(()=>void poll(),2500);
  return()=>{active=false;clearInterval(timer);controller.abort();};
 },[handoff]);
 async function approve(allowed:boolean) {
  if(!handoff||!claim?.claim_id||busy)return;setBusy(true);setError('');
  try{
   const r=await fetch(API+'/api/designs/'+handoff.design_id+'/approve',{method:'POST',headers:{'Content-Type':'application/json','X-Design-Approval':handoff.approval_secret},body:JSON.stringify({claim_id:claim.claim_id,approve:allowed})});
   const data=await r.json();if(!r.ok)throw new Error(data.detail);setClaim(data);
  }catch(e){setError(e instanceof Error?e.message:'Confirmation failed.');}finally{setBusy(false);}
 }
 return <div className="dl" onClick={onClose}><div role="dialog" aria-modal="true" className="roblox-handoff" onClick={e=>e.stopPropagation()}>
  <h3>{ar?"\u062c\u0631\u0651\u0628\u064a \u0633\u062a\u0627\u064a\u0644\u0643 \u0641\u064a Roblox":'Try your outfit in Roblox'}</h3>
  {error&&<p role="alert">{error}</p>}
  {!handoff&&<><p>{ar?'اختاري حساب Roblox اللي بتدخلين فيه. الرمز بيشتغل لهذا الحساب فقط 🎀':'Choose the Roblox account you will join with. Only that account can use the code.'}</p><label>{ar?'اسم المستخدم في Roblox':'Roblox username'}<input value={username} onChange={event=>{setUsername(event.target.value);setRecipient(undefined);}} autoComplete="off" maxLength={20}/></label><button className="b2" disabled={busy||!username.trim()} onClick={()=>void lookupRecipient()}>{ar?'تحققي من الحساب':'Find account'}</button>{recipient&&<div><p>{recipient.display_name} (@{recipient.name}) · ID {recipient.id}</p><button className="btn" disabled={busy} onClick={()=>void createHandoff()}>{ar?'هذا حسابي، جهزي الرمز':'Confirm this account & prepare code'}</button></div>}{busy&&<p role="status">{ar?'لحظة ونجهز لك كل شيء ✨':'Preparing your design...'}</p>}</>}
  {handoff&&<>
   <p>{ar?"ادخلي Roblox بنفس الحساب واكتبي الرمز هناك. ما تحتاجين ترجعين للموقع.":"Join Roblox with the confirmed account and enter the code there. No return to the website is needed."}</p>
   <output className="handoff-code" dir="ltr">{handoff.code}</output>
   <div className="row"><button className="b2" onClick={()=>void navigator.clipboard.writeText(handoff.code).then(()=>setCopied(true)).catch(()=>setError(ar?"\u0627\u0646\u0633\u062e\u064a \u0627\u0644\u0631\u0645\u0632 \u064a\u062f\u0648\u064a\u0627\u064b":'Copy the code manually'))}>{copied?(ar?"\u062a\u0645 \u0627\u0644\u0646\u0633\u062e":'Copied'):(ar?"\u0646\u0633\u062e \u0627\u0644\u0631\u0645\u0632":'Copy code')}</button><a className="btn" onClick={()=>{void navigator.clipboard.writeText(handoff.code).then(()=>setCopied(true)).catch(()=>setError(ar?'Copy the displayed code manually.':'Copy the displayed code manually.'));}} href={handoff.launch_url} target="_blank" rel="noopener noreferrer">{ar?"انسخي الرمز وافتحي Roblox":'Copy code & open Roblox'}</a></div>
   <small>{ar?"\u064a\u0646\u062a\u0647\u064a \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0633\u0627\u0639\u0629 ":'Code expires at '}{new Date(handoff.expires_at*1000).toLocaleTimeString()}</small>
   {claim?.state==='pending'&&<div className="handoff-confirm"><p>{ar?"\u062a\u0623\u0643\u062f\u064a: \u0647\u0630\u0627 \u062d\u0633\u0627\u0628\u0643 \u0641\u064a Roblox\u061f \u0631\u0642\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 ":'Confirm: is this your Roblox account? User ID '}{claim.user_id}</p><div className="row"><button className="btn" disabled={busy} onClick={()=>void approve(true)}>{ar?"\u0625\u064a\u0647\u060c \u0647\u0630\u0627 \u062d\u0633\u0627\u0628\u064a":'Yes, this is my account'}</button><button className="b2" disabled={busy} onClick={()=>void approve(false)}>{ar?"\u0631\u0641\u0636":'Decline'}</button></div></div>}
   {claim?.state==='approved'&&<p role="status">{ar?"\u062a\u0645 \u0627\u0644\u062a\u0623\u0643\u064a\u062f. \u0627\u0631\u062c\u0639\u064a \u0644\u062a\u062c\u0631\u0628\u0629 Roblox.":'Confirmed. Return to the Roblox experience.'}</p>}
   {claim?.state==='redeemed'&&<p role="status">{ar?"\u0648\u0635\u0644 \u0627\u0644\u062a\u0635\u0645\u064a\u0645 \u0625\u0644\u0649 Roblox. \u0627\u0644\u0634\u0631\u0627\u0621 \u0648\u062d\u0641\u0638 \u0627\u0644\u0633\u062a\u0627\u064a\u0644 \u0648\u0644\u0628\u0633\u0647 \u062a\u062d\u062a\u0627\u062c \u0645\u0648\u0627\u0641\u0642\u062a\u0643 \u0647\u0646\u0627\u0643.":'Design delivered to Roblox. Purchasing, saving an outfit and wearing it each require your confirmation there.'}</p>}
   <small>{ar?"\u0627\u0644\u062a\u062c\u0631\u0628\u0629 \u0627\u0644\u062e\u0627\u0635\u0629 \u062a\u062d\u062a\u0627\u062c \u0625\u0630\u0646 \u062f\u062e\u0648\u0644 \u0645\u0646 \u0635\u0627\u062d\u0628\u0647\u0627.":'A private experience requires access granted by its owner.'}</small>
  </>}
  <button className="b2" onClick={onClose}>{ar?"\u0625\u063a\u0644\u0627\u0642":'Close'}</button>
 </div></div>;
}
