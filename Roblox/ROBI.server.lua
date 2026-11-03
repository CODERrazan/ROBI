-- ServerScriptService/ROBI/ROBI.server.lua
print("[ROBI] server_start")
local Players=game:GetService("Players")
local Http=game:GetService("HttpService")
local ReplicatedStorage=game:GetService("ReplicatedStorage")
local Marketplace=game:GetService("MarketplaceService")
local RunService=game:GetService("RunService")
local Config=require(script.Parent.ROBIConfig)
local Dressing=require(script.Parent.OutfitDescription)
assert(game.GameId==Config.UniverseId or RunService:IsStudio(),"Wrong ROBI universe")
assert(string.sub(Config.Backend,1,8)=="https://","HTTPS backend required")

local remotes=Instance.new("Folder");remotes.Name="ROBI";remotes.Parent=ReplicatedStorage
local request=Instance.new("RemoteFunction");request.Name="Request";request.Parent=remotes
local status=Instance.new("RemoteEvent");status.Name="Status";status.Parent=remotes
local previews=Instance.new("Folder");previews.Name="ROBIPreviews";previews.Parent=workspace
local sessions={}
local previewSlots={}
local job=game.JobId~="" and game.JobId or "studio-"..Http:GenerateGUID(false)

local function notify(player,state,message,extra)
 print("[ROBI] state",player.UserId,state)
 if player.Parent then status:FireClient(player,{state=state,message=message,extra=extra}) end
end
local function backend(path,body)
 -- Configure this existing secret in Creator Dashboard > Security > Secrets.
 -- Never put its value in a LocalScript or ReplicatedStorage.
 local secret=Http:GetSecret(Config.SecretName)
 print("[ROBI] backend_request",path)
 local response=Http:RequestAsync({Url=Config.Backend..path,Method="POST",Headers={
  ["Authorization"]=secret:AddPrefix("Bearer "),["Content-Type"]="application/json",["ngrok-skip-browser-warning"]="ROBI"
 },Body=Http:JSONEncode(body)})
 print("[ROBI] backend_response",path,response.StatusCode)
 local ok,data=pcall(function()return Http:JSONDecode(response.Body)end)
 if not response.Success then error(ok and type(data.detail)=="string" and data.detail or "ROBI backend request failed ("..response.StatusCode..")") end
 assert(ok and type(data)=="table","Invalid backend response")
 return data
end
local function showDesign(player,design)
 local state=sessions[player];assert(state,"Player left")
 notify(player,"applying_outfit","Applying your real R15 outfit...")
 local base=Players:GetHumanoidDescriptionFromUserIdAsync(player.UserId)
 local description=Dressing.build(base,design);base:Destroy()
 local model
 local ok,err=pcall(function()
  -- Construct a fresh native preview so a failed update cannot damage the old one.
  model=Players:CreateHumanoidModelFromDescriptionAsync(description,Enum.HumanoidRigType.R15)
  local humanoid=model:FindFirstChildOfClass("Humanoid")
  humanoid:ApplyDescriptionAsync(description)
  Dressing.inspect(model,design)
  model.Name="ROBI_"..player.UserId
  local slot=state.previewSlot
  model:PivotTo(CFrame.new(slot*8,5,0))
  for _,part in ipairs(model:GetDescendants()) do if part:IsA("BasePart") then part.Anchored=true;part.CanCollide=false end end
  model.Parent=previews
 end)
 if not ok then if model then model:Destroy() end;description:Destroy();error(err) end
 if not player.Parent then model:Destroy();description:Destroy();return end
 if state.model then state.model:Destroy() end
 if state.description then state.description:Destroy() end
 description.Name="ROBIValidatedDescription";description.Parent=model
 state.model=model;state.description=description;state.design=design
 notify(player,"ready","Native R15 outfit applied and asset loading checked.",{model=model})
end
local function beginClaim(player,code)
 local state=sessions[player];assert(not state.claiming,"A code is already being confirmed")
 if type(code)~="string" or #code>16 or #code<12 or not code:match("^[%w%-]+$") then notify(player,"failed","Enter the complete code shown on ROBI.");return end
 state.claiming=true
 local ok,err=pcall(function()
  local claim=backend("/api/designs/claim",{code=code,user_id=player.UserId,job_id=job,universe_id=Config.UniverseId})
  if claim.requires_website_confirmation then notify(player,"confirm_on_website","Confirm this Roblox account on the website.") else notify(player,"loading_design","Your account matches. Loading your outfit...") end
  local deadline=os.clock()+120
  repeat
   local value=backend("/api/designs/redeem",{design_id=claim.design_id,claim_id=claim.claim_id,user_id=player.UserId,job_id=job,universe_id=Config.UniverseId,version=claim.version})
   if value.state=="redeemed" then
    assert(value.user_id==player.UserId and value.version==claim.version,"Design binding mismatch")
    showDesign(player,value.design);return
   end
   task.wait(2.5)
  until not player.Parent or os.clock()>deadline
  error("Confirmation expired. Enter the code again or create a new one.")
 end)
 state.claiming=false
 if not ok then warn("[ROBI] design_failed",tostring(err));notify(player,"failed","Could not load this design. Check that the code is current and belongs to this account. Studio Output has the details.") end
end

request.OnServerInvoke=function(player,action,value)
 local state=sessions[player]
 if not state then return {ok=false,error="Session unavailable"} end
 if state.busy or os.clock()-(state.lastRequest or 0)<0.8 then return {ok=false,error="Please wait a moment."} end
 state.lastRequest=os.clock()
 if action=="claim" then
  if state.claiming then return {ok=false,error="A confirmation is already pending."} end
  task.spawn(beginClaim,player,value);return {ok=true}
 end
 state.busy=true
 local ok,result=pcall(function()
  assert(state.design and state.description and state.model,"Preview a website design first")
  if action=="check" then return Dressing.purchaseState(player,state.design) end
  if action=="purchase" then
   assert(not state.purchasePending,"A purchase prompt is already open")
   local check=Dressing.purchaseState(player,state.design)
   assert(check.blocked_count==0,"Some missing items are off-sale, limited, or have no verified price. No purchase was started.")
   assert(check.missing_count>0,"You already own these items")
   local list={}
   for _,item in ipairs(check.items) do
    if not item.owned then table.insert(list,{Type=Enum.MarketplaceProductType.AvatarAsset,Id=tostring(item.asset_id)}) end
   end
   assert(#list<=20,"Roblox allows at most 20 items per bulk prompt")
   state.purchasePending=true
   local promptOk,promptErr=pcall(function()Marketplace:PromptBulkPurchase(player,list,{})end)
   if not promptOk then state.purchasePending=false;error(promptErr) end
   return {prompt_opened=true}
  end
  if action=="prepare_save" then
   local check=Dressing.purchaseState(player,state.design)
   assert(check.missing_count==0,"Purchase missing items first. Saving an outfit does not grant ownership.")
   Dressing.inspect(state.model,state.design)
   return {description=state.description,ownership_checked=true}
  end
  error("Unsupported ROBI action")
 end)
 state.busy=false
 if not ok then return {ok=false,error=tostring(result)} end
 return {ok=true,result=result}
end

Marketplace.PromptBulkPurchaseFinished:Connect(function(player,promptStatus,_results)
 local state=sessions[player];if not state or not state.purchasePending then return end
 state.purchasePending=false
 local ok,check=pcall(function()return Dressing.purchaseState(player,state.design)end)
 if ok then
  notify(player,"purchase_finished",check.missing_count==0 and "Ownership verified for all selected items." or "Purchase prompt closed. Some items are still not owned; the design is preserved.",check)
 else notify(player,"purchase_unknown","Purchase prompt closed; ownership could not be refreshed. Check again before saving.") end
end)

local function joined(player)
 local slot=0;while previewSlots[slot] do slot+=1 end;previewSlots[slot]=true
 sessions[player]={previewSlot=slot}
 local data=player:GetJoinData()
 print("[ROBI] player_join",player.UserId,"has_launch_data",type(data.LaunchData)=="string" and #data.LaunchData>0)
 -- Only official share-link LaunchData may fill the code; no automatic redemption.
 local launch=type(data.LaunchData)=="string" and data.LaunchData:match("^ROBI:([%w%-]+)$")
 if launch and #launch<=16 then player:SetAttribute("ROBILaunchCode",launch) end
end
Players.PlayerAdded:Connect(joined)
for _,player in ipairs(Players:GetPlayers()) do joined(player) end
Players.PlayerRemoving:Connect(function(player)
 local state=sessions[player]
 if state then if state.model then state.model:Destroy() end;if state.description then state.description:Destroy() end end
 if state then previewSlots[state.previewSlot]=nil end
 sessions[player]=nil
end)

print("[ROBI] server_ready",game.PlaceId,game.GameId)
