import asyncio,json,os,unittest
from unittest.mock import AsyncMock,patch
from app import main
from app.styling import OutfitRequirements,merge_requirements,query_plan
from pydantic import ValidationError

class StylingTests(unittest.TestCase):
 def test_pants_color_change_keeps_shirt_and_budget_requirements(self):
  previous=OutfitRequirements(style=['cute'],colors=['black'],categories=['shirt','pants'],budget_robux=100)
  changed=merge_requirements(previous,{'intent':'modify_outfit','categories':['pants'],'changed_categories':['pants'],'colors':['white']},[{'asset_id':1}])
  self.assertEqual(changed.colors,['black'])
  self.assertEqual(changed.category_colors['pants'],['white'])
  self.assertEqual(changed.budget_robux,100)
  self.assertEqual(set(changed.categories),{'shirt','pants'})
  plan=query_plan(changed,changed.changed_categories)
  self.assertEqual(len(plan),1);self.assertEqual(plan[0]['asset_type'],12)
  self.assertIn('white',plan[0]['keyword']);self.assertNotIn('black',plan[0]['keyword'])

 def test_requirement_schema_rejects_invalid_categories_and_budget(self):
  with self.assertRaises(ValidationError):OutfitRequirements(categories=['fake-category'])
  with self.assertRaises(ValidationError):OutfitRequirements(budget_robux=-1)

 def test_cloud_vision_never_substitutes_a_model_or_asset(self):
  class Response:
   status_code=200
   def raise_for_status(self):pass
   def json(self):return {'model':state['model'],'choices':[{'message':{'content':json.dumps({'asset_id':state['asset_id'],'visual_analysis_success':True,'visual_colors':['black'],'visible_details':['sleeves']})}}]}
  class Client:
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   async def post(self,url,headers,json):
    self.url=url;self.payload=json;return Response()
  client=Client();state={'model':'google/gemma-4-31B-it-turbo','asset_id':44}
  with patch.dict(os.environ,{'DEEPINFRA_API_KEY':'test-key','VISION_MODEL_ID':'google/gemma-4-26B-A4B-it'}),patch.object(main.httpx,'AsyncClient',return_value=client):
   with self.assertRaisesRegex(ValueError,'unexpected model'):asyncio.run(main.cloud_vision_analyze(b'png','asset 44',asset_id=44))
   state['model']='google/gemma-4-26B-A4B-it';state['asset_id']=45
   with self.assertRaisesRegex(ValueError,'asset ID'):asyncio.run(main.cloud_vision_analyze(b'png','asset 44',asset_id=44))
   state['asset_id']=44
   result=asyncio.run(main.cloud_vision_analyze(b'png','asset 44',asset_id=44))
   self.assertEqual(result['asset_id'],44)
   self.assertEqual(client.payload['model'],'google/gemma-4-26B-A4B-it')
   self.assertTrue(client.payload['messages'][0]['content'][1]['image_url']['url'].startswith('data:image/png;base64,'))
   asyncio.run(main.cloud_vision_analyze(b'\xff\xd8\xffjpeg','asset 44',asset_id=44))
   self.assertTrue(client.payload['messages'][0]['content'][1]['image_url']['url'].startswith('data:image/jpeg;base64,'))

 def test_existing_option_selection_rejects_invented_id(self):
  class Response:
   status_code=200
   def raise_for_status(self):pass
   def json(self):return {'model':main.MODEL,'choices':[{'message':{'content':json.dumps({'intent':'select_option','option_id':state['id'],'ready':False,'reply':'Second outfit selected','requirements':None})}}]}
  class Client:
   async def __aenter__(self):return self
   async def __aexit__(self,*args):pass
   async def post(self,*args,**kwargs):return Response()
  state={'id':'invented'}
  request=main.Chat(message='Choose the second outfit',available_options=[{'id':'outfit-a','name':'A'},{'id':'outfit-b','name':'B'}],selected_option_id='outfit-a')
  with patch.dict(os.environ,{'DEEPINFRA_API_KEY':'test-key','LLAMA_MODEL_ID':main.MODEL}),patch.object(main.httpx,'AsyncClient',return_value=Client()):
   with self.assertRaises(main.HTTPException):asyncio.run(main.chat(request))
   state['id']='outfit-b'
   result=asyncio.run(main.chat(request))
   self.assertEqual(result['intent'],'select_option');self.assertEqual(result['option_id'],'outfit-b')

 def test_vision_category_color_override_is_explicit(self):
  context=main.candidate_vision_context({'asset_id':44,'category':'pants'},{'colors':['black'],'category_colors':{'pants':['white']}})
  self.assertEqual(context['effective_item_colors'],['white'])
  self.assertEqual(context['requirements']['colors'],['black'])
