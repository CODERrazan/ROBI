import * as THREE from 'three';

export type DressingState = 'idle'|'resolving_assets'|'loading_textures'|'applying_outfit'|'ready'|'partially_supported'|'failed';
export type DressingResult = {state:DressingState;appliedIds:number[];unsupportedIds:number[];errors:string[]};
export type DressingItem = {assetId:number;assetType?:number;name:string;slot:string};
type Mapping = {position:number[][];uv:number[][];faces:number[][]};
type Resolved = {asset_id:number;asset_type:number;resolution_status:string;texture_url?:string;geometry_url?:string;render_kind?:string;message?:string};
type BodyColors = Record<string,string>;
const API=import.meta.env.VITE_ROBI_API_URL||'http://localhost:8000';
// Verified catalog assets used only as base-preview appearance, never silently added to the outfit or handoff.
const BASE_APPEARANCE=[{assetId:63690008,assetType:41},{assetId:7074764,assetType:18}];
let defaultAppearance:Promise<Resolved[]>|undefined;
let mappings:Promise<Record<string,Mapping>>|undefined;
const imageCache=new Map<string,Promise<HTMLImageElement>>();
function loadImage(url:string) {
  let task=imageCache.get(url);
  if(!task) {
    task=new Promise<HTMLImageElement>((resolve,reject)=>{
      const image=new Image();image.crossOrigin='anonymous';
      const timer=window.setTimeout(()=>{image.onload=null;image.onerror=null;imageCache.delete(url);reject(new Error('The clothing texture request timed out.'));},25000);
      image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);imageCache.delete(url);reject(new Error('The clothing texture could not be loaded.'));};
      image.src=API+url;
    });
    imageCache.set(url,task);
    if(imageCache.size>32)imageCache.delete(imageCache.keys().next().value!);
  }
  return task;
}

// Rasterize Roblox's native compositor triangles. Source is the real template;
// output is the per-body-region texture used by the native R15 mesh UVs.
function drawTemplate(ctx:CanvasRenderingContext2D,image:HTMLImageElement,map:Mapping,height:number) {
  for(const face of map.faces) {
    const s=face.map(i=>[map.uv[i][0]*image.width,map.uv[i][1]*image.height]);
    const d=face.map(i=>[map.position[i][0],height-map.position[i][1]]);
    const sx1=s[1][0]-s[0][0],sy1=s[1][1]-s[0][1],sx2=s[2][0]-s[0][0],sy2=s[2][1]-s[0][1];
    const determinant=sx1*sy2-sx2*sy1;if(Math.abs(determinant)<1e-8)continue;
    const dx1=d[1][0]-d[0][0],dy1=d[1][1]-d[0][1],dx2=d[2][0]-d[0][0],dy2=d[2][1]-d[0][1];
    const a=(dx1*sy2-dx2*sy1)/determinant,c=(sx1*dx2-sx2*dx1)/determinant;
    const b=(dy1*sy2-dy2*sy1)/determinant,e=(sx1*dy2-sx2*dy1)/determinant;
    // Expand raster coverage half a pixel to avoid antialiased triangle cracks.
    const center=[(d[0][0]+d[1][0]+d[2][0])/3,(d[0][1]+d[1][1]+d[2][1])/3];
    const clip=d.map(p=>{const x=p[0]-center[0],y=p[1]-center[1],n=Math.hypot(x,y)||1;return [p[0]+.6*x/n,p[1]+.6*y/n];});
    ctx.save();ctx.beginPath();ctx.moveTo(...clip[0] as [number,number]);ctx.lineTo(...clip[1] as [number,number]);ctx.lineTo(...clip[2] as [number,number]);ctx.closePath();ctx.clip();
    ctx.setTransform(a,b,c,e,d[0][0]-a*s[0][0]-c*s[0][1],d[0][1]-b*s[0][0]-e*s[0][1]);
    ctx.drawImage(image,0,0);ctx.restore();
  }
}

export class ClassicDresser {
  private rigid=new Map<number,THREE.Mesh>();
  private generation=0;
  private disposed=false;
  private materials=new Map<string,THREE.MeshStandardMaterial[]>();
  private textures=new Map<string,{key:string;texture:THREE.CanvasTexture}>();
  private controller:AbortController|undefined;
  constructor(private model:THREE.Object3D,private report:(result:DressingResult)=>void) {
    const replaced=new Set<THREE.Material>();
    model.traverse(object=>{
      if(!(object instanceof THREE.Mesh))return;
      const region=object.userData.bodyRegion as string;
      if(!region)return;
      for(const original of Array.isArray(object.material)?object.material:[object.material])replaced.add(original);
      const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85});
      object.material=material;
      this.materials.set(region,[...(this.materials.get(region)||[]),material]);
    });
    for(const material of replaced)material.dispose();
  }
  async apply(items:DressingItem[],colors:BodyColors) {
    const generation=++this.generation;this.controller?.abort();this.controller=new AbortController();const controller=this.controller;
    const current=()=>!this.disposed&&generation===this.generation;
    const emit=(state:DressingState,appliedIds:number[]=[],unsupportedIds:number[]=[],errors:string[]=[])=>{if(current())this.report({state,appliedIds,unsupportedIds,errors});};
    const timeout=window.setTimeout(()=>controller.abort(),65000);
    try {
      emit(items.length?'resolving_assets':'idle');
      let rows:Resolved[]=[];
      if(items.length){
        const r=await fetch(API+'/api/avatar/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items.map(i=>({assetId:i.assetId,assetType:i.assetType}))}),signal:this.controller.signal});
        const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==='string'?data.detail:'Clothing assets could not be resolved.');
        rows=data.items;
      }
      const selectedIds=new Set(items.map(item=>item.assetId));
      const selectedTypes=new Set(items.map(item=>item.assetType));
      let defaultError='';
      if(!selectedTypes.has(41)||!selectedTypes.has(18)){
      defaultAppearance??=fetch(API+'/api/avatar/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:BASE_APPEARANCE})}).then(async response=>{if(!response.ok)throw new Error('Base appearance unavailable.');return (await response.json()).items as Resolved[];}).catch(error=>{defaultAppearance=undefined;throw error;});
      try {
        const defaults=await defaultAppearance;
        const needed=defaults.filter(item=>!selectedTypes.has(item.asset_type));
        rows.push(...needed.filter(item=>item.resolution_status==='resolved'));
        if(needed.some(item=>item.resolution_status!=='resolved')){defaultAppearance=undefined;defaultError='Base appearance could not be loaded; selected outfit items are checked separately.';}
      } catch { defaultError='Base appearance could not be loaded; selected outfit items are checked separately.'; }
      }
      if(!current())return;
      emit('loading_textures');
      mappings??=fetch('/ClassicUV.json').then(r=>{if(!r.ok)throw new Error('Native R15 UV mappings unavailable.');return r.json();}).catch(e=>{mappings=undefined;throw e;});
      const maps=await mappings;const loaded=new Map<number,HTMLImageElement>();const loadedById=new Map<number,HTMLImageElement>();
      const errors=rows.filter(i=>i.resolution_status==='failed').map(i=>i.message||'Asset retrieval failed.');if(defaultError)errors.push(defaultError);
      await Promise.all(rows.filter(i=>i.resolution_status==='resolved'&&i.texture_url).map(async item=>{
        try{const image=await loadImage(item.texture_url!);loaded.set(item.asset_type,image);loadedById.set(item.asset_id,image);}
        catch(error){errors.push(error instanceof Error?error.message:'Texture failed');item.resolution_status='failed';}
      }));
      if(!current())return;
      emit('applying_outfit');
      const regionColor:Record<string,string>={Torso:colors.torso,LeftArm:colors.leftArm,RightArm:colors.rightArm,LeftLeg:colors.leftLeg,RightLeg:colors.rightLeg,Head:colors.head};
      for(const [region,materials] of this.materials) {
        const types=region==='Head'?[18]:region==='Torso'?[12,11,2]:region.endsWith('Arm')?[11]:region.endsWith('Leg')?[12]:[];
        const key=JSON.stringify([regionColor[region],...types.map(t=>loaded.has(t)?rows.find(i=>i.asset_type===t)?.texture_url:null)]);
        if(this.textures.get(region)?.key===key)continue;
        const canvas=document.createElement('canvas');canvas.width=region==='Head'?512:region==='Torso'?388:264;canvas.height=region==='Head'?512:region==='Torso'?272:284;
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas texture rendering unavailable.');
        ctx.fillStyle=regionColor[region]||'#E8B590';ctx.fillRect(0,0,canvas.width,canvas.height);
        for(const type of types) {
          const image=loaded.get(type);if(!image)continue;
          if(type===18){ctx.drawImage(image,0,0,canvas.width,canvas.height);ctx.fillStyle=regionColor[region]||"#E8B590";ctx.fillRect(0,0,2,2);}
          else if(type===2)ctx.drawImage(image,2,74,128,128);
          else drawTemplate(ctx,image,maps[region==='Torso'?'R15CompositTorsoBase':region.startsWith('Left')?'R15CompositLeftArmBase':'R15CompositRightArmBase'],canvas.height);
        }
        const texture=new THREE.CanvasTexture(canvas);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
        for(const material of materials){material.map=texture;material.color.set(0xffffff);material.needsUpdate=true;}
        this.textures.get(region)?.texture.dispose();this.textures.set(region,{key,texture});
      }
      const desired=new Set(rows.filter(row=>row.render_kind==='rigid'&&row.resolution_status==='resolved').map(row=>row.asset_id));
      for(const [id,object] of this.rigid)if(!desired.has(id)){this.releaseRigid(object);this.rigid.delete(id);}
      for(const row of rows.filter(row=>row.render_kind==='rigid'&&row.resolution_status==='resolved')) {
        if(this.rigid.has(row.asset_id))continue;
        try {
          const response=await fetch(API+row.geometry_url,{signal:controller.signal});
          if(!response.ok)throw new Error('Accessory geometry unavailable.');
          const data=await response.json();
          if(!current())return;
          const bone=this.model.getObjectByName(data.body_bone);
          const image=loadedById.get(row.asset_id);
          if(!bone||!image)throw new Error('Accessory attachment or texture unavailable.');
          const geometry=new THREE.BufferGeometry();
          geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.position.flat(),3));
          geometry.setAttribute('normal',new THREE.Float32BufferAttribute(data.normal.flat(),3));
          geometry.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv.flat(),2));
          geometry.setIndex(data.indices);
          const texture=new THREE.Texture(image);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
          const material=new THREE.MeshStandardMaterial({map:texture,roughness:.8,alphaTest:.05,color:new THREE.Color().fromArray(data.vertex_color)});
          const object=new THREE.Mesh(geometry,material);object.name='RobloxAsset_'+row.asset_id;
          const r=data.attachment_frame.rotation,p=data.attachment_frame.position;
          const attachment=new THREE.Matrix4().set(r[0],r[1],r[2],p[0],r[3],r[4],r[5],p[1],r[6],r[7],r[8],p[2],0,0,0,1);
          const transform=new THREE.Matrix4().makeTranslation(...data.body_attachment_position as [number,number,number]).multiply(attachment.invert())
            .multiply(new THREE.Matrix4().makeTranslation(...data.offset as [number,number,number]))
            .multiply(new THREE.Matrix4().makeScale(...data.scale as [number,number,number]));
          object.applyMatrix4(transform);bone.add(object);this.rigid.set(row.asset_id,object);
        } catch(error) {
          if(!current())return;
          row.resolution_status='failed';errors.push(error instanceof Error?error.message:'Accessory failed.');
        }
      }
      // Let the viewer submit the new materials before reporting applied state.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      const applied=rows.filter(i=>selectedIds.has(i.asset_id)&&i.resolution_status==='resolved'&&(i.render_kind==='rigid'?this.rigid.has(i.asset_id):loaded.has(i.asset_type))).map(i=>i.asset_id);
      const unsupported=rows.filter(i=>i.resolution_status==='unsupported').map(i=>i.asset_id);
      emit(!items.length?'idle':applied.length===items.length?'ready':applied.length||unsupported.length?'partially_supported':'failed',applied,unsupported,errors);
    } catch(error) {
      if(current()){
        for(const object of this.rigid.values())this.releaseRigid(object);this.rigid.clear();
        for(const materials of this.materials.values())for(const material of materials){material.map=null;material.color.set('#E8B590');material.needsUpdate=true;}
        for(const entry of this.textures.values())entry.texture.dispose();this.textures.clear();
        emit('failed',[],[],[error instanceof Error?error.message:'Dressing failed.']);
      }
    } finally {window.clearTimeout(timeout);}
  }
  private releaseRigid(object:THREE.Mesh){object.removeFromParent();object.geometry.dispose();const material=object.material as THREE.MeshStandardMaterial;material.map?.dispose();material.dispose();}
  dispose(){for(const object of this.rigid.values())this.releaseRigid(object);this.rigid.clear();this.disposed=true;this.generation++;this.controller?.abort();for(const v of this.textures.values())v.texture.dispose();this.textures.clear();}
}

