import asyncio,json,os,sys,unittest
from io import BytesIO
from PIL import Image
from unittest.mock import AsyncMock, patch
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault('ROBI_LAUNCH_SECRET','x'*40)
from fastapi.testclient import TestClient
from app.main import app, normalize_candidate, validate_model_selection, analyze_candidate_thumbnails, valid_image_bytes
class Contracts(unittest.TestCase):
 @classmethod
 def setUpClass(cls): cls.client=TestClient(app)
 def _assert_chat_route(self,message,model_response,reported_model=None,expected_status=200):
  from app import main
  reported_model=reported_model or main.MODEL
  class Response:
   status_code=200
   def raise_for_status(self): pass
   def json(self): return {'model':reported_model,'choices':[{'message':{'content':json.dumps(model_response,ensure_ascii=False)}}]}
  class Client:
   async def __aenter__(self): return self
   async def __aexit__(self,*args): return None
   async def post(self,url,headers,json):
    self.url=url;self.headers=headers;self.payload=json
    self.correct_route=(url=='https://api.deepinfra.com/v1/openai/chat/completions' and json['model']=='meta-llama/Llama-4-Scout-17B-16E-Instruct')
    return Response()
  if model_response.get('intent')=='outfit' and 'requirements' not in model_response:model_response={**model_response,'requirements':{'intent':'generate_outfit','colors':['black'],'categories':[]}}
  client=Client()
  with patch.dict(os.environ,{'DEEPINFRA_API_KEY':'test-key-never-log','LLAMA_MODEL_ID':main.MODEL,'DEEPINFRA_BASE_URL':'https://api.deepinfra.com/v1/openai'}),patch.object(main.httpx,'AsyncClient',return_value=client),patch.object(main,'roblox_search',new=AsyncMock(side_effect=AssertionError('chat must not query catalog'))),patch.object(main,'gemma_analyze',new=AsyncMock(side_effect=AssertionError('chat must not call Gemma'))):
   response=self.client.post('/api/chat',json={'message':message})
  self.assertEqual(response.status_code,expected_status);self.assertTrue(client.correct_route);self.assertEqual(client.headers['Authorization'],'Bearer test-key-never-log')
  return response.json()

 def test_chat_rejects_provider_model_mismatch(self):
  response=self._assert_chat_route('هلا',{'intent':'conversation','ready':False,'reply':'غير متوقع'},'google/gemma-4-31B-it-turbo',502)
  self.assertIn('configured Llama',response['detail'])
 def test_saudi_greeting_routes_to_llama_chat_only(self):
  data=self._assert_chat_route('هلا كيفك؟',{'intent':'conversation','ready':False,'reply':'الحمد لله بخير! شلونك إنتِ؟ 💗'})
  self.assertEqual(data['intent'],'conversation');self.assertIn('شلونك',data['reply'])

 def test_capabilities_question_routes_to_llama_chat_only(self):
  data=self._assert_chat_route('وش تقدر تسوي؟',{'intent':'conversation','ready':False,'reply':'أساعدك تختارين ستايل وأدور لك على قطع Roblox ✨'})
  self.assertEqual(data['intent'],'conversation');self.assertEqual(data['ready'],False)

 def test_incomplete_outfit_is_clarified_without_catalog_or_gemma(self):
  data=self._assert_chat_route('أبي ملابس بنت لونها أسود.',{'intent':'outfit','ready':False,'reply':'تبينها فستان ولا بنطلون وبلوزة؟ 🖤'})
  self.assertEqual(data['intent'],'outfit');self.assertFalse(data['ready']);self.assertIn('فستان',data['reply'])

 def test_compose_clarification_exits_before_catalog_search(self):
  from app import main
  incomplete={'ready':False,'clarification':'فستان ولا بنطلون وبلوزة؟','categories':[],'search_terms':[]}
  with patch.object(main,'llama_json',new=AsyncMock(return_value=incomplete)) as model,patch.object(main,'roblox_search',new=AsyncMock(side_effect=AssertionError('catalog search must not run'))),patch.object(main,'analyze_candidate_thumbnails',new=AsyncMock(side_effect=AssertionError('Gemma must not run'))):
   response=self.client.post('/api/outfits/compose',json={'message':'أبي ملابس بنت لونها أسود'})
  self.assertEqual(response.status_code,200);data=response.json();self.assertTrue(data['clarification_required']);self.assertEqual(data['selection_status'],'clarification_required');self.assertEqual(data['candidates'],[]);model.assert_awaited_once()
 def setUp(self):
  from app import main
  main.VISUAL_CACHE.clear()
  provider_patch=patch.dict(os.environ,{'VISION_PROVIDER':'ollama'});provider_patch.start();self.addCleanup(provider_patch.stop)

 def test_health(self): self.assertTrue(self.client.get('/health').json()['ok'])

 def test_roblox_asset_type_categories_are_exact(self):
  self.assertEqual(normalize_candidate({'id':1,'assetType':2})['category'],'tshirt')
  self.assertEqual(normalize_candidate({'id':2,'assetType':11})['category'],'shirt')
  self.assertEqual(normalize_candidate({'id':3,'assetType':12})['category'],'pants')
  self.assertEqual(normalize_candidate({'id':4,'assetType':65})['category'],'layeredShirt')
  self.assertEqual(normalize_candidate({'id':5,'assetType':66})['category'],'layeredPants')
  from app.main import category_matches
  self.assertTrue(category_matches('layeredPants','pants'))
  self.assertFalse(category_matches('layeredPants','shirt'))
  self.assertIsNone(normalize_candidate({'id':6,'assetType':999})['category'])

 def test_image_bytes_require_matching_real_image_signature(self):
  self.assertTrue(valid_image_bytes('image/png',b'\x89PNG\r\n\x1a\n'+b'0'*20))
  self.assertFalse(valid_image_bytes('image/jpeg',b'\x89PNG\r\n\x1a\n'+b'0'*20))


 def test_reject_mock_assets(self):
  r=self.client.post('/api/designs/launch-token',json={'config':{'rigType':'R15','items':[{'source':'mock','assetId':4,'verified':True}]}});self.assertEqual(r.status_code,422)
 def test_reject_r6(self):
  r=self.client.post('/api/designs/launch-token',json={'config':{'rigType':'R6','items':[]}});self.assertEqual(r.status_code,422)
 def test_missing_deepinfra_key(self):
  os.environ.pop('DEEPINFRA_API_KEY',None);r=self.client.post('/api/chat',json={'message':'style me'});self.assertEqual(r.status_code,503)

 def test_candidate_normalization_uses_catalog_fields(self):
  item=normalize_candidate({'id':123,'name':'Real item','description':'Catalog description','assetType':11,'price':25,'priceStatus':'OnSale','thumbnailUrl':'https://tr.rbxcdn.com/image'})
  self.assertEqual(item['asset_id'],123); self.assertEqual(item['category'],'shirt'); self.assertEqual(item['price'],25)
  self.assertEqual(item['availability'],'available'); self.assertEqual(item['thumbnail_url'],'https://tr.rbxcdn.com/image')
  self.assertIsNone(normalize_candidate({'name':'missing ID'}))

 def test_selection_rejects_unknown_duplicate_unavailable_and_over_budget(self):
  candidates=[
   {'asset_id':1,'category':'shirt','availability':'available','price':30,'name':'shirt','visual_analysis_status':'verified','visual_analysis':{}},
   {'asset_id':2,'category':'pants','availability':'unavailable','price':10,'name':'pants','visual_analysis_status':'verified','visual_analysis':{}},
   {'asset_id':3,'category':'hair','availability':'available','price':50,'name':'hair','visual_analysis_status':'verified','visual_analysis':{}},
  ]
  raw=[{'asset_id':999,'category':'shirt','reason':'invented'},{'asset_id':2,'category':'pants'},{'asset_id':1,'category':'shirt'},{'asset_id':1,'category':'shirt'},{'asset_id':3,'category':'hair'}]
  chosen,total=validate_model_selection(raw,candidates,40)
  self.assertEqual([item['asset_id'] for item in chosen],[1]); self.assertEqual(total,30)


 def test_ollama_model_mismatch_is_rejected(self):
  from app import main
  class Response:
   status_code=200
   def raise_for_status(self): pass
   def json(self): return {'model':'gemma2:2b','response':'{}'}
  class Client:
   async def __aenter__(self): return self
   async def __aexit__(self,*args): return None
   async def post(self,url,json): self.url=url;self.payload=json;return Response()
  client=Client()
  with patch.dict(os.environ,{'OLLAMA_BASE_URL':'http://localhost:11434','OLLAMA_VISION_MODEL':'gemma3:4b'}),patch.object(main.httpx,'AsyncClient',return_value=client):
   with self.assertRaisesRegex(ValueError,'different model'): asyncio.run(main.gemma_analyze(b'image','test prompt'))
  self.assertEqual(client.url,'http://localhost:11434/api/generate');self.assertEqual(client.payload['model'],'gemma3:4b')
 def test_gemma_analysis_is_attached_to_the_same_candidate_id(self):
  from app import main
  candidate={'asset_id':44,'category':'shirt','name':'real catalog item'}
  output=BytesIO(); Image.new('RGB',(2,2),'black').save(output,format='PNG'); image=output.getvalue()
  class Response:
   def __init__(self,data=None,content=b'',headers=None): self.status_code=200; self.data=data; self.content=content; self.headers=headers or {}
   def raise_for_status(self): pass
   def json(self): return self.data
  class Client:
   async def __aenter__(self): return self
   async def __aexit__(self,*args): return None
   async def get(self,url,**kwargs):
    if url==main.THUMBNAILS: return Response({'data':[{'targetId':44,'state':'Completed','imageUrl':'https://tr.rbxcdn.com/44.png'}]})
    return Response(content=image,headers={'content-type':'image/png'})
  async def run():
   with patch.object(main.httpx,'AsyncClient',return_value=Client()), patch.object(main,'gemma_analyze',new=AsyncMock(return_value={'dominant_colors':['black'],'style':'streetwear','pattern':'graphic','visible_details':['white print'],'confidence':0.9})) as vision:
    analyzed=await main.analyze_candidate_thumbnails([candidate]); return analyzed,vision
  analyzed,vision=asyncio.run(run())
  self.assertEqual(analyzed[44]['visual_analysis_status'],'verified')
  self.assertEqual(analyzed[44]['image_verified_for_asset_id'],44)
  self.assertEqual(analyzed[44]['visual_analysis']['dominant_colors'],['black'])
  self.assertEqual(vision.await_args.args[0],image)

 def test_client_verified_flag_does_not_authorize_preserving_an_item(self):
  from app import main
  main.VERIFIED_CATALOG.clear()
  item={'assetId':888,'category':'shirt','verified':True,'source':'roblox'}
  self.assertEqual(main.verified_current_items([item],set(),set()),[])
  candidate={'asset_id':888,'category':'shirt','price':12,'name':'Live item'}
  main.remember_candidate(candidate)
  self.assertEqual(main.verified_current_items([item],set(),set())[0]['asset_id'],888)
  main.VERIFIED_CATALOG.clear()



 def test_followup_total_counts_preserved_items_once(self):
  from app import main
  compatible=patch('app.appearance.compatibility',new=AsyncMock(side_effect=lambda asset_id,asset_type=None:{'asset_id':asset_id,'asset_type':asset_type,'compatibility_status':'renderable','price':15 if asset_id==10 else 10 if asset_id==20 else 25,'availability':'available'}))
  compatible.start();self.addCleanup(compatible.stop)
  main.VERIFIED_CATALOG.clear()
  shirt={'asset_id':10,'name':'Verified shirt','description':'','asset_type':11,'category':'shirt','price':15,'availability':'available','currency':'Robux','item_type':'Asset','catalog_url':'https://www.roblox.com/catalog/10'}
  shirt.update({'visual_analysis_status':'verified','visual_analysis':{'dominant_colors':['black'],'visible_details':['server-observed garment']}})
  main.remember_candidate(shirt)
  requirements={'ready':True,'style':'casual','colors':['black'],'categories':['pants'],'search_terms':['black pants'],'budget':30,'restrictions':[],'response':'Updated.'}
  selection={'selected':[{'asset_id':20,'category':'pants','reason':'Matches request','match_score':0.9}],'affected_categories':['pants'],'removed_categories':[],'missing_categories':[],'response':'Updated.'}
  with patch.object(main,'llama_json',new=AsyncMock(side_effect=[requirements,selection])), patch.object(main,'roblox_search',new=AsyncMock(return_value={'data':[{'id':20,'name':'Black pants','description':'','assetType':12,'price':10,'priceStatus':'OnSale'}]})), patch.object(main,'analyze_candidate_thumbnails',new=AsyncMock(side_effect=lambda items,requirements=None:{item['asset_id']:{'image_retrieval_status':'verified','image_verified_for_asset_id':item['asset_id'],'thumbnail_url':'https://tr.rbxcdn.com/test.png','visual_analysis_status':'verified','visual_analysis':{'dominant_colors':['black'],'style':'casual','pattern':'solid','visible_details':['visible garment'],'confidence':0.9}} for item in items})):
   response=self.client.post('/api/outfits/compose',json={'message':'change pants to black','budget':30,'current_items':[{'assetId':10,'category':'shirt','verified':True}]})
  self.assertEqual(response.status_code,200)
  data=response.json(); self.assertEqual([item['asset_id'] for item in data['selected_items']],[10,20]); self.assertEqual(data['total_known_price'],25)
  main.VERIFIED_CATALOG.clear()

 def test_required_category_rejects_misclassified_catalog_item(self):
  candidate={'asset_id':9,'category':'waistAccessory','availability':'unknown','price':10,'name':'shoe-like accessory'}
  selected,total=validate_model_selection([{'asset_id':9,'category':'waistAccessory'}], [candidate], 50, {'shoes'})
  self.assertEqual(selected,[]); self.assertEqual(total,0)

 def test_followup_preserves_server_verified_unchanged_item(self):
  from app import main
  main.VERIFIED_CATALOG.clear()
  shirt={'asset_id':1,'name':'real shirt','category':'shirt','asset_type':11,'price':10,'availability':'available','catalog_url':'https://www.roblox.com/catalog/1'}
  shirt.update({'visual_analysis_status':'verified','visual_analysis':{'dominant_colors':['black'],'visible_details':['server-observed garment']}})
  main.remember_candidate(shirt)
  preserved=main.verified_current_items([{'assetId':1,'category':'shirt','verified':True}],{'pants'},set())
  self.assertEqual([item['asset_id'] for item in preserved],[1])
  self.assertEqual(main.verified_current_items([{'assetId':2,'category':'shirt','verified':True}],{'pants'},set()),[])
  main.VERIFIED_CATALOG.clear()

 def test_selection_preserves_unknown_price_as_nonzero_evidence(self):
  candidates=[{'asset_id':4,'category':'hat','availability':'unknown','price':None,'name':'hat','visual_analysis_status':'verified','visual_analysis':{}}]
  chosen,total=validate_model_selection([{'asset_id':4,'category':'hat','match_score':0.8}],candidates,20)
  self.assertEqual(chosen[0]['asset_id'],4); self.assertIsNone(chosen[0]['price']); self.assertEqual(total,0)


 def test_compose_only_selects_candidates_returned_by_catalog(self):
  from app import main
  compatible=patch('app.appearance.compatibility',new=AsyncMock(side_effect=lambda asset_id,asset_type=None:{'asset_id':asset_id,'asset_type':asset_type,'compatibility_status':'renderable','price':15 if asset_id==10 else 10 if asset_id==20 else 25,'availability':'available'}))
  compatible.start();self.addCleanup(compatible.stop)
  catalog_item={'id':123456789,'name':'Actual response item','description':'Returned by mocked catalog client','assetType':11,'price':25,'priceStatus':'OnSale'}
  requirements={'ready':True,'style':'casual','colors':['black','white'],'categories':['shirt'],'search_terms':['black white shirt'],'response':'Found a shirt.'}
  selection={'selected':[{'asset_id':123456789,'category':'shirt','reason':'Matches colors','match_score':0.9},{'asset_id':999999999,'reason':'hallucinated'}],'affected_categories':['shirt'],'missing_categories':[],'response':'Here is a match.'}
  correction={'selected':[{'asset_id':123456789,'category':'shirt','reason':'Matches colors','match_score':0.9}],'affected_categories':['shirt'],'missing_categories':[],'response':'Here is a match.'}
  with patch.object(main,'llama_json',new=AsyncMock(side_effect=[requirements,selection,correction])) as model,  patch.object(main,'roblox_search',new=AsyncMock(return_value={'data':[catalog_item]})), patch.object(main,'analyze_candidate_thumbnails',new=AsyncMock(side_effect=lambda items,requirements=None:{item['asset_id']:{'image_retrieval_status':'verified','image_verified_for_asset_id':item['asset_id'],'thumbnail_url':'https://tr.rbxcdn.com/test.png','visual_analysis_status':'verified','visual_analysis':{'dominant_colors':['black'],'style':'casual','pattern':'solid','visible_details':['visible garment'],'confidence':0.9}} for item in items})):
   response=self.client.post('/api/outfits/compose',json={'message':'black and white shirt','budget':50,'current_items':[]})
  self.assertEqual(response.status_code,200)
  data=response.json(); self.assertEqual([item['asset_id'] for item in data['selected_items']],[123456789])
  self.assertEqual(data['selected_items'][0]['price'],25); self.assertEqual(data['total_known_price'],25); self.assertEqual(data['selected_items'][0]['visual_analysis_status'],'verified'); self.assertEqual(model.await_count,3); self.assertEqual(model.await_args_list[1].args[1]['candidates'][0]['visual_analysis']['style'],'casual')
  self.assertEqual(model.await_args_list[1].args[1]['candidates'][0]['visual_analysis_status'],'verified')


 def test_failed_candidate_vision_stops_before_metadata_only_selection(self):
  from app import main
  compatible=patch('app.appearance.compatibility',new=AsyncMock(side_effect=lambda asset_id,asset_type=None:{'asset_id':asset_id,'asset_type':asset_type,'compatibility_status':'renderable','price':15 if asset_id==10 else 10 if asset_id==20 else 25,'availability':'available'}))
  compatible.start();self.addCleanup(compatible.stop)
  requirements={'ready':True,'style':'casual','colors':['black'],'categories':['shirt'],'search_terms':['black shirt'],'budget':50}
  failed={'image_retrieval_status':'failed','visual_analysis_status':'not_analyzed','visual_analysis':None,'image_error':'thumbnail_missing'}
  with patch.object(main,'llama_json',new=AsyncMock(return_value=requirements)) as model, patch.object(main,'roblox_search',new=AsyncMock(return_value={'data':[{'id':321,'name':'Catalog shirt','assetType':11,'price':20}]})), patch.object(main,'analyze_candidate_thumbnails',new=AsyncMock(return_value={321:failed})):
   response=self.client.post('/api/outfits/compose',json={'message':'black shirt','budget':50})
  data=response.json()
  self.assertEqual(response.status_code,200)
  self.assertEqual(data['selection_status'],'no_match')
  self.assertEqual(data['selected_items'],[])
  self.assertEqual(data['candidates'][0]['visual_analysis_status'],'not_analyzed')
  self.assertEqual(model.await_count,1)

 def test_frontend_cors_preflight(self):
  r=self.client.options('/api/chat',headers={'Origin':'http://127.0.0.1:5173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
  self.assertEqual(r.status_code,200);self.assertEqual(r.headers.get('access-control-allow-origin'),'http://127.0.0.1:5173')

 def test_advice_cannot_select_even_when_model_misclassifies(self):
  result=self._assert_chat_route('وش أحلى شي؟',{'intent':'select_option','ready':False,'option_index':1,'reply':'الأول يناسبك','requirements':None})
  self.assertEqual(result['intent'],'conversation');self.assertFalse(result['ready']);self.assertNotIn('option_id',result)
 def test_explicit_skin_tone_changes_appearance_without_catalog_generation(self):
  result=self._assert_chat_route('خلي لون البشرة أسمر',{'intent':'advice','ready':False,'reply':'تمام','requirements':{'skin_tone':'#964B00'}})
  self.assertEqual(result['conversation_kind'],'appearance');self.assertFalse(result['ready'])
  self.assertEqual(result['requirements']['skin_tone'],'#964B00')
