"""Real Roblox classic assets. Never interpret catalog thumbnails as templates."""
from __future__ import annotations
import asyncio, hashlib, os, re, time, xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import httpx
from PIL import Image
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

class UnsupportedPreview(HTTPException):
    def __init__(self,detail):super().__init__(424,detail)

router=APIRouter()
CLASSIC={2:("tshirt","ShirtGraphic","Graphic"),11:("shirt","Shirt","ShirtTemplate"),12:("pants","Pants","PantsTemplate")}
ACCESSORIES={8:("hat","Hat",False),41:("hair","Hair",False),42:("faceAccessory","Face",False),43:("neckAccessory","Neck",False),44:("shouldersAccessory","Shoulder",False),45:("frontAccessory","Front",False),46:("backAccessory","Back",False),47:("waistAccessory","Waist",False),64:("layered","TShirt",True),65:("layered","Shirt",True),66:("layered","Pants",True),67:("layered","Jacket",True),68:("layered","Sweater",True),69:("layered","Shorts",True),70:("layered","LeftShoe",True),71:("layered","RightShoe",True),72:("layered","DressSkirt",True),76:("layered","Eyebrow",True),77:("layered","Eyelash",True)}
CACHE=Path(__file__).resolve().parents[1]/".data"/"textures"
_metadata:dict[int,tuple[float,dict]]={}
_resolved:dict[int,tuple[float,dict]]={}
_LIMIT=6_000_000

def capability(asset_type:int)->str:
    return "classic_template" if asset_type in CLASSIC else "native_only" if asset_type in ACCESSORIES or asset_type==18 else "unsupported"

async def details(asset_id:int, fresh:bool=False)->dict:
    if isinstance(asset_id,bool) or not isinstance(asset_id,int) or not 0<asset_id<2**53:raise HTTPException(422,"Invalid Roblox asset ID.")
    cached=_metadata.get(asset_id)
    if cached and not fresh and time.time()-cached[0]<300:return dict(cached[1])
    try:
        async with httpx.AsyncClient(timeout=15,follow_redirects=False) as c:
            r=await c.get(f"https://economy.roblox.com/v2/assets/{asset_id}/details")
            if r.status_code in (404,410):raise HTTPException(422,"Roblox catalog asset does not exist.")
            r.raise_for_status();v=r.json()
        if v.get("AssetId")!=asset_id or not isinstance(v.get("AssetTypeId"),int):raise ValueError("Asset identity mismatch")
        typ=v["AssetTypeId"];price=v.get("PriceInRobux")
        item={"asset_id":asset_id,"asset_type":typ,"name":v.get("Name",""),"description":str(v.get("Description",""))[:4000],"price":price if type(price) in (int,float) and price>=0 else None,
              "availability":"available" if v.get("IsForSale") is True else "unavailable" if v.get("IsForSale") is False else "unknown",
              "preview_capability":capability(typ)}
        if typ in CLASSIC:item["slot"]=CLASSIC[typ][0]
        elif typ in ACCESSORIES:
            slot,accessory,layered=ACCESSORIES[typ];item.update(slot=slot,accessory_type=accessory,is_layered=layered)
        elif typ==18:item["slot"]="face"
        else:item["slot"]="unsupported"
        _metadata[asset_id]=(time.time(),item)
        if len(_metadata)>1000:_metadata.pop(next(iter(_metadata)))
        return dict(item)
    except HTTPException:raise
    except Exception as e:raise HTTPException(502,"Roblox could not verify this catalog asset.") from e

async def download_asset(asset_id:int)->tuple[bytes,dict]:
    key=os.getenv("ROBLOX_OPEN_CLOUD_API_KEY")
    if not key:raise HTTPException(503,"Roblox Asset Delivery requires the configured Open Cloud key with legacy-asset:manage.")
    async with httpx.AsyncClient(timeout=20,follow_redirects=False) as c:
        r=await c.get(f"https://apis.roblox.com/asset-delivery-api/v1/assetId/{asset_id}",headers={"x-api-key":key})
        if r.status_code in (401,403):raise HTTPException(424,"Roblox denied asset access. Check asset permissions and the existing Open Cloud key scope.")
        if r.status_code!=200:raise HTTPException(424,"Roblox asset is unavailable.")
        meta=r.json()
        if meta.get("isArchived"):raise HTTPException(424,"Roblox asset is archived.")
        url=meta.get("location");p=urlparse(url or "")
        if p.scheme!="https" or not p.hostname or not (p.hostname=="rbxcdn.com" or p.hostname.endswith(".rbxcdn.com")) or p.port not in (None,443):
            raise HTTPException(424,"Roblox did not return a trusted asset content location.")
        # Credentials go only to apis.roblox.com, never to the CDN or a URL from client input.
        async with c.stream("GET",url) as content:
            if content.status_code!=200:raise HTTPException(424,"Roblox asset content could not be downloaded.")
            body=bytearray()
            async for chunk in content.aiter_bytes():
                body.extend(chunk)
                if len(body)>_LIMIT:raise HTTPException(413,"Roblox asset exceeds the preview size limit.")
    return bytes(body),meta

def template_id(raw:bytes,asset_type:int)->int:
    if len(raw)>1_000_000 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():raise UnsupportedPreview("Unsupported clothing asset format.")
    try:
        root=ET.fromstring(raw)
        _,class_name,property_name=CLASSIC[asset_type]
        instances=root.findall(f".//Item[@class='{class_name}']")
        if len(instances)!=1:raise ValueError()
        node=instances[0].find(f"./Properties/Content[@name='{property_name}']/url")
        value=(node.text or "").strip() if node is not None else ""
        if value.startswith("rbxassetid://"):identifier=value[len("rbxassetid://"):]
        else:
            p=urlparse(value)
            if p.scheme not in {"http","https"} or p.hostname not in {"www.roblox.com","roblox.com"} or p.path.rstrip("/")!="/asset":raise ValueError()
            identifier=parse_qs(p.query).get("id",[""])[0]
        if not re.fullmatch(r"[1-9][0-9]{0,15}",identifier):raise ValueError()
        return int(identifier)
    except HTTPException:raise
    except Exception as e:raise UnsupportedPreview("No supported classic clothing template reference was found.") from e

async def resolve_classic(asset_id:int,asset_type:int)->dict:
    cached=_resolved.get(asset_id)
    if cached and time.time()-cached[0]<3600:return dict(cached[1])
    raw,meta=await download_asset(asset_id)
    if meta.get("assetTypeId")!=asset_type:raise HTTPException(424,"Clothing asset type changed during resolution.")
    tid=template_id(raw,asset_type)
    image,image_meta=await download_asset(tid)
    if image_meta.get("assetTypeId")!=1:raise HTTPException(424,"The clothing template is not an image asset.")
    try:
        with Image.open(BytesIO(image)) as im:
            if im.width*im.height>4_194_304:raise ValueError("Texture too large")
            if asset_type in (11,12) and im.size!=(585,559):raise ValueError("Unsupported classic template dimensions")
            if asset_type==2 and im.width!=im.height:raise ValueError("Graphic T-shirt must be square")
            rgba=im.convert("RGBA");out=BytesIO();rgba.save(out,format="PNG");png=out.getvalue()
            width,height=rgba.size
    except Exception as e:raise UnsupportedPreview("The real clothing texture has an unsupported image format or dimensions.") from e
    digest=hashlib.sha256(png).hexdigest();CACHE.mkdir(parents=True,exist_ok=True)
    path=CACHE/(digest+".png")
    if not path.exists():path.write_bytes(png)
    result={"texture_asset_id":tid,"texture_url":f"/api/avatar/textures/{digest}","texture_sha256":digest,"width":width,"height":height,"resolution_status":"resolved"}
    _resolved[asset_id]=(time.time(),result)
    if len(_resolved)>500:_resolved.pop(next(iter(_resolved)))
    return dict(result)

class PreviewItem(BaseModel):
    assetId:int=Field(gt=0,lt=2**53,strict=True)
    assetType:int|None=None
class PreviewRequest(BaseModel):
    items:list[PreviewItem]=Field(min_length=1,max_length=20)

async def verified_items(items:list[dict],fresh:bool=False)->list[dict]:
    ids=[x.get("assetId",x.get("asset_id")) for x in items]
    if len(ids)!=len(set(ids)):raise HTTPException(422,"Duplicate catalog IDs.")
    verified=await asyncio.gather(*(details(i,fresh) for i in ids))
    singles=set();result=[]
    for claimed,item in zip(items,verified):
        typ=claimed.get("assetType",claimed.get("asset_type"))
        if typ is not None and typ!=item["asset_type"]:raise HTTPException(422,"Catalog asset type does not match the selected slot.")
        if item["preview_capability"]=="unsupported":raise HTTPException(422,"Body packages, bundles or this asset type are not supported by the outfit handoff.")
        slot=item["slot"]
        if item.get("is_layered"):
            key="layered:"+item["accessory_type"]
            if key in singles:raise HTTPException(422,"Duplicate layered clothing slot.")
            singles.add(key)
        if slot in {"shirt","pants","tshirt","hair","face"}:
            if slot in singles:raise HTTPException(422,"Only one item may occupy this clothing slot.")
            singles.add(slot)
        result.append({**item,"order":len(result)+1})
    return result

@router.post("/api/avatar/resolve")
async def resolve(q:PreviewRequest):
    items=await verified_items([x.model_dump() for x in q.items])
    from .appearance import compatibility
    return {"rig":"native_classic_r15","items":await asyncio.gather(*(compatibility(i["asset_id"],i["asset_type"]) for i in items))}

@router.get("/api/avatar/geometry/{digest}")
async def geometry(digest:str):
    from .appearance import GEOMETRY
    if not re.fullmatch("[a-f0-9]{64}",digest):raise HTTPException(404)
    p=GEOMETRY/(digest+".json")
    if not p.is_file():raise HTTPException(404,"Geometry expired; resolve the outfit again.")
    return Response(p.read_bytes(),media_type="application/json",headers={"Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff"})

@router.get("/api/avatar/textures/{digest}")
async def texture(digest:str):
    if not re.fullmatch("[a-f0-9]{64}",digest):raise HTTPException(404)
    p=CACHE/(digest+".png")
    if not p.is_file():raise HTTPException(404,"Texture expired; resolve the outfit again.")
    return Response(p.read_bytes(),media_type="image/png",headers={"Cache-Control":"public, max-age=3600","X-Content-Type-Options":"nosniff"})
