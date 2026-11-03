import { useEffect, useMemo, useRef, useState } from 'react';
import Preview from './Preview';
import AppearanceControls from './AppearanceControls';
import type { DressingResult } from './classicClothing';
import DemoAvatar from './DemoAvatar';
import { emptyConfig, removeItem, setItem } from '../avatarConfig.mjs';

const API = import.meta.env.VITE_ROBI_API_URL || 'http://localhost:8000';
async function fetchWithTimeout(url:string,init:RequestInit,timeoutMs:number,errorMessage:string):Promise<Response>{const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),timeoutMs);try{return await fetch(url,{...init,signal:controller.signal});}catch(error){if(controller.signal.aborted)throw new Error(errorMessage);throw error;}finally{window.clearTimeout(timer);}}
const SLOTS = ['hair','hat','face','faceAccessory','neckAccessory','shouldersAccessory','frontAccessory','backAccessory','waistAccessory','shirt','pants','tshirt','layered'] as const;
const THEMES = ['light','dark','kawaii','midnight','space','racing','saudi','football'] as const;
type Slot = typeof SLOTS[number];
type Theme = typeof THEMES[number];
type Language = 'en' | 'ar';
type CatalogItem = { previewState?:'renderable'|'roblox_only'; assetId: number; name: string; price?: number | null; itemType?: string; assetType?: number; category?: Slot; description?: string; availability?: string; thumbnailUrl?: string; catalogUrl?: string };
type OutfitItem = { slot: Slot; source: 'roblox'; assetId: number; name: string; verified: true; price?: number; itemType?: string; assetType?: number; accessoryType?: string; reason?: string; availability?: string; thumbnailUrl?: string; visual_analysis?: {dominant_colors?:string[]; secondary_colors?:string[]; style?:string; pattern?:string; visible_details?:string[]; confidence?:number} };
type AvatarConfig = Omit<ReturnType<typeof emptyConfig>, 'items'> & { items: OutfitItem[]; bodyColorsOverride?:Record<string,string> };
type Message = { role: 'user' | 'assistant'; content: string; image?: string; id: number };
type ActiveRequirements = { skin_tone?:string|null; intent:'generate_outfit'|'modify_outfit'; avatar_type?:string|null; style:string[];colors:string[];categories:string[];budget_robux:number|null;category_colors:Record<string,string[]>;changed_categories:string[];removed_categories:string[] };
type ApiOutfitItem = {preview_state?:'renderable'|'roblox_only';compatibility_status?:string;asset_id:number;name:string;category:string;asset_type?:number;price?:number|null;item_type?:string;availability?:string;thumbnail_url?:string;catalog_url?:string;description?:string;reason?:string;visual_analysis?:OutfitItem['visual_analysis']};
type ApiOutfitOption = {id:string;name:string;items:ApiOutfitItem[];total_known_price:number;total_price_known:boolean;explanation:string};
type OutfitOption = {id:string;name:string;items:OutfitItem[];totalKnownPrice:number;totalPriceKnown:boolean;explanation:string};
type SavedDesign = { id: number; name: string; date: string; config: AvatarConfig; budget: number };
type PreviewCopy = { classicTShirtUnsupported: string; classicShirtUnsupported: string; classicPantsUnsupported: string; layeredUnsupported: string; accessoryUnsupported: string; assetUnsupported: string };
const SLOT_BY_ASSET_TYPE: Partial<Record<number, Slot>> = { 2:'tshirt', 8:'hat', 11:'shirt', 12:'pants', 18:'face', 41:'hair', 42:'faceAccessory', 43:'neckAccessory', 44:'shouldersAccessory', 45:'frontAccessory', 46:'backAccessory', 47:'waistAccessory' };
const LAYERED_ACCESSORY_TYPE: Record<number, string> = { 64:'TShirt', 65:'Shirt', 66:'Pants', 67:'Jacket', 68:'Sweater', 69:'Shorts', 70:'LeftShoe', 71:'RightShoe', 72:'DressSkirt', 76:'Eyebrow', 77:'Eyelash' };
function categoryForAssetType(assetType?: number): string | undefined {
  if (assetType === 64) return 'layeredTShirt';
  if (assetType === 65) return 'layeredShirt';
  if (assetType === 66) return 'layeredPants';
  if (assetType === 67) return 'layeredJacket';
  if (assetType === 68) return 'layeredSweater';
  if (assetType === 69) return 'layeredShorts';
  if (assetType === 70) return 'layeredLeftShoe';
  if (assetType === 71) return 'layeredRightShoe';
  if (assetType === 72) return 'layeredDressSkirt';
  if (assetType === 76) return 'layeredEyebrow';
  if (assetType === 77) return 'layeredEyelash';
  return assetType === undefined ? undefined : SLOT_BY_ASSET_TYPE[assetType];
}
function slotForAssetType(assetType?: number): Slot | undefined {
  if (assetType === undefined) return undefined;
  return SLOT_BY_ASSET_TYPE[assetType] ?? (LAYERED_ACCESSORY_TYPE[assetType] ? 'layered' : undefined);
}
function previewNotice(assetType: number | undefined, copy: PreviewCopy): string {
  if (assetType === 2) return copy.classicTShirtUnsupported;
  if (assetType === 11) return copy.classicShirtUnsupported;
  if (assetType === 12) return copy.classicPantsUnsupported;
  if (assetType !== undefined && LAYERED_ACCESSORY_TYPE[assetType]) return copy.layeredUnsupported;
  if ([8,41,42,43,44,45,46,47].includes(assetType ?? -1)) return copy.accessoryUnsupported;
  return copy.assetUnsupported;
}
const COPY = {
  en: { tag:'Make Your Avatar You.', studio:'Studio', designs:'My Designs', appearance:'Appearance', explain:'Explain', lang:'العربية', chat:'Chat', fit:'Outfit', hello:'Hi! Describe your dream avatar, for example: a cute Korean girl in pink.', placeholder:'Describe your avatar...', upload:'Upload inspiration', remove:'Remove', send:'Send', mic:'Push to talk', noMic:'Speech input is not supported here. Please type.', listening:'Listening... tap to stop', catalog:'Roblox catalog', search:'Search real catalog items...', searchButton:'Search', slot:'Avatar slot', selected:'Selected outfit', empty:'Describe your avatar and your outfit will appear here.', total:'Known total', budget:'Budget', notRendered:'Selected; not rendered in 3D preview', classicTShirtUnsupported:'Classic T-shirt texture unavailable; not applied', classicShirtUnsupported:'Classic shirt texture unavailable; not applied', classicPantsUnsupported:'Classic pants texture unavailable; not applied', layeredUnsupported:'Layered mesh and cage fitting unavailable; not applied', accessoryUnsupported:'Accessory geometry unavailable; not applied', assetUnsupported:'Asset type unsupported in 3D preview', base:'Undressed R15 base; catalog clothing is not applied', thinking:'Thinking...', imageFailed:'Image analysis failed. The image was not analyzed.', save:'Save design', saved:'Saved in this browser.', noDesigns:'No saved designs yet.', open:'Open', delete:'Delete', idea:'Try a style', try:'Try another style', surprise:'Surprise me', wear:'Try in Roblox', wearHint:'Opens the Experience only; your outfit is not transferred or equipped automatically.', prototype:'Prototype state: there is no real Roblox integration yet.', pastel:'Cute pastel', street:'Streetwear', classic:'Classic style', loading:'Loading...', priceUnknown:'Price unavailable', slotNote:'Choose the matching slot. Compatibility is not verified.', read:'Read message aloud', noResults:'No catalog items found.', error:'Could not connect to ROBI. Check that the backend is running.', previewHelp:'Drag to rotate and scroll to zoom.', removeFirst:'Add an item before saving.', knownOver:'Known prices exceed your budget.', savedLocally:'Saved locally in this browser', chatTab:'Chat', fitTab:'Outfit', analysis:'Image analysis', items:'items', demo:'Demo sample avatar', demoHint:'Send an outfit request to load the skinned R15 avatar.', pa:'Original blocky 3D model, not an actual Roblox avatar', idle:'Idle', walk:'Walk', pose:'Wave', turn:'Turntable', reset:'Reset', preparing:'Loading the undressed R15 base...' , retry:'Retry R15 preview', requestTimeout:'The request timed out. Please try again.', analyzingImage:'Checking your inspiration image...', generating:'Looking for a lovely style...', emptyReply:'ROBI returned an empty reply. Please try again.', generationTimeout:'Outfit search timed out. Please try again.', modelFailed:'The R15 preview could not be loaded.', undressedPreview:'Base R15 only: catalog clothing and accessories are not applied in this 3D preview.', availabilityUnknown:'Availability not returned by Roblox', availabilityAvailable:'Available according to Roblox' },
  ar: { tag:'خلّ أفاتارك يكون أنت.', studio:'الاستوديو', designs:'تصاميمي', appearance:'المظهر', explain:'اشرح لي', lang:'English', chat:'المحادثة', fit:'الإطلالة', hello:'هلاا! أنا روبي 🎀 مساعدتك في تنسيق أفاتارك! وش ودك نلبّسها اليوم؟', placeholder:'اكتب وصف أفاتارك...', upload:'ارفع صورة', remove:'إزالة', send:'إرسال', mic:'تحدث', noMic:'الإملاء الصوتي غير مدعوم هنا. اكتب رسالتك.', listening:'أستمع إليك... اضغط للإيقاف', catalog:'كتالوج Roblox', search:'ابحث في الكتالوج الحقيقي...', searchButton:'بحث', slot:'الخانة', selected:'العناصر المختارة', empty:'ابدأ بوصف أفاتارك وراح تظهر القطع هنا.', total:'المجموع المعروف', budget:'الميزانية', notRendered:'تم الاختيار؛ غير معروض ثلاثي الأبعاد', classicTShirtUnsupported:'نسيج القميص الكلاسيكي غير متاح؛ لم يُطبّق', classicShirtUnsupported:'نسيج القميص غير متاح؛ لم يُطبّق', classicPantsUnsupported:'نسيج البنطال غير متاح؛ لم يُطبّق', layeredUnsupported:'هندسة الملابس وملاءمتها غير متاحة؛ لم تُطبّق', accessoryUnsupported:'مجسم الإكسسوار غير متاح؛ لم يُطبّق', assetUnsupported:'نوع العنصر غير مدعوم في المعاينة ثلاثية الأبعاد', base:'هيكل R15 أساسي؛ الملابس ما تطبّقت', thinking:'جارٍ التفكير...', imageFailed:'تعذر تحليل الصورة. لم يتم تحليلها.', save:'احفظ', saved:'تم الحفظ في هذا المتصفح.', noDesigns:'لا توجد تصاميم محفوظة بعد.', open:'فتح', delete:'حذف', idea:'اختر أسلوباً', try:'غيّر الستايل', surprise:'فاجئني', wear:'لبّسني في Roblox', wearHint:'يفتح الاستوديو فقط؛ ما ينقل الإطلالة ولا يلبّسها تلقائيًا.', prototype:'نموذج تجريبي: ما فيه ربط حقيقي مع Roblox حاليًا.', pastel:'ألوان باستيل', street:'ملابس الشارع', classic:'أسلوب كلاسيكي', loading:'جارٍ التحميل...', priceUnknown:'السعر غير متاح', slotNote:'اختر الخانة المطابقة. التوافق غير متحقق.', read:'اقرأ الرسالة', noResults:'لم يتم العثور على عناصر.', error:'تعذر الاتصال بـ ROBI. تحقق من تشغيل الخادم.', previewHelp:'اسحب للتدوير واستخدم عجلة الفأرة للتقريب.', removeFirst:'أضف عنصراً قبل الحفظ.', knownOver:'الأسعار المعروفة تتجاوز الميزانية.', savedLocally:'محفوظ محلياً في هذا المتصفح', chatTab:'المحادثة', fitTab:'الأفاتار', pa:'نموذج ثلاثي الأبعاد أصلي بمكعبات وليس أفاتار Roblox حقيقياً', idle:'وقفة', walk:'مشي', pose:'تحية', turn:'دوران', reset:'إعادة', requestTimeout:'انتهت مهلة الاتصال. جربي مرة ثانية.', analyzingImage:'أشوف تفاصيل الصورة...', generating:'أدور لك على أحلى ستايل... ✨', emptyReply:'ما وصلني رد واضح. جربي مرة ثانية.', generationTimeout:'تأخر البحث عن الإطلالة. جربي مرة ثانية.', modelFailed:'ما قدرت أحمل معاينة R15.', undressedPreview:'هذي معاينة R15 الأساسية فقط؛ الملابس والإكسسوارات المختارة ما تطبّقت عليها.' }
};
const THEME_NAME: Record<Theme,string> = { light:'Soft lavender', dark:'Deep purple', kawaii:'Kawaii', midnight:'Midnight', space:'Space', racing:'Racing', saudi:'Saudi', football:'Football' };
const THEME_PALETTE: Record<Theme,string[]> = { light:['#FAF9FC','#7f61ee','#e5dff5'], dark:['#191923','#9275FF','#34344a'], kawaii:['#FFF8F3','#8a6cf0','#f7dde9'], midnight:['#0b0b0e','#cfc8f5','#26262e'], space:['#0a0e24','#8f7bff','#2a3166'], racing:['#f3f4f7','#d10b0b','#dfe2ea'], saudi:['#fbf6ec','#006c35','#e8dcc0'], football:['#f2faf3','#17803a','#d4e8d6'] };
function Icon({ name, size = 18 }: {name:string; size?:number}) {
  const paths:Record<string,string> = {external:'<path d="M15 3h6v6M21 3l-9 9M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 5 0c0 1.5-2.5 2-2.5 4M12 17h.01"/>',dice:'<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="12" cy="12" r="1"/>',save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',replay:'<path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/>',idle:'<circle cx="12" cy="5" r="2"/><path d="M12 8v7M8 11h8M10 21l2-6 2 6"/>',walk:'<circle cx="13" cy="4" r="2"/><path d="M7 21l3-7 3 2 2 5M10 14l-1-5 4-1 3 3"/>',pose:'<path d="M7 11V6a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3l-3-4a1.5 1.5 0 0 1 2.5-1.7L7 16"/>', cube:'<path d="m3 7 9-5 9 5v10l-9 5-9-5z"/><path d="m3 7 9 5 9-5M12 12v10"/>', list:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>', palette:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18"/>', globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18"/>', mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>', image:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1"/><path d="m21 15-5-5L5 20"/>', send:'<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>', remove:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>', plus:'<path d="M12 5v14M5 12h14"/>', refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7 7 0 0 1 12-2M7 17a7 7 0 0 0 12-2"/>', shirt:'<path d="m8 3-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0Z"/>' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{__html:paths[name] || ''}}/>;
}
function Mascot({size=44}:{size?:number}) { return <div className="mas" style={{width:size}} aria-hidden="true"><svg viewBox="0 0 64 64"><path d="m32 3 3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z" fill="#FF91BD"/><rect x="9" y="18" width="46" height="40" rx="11" fill="#9275FF"/><rect x="9" y="18" width="46" height="9" rx="6" fill="#C5B3FF"/><g className="ey"><rect x="19" y="33" width="9" height="11" rx="4" fill="white"/><rect x="36" y="33" width="9" height="11" rx="4" fill="white"/><circle cx="24" cy="39" r="3"/><circle cx="41" cy="39" r="3"/></g><ellipse cx="17" cy="48" rx="4" ry="2.5" fill="#FF91BD"/><ellipse cx="47" cy="48" rx="4" ry="2.5" fill="#FF91BD"/><path d="M28 50q4 3 8 0" stroke="#191923" strokeWidth="2" fill="none"/></svg></div>; }
function Logo() { return <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 35 11v18l-15 8L5 29V11z" fill="#9275FF"/><path d="m20 3 15 8-15 8L5 11z" fill="#C5B3FF"/><path d="M20 19v18L5 29V11z" fill="#7d60f0"/><circle cx="27" cy="27" r="3" fill="#FF91BD"/></svg>; }
function loadDesigns():SavedDesign[] { try { return JSON.parse(localStorage.getItem('robi-designs') || '[]') as SavedDesign[]; } catch { return []; } }
function summaryAnalysis(value:Record<string,unknown>) { return Object.entries(value).map(pair => pair[0].replace(/_/g,' ') + ': ' + (Array.isArray(pair[1]) ? pair[1].join(', ') : String(pair[1]))).join('\n'); }

export default function App() {
  const [lang,setLang] = useState<Language>(() => localStorage.getItem('robi-lang') === 'en' ? 'en' : 'ar');
  const [theme,setTheme] = useState<Theme>(() => THEMES.includes(localStorage.getItem('robi-theme') as Theme) ? localStorage.getItem('robi-theme') as Theme : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const [themeOpen,setThemeOpen] = useState(false);
  const [page,setPage] = useState<'studio'|'designs'>('studio');
  const [mobileTab,setMobileTab] = useState<'chat'|'fit'>('chat');
  const [previewRequested,setPreviewRequested] = useState(false);
  const [dressing,setDressing]=useState<DressingResult>({state:'idle',appliedIds:[],unsupportedIds:[],errors:[]});
  const [modelStatus,setModelStatus] = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [generationPending,setGenerationPending] = useState(false);
  const [previewKey,setPreviewKey] = useState(0);
  const [demoMode,setDemoMode] = useState<'idle'|'walk'|'pose'>('idle');
  const [turntable,setTurntable] = useState(true);
  const [resetKey,setResetKey] = useState(0);
  const [messages,setMessages] = useState<Message[]>([]);
  const [input,setInput] = useState('');
  const [chatBusy,setChatBusy] = useState(false);
  const [status,setStatus] = useState('');
  const [catalogQuery,setCatalogQuery] = useState('');
  const [catalogResults,setCatalogResults] = useState<CatalogItem[]>([]);
  const [catalogBusy,setCatalogBusy] = useState(false);
  const [catalogOpen,setCatalogOpen] = useState(false);
  const [slotByAsset,setSlotByAsset] = useState<Record<number,Slot>>({});
  const [config,setConfig] = useState<AvatarConfig>(() => emptyConfig() as AvatarConfig);
  const [budget,setBudget] = useState(500);
  const [analysis,setAnalysis] = useState<Record<string,unknown>|null>(null);
  const [activeRequirements,setActiveRequirements] = useState<ActiveRequirements|null>(null);
  const [outfitOptions,setOutfitOptions] = useState<OutfitOption[]>([]);
  const [selectedOptionId,setSelectedOptionId] = useState('');
  const [imagePreview,setImagePreview] = useState('');
  const [voiceListening,setVoiceListening] = useState(false);
  const [designs,setDesigns] = useState<SavedDesign[]>(loadDesigns);
  const [notice,setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const speechRef = useRef<any>(null);
  const t = { ...COPY.en, ...COPY[lang], optionsLabel:lang==='ar'?'اختاري ستايلك':'Choose your style',chooseLook:lang==='ar'?'اختاري هذا الستايل':'Choose this outfit',chosenLook:lang==='ar'?'الستايل المختار':'Selected outfit' };

  useEffect(() => { document.documentElement.dataset.theme=theme; document.documentElement.lang=lang; document.documentElement.dir=lang==='ar'?'rtl':'ltr'; localStorage.setItem('robi-theme',theme); localStorage.setItem('robi-lang',lang); },[theme,lang]);
  useEffect(() => { localStorage.setItem('robi-designs',JSON.stringify(designs)); },[designs]);
  useEffect(() => { const container=messagesRef.current; if(container) container.scrollTop=container.scrollHeight; },[messages,chatBusy]);
  useEffect(() => () => { if(imagePreview) URL.revokeObjectURL(imagePreview); },[imagePreview]);
  useEffect(() => () => { speechRef.current?.stop(); },[]);
  const total = useMemo(() => config.items.reduce((sum,item)=>sum+(item.price||0),0),[config.items]);

  function toOutfitItems(items:ApiOutfitItem[]):OutfitItem[] {
    return items.flatMap(item=>{
      const assetId=Number(item.asset_id);
      const slot=slotForAssetType(item.asset_type)||((SLOTS as readonly string[]).includes(item.category)?item.category as Slot:undefined);
      if(!Number.isSafeInteger(assetId)||assetId<=0||!slot)return [];
      return [{slot,source:'roblox',assetId,name:item.name,verified:true,
        ...(typeof item.price==='number'?{price:item.price}:{}),itemType:item.item_type,assetType:item.asset_type,
        availability:item.availability,accessoryType:item.asset_type===undefined?undefined:LAYERED_ACCESSORY_TYPE[item.asset_type],
        reason:item.reason,visual_analysis:item.visual_analysis,thumbnailUrl:item.thumbnail_url}];
    });
  }
  function setSkinTone(color:string) {
    if(!/^#[0-9a-fA-F]{6}$/.test(color))return;
    setConfig(current=>({...current,bodyColors:Object.fromEntries(Object.keys(current.bodyColors).map(key=>[key,color])),bodyColorsOverride:Object.fromEntries(Object.keys(current.bodyColors).map(key=>[key,color]))}));
    setActiveRequirements(current=>current?{...current,skin_tone:color}:current);
    startPreviewRequest();
  }
  function chooseOutfit(option:OutfitOption) {
    setConfig(current=>({...current,items:[...current.items.filter(item=>!['shirt','pants','tshirt','layered'].includes(item.slot)&&!option.items.some(next=>next.slot===item.slot)),...option.items]}));setSelectedOptionId(option.id);
    if(!previewRequested){setPreviewRequested(true);setModelStatus('loading');}
    setDressing({state:'resolving_assets',appliedIds:[],unsupportedIds:[],errors:[]});setNotice('');
  }
  async function ask(question:string, prior:Message[], showUser:boolean, referenceAnalysis?:Record<string,unknown>|null, budgetLimit=budget) {
    const user:Message={role:'user',content:question,id:Date.now()};const thread=showUser?prior.concat(user):prior;
    if(showUser)setMessages(thread);setChatBusy(true);setStatus(t.thinking);
    try {
      const history=prior.slice(-12).map(message=>({role:message.role,content:message.content}));
      const currentItems=config.items.map(item=>({...item,category:categoryForAssetType(item.assetType)||item.slot}));
      const chatResponse=await fetchWithTimeout(API+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,history,active_requirements:activeRequirements,current_items:currentItems,available_options:outfitOptions.map(option=>({id:option.id,name:option.name,asset_ids:option.items.map(item=>item.assetId)})),selected_option_id:selectedOptionId||null})},50000,t.requestTimeout);
      const chatData=await chatResponse.json();
      if(!chatResponse.ok)throw new Error(typeof chatData.detail==='string'?chatData.detail:t.error);
      const nextRequirements=(chatData.requirements||activeRequirements) as ActiveRequirements|null;
      setActiveRequirements(nextRequirements);
      if(nextRequirements?.skin_tone&&nextRequirements.skin_tone!==activeRequirements?.skin_tone)setSkinTone(nextRequirements.skin_tone);
      if(typeof nextRequirements?.budget_robux==='number')setBudget(nextRequirements.budget_robux);
      if(chatData.intent==='select_option'){
        const option=outfitOptions.find(value=>value.id===chatData.option_id);
        if(!option)throw new Error(t.emptyReply);
        chooseOutfit(option);
        setMessages(thread.concat({role:'assistant',content:String(chatData.reply),id:Date.now()+1}));return;
      }
      if(chatData.intent!=='outfit'||chatData.ready!==true){
        const reply=String(chatData.reply||'');if(!reply.trim())throw new Error(t.emptyReply);
        setMessages(thread.concat({role:'assistant',content:reply,id:Date.now()+1}));return;
      }
      setGenerationPending(true);setStatus(t.generating);
      const response=await fetchWithTimeout(API+'/api/outfits/compose',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,budget:nextRequirements?.budget_robux??budgetLimit,requirements:nextRequirements,current_items:currentItems,reference_analysis:referenceAnalysis===undefined?analysis:referenceAnalysis,history:thread.slice(-12).map(message=>({role:message.role,content:message.content}))})},90000,t.generationTimeout);
      const data=await response.json();
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:t.error);
      if(data.requirements)setActiveRequirements(data.requirements as ActiveRequirements);
      const options:OutfitOption[]=Array.isArray(data.outfit_options)?data.outfit_options.filter((option:ApiOutfitOption)=>option.items.every(item=>item.compatibility_status==='renderable')).map((option:ApiOutfitOption)=>({id:option.id,name:option.name,items:toOutfitItems(option.items),totalKnownPrice:option.total_known_price,totalPriceKnown:option.total_price_known,explanation:option.explanation})).filter((option:OutfitOption)=>option.items.length>0):[];
      setOutfitOptions(options);if(config.items.length>0)chooseOutfit(options[0]);else setSelectedOptionId('');
      if(Array.isArray(data.candidates))setCatalogResults([...data.candidates,...(data.discovery_items||[])].map((item:ApiOutfitItem)=>({assetId:item.asset_id,name:item.name,price:item.price,itemType:item.item_type,assetType:item.asset_type,description:item.description,availability:item.availability,thumbnailUrl:item.thumbnail_url,catalogUrl:item.catalog_url,previewState:item.preview_state||(item.compatibility_status==='renderable'?'renderable':'roblox_only')})));
      const reply=String(data.reply||'');if(!reply.trim())throw new Error(t.emptyReply);
      setMessages(thread.concat({role:'assistant',content:reply,id:Date.now()+1}));
    } catch(error) {setMessages(thread.concat({role:'assistant',content:error instanceof Error?error.message:t.error,id:Date.now()+1}));}
    finally {setStatus('');setGenerationPending(false);setChatBusy(false);}
  }
  function send() { const value=input.trim();if(!value||chatBusy)return;const budgetReply=messages[messages.length-1]?.content.match(/budget|\u0645\u064a\u0632\u0627\u0646\u064a/i);const budgetMatch=value.match(/(?:budget|robux|under|below|less than|at most|maximum|\u0645\u064a\u0632\u0627\u0646\u064a|\u0631\u0648\u0628\u0648\u0643\u0633|\u0623\u0642\u0644 \u0645\u0646|\u0627\u0642\u0644 \u0645\u0646)[^\d]{0,16}(\d{1,5})/i)||(budgetReply?value.match(/^\s*(\d{1,5})\s*(?:R\$|robux|\u0631\u0648\u0628\u0648\u0643\u0633)?\s*$/i):null);const nextBudget=budgetMatch?Math.max(0,Math.min(2000,Number(budgetMatch[1]))):budget;if(budgetMatch)setBudget(nextBudget);setInput('');void ask(value,messages,true,undefined,nextBudget); }
  async function searchCatalog(queryText:string=catalogQuery) {
    if(!queryText.trim()||catalogBusy)return;
    setCatalogBusy(true);setNotice('');
    try {
      const response=await fetchWithTimeout(API+'/api/catalog/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({keyword:queryText.trim(),limit:10})},25000,t.requestTimeout);
      const data=await response.json();if(!response.ok)throw new Error(data.detail||t.error);setCatalogResults(data.items||[]);
    } catch(error) {setCatalogResults([]);setNotice(error instanceof Error?error.message:t.error);}
    finally {setCatalogBusy(false);}
  }
  function startPreviewRequest() { if(!previewRequested){setPreviewRequested(true);setModelStatus('loading');} }
  async function requestLook(question:string, prior:Message[], showUser:boolean, referenceAnalysis?:Record<string,unknown>|null, budgetLimit=budget) { await ask(question,prior,showUser,referenceAnalysis,budgetLimit); }
  async function addItem(item:CatalogItem) {
    if(item.previewState==='roblox_only')return;
    try {
      const response=await fetchWithTimeout(API+'/api/avatar/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{assetId:item.assetId,assetType:item.assetType}]})},65000,t.requestTimeout);
      const result=await response.json();
      if(!response.ok||result.items?.[0]?.compatibility_status!=='renderable'){setNotice(result.items?.[0]?.message||'This item cannot currently be previewed.');return;}
      const actual=result.items[0];
      item={...item,name:actual.name,assetType:actual.asset_type,price:actual.price,availability:actual.availability};
    } catch {setNotice('Asset verification failed. Please retry.');return;}

    startPreviewRequest();
    const slot=slotForAssetType(item.assetType)||slotByAsset[item.assetId]||'hair';
    setConfig(current=>setItem({...current,items:current.items.filter(existing=>existing.assetId!==item.assetId)},{slot,source:'roblox',assetId:item.assetId,name:item.name,verified:true,price:item.price??undefined,itemType:item.itemType,assetType:item.assetType,availability:item.availability,accessoryType:item.assetType===undefined?undefined:LAYERED_ACCESSORY_TYPE[item.assetType]}) as AvatarConfig);
  }
  function deleteItem(item:OutfitItem) { setConfig(current=>removeItem(current,item.slot,'r:'+item.assetId) as AvatarConfig); }

  async function upload(file?:File) {
    if(chatBusy||!file||!file.type.startsWith('image/'))return;
    const preview=URL.createObjectURL(file);
    setImagePreview(preview);
    setAnalysis(null);setStatus(t.analyzingImage);
    const form=new FormData();form.append('image',file);
    try {
      const response=await fetchWithTimeout(API+'/api/vision/analyze',{method:'POST',body:form},190000,t.requestTimeout);const data=await response.json();
      if(!response.ok)throw new Error(data.detail||t.imageFailed);
      const result=data.analysis as Record<string,unknown>;setAnalysis(result);
      const summary=summaryAnalysis(result);
      const thread=messages.concat([{role:'user',content:'I uploaded an inspiration image.',id:Date.now()},{role:'assistant',content:t.analysis+':\n'+summary,id:Date.now()+1}]);
      setMessages(thread);setStatus('');await requestLook('Use these vision findings as inspiration for a Roblox avatar. They are not exact catalog matches:\n'+summary,thread,false,result);
    } catch(error) {
      const warning=error instanceof Error?error.message:t.imageFailed;
      setAnalysis(null);setStatus(warning);setGenerationPending(false);
      const thread=messages.concat([{role:'user',content:'I uploaded an inspiration image.',id:Date.now()},{role:'assistant',content:warning+' The image was not analyzed, so no outfit search was started from it. You can retry the upload or send a text request.',id:Date.now()+1}]);
      setMessages(thread);
    }
  }
  function voice() {
    const Recognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
    if(!Recognition){setStatus(t.noMic);return;}
    if(voiceListening){speechRef.current?.stop();setVoiceListening(false);return;}
    const rec=new Recognition();speechRef.current=rec;rec.lang=lang==='ar'?'ar-SA':'en-US';
    rec.onresult=(event:any)=>{setInput(event.results[0][0].transcript);setVoiceListening(false);setStatus('');};
    rec.onerror=()=>{setVoiceListening(false);setStatus(t.noMic);};rec.onend=()=>setVoiceListening(false);
    try{rec.start();setVoiceListening(true);setStatus(t.listening);}catch{setVoiceListening(false);setStatus(t.noMic);}
  }
  function save() {
    if(!config.items.length){setNotice(t.removeFirst);return;}
    setDesigns(old=>[{id:Date.now(),name:t.designs+' '+(old.length+1),date:new Date().toLocaleDateString(lang==='ar'?'ar-SA':'en-US'),config,budget},...old]);
    setNotice(t.saved);
  }
  function removeDesign(id:number){setDesigns(old=>old.filter(item=>item.id!==id));}
  function say(text:string){if(!('speechSynthesis'in window))return;window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang=lang==='ar'?'ar-SA':'en-US';window.speechSynthesis.speak(utterance);}

  function itemLink(item:{assetId:number;itemType?:string}) {
    if(!Number.isSafeInteger(item.assetId)||item.assetId<=0)return null;
    return <a className="b2 item-link" href={'https://www.roblox.com/'+(item.itemType?.toLowerCase()==='bundle'?'bundles/':'catalog/')+item.assetId} target="_blank" rel="noopener noreferrer"><Icon name="external" size={13}/>شوفيها في Roblox</a>;
  }
  function catalogCard(item:CatalogItem) {
    const only=item.previewState!=='renderable';const found=selected(item.assetId);
    return <div className="catalog-result" key={item.assetId} data-preview-state={only?'roblox_only':'renderable'}>
      {item.thumbnailUrl&&<img width={64} height={64} src={item.thumbnailUrl} alt={item.name} loading="lazy"/>}
      <div className="catalog-name"><b>{item.name}</b><small>{price(item)}</small>{only&&<small>{lang==='ar'?'في Roblox فقط — ما تنلبس هنا':'Roblox only — unavailable for website dressing'}</small>}{itemLink(item)}</div>
      <button className="b2 catalog-result-action" disabled={only||!!found} onClick={()=>void addItem(item)}>{only?(lang==='ar'?'Roblox فقط':'Roblox only'):found?'✓':t.chooseLook}</button>
    </div>;
  }

  function price(item:CatalogItem|OutfitItem){return item.availability==='unavailable'?(lang==='ar'?'غير معروض للبيع':'Off sale'):item.price==null?t.priceUnknown:item.price+' R$';}
  const selected=(id:number)=>config.items.find(item=>item.assetId===id);
  const dressingBusy=['resolving_assets','loading_textures','applying_outfit'].includes(dressing.state);
  const dressingLabels:Record<string,string>=lang==='ar'?{
    idle:'معاينة R15 كلاسيكية',resolving_assets:'أجيب خامات ملابسك...',loading_textures:'أجهز ملابسك...',applying_outfit:'ألبس الأفاتار...',ready:'تطبقت القطع المختارة',partially_supported:'بعض القطع تحتاج تجربة داخل Roblox',failed:'ما قدرت أطبق الملابس. جربي مرة ثانية.'
  }:{idle:'Classic R15 preview',resolving_assets:'Resolving real clothing assets...',loading_textures:'Loading clothing textures...',applying_outfit:'Dressing your avatar...',ready:'Selected items applied',partially_supported:'Some items require the Roblox Experience',failed:'Clothing could not be applied. Please retry.'};
  function itemPreviewLabel(item:OutfitItem) {
    if(dressing.appliedIds.includes(item.assetId))return lang==='ar'?'تطبق على المعاينة':'Rendered in website preview';
    if([2,11,12,18,41].includes(item.assetType||0))return lang==='ar'?'معاينة كلاسيكية؛ بانتظار التطبيق':'Supported preview; not yet applied';
    return lang==='ar'?'معاينة دقيقة داخل Roblox فقط':'Accurate try-on in Roblox only';
  }


  return <>
    <nav>
      <div className="logo"><Logo/><span>ROBI<small>{t.tag}</small></span></div>
      <button className={'l '+(page==='studio'?'on':'')} onClick={()=>setPage('studio')}><Icon name="cube"/>{t.studio}</button>
      <button className={'l '+(page==='designs'?'on':'')} onClick={()=>setPage('designs')}><Icon name="list"/>{t.designs}</button>
      <button className={'l '+(themeOpen?'on':'')} onClick={()=>setThemeOpen(!themeOpen)} aria-haspopup="dialog"><Icon name="palette"/>{t.appearance}</button>
      <button className="l" onClick={()=>setStatus(t.previewHelp)}><Icon name="help"/>{t.explain}</button>
      <button className="l" onClick={()=>setLang(lang==='en'?'ar':'en')}><Icon name="globe"/>{t.lang}</button><div className="pf">R</div>
    </nav>
    {themeOpen&&<><button className="px" onClick={()=>setThemeOpen(false)} aria-label="Close"/><div className="pop" role="dialog"><h4>{t.appearance}</h4><AppearanceControls items={config.items} ar={lang==='ar'} onChoose={addItem} onRequest={text=>{setThemeOpen(false);void requestLook(text,messages,true);}} busy={chatBusy}/><label>{lang==="ar"?"لون البشرة":"Skin tone"} <input aria-label="Skin tone" type="color" value={config.bodyColors.head} onChange={event=>setSkinTone(event.target.value)}/></label><div className="pg2">{THEMES.map(key=><button className={'pt '+(theme===key?'on':'')} key={key} onClick={()=>{setTheme(key);setThemeOpen(false);}}><div className="pv" style={{background:THEME_PALETTE[key][0]}}><i style={{flex:1,background:THEME_PALETTE[key][1]}}/><i style={{flex:1,background:THEME_PALETTE[key][2]}}/></div><b>{THEME_NAME[key]}</b>{theme===key&&<span className="ck">✓</span>}</button>)}</div></div></>}
    {catalogOpen&&<div className="dl" onClick={()=>setCatalogOpen(false)}><div className="catalog-modal" role="dialog" aria-modal="true" aria-label={t.catalog} onClick={event=>event.stopPropagation()}>
      <div className="hd"><Icon name="shirt"/><span>{t.catalog}</span><button className="b2" style={{marginInlineStart:'auto'}} onClick={()=>setCatalogOpen(false)} aria-label={t.remove}>×</button></div>
      <small className="slot-note">{t.slotNote}</small>
      <div className="catalog-search"><input type="text" value={catalogQuery} onChange={event=>setCatalogQuery(event.target.value)} onKeyDown={event=>event.key==='Enter'&&void searchCatalog()} placeholder={t.search}/><button className="ic pr" onClick={()=>void searchCatalog()} disabled={catalogBusy} aria-label={t.searchButton}><Icon name="send" size={16}/></button></div>
      <div className="catalog-results">
        {catalogBusy&&<div className="note">{t.loading}</div>}
        {!catalogBusy&&catalogQuery&&catalogResults.length===0&&<div className="note">{t.noResults}</div>}
        {catalogResults.map(catalogCard)}
      </div>
    </div></div>}
    {page==='studio'?<div className="wrap">
      <div className="tabs"><button className={mobileTab==='chat'?'on':''} onClick={()=>setMobileTab('chat')}>{t.chat}</button><button className={mobileTab==='fit'?'on':''} onClick={()=>setMobileTab('fit')}>{t.fit}</button></div>
      <div className="ws">
        <section className={'p '+(mobileTab==='chat'?'on':'')} aria-label={t.chat}>
          <div className="hd"><Mascot/><span>{t.tag}</span></div>
          <div id="msgs" ref={messagesRef} aria-live="polite">
            {messages.length===0&&<div className="m l"><span className="tx">{t.hello}</span><button className="sp" onClick={()=>say(t.hello)} aria-label={t.read}>◖</button></div>}
            {messages.map(message=><div className={'m '+(message.role==='user'?'u':'l')} key={message.id}><span className="tx">{message.image&&<img className="chat-image" src={message.image} alt={t.upload}/>}<span>{message.content}</span></span>{message.role==='assistant'&&<button className="sp" onClick={()=>say(message.content)} aria-label={t.read}>◖</button>}</div>)}
            {chatBusy&&<div className="m l dots"><i/><i/><i/></div>}
          </div>
          <div className="bar" role="status">{status}</div>
          {analysis&&<div className="analysis"><b>Image analysis</b><div>{Object.entries(analysis).filter(([,v])=>v&&(!Array.isArray(v)||v.length)).slice(0,5).map(pair=><span className="tg" key={pair[0]}>{Array.isArray(pair[1])?pair[1].join(', '):String(pair[1])}</span>)}</div></div>}
          {imagePreview&&<div className="drop"><img src={imagePreview} alt={t.upload}/><button className="b2" onClick={()=>{URL.revokeObjectURL(imagePreview);setImagePreview('');setAnalysis(null);}}><Icon name="remove"/>{t.remove}</button></div>}
          <div className="drop"><button className="b2" disabled={chatBusy} onClick={()=>fileRef.current?.click()}><Icon name="image"/>{t.upload}</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event=>void upload(event.target.files?.[0])}/></div>
          <div className="row"><button className={'ic '+(voiceListening?'rec':'')} onClick={voice} aria-label={t.mic}><Icon name="mic" size={21}/></button><input type="text" value={input} onChange={event=>setInput(event.target.value)} onKeyDown={event=>event.key==='Enter'&&send()} placeholder={t.placeholder}/><button className="ic pr" onClick={send} disabled={chatBusy} aria-label={t.send}><Icon name="send" size={20}/></button></div>
        </section>
<div id="center">
  <div className="cap">{previewRequested?dressingLabels[dressing.state]:t.pa}</div>
  {!previewRequested ? <>
    
    <DemoAvatar mode={demoMode} turntable={turntable} resetKey={resetKey}/>
    {generationPending&&<div className="stage-loading" role="status"><span className="sparkle">✦</span><Mascot size={56}/><span className="sparkle second">✧</span><b>{t.generating}</b></div>}
    
  </> : <>
    
    {modelStatus === 'error' ? <div className="model-error"><Mascot size={58}/><p>{t.modelFailed}</p><button className="b2" onClick={()=>{setModelStatus('loading');setPreviewKey(value=>value+1);}}>{t.retry}</button></div> : <Preview key={previewKey} items={config.items} bodyColors={config.bodyColors} onDressing={setDressing} autoRotate={turntable} resetKey={resetKey} onReady={()=>setModelStatus('ready')} onError={()=>setModelStatus('error')}/>}
    {modelStatus==='ready'&&!dressingBusy&&<div className="preview-note" data-dressing-state={dressing.state} data-applied-ids={dressing.appliedIds.join(',')} role="status">{dressingLabels[dressing.state]}{(!config.items.some(item=>item.slot==="hair")||!config.items.some(item=>item.slot==="face"))&&<small>{lang==="ar"?"الشعر والوجه الافتراضيان للمعاينة فقط؛ Roblox يحتفظ بمظهرك إلا إذا اخترت بديلًا.":"Base hair/face are preview defaults only. Roblox keeps yours unless you select replacements."}</small>}{dressing.errors.length>0&&<small>{dressing.errors.join(' ')}</small>}</div>}{modelStatus==='ready'&&dressingBusy&&<div className="stage-loading" role="status"><Mascot size={56}/><b>{dressingLabels[dressing.state]}</b></div>}{modelStatus === 'loading' && <div className="stage-loading"><span className="sparkle">✦</span><Mascot size={56}/><span className="sparkle second">✧</span><b>{t.preparing}</b><small>{t.previewHelp}</small></div>}
  </>}
  <div className="ctl">
    <button className={demoMode==='idle'?'on':''} disabled={previewRequested} onClick={()=>setDemoMode('idle')}><Icon name="idle" size={16}/>{t.idle}</button>
    <button className={demoMode==='walk'?'on':''} disabled={previewRequested} onClick={()=>setDemoMode('walk')}><Icon name="walk" size={16}/>{t.walk}</button>
    <button className={demoMode==='pose'?'on':''} disabled={previewRequested} onClick={()=>setDemoMode('pose')}><Icon name="pose" size={16}/>{t.pose}</button>
    <button className={turntable?'on':''} onClick={()=>setTurntable(value=>!value)}><Icon name="refresh" size={16}/>{t.turn}</button>
    <button onClick={()=>{setTurntable(false);setResetKey(value=>value+1);}}><Icon name="replay" size={16}/>{t.reset}</button>
  </div>
</div>
        <aside className={'p '+(mobileTab==='fit'?'on':'')} aria-label={t.fit}>
          <div className="hd"><span>{t.fit}</span></div>
          <div id="outfit">
            {outfitOptions.length>0&&<div className="outfit-options" aria-label={t.optionsLabel}>
              {outfitOptions.map(option=><article className={'outfit-option '+(selectedOptionId===option.id?'chosen':'')} key={option.id} data-outfit-option={option.id} data-selected={selectedOptionId===option.id}>
                <div className="option-title"><b>{option.name}</b><span>{option.totalKnownPrice} {'R$'}{!option.totalPriceKnown?' + ?':''}</span></div>
                <div className="option-items">{option.items.map(item=><div key={item.assetId} data-asset-id={item.assetId}>{item.thumbnailUrl&&<img src={item.thumbnailUrl} alt={item.name} loading="lazy"/>}<small>{item.name}</small><small>{price(item)}</small>{itemLink(item)}</div>)}</div>
                {option.explanation&&<p>{option.explanation}</p>}
                <button className="b2" disabled={chatBusy||selectedOptionId===option.id&&dressing.state==='ready'&&option.items.every(item=>dressing.appliedIds.includes(item.assetId))} onClick={()=>chooseOutfit(option)}>{selectedOptionId===option.id&&dressing.state==='ready'&&option.items.every(item=>dressing.appliedIds.includes(item.assetId))?t.chosenLook:t.chooseLook}</button>
              </article>)}
            </div>}

            {catalogResults.filter(item=>item.previewState==='roblox_only').length>0&&<div className="roblox-only-items"><h4>{lang==='ar'?'Roblox فقط':'Roblox only'}</h4>{catalogResults.filter(item=>item.previewState==='roblox_only').map(catalogCard)}</div>}
            {config.items.length===0
              ? <div className="empty-outfit"><Mascot size={60}/><p>{outfitOptions.length?t.chooseLook:t.empty}</p></div>
              : <>{config.items.map(item=><div className="it" key={item.assetId} data-selected-asset-id={item.assetId}>
                  <div className="th">{item.thumbnailUrl?<img src={item.thumbnailUrl} alt={item.name}/>:<span>◇</span>}</div>
                  <div><b>{item.name}</b><br/><small>{item.slot} · Asset {item.assetId}</small>{item.availability==='unknown'&&<><br/><small>{t.availabilityUnknown}</small></>}<br/><small className="unrendered">{itemPreviewLabel(item)}</small>{item.reason&&<><br/><small>{item.reason}</small></>}<br/><small>{price(item)}</small>{itemLink(item)}</div>
                  <button className="b2" onClick={()=>deleteItem(item)} aria-label={t.remove}><Icon name="remove" size={16}/></button>
                </div>)}
                <div className="tot"><span>{t.total}</span><span>{total} R$</span></div>
                {total>budget&&<div className="warning">{t.knownOver}</div>}
              </>}
          </div>
          <div className="row outfit-actions"><button className="b2" onClick={()=>setCatalogOpen(true)}><Icon name="plus"/>{lang==='ar'?'\u0627\u0644\u0643\u062a\u0627\u0644\u0648\u062c':'Catalog'}</button>
            <button className="b2" onClick={()=>void requestLook(lang==='ar'?'\u0623\u0628\u064a \u0633\u062a\u0627\u064a\u0644 \u0645\u062e\u062a\u0644\u0641 \u0628\u0646\u0641\u0633 \u0627\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629 \u0648\u0627\u0644\u062a\u0641\u0636\u064a\u0644\u0627\u062a':'Generate a different outfit with my current budget and preferences',messages,true)} disabled={chatBusy}><Icon name="refresh"/>{t.try}</button>
            <button className="b2" onClick={()=>void requestLook('Surprise me with a complete avatar outfit.',messages,true)} disabled={chatBusy}><Icon name="dice"/>{t.surprise}</button>
            <button className="b2" onClick={save}><Icon name="save"/>{t.save}</button>
          </div>
          {notice&&<div className="note" role="status">{notice}</div>}
          <a className="btn" style={{marginTop:8}} href="https://www.roblox.com/games/137572714213370" target="_blank" rel="noopener noreferrer">{t.wear}</a>
          <div className="hint">{t.wearHint}</div>
        </aside>
      </div>
    </div>:<div className="wrap designs-page"><h2><Icon name="list" size={28}/>{t.designs}</h2>{designs.length?<div className="gal">{designs.map(design=><article className="p design-card" key={design.id}><div className="design-mark"><Mascot size={56}/></div><h3>{design.name}</h3><p>{design.config.items.length} {t.items} · {design.date}</p><div>{design.config.items.map(item=><div key={item.assetId}><span>{item.name}</span> {itemLink(item)}</div>)}</div><div className="row"><button className="b2" onClick={()=>{setConfig(design.config);setBudget(design.budget);setPage('studio');setPreviewRequested(true);setModelStatus('loading');setPreviewKey(value=>value+1);}}><Icon name="list"/>{t.open}</button><button className="b2" onClick={()=>setDesigns(old=>old.filter(value=>value.id!==design.id))}><Icon name="remove"/>{t.delete}</button></div></article>)}</div>:<div className="p empty-designs"><Mascot size={80}/><p>{t.noDesigns}</p><small>{t.savedLocally}</small><button className="btn" onClick={()=>setPage('studio')}>{t.studio}</button></div>}</div>}
  </>;
  function removeItemFromConfig(item:OutfitItem) { setConfig(current=>removeItem(current,item.slot,'r:'+item.assetId) as AvatarConfig); }
}
