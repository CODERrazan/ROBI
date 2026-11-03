
import asyncio,unittest
from unittest.mock import AsyncMock,patch
from fastapi import HTTPException
from app import appearance,roblox_assets,main
from app.roblox_binary import lz4,mesh,asset_reference
from app.styling import OutfitRequirements,merge_requirements,query_plan
from fastapi.testclient import TestClient

class AppearanceTests(unittest.TestCase):
 def setUp(self):appearance._cache.clear()
 def test_resolution_proof_cached_and_claimed_type_rejected(self):
  async def run():
   with patch.object(roblox_assets,'details',new=AsyncMock(return_value={'asset_id':12,'asset_type':11})),patch.object(roblox_assets,'resolve_classic',new=AsyncMock(return_value={'resolution_status':'resolved','texture_asset_id':99})) as resolver:
    first=await appearance.compatibility(12,11)
    second=await appearance.compatibility(12,11)
    bad=await appearance.compatibility(12,12)
    self.assertEqual(first['compatibility_status'],'renderable');self.assertEqual(second,first)
    self.assertEqual(bad['compatibility_status'],'invalid');self.assertEqual(resolver.await_count,1)
  asyncio.run(run())
 def test_unsupported_and_temporary_are_distinct(self):
  async def run():
   with patch.object(roblox_assets,'details',new=AsyncMock(return_value={'asset_id':1,'asset_type':72})):
    self.assertEqual((await appearance.compatibility(1,72))['compatibility_status'],'unsupported')
   with patch.object(roblox_assets,'details',new=AsyncMock(side_effect=HTTPException(502,'Service unavailable'))):
    self.assertEqual((await appearance.compatibility(2,11))['compatibility_status'],'temporarily_unavailable')
  asyncio.run(run())
 def test_invalid_geometry_is_not_retryable_or_renderable(self):
  async def run():
   with patch.object(roblox_assets,'details',new=AsyncMock(return_value={'asset_id':1,'asset_type':41})),patch.object(appearance,'appearance',new=AsyncMock(side_effect=ValueError('bad transform'))):
    self.assertEqual((await appearance.compatibility(1,41))['compatibility_status'],'invalid')
  asyncio.run(run())
 def test_binary_parser_rejects_untrusted_references_and_meshes(self):
  for value in ('https://evil.example/asset/?id=123','rbxassetid://0','rbxassetid://9007199254740993'):
   with self.assertRaises(ValueError):asset_reference(value)
  with self.assertRaises(ValueError):lz4(b'\x00\x01\x00',20)
  with self.assertRaises(ValueError):mesh(b'version 7.00\n')
 def test_hair_changes_preserve_clothing_and_skin(self):
  before=OutfitRequirements(categories=['shirt','pants'],colors=['black'],skin_tone='#A07050')
  after=merge_requirements(before,{'intent':'modify_outfit','categories':['hair'],'changed_categories':['hair'],'category_colors':{'hair':['brown']},'category_preferences':{'hair':['long','curly']}},[])
  self.assertEqual(after.categories,['shirt','pants','hair']);self.assertEqual(after.skin_tone,'#A07050')
  self.assertEqual(query_plan(after,['hair'])[0]['keyword'],'brown long curly hair')
 def test_unsupported_dress_never_reaches_vision_or_becomes_pants(self):
  req={'categories':['layeredDressSkirt'],'colors':['pink'],'budget_robux':100}
  with patch.object(main,'roblox_search',new=AsyncMock(return_value={'data':[{'id':123,'assetType':72,'name':'Pink dress','price':20}]})),patch.object(appearance,'compatibility',new=AsyncMock(return_value={'asset_id':123,'asset_type':72,'compatibility_status':'unsupported'})),patch.object(main,'analyze_candidate_thumbnails',new=AsyncMock(return_value={})) as vision,patch.object(main,'llama_json',new=AsyncMock()) as llama:
   r=TestClient(main.app).post('/api/outfits/compose',json={'message':'pink dress','requirements':req,'budget':100})
  self.assertEqual(r.status_code,200);self.assertEqual(r.json()['outfit_options'],[])
  self.assertEqual(r.json()['requirements']['categories'],['layeredDressSkirt'])
  self.assertEqual(vision.await_args.args[0],[]);llama.assert_not_awaited()

 def test_arabic_structured_categories_keep_dress_hair_and_bow_distinct(self):
  result=merge_requirements(None,{'categories':['فستان','شعر','وجه'],'category_preferences':{'شعر':['بني طويل'],'وجه':['ميكب ناعم','فيونكة']}},[])
  self.assertEqual(result.categories,['layeredDressSkirt','hair','face','hat'])
  self.assertEqual(result.category_colors['hair'],['brown'])
  self.assertEqual(result.category_preferences['hat'],['bow'])
  schema=OutfitRequirements.model_json_schema()
  self.assertIn('hair',schema['properties']['categories']['items']['enum'])
 def test_unsupported_template_format_is_not_temporary_network_failure(self):
  async def run():
   with patch.object(roblox_assets,'details',new=AsyncMock(return_value={'asset_id':123,'asset_type':11})),patch.object(roblox_assets,'resolve_classic',new=AsyncMock(side_effect=roblox_assets.UnsupportedPreview('Wrong template dimensions'))):
    self.assertEqual((await appearance.compatibility(123,11))['compatibility_status'],'unsupported')
  asyncio.run(run())
