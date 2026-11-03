
"""Bounded resolution of actual rigid accessories and classic face decals."""
import asyncio, hashlib, json, time, xml.etree.ElementTree as ET
from io import BytesIO
from PIL import Image
from fastapi import HTTPException
from . import roblox_assets as assets
from .roblox_binary import rigid_descriptor, mesh, asset_reference, UnsupportedAsset

GEOMETRY=assets.CACHE.parent/"geometry"
_cache={}
_gate=asyncio.Semaphore(3)
# Native rig attachment frames relative to the corresponding body bone.
ATTACHMENTS={"HairAttachment":("Head",[0,1.100000024,-.000272244]),"HatAttachment":("Head",[0,1.100000024,-.000272244]),"FaceFrontAttachment":("Head",[0,.500000119,-.600272298]),"FaceCenterAttachment":("Head",[0,.500000119,-.000272244])}

async def image_asset(identifier):
    raw,meta=await assets.download_asset(identifier)
    if meta.get("assetTypeId")!=1:raise UnsupportedAsset("Texture reference is not an image asset.")
    try:
        with Image.open(BytesIO(raw)) as im:
            if im.width*im.height>4194304:raise ValueError()
            rgba=im.convert("RGBA");out=BytesIO();rgba.save(out,format="PNG")
            data=out.getvalue();size=rgba.size
    except Exception as exc:raise UnsupportedAsset("Unsupported texture format or size.") from exc
    digest=hashlib.sha256(data).hexdigest();assets.CACHE.mkdir(parents=True,exist_ok=True)
    (assets.CACHE/(digest+".png")).write_bytes(data)
    return {"texture_url":"/api/avatar/textures/"+digest,"texture_sha256":digest,"texture_asset_id":identifier,"width":size[0],"height":size[1]}

async def appearance(item):
    # Browser fit audit: this real mesh clips the native classic head. Do not move
    # it with a per-item offset or claim compatibility with this body profile.
    if item["asset_id"]==12980879256:raise UnsupportedAsset("This hairstyle clips the current classic head; use a different hair item or native Roblox preview.")
    raw,meta=await assets.download_asset(item["asset_id"])
    typ=item["asset_type"]
    if meta.get("assetTypeId")!=typ:raise UnsupportedAsset("Asset type changed during retrieval.")
    if typ==18:
        if len(raw)>1000000 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():raise UnsupportedAsset("Unsupported face format.")
        try:
            root=ET.fromstring(raw);decals=root.findall(".//Item[@class='Decal']")
            if len(decals)!=1:raise ValueError()
            props=decals[0].find("Properties")
            face=props.find("./token[@name='Face']")
            if face is not None and face.text!="5":raise ValueError()
            texture=props.find("./Content[@name='Texture']/url")
            identifier=asset_reference(texture.text)
        except Exception as exc:raise UnsupportedAsset("No supported front-face decal found.") from exc
        image=await image_asset(identifier)
        if image["width"]!=image["height"]:raise UnsupportedAsset("Classic face requires a square texture.")
        return {**image,"resolution_status":"resolved","render_kind":"face"}
    descriptor=rigid_descriptor(raw)
    attachment=descriptor["attachment"]
    if attachment not in ATTACHMENTS:raise UnsupportedAsset("This attachment is not supported by the current preview.")
    geometry_raw,geometry_meta=await assets.download_asset(descriptor["mesh_asset_id"])
    if geometry_meta.get("assetTypeId")!=4:raise UnsupportedAsset("Accessory geometry is not a mesh asset.")
    geometry=mesh(geometry_raw)
    if any(abs(value)>8 for side in geometry["bounds"].values() for value in side) or any((geometry["bounds"]["max"][j]-geometry["bounds"]["min"][j])*descriptor["scale"][j]>8 for j in range(3)):
        raise UnsupportedAsset("Accessory exceeds the supported native body preview bounds.")
    image=await image_asset(descriptor["texture_asset_id"])
    bone,position=ATTACHMENTS[attachment]
    payload={**geometry,**descriptor,"body_bone":bone,"body_attachment_position":position}
    encoded=json.dumps(payload,separators=(",",":"),allow_nan=False).encode()
    digest=hashlib.sha256(encoded).hexdigest();GEOMETRY.mkdir(parents=True,exist_ok=True)
    (GEOMETRY/(digest+".json")).write_bytes(encoded)
    return {**image,"resolution_status":"resolved","render_kind":"rigid","geometry_url":"/api/avatar/geometry/"+digest}

async def compatibility(asset_id,claimed_type=None):
    cached=_cache.get(asset_id)
    if cached and time.monotonic()<cached[0]:
        result=dict(cached[1])
        if claimed_type is not None and result.get("asset_type")!=claimed_type:
            return {**result,"compatibility_status":"invalid","resolution_status":"failed","message":"Catalog asset type mismatch."}
        return result
    async with _gate:
        try:
            item=await assets.details(asset_id)
            if claimed_type is not None and item["asset_type"]!=claimed_type:
                return {**item,"compatibility_status":"invalid","resolution_status":"failed","message":"Catalog asset type mismatch."}
            typ=item["asset_type"]
            if typ in assets.CLASSIC:resolved=await assets.resolve_classic(asset_id,typ)
            elif typ in (18,41):resolved=await appearance(item)
            else:raise UnsupportedAsset("This clothing type requires the native Roblox preview.")
            result={**item,**resolved,"compatibility_status":"renderable","renderer_profile":"native-r15-v3","preview_capability":resolved.get("render_kind","classic_template")}
            ttl=300
        except (UnsupportedAsset,assets.UnsupportedPreview) as exc:
            result={**locals().get("item",{"asset_id":asset_id}),"compatibility_status":"unsupported","resolution_status":"unsupported","message":str(exc.detail) if isinstance(exc,HTTPException) else str(exc)};ttl=300
        except (ValueError,KeyError,IndexError) as exc:
            result={**locals().get("item",{"asset_id":asset_id}),"compatibility_status":"invalid","resolution_status":"failed","message":"The asset contains invalid geometry, references or transforms."};ttl=300
        except Exception as exc:
            status="invalid" if isinstance(exc,HTTPException) and exc.status_code==422 else "temporarily_unavailable"
            result={**locals().get("item",{"asset_id":asset_id}),"compatibility_status":status,"resolution_status":"failed","message":str(exc.detail) if isinstance(exc,HTTPException) else "Asset retrieval failed. Please retry."};ttl=10
    _cache[asset_id]=(time.monotonic()+ttl,result)
    if len(_cache)>1000:_cache.pop(next(iter(_cache)))
    return dict(result)
