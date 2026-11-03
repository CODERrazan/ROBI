"""Validated conversation requirements and deterministic Roblox query planning."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, field_validator

CATEGORY_ALIASES = {"blouse":"shirt","top":"shirt","dress":"layeredDressSkirt","accessory":"accessories"}
SEARCH_WORDS={'أسود': 'black', 'اسود': 'black', 'سوداء': 'black', 'أبيض': 'white', 'ابيض': 'white', 'بيضاء': 'white', 'وردي': 'pink', 'أزرق': 'blue', 'أحمر': 'red', 'بنفسجي': 'purple', 'رمادي': 'gray', 'كيوت': 'cute', 'فخم': 'formal', 'رسمي': 'formal', 'كاجوال': 'casual'}
CATEGORIES = {"face","shirt","pants","tshirt","hair","hat","faceAccessory","neckAccessory","shouldersAccessory","frontAccessory","backAccessory","waistAccessory","accessories","shoes","layered","layeredTShirt","layeredShirt","layeredPants","layeredJacket","layeredSweater","layeredShorts","layeredLeftShoe","layeredRightShoe","layeredDressSkirt","layeredEyebrow","layeredEyelash"}
Category = Literal['accessories', 'backAccessory', 'face', 'faceAccessory', 'frontAccessory', 'hair', 'hat', 'layered', 'layeredDressSkirt', 'layeredEyebrow', 'layeredEyelash', 'layeredJacket', 'layeredLeftShoe', 'layeredPants', 'layeredRightShoe', 'layeredShirt', 'layeredShorts', 'layeredSweater', 'layeredTShirt', 'neckAccessory', 'pants', 'shirt', 'shoes', 'shouldersAccessory', 'tshirt', 'waistAccessory']

CATEGORY_ALIASES.update({"فستان":"layeredDressSkirt","شعر":"hair","ميكب":"faceAccessory","مكياج":"faceAccessory","makeup":"faceAccessory","فيونكة":"hat","فايونكة":"hat","bow":"hat","بلوزة":"shirt","قميص":"shirt","بنطلون":"pants","وجه":"face","إكسسوارات":"accessories"})
SEARCH_WORDS.update({"فيونكة":"bow","فايونكة":"bow","ميكب":"makeup","مكياج":"makeup","طويل":"long","بني":"brown","ناعم":"soft","كيرلي":"curly","قصير":"short","أشقر":"blonde"})

class OutfitRequirements(BaseModel):
    intent: Literal["generate_outfit","modify_outfit"] = "generate_outfit"
    avatar_type: str | None = None
    style: list[str] = Field(default_factory=list,max_length=8)
    colors: list[str] = Field(default_factory=list,max_length=8)
    categories: list[Category] = Field(default_factory=list,max_length=15)
    budget_robux: int | None = Field(default=None,ge=0,le=100000)
    skin_tone: str | None = Field(default=None,pattern=r"^#[0-9a-fA-F]{6}$")
    category_preferences: dict[Category,list[str]] = Field(default_factory=dict,max_length=15)
    occasion: str | None = None
    preferences: list[str] = Field(default_factory=list,max_length=20)
    excluded_items: list[int] = Field(default_factory=list,max_length=30)
    category_colors: dict[Category,list[str]] = Field(default_factory=dict)
    changed_categories: list[Category] = Field(default_factory=list,max_length=15)
    removed_categories: list[Category] = Field(default_factory=list,max_length=15)

    @field_validator("style","colors","preferences",mode="before")
    @classmethod
    def string_lists(cls,value):
        values=[value] if isinstance(value,str) and value.strip() else value or []
        return [SEARCH_WORDS.get(item,item) for item in values]

    @field_validator("categories","changed_categories","removed_categories",mode="before")
    @classmethod
    def canonical_categories(cls,value):
        if value is None:return []
        if not isinstance(value,list):raise ValueError("Categories must be a list")
        values=[CATEGORY_ALIASES.get(item,item) for item in value]
        if any(item not in CATEGORIES for item in values):raise ValueError("Unsupported clothing category")
        return list(dict.fromkeys(values))

    @field_validator("category_colors","category_preferences",mode="before")
    @classmethod
    def valid_category_colors(cls,value):
        value={CATEGORY_ALIASES.get(key,key):values for key,values in value.items()}
        if any(key not in CATEGORIES for key in value):raise ValueError("Unknown category color override")
        if len(value)>15 or any(len(colors)>8 for colors in value.values()):raise ValueError("Too many color overrides")
        return {key:[" ".join(SEARCH_WORDS.get(word,word) for word in color.split()) for color in colors] for key,colors in value.items()}

def merge_requirements(previous:OutfitRequirements|None,proposed:dict,current_items:list[dict]|None=None)->OutfitRequirements:
    proposed=dict(proposed)
    if "budget_robux" not in proposed and "budget" in proposed:proposed["budget_robux"]=proposed["budget"]
    before=previous.model_dump() if previous else {}
    if current_items and not before.get("categories"):
        before["categories"]=list(dict.fromkeys(item.get("category",item.get("slot")) for item in current_items if item.get("category",item.get("slot")) in CATEGORIES))
    supplied={key:value for key,value in proposed.items() if value is not None}
    merged={**before,**supplied}
    modifying=proposed.get("intent")=="modify_outfit" or bool(current_items)
    if modifying:
        merged["intent"]="modify_outfit"
        changed=proposed.get("changed_categories") or proposed.get("categories") or before.get("categories",[])
        merged["changed_categories"]=changed
        removed=proposed.get("removed_categories") or []
        merged["categories"]=list(dict.fromkeys(before.get("categories",[])+proposed.get("categories",[])+changed))
        merged["categories"]=[category for category in merged["categories"] if category not in removed]
        merged["category_preferences"]={**before.get("category_preferences",{}),**(proposed.get("category_preferences") or {})}
        merged["category_colors"]={**before.get("category_colors",{}),**(proposed.get("category_colors") or {})}
        if before.get("categories") and set(changed)<set(before["categories"]) and proposed.get("colors") and proposed["colors"]!=before.get("colors"):
            for category in changed:merged["category_colors"].setdefault(category,proposed["colors"])
            merged["colors"]=before.get("colors",[])
        for key in ("style","colors","preferences","excluded_items"):
            if not supplied.get(key) and before.get(key):merged[key]=before[key]
    result=OutfitRequirements.model_validate(merged)
    known_styles={'cute','casual','streetwear','formal','kawaii','soft'}
    result.style=list(dict.fromkeys(result.style+[value for value in result.preferences if value in known_styles]))
    palette={'black','white','pink','brown','blonde','blue','red','purple','gray','green'}
    for category,preferences in result.category_preferences.items():
        explicit=[value for value in ' '.join(preferences).split() if value in palette]
        if explicit and category not in result.category_colors:result.category_colors[category]=explicit
    # Keep a structured bow preference in its own accessory slot, never inside a face decal.
    for category,preferences in list(result.category_preferences.items()):
        bows=[value for value in preferences if 'bow' in value.split()]
        if bows and category!='hat':
            result.category_preferences['hat']=list(dict.fromkeys(result.category_preferences.get('hat',[])+bows))
            result.category_preferences[category]=[value for value in preferences if value not in bows]
            if 'hat' not in result.categories:result.categories.append('hat')
            if result.intent=='modify_outfit' and 'hat' not in result.changed_categories:result.changed_categories.append('hat')
    return result

TYPE_QUERY = {
    "shirt":(11,56,"shirt"),"pants":(12,57,"pants"),"tshirt":(2,55,"t-shirt"),
    "face":(18,None,"face"),"hat":(8,None,"hat"),"hair":(41,None,"hair"),
    "faceAccessory":(42,None,"face accessory"),"neckAccessory":(43,None,"necklace"),
    "shouldersAccessory":(44,None,"shoulder accessory"),"frontAccessory":(45,None,"front accessory"),
    "backAccessory":(46,None,"back accessory"),"waistAccessory":(47,None,"waist accessory"),
    "layeredTShirt":(64,None,"t-shirt"),"layeredShirt":(65,None,"shirt"),"layeredPants":(66,None,"pants"),
    "layeredJacket":(67,None,"jacket"),"layeredSweater":(68,None,"sweater"),"layeredShorts":(69,None,"shorts"),
    "layeredLeftShoe":(70,None,"left shoe"),"layeredRightShoe":(71,None,"right shoe"),
    "layeredDressSkirt":(72,None,"dress"),"layeredEyebrow":(76,None,"eyebrows"),"layeredEyelash":(77,None,"eyelashes"),
}
def query_plan(requirements:OutfitRequirements,changed:list[str])->list[dict]:
    plans=[]
    for category in changed:
        asset_type,subcategory,noun=TYPE_QUERY.get(category,(None,None,category))
        colors=requirements.category_colors.get(category,requirements.colors)
        words=colors+requirements.style+requirements.category_preferences.get(category,[])+[noun]
        plans.append({"category":category,"keyword":" ".join(dict.fromkeys(words))[:180],"asset_type":asset_type,"subcategory":subcategory})
    return plans
