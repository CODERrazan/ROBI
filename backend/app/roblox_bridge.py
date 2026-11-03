"""Persistent, one-time Roblox handoff with website-approved account binding."""
from __future__ import annotations
import httpx
import re,hashlib,hmac,json,os,secrets,sqlite3,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from fastapi import APIRouter,Header,HTTPException
from pydantic import BaseModel,Field
from .roblox_assets import verified_items
router=APIRouter()

def database():
    path=Path(os.getenv("ROBI_HANDOFF_DB",str(Path(__file__).resolve().parents[1]/".data"/"handoff.sqlite3")))
    path.parent.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(path,timeout=10,isolation_level=None);db.row_factory=sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS handoffs(
      id TEXT PRIMARY KEY,code_hash TEXT UNIQUE NOT NULL,approval_hash TEXT NOT NULL,version INTEGER NOT NULL,
      payload TEXT NOT NULL,expires INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'created',
      claim_id TEXT,user_id INTEGER,job_id TEXT,claim_expires INTEGER,redeemed_at INTEGER)""")
    db.execute("DELETE FROM handoffs WHERE expires < ?",(int(time.time())-86400,))
    return db
def digest(value:str)->str:return hashlib.sha256(value.encode()).hexdigest()
def bridge_config():
    place=os.getenv("ROBLOX_PLACE_ID","");universe=os.getenv("ROBLOX_UNIVERSE_ID","");url=os.getenv("PUBLIC_BACKEND_URL","").rstrip("/")
    enabled=place.isdigit() and universe.isdigit() and urlparse(url).scheme=="https" and bool(os.getenv("ROBLOX_BRIDGE_SECRET"))
    return {"enabled":enabled,"place_id":place,"universe_id":universe,"public_backend_url":url,"handoff_mode":"recipient_bound_code"}
def authorize(auth:str|None,universe:int):
    secret=os.getenv("ROBLOX_BRIDGE_SECRET")
    if not secret:raise HTTPException(503,"ROBLOX_BRIDGE_SECRET is missing.")
    if not auth or not hmac.compare_digest(auth,"Bearer "+secret):raise HTTPException(401,"Roblox server authentication required.")
    if str(universe)!=os.getenv("ROBLOX_UNIVERSE_ID"):raise HTTPException(403,"Wrong Roblox universe.")
def live_row(db,identifier:str):
    r=db.execute("SELECT * FROM handoffs WHERE id=?",(identifier,)).fetchone()
    if not r:raise HTTPException(404,"Design not found.")
    if r["expires"]<=time.time():raise HTTPException(410,"Design expired. Create a new code on ROBI.")
    return r
def owner(r,secret:str|None):
    if not secret or not hmac.compare_digest(r["approval_hash"],digest(secret)):raise HTTPException(403,"Website approval credential required.")
def claim_identity(r,q):
    if r["claim_id"]!=q.claim_id or r["user_id"]!=q.user_id or r["job_id"]!=q.job_id:raise HTTPException(409,"This claim belongs to another Roblox user or session.")

class Launch(BaseModel):
    config:dict
    recipient_user_id:int|None=Field(default=None,gt=0,strict=True)
class Claim(BaseModel):
    code:str=Field(min_length=12,max_length=16,pattern=r"^[A-Za-z0-9-]+$")
    user_id:int=Field(gt=0,strict=True)
    job_id:str=Field(min_length=1,max_length=128)
    universe_id:int=Field(gt=0,strict=True)
class Redeem(BaseModel):
    design_id:str
    claim_id:str
    user_id:int=Field(gt=0,strict=True)
    job_id:str=Field(min_length=1,max_length=128)
    universe_id:int=Field(gt=0,strict=True)
    version:int=Field(ge=1,strict=True)
class Approval(BaseModel):
    claim_id:str
    approve:bool=True

@router.get("/api/roblox/config")
def config():return bridge_config()

@router.post("/api/designs/launch-token")
async def launch(q:Launch):
    cfg=q.config
    if cfg.get("rigType")!="R15" or cfg.get("version")!=1:raise HTTPException(422,"A version 1 R15 design is required.")
    items=cfg.get("items")
    if not isinstance(items,list) or not 1<=len(items)<=20 or any(not isinstance(i,dict) or i.get("source")!="roblox" for i in items):raise HTTPException(422,"Choose 1-20 real Roblox items.")
    settings=bridge_config()
    if not settings["enabled"]:raise HTTPException(503,"Roblox place, universe, HTTPS backend and bridge secret must be configured.")
    validated=await verified_items(items,fresh=True)
    # Body identity/colors/scales are deliberately not accepted from the browser:
    # Roblox starts from the joining player's native description and replaces slots.
    payload={"version":1,"rigType":"R15","preserve_unrelated":True,"items":validated}
    override=cfg.get("bodyColorsOverride")
    if override is not None:
        keys={"head","torso","leftArm","rightArm","leftLeg","rightLeg"}
        if not isinstance(override,dict) or not set(override)<=keys or any(not isinstance(value,str) or not re.fullmatch(r"#[0-9a-fA-F]{6}",value) for value in override.values()):
            raise HTTPException(422,"Invalid explicit body color override.")
        payload["body_colors"]=override
    if q.recipient_user_id:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response=await client.get(f"https://users.roblox.com/v1/users/{q.recipient_user_id}")
                response.raise_for_status();recipient=response.json()
            if recipient.get("id")!=q.recipient_user_id or recipient.get("isBanned"):raise ValueError()
        except Exception as exc:raise HTTPException(422,"Could not confirm that Roblox account. Check the username and try again.") from exc
        payload["recipient_user_id"]=q.recipient_user_id
    identity=str(uuid.uuid4());code="".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(12));approval=secrets.token_urlsafe(32)
    ttl=max(60,min(900,int(os.getenv("DESIGN_TOKEN_TTL_SECONDS","600"))));expiry=int(time.time())+ttl
    db=database()
    try:db.execute("INSERT INTO handoffs(id,code_hash,approval_hash,version,payload,expires) VALUES(?,?,?,?,?,?)",(identity,digest(code),digest(approval),1,json.dumps(payload,separators=(",",":")),expiry))
    finally:db.close()
    return {"design_id":identity,"version":1,"code":"-".join(code[i:i+4] for i in range(0,12,4)),"approval_secret":approval,"expires_at":expiry,
            "launch_url":f"https://www.roblox.com/games/{settings['place_id']}","handoff_mode":"recipient_bound_code" if q.recipient_user_id else "one_time_code_with_website_confirmation",
            "recipient_user_id":q.recipient_user_id,"items":validated}

@router.get("/api/designs/{design_id}/status")
def status(design_id:str,x_design_approval:str|None=Header(default=None)):
    db=database()
    try:
        r=live_row(db,design_id);owner(r,x_design_approval)
        return {"state":r["state"],"user_id":r["user_id"],"claim_id":r["claim_id"],"expires_at":r["expires"],"version":r["version"]}
    finally:db.close()

@router.post("/api/designs/{design_id}/approve")
def approve(design_id:str,q:Approval,x_design_approval:str|None=Header(default=None)):
    db=database()
    try:
        db.execute("BEGIN IMMEDIATE");r=live_row(db,design_id);owner(r,x_design_approval)
        if r["state"]!="pending" or r["claim_id"]!=q.claim_id or r["claim_expires"]<=time.time():raise HTTPException(409,"The Roblox confirmation request is no longer active.")
        if q.approve:db.execute("UPDATE handoffs SET state='approved' WHERE id=?",(design_id,))
        else:db.execute("UPDATE handoffs SET state='created',claim_id=NULL,user_id=NULL,job_id=NULL,claim_expires=NULL WHERE id=?",(design_id,))
        db.commit();return {"state":"approved" if q.approve else "created"}
    finally:
        if db.in_transaction:db.rollback()
        db.close()

@router.post("/api/designs/claim")
def claim(q:Claim,authorization:str|None=Header(default=None)):
    authorize(authorization,q.universe_id);db=database()
    try:
        db.execute("BEGIN IMMEDIATE")
        r=db.execute("SELECT * FROM handoffs WHERE code_hash=?",(digest(q.code.replace("-","").upper()),)).fetchone()
        if not r:raise HTTPException(404,"Invalid code.")
        live_row(db,r["id"])
        recipient=json.loads(r["payload"]).get("recipient_user_id")
        if recipient and recipient!=q.user_id:raise HTTPException(403,"This code is for a different Roblox account.")
        if r["state"] in {"approved","redeemed"}:
            if r["user_id"]!=q.user_id or r["job_id"]!=q.job_id:raise HTTPException(409,"This design is already bound to another player/session.")
        elif r["state"]=="pending" and r["claim_expires"]>time.time():
            if r["user_id"]!=q.user_id or r["job_id"]!=q.job_id:raise HTTPException(409,"A confirmation is already pending. The website owner can decline it.")
        else:
            db.execute("UPDATE handoffs SET state=?,claim_id=?,user_id=?,job_id=?,claim_expires=? WHERE id=?",
                       ("approved" if recipient else "pending",secrets.token_urlsafe(24),q.user_id,q.job_id,int(time.time())+120,r["id"]))
        r=db.execute("SELECT * FROM handoffs WHERE id=?",(r["id"],)).fetchone();db.commit()
        return {"design_id":r["id"],"version":r["version"],"claim_id":r["claim_id"],"state":r["state"],"requires_website_confirmation":r["state"]=="pending"}
    finally:
        if db.in_transaction:db.rollback()
        db.close()

@router.post("/api/designs/redeem")
def redeem(q:Redeem,authorization:str|None=Header(default=None)):
    authorize(authorization,q.universe_id);db=database()
    try:
        db.execute("BEGIN IMMEDIATE");r=live_row(db,q.design_id);claim_identity(r,q)
        if q.version!=r["version"]:raise HTTPException(409,"Design version mismatch.")
        if r["state"]=="pending":
            if r["claim_expires"]<=time.time():raise HTTPException(410,"Confirmation request expired.")
            return {"state":"pending"}
        if r["state"] not in {"approved","redeemed"}:raise HTTPException(409,"The website owner has not approved this account.")
        if r["state"]=="approved":db.execute("UPDATE handoffs SET state='redeemed',redeemed_at=? WHERE id=?",(int(time.time()),r["id"]))
        db.commit()
        # Same user+server+claim may retry after a lost HTTP response; other identities cannot redeem.
        return {"state":"redeemed","design_id":r["id"],"version":r["version"],"user_id":r["user_id"],"design":json.loads(r["payload"])}
    finally:
        if db.in_transaction:db.rollback()
        db.close()

class RecipientLookup(BaseModel):
    username:str=Field(min_length=3,max_length=20,pattern=r"^[A-Za-z0-9_]+$")

@router.post("/api/roblox/recipient")
async def recipient_lookup(q:RecipientLookup):
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response=await client.post("https://users.roblox.com/v1/usernames/users",json={"usernames":[q.username],"excludeBannedUsers":True})
            response.raise_for_status();rows=response.json().get("data",[])
        if len(rows)!=1:raise HTTPException(404,"That Roblox username was not found. Use the username, not the display name.")
        return {"id":rows[0]["id"],"name":rows[0]["name"],"display_name":rows[0].get("displayName")}
    except HTTPException:raise
    except Exception as exc:raise HTTPException(502,"Roblox account lookup is unavailable. Please retry.") from exc
