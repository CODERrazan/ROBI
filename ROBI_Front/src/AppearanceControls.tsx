import {useState} from 'react';
type Item={assetId:number;assetType?:number;name:string;slot?:string};
export default function AppearanceControls({items,ar,onChoose,onRequest,busy}:{items:Item[];ar:boolean;onChoose:(item:Item)=>Promise<void>;onRequest:(text:string)=>void;busy:boolean}) {
 const [loading,setLoading]=useState(false);
 const hair=items.find(item=>item.slot==='hair'),face=items.find(item=>item.slot==='face');
 async function choose(assetId:number,assetType:number){setLoading(true);try{await onChoose({assetId,assetType,name:''});}finally{setLoading(false);}}
 return <div className="appearance-controls">
 <label>{ar?'تسريحة الشعر':'Hair style'}<select aria-label="Hair style" disabled={loading||busy} value={hair?.assetId||''} onChange={e=>void choose(Number(e.target.value),41)}>
 <option value="" disabled>{ar?'الشعر الافتراضي للمعاينة':'Preview default hair'}</option>
 {hair&&![63690008,12980879256].includes(hair.assetId)&&<option value={hair.assetId}>{hair.name}</option>}
 <option value={63690008}>{ar?'قصير — Pal Hair':'Short — Pal Hair'}</option><option value={12980879256} disabled>{ar?'طويل بني — غير متوافق مع الرأس الحالي':'Long brown — incompatible with this head'}</option></select></label>
 <label>{ar?'لون الشعر — بحث عن قطعة حقيقية':'Hair color — find a real item'}<select aria-label="Find hair color" value="" disabled={loading||busy} onChange={e=>onRequest(ar?'غيري لون الشعر إلى '+e.target.value+' وحافظي على باقي الإطلالة':'Change only my hair color to '+e.target.value+'; preserve everything else')}>
 <option value="" disabled>{ar?'اختاري لون للبحث':'Choose a color to search'}</option>{(ar?['أسود','بني','أشقر','وردي']:['black','brown','blonde','pink']).map(color=><option key={color}>{color}</option>)}</select></label>
 <label>{ar?'الوجه':'Face'}<select aria-label="Face style" disabled={loading||busy} value={face?.assetId||''} onChange={e=>void choose(Number(e.target.value),18)}><option value="" disabled>{ar?'الوجه الافتراضي للمعاينة':'Preview default face'}</option>{face&&![7074764,144075659].includes(face.assetId)&&<option value={face.assetId}>{face.name}</option>}<option value={7074764}>Chill</option><option value={144075659}>Smile</option></select></label>
 <small>{ar?'الاختيارات تتحقق من Roblox قبل إضافتها. الوجه والشعر الافتراضيان للمعاينة فقط؛ اختيار قطعة يضيفها للإطلالة بسعرها الحالي إن توفر.':'Items are checked with Roblox before selection. Defaults are preview-only; choosing an item adds it to the outfit with its current price when available.'}</small>
 <small>{ar?'المكياج وإكسسوارات الوجه: المعاينة غير مدعومة حاليًا؛ ما نضيف قطع وهمية.':'Makeup and face accessories cannot currently be previewed; no simulated items are applied.'}</small>
 {loading&&<p role="status">{ar?'أجهز لك المظهر 🎀':'Checking appearance…'}</p>}
 </div>;
}
