-- Server-only module. Catalog types are rechecked using Roblox itself.
local Marketplace = game:GetService("MarketplaceService")
local ContentProvider = game:GetService("ContentProvider")
local M = {}
local classic = {[2]="GraphicTShirt",[11]="Shirt",[12]="Pants",[18]="Face"}
local accessories = {
 [8]={"Hat",false},[41]={"Hair",false},[42]={"Face",false},[43]={"Neck",false},
 [44]={"Shoulder",false},[45]={"Front",false},[46]={"Back",false},[47]={"Waist",false},
 [64]={"TShirt",true},[65]={"Shirt",true},[66]={"Pants",true},[67]={"Jacket",true},
 [68]={"Sweater",true},[69]={"Shorts",true},[70]={"LeftShoe",true},[71]={"RightShoe",true},
 [72]={"DressSkirt",true},[76]={"Eyebrow",true},[77]={"Eyelash",true},
}
local upper = {TShirt=true,Shirt=true,Jacket=true,Sweater=true,DressSkirt=true}
local lower = {Pants=true,Shorts=true,DressSkirt=true}
function M.build(base, payload)
 assert(type(payload)=="table" and payload.version==1 and payload.rigType=="R15","Invalid design version/rig")
 assert(type(payload.items)=="table" and #payload.items>0 and #payload.items<=20,"Invalid item count")
 local description=base:Clone()
 local ok,result=pcall(function()
  if payload.body_colors then
   local properties={head="HeadColor",torso="TorsoColor",leftArm="LeftArmColor",rightArm="RightArmColor",leftLeg="LeftLegColor",rightLeg="RightLegColor"}
   for key,value in pairs(payload.body_colors) do
    assert(properties[key] and type(value)=="string" and string.match(value,"^#%x%x%x%x%x%x$"),"Invalid body color")
    description[properties[key]]=Color3.fromHex(value)
   end
  end
  local ids,slots,replaced,selected={},{},{},{}
  for _,item in ipairs(payload.items) do
   local id,typ=item.asset_id,item.asset_type
   assert(type(id)=="number" and id>0 and id%1==0 and id<2^53 and not ids[id],"Invalid/duplicate asset ID")
   ids[id]=true
   local info=Marketplace:GetProductInfoAsync(id,Enum.InfoType.Asset)
   assert(info.AssetTypeId==typ,"Catalog asset type changed")
   local property=classic[typ]
   if property then
    assert(not slots[property],"Duplicate classic clothing slot");slots[property]=true
    description[property]=id
    if typ==11 then for name in pairs(upper) do replaced[name]=true end end
    if typ==12 then for name in pairs(lower) do replaced[name]=true end end
   else
    local kind=accessories[typ];assert(kind,"Unsupported asset/bundle type")
    if kind[2] or kind[1]=="Hair" then
     local key="accessory:"..kind[1];assert(not slots[key],"Duplicate accessory clothing slot");slots[key]=true
    end
    replaced[kind[1]]=true
    table.insert(selected,{AssetId=id,AccessoryType=Enum.AccessoryType[kind[1]],IsLayered=kind[2],Order=item.order})
   end
  end
  local combined={}
  for _,accessory in ipairs(base:GetAccessories(true)) do
   if not replaced[accessory.AccessoryType.Name] and not ids[accessory.AssetId] then table.insert(combined,accessory) end
  end
  table.sort(selected,function(a,b)return (a.Order or 0)<(b.Order or 0) end)
  for _,accessory in ipairs(selected) do table.insert(combined,accessory) end
  local order=0
  for _,accessory in ipairs(combined) do
   if accessory.IsLayered then order+=1;accessory.Order=order else accessory.Order=nil end
  end
  description:SetAccessories(combined,true)
  return description
 end)
 if not ok then description:Destroy();error(result) end
 return result
end

function M.inspect(model, payload)
 local humanoid=model:FindFirstChildOfClass("Humanoid")
 assert(humanoid and humanoid.RigType==Enum.HumanoidRigType.R15,"Preview is not R15")
 local applied=humanoid:GetAppliedDescription()
 local actual={}
 for _,a in ipairs(applied:GetAccessories(true)) do actual[a.AssetId]=true end
 for _,item in ipairs(payload.items) do
  local property=classic[item.asset_type]
  if property then
   assert(applied[property]==item.asset_id,"Native clothing assignment did not match the design")
   if item.asset_type==18 then
    local head=model:FindFirstChild("Head")
    local face=head and head:FindFirstChildOfClass("Decal")
    assert(face and face.Texture~="","Classic face could not be inspected on this head; Dynamic Heads may be incompatible")
   end
   local className=item.asset_type==11 and "Shirt" or item.asset_type==12 and "Pants" or item.asset_type==2 and "ShirtGraphic"
   if className then
    local clothing=model:FindFirstChildOfClass(className)
    assert(clothing,"Native clothing instance missing")
    local texture=className=="Shirt" and clothing.ShirtTemplate or className=="Pants" and clothing.PantsTemplate or clothing.Graphic
    assert(texture and texture~="","Native clothing texture missing")
   end
  else assert(actual[item.asset_id],"Native accessory assignment missing") end
 end
 applied:Destroy()
 for _,name in ipairs({"Head","UpperTorso","LowerTorso","LeftUpperArm","LeftLowerArm","LeftHand","RightUpperArm","RightLowerArm","RightHand","LeftUpperLeg","LeftLowerLeg","LeftFoot","RightUpperLeg","RightLowerLeg","RightFoot"}) do
  assert(model:FindFirstChild(name),"Missing R15 body part: "..name)
 end
 local failures={}
 ContentProvider:PreloadAsync(model:GetDescendants(),function(_,status)
  if status~=Enum.AssetFetchStatus.Success then table.insert(failures,tostring(status)) end
 end)
 assert(#failures==0,"Some native avatar assets did not load; dressing is not confirmed")
 return true
end

function M.purchaseState(player,payload)
 local rows,total,missing,blocked={},0,0,0
 for _,item in ipairs(payload.items) do
  local info=Marketplace:GetProductInfoAsync(item.asset_id,Enum.InfoType.Asset)
  assert(info.AssetTypeId==item.asset_type,"Catalog type changed")
  local owned=Marketplace:PlayerOwnsAssetAsync(player,item.asset_id)
  local price=info.PriceInRobux
  local purchasable=info.IsForSale==true and type(price)=="number" and price>=0 and not info.IsLimited and not info.IsLimitedUnique
  if not owned then
   missing+=1
   if purchasable then total+=price else blocked+=1 end
  end
  table.insert(rows,{asset_id=item.asset_id,name=info.Name,owned=owned,price=price,free=price==0,purchasable=purchasable,off_sale=info.IsForSale==false})
 end
 return {items=rows,total_missing_known=total,missing_count=missing,blocked_count=blocked}
end
return M
