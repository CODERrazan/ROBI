import asyncio, os, tempfile, unittest, time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app
from app import roblox_bridge as bridge, roblox_assets as assets

class DressingSecurity(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.env=patch.dict(os.environ,{'ROBI_HANDOFF_DB':self.temp.name+'/handoff.sqlite3','ROBLOX_PLACE_ID':'123','ROBLOX_UNIVERSE_ID':'456','PUBLIC_BACKEND_URL':'https://example.test','ROBLOX_BRIDGE_SECRET':'unit-test-secret'})
  self.env.start();self.client=TestClient(app);self.auth={'Authorization':'Bearer unit-test-secret'}
 def tearDown(self):self.env.stop();self.temp.cleanup()
 def launch(self):
  with patch.object(bridge,'verified_items',new=AsyncMock(return_value=[{'asset_id':123,'asset_type':11,'slot':'shirt'}])):
   r=self.client.post('/api/designs/launch-token',json={'config':{'version':1,'rigType':'R15','items':[{'source':'roblox','assetId':123}]}})
  self.assertEqual(r.status_code,200);return r.json()
 def claim(self,h,user=10,job='server'):
  return self.client.post('/api/designs/claim',headers=self.auth,json={'code':h['code'],'user_id':user,'job_id':job,'universe_id':456})
 def redemption(self,h,c,user=10,job='server',version=1):
  return self.client.post('/api/designs/redeem',headers=self.auth,json={'design_id':h['design_id'],'claim_id':c['claim_id'],'user_id':user,'job_id':job,'version':version,'universe_id':456})
 def test_approval_binding_retry_and_cross_user_replay(self):
  h=self.launch();c=self.claim(h).json()
  pending=self.redemption(h,c).json();self.assertEqual(pending,{'state':'pending'})
  self.assertEqual(self.client.get('/api/designs/'+h['design_id']+'/status').status_code,403)
  self.assertEqual(self.client.post('/api/designs/'+h['design_id']+'/approve',json={'claim_id':c['claim_id']}).status_code,403)
  self.assertEqual(self.client.post('/api/designs/'+h['design_id']+'/approve',headers={'X-Design-Approval':h['approval_secret']},json={'claim_id':c['claim_id']}).status_code,200)
  self.assertEqual(self.redemption(h,c).json()['design']['items'][0]['asset_id'],123)
  self.assertEqual(self.redemption(h,c).status_code,200)
  self.assertEqual(self.redemption(h,c,user=11).status_code,409)
  self.assertEqual(self.redemption(h,c,job='other').status_code,409)
  self.assertEqual(self.redemption(h,c,version=2).status_code,409)
 def test_expiry_and_server_auth(self):
  h=self.launch()
  self.assertEqual(self.client.post('/api/designs/claim',json={'code':h['code'],'user_id':10,'job_id':'server','universe_id':456}).status_code,401)
  db=bridge.database();db.execute('UPDATE handoffs SET expires=? WHERE id=?',(int(time.time())-1,h['design_id']));db.close()
  self.assertEqual(self.claim(h).status_code,410)
 def test_concurrent_claims_only_one_player_wins(self):
  h=self.launch()
  with ThreadPoolExecutor(2) as pool:
   results=list(pool.map(lambda user:self.claim(h,user).status_code,[10,11]))
  self.assertEqual(sorted(results),[200,409])
 def test_decline_allows_new_confirmation_not_private_payload(self):
  h=self.launch();c=self.claim(h).json()
  r=self.client.post('/api/designs/'+h['design_id']+'/approve',headers={'X-Design-Approval':h['approval_secret']},json={'claim_id':c['claim_id'],'approve':False})
  self.assertEqual(r.status_code,200)
  self.assertEqual(self.redemption(h,c).status_code,409)
  self.assertEqual(self.claim(h,11).status_code,200)
 def test_template_ids_are_distinct_and_untrusted_xml_rejected(self):
  raw=b'<roblox><Item class="Shirt"><Properties><Content name="ShirtTemplate"><url>http://www.roblox.com/asset/?id=456</url></Content></Properties></Item></roblox>'
  self.assertEqual(assets.template_id(raw,11),456)
  for bad in [raw.replace(b'www.roblox.com',b'evil.example'),b'<!DOCTYPE x>'+raw,raw.replace(b'ShirtTemplate',b'Thumbnail')]:
   with self.assertRaises(Exception):assets.template_id(bad,11)
 def test_type_mismatch_and_duplicate_classic_slots_rejected(self):
  item={'asset_id':123,'asset_type':11,'slot':'shirt','preview_capability':'classic_template'}
  with patch.object(assets,'details',new=AsyncMock(return_value=item)):
   with self.assertRaises(Exception):asyncio.run(assets.verified_items([{'assetId':123,'assetType':12}]))
   with self.assertRaises(Exception):asyncio.run(assets.verified_items([{'assetId':123},{'assetId':124}]))
 def test_layered_never_resolved_as_classic_texture(self):
  self.assertEqual(assets.capability(65),'native_only')
  from app import appearance
  appearance._cache.clear()
  with patch.object(assets,'details',new=AsyncMock(return_value={'asset_id':123,'asset_type':65})), patch.object(assets,'verified_items',new=AsyncMock(return_value=[{'asset_id':123,'asset_type':65,'preview_capability':'native_only'}])),patch.object(assets,'resolve_classic',new=AsyncMock(side_effect=AssertionError('layered is not a classic texture'))):
   r=self.client.post('/api/avatar/resolve',json={'items':[{'assetId':123,'assetType':65}]})
  self.assertEqual(r.json()['items'][0]['resolution_status'],'unsupported')

 def test_only_explicit_body_colors_enter_handoff(self):
  with patch.object(bridge,'verified_items',new=AsyncMock(return_value=[{'asset_id':123,'asset_type':11,'slot':'shirt'}])):
   cfg={'version':1,'rigType':'R15','items':[{'source':'roblox','assetId':123}],'bodyColors':{'head':'#FFFFFF'}}
   first=self.client.post('/api/designs/launch-token',json={'config':cfg}).json()
   cfg['bodyColorsOverride']={'head':'#A07050'}
   second=self.client.post('/api/designs/launch-token',json={'config':cfg}).json()
   cfg['bodyColorsOverride']={'head':'not-a-color'}
   self.assertEqual(self.client.post('/api/designs/launch-token',json={'config':cfg}).status_code,422)
  import json
  db=bridge.database()
  initial=json.loads(db.execute('SELECT payload FROM handoffs WHERE id=?',(first['design_id'],)).fetchone()[0])
  changed=json.loads(db.execute('SELECT payload FROM handoffs WHERE id=?',(second['design_id'],)).fetchone()[0]);db.close()
  self.assertNotIn('body_colors',initial);self.assertEqual(changed['body_colors'],{'head':'#A07050'})

 def test_recipient_bound_code_rejects_other_player_and_needs_no_return(self):
  import json
  h=self.launch()
  db=bridge.database();row=db.execute('SELECT payload FROM handoffs WHERE id=?',(h['design_id'],)).fetchone()
  payload=json.loads(row[0]);payload['recipient_user_id']=10
  db.execute('UPDATE handoffs SET payload=? WHERE id=?',(json.dumps(payload),h['design_id']));db.close()
  self.assertEqual(self.claim(h,11).status_code,403)
  c=self.claim(h,10).json()
  self.assertEqual(c['state'],'approved');self.assertFalse(c['requires_website_confirmation'])
  self.assertEqual(self.redemption(h,c).status_code,200)
  self.assertEqual(self.redemption(h,c).status_code,200)
  self.assertEqual(self.claim(h,10,'different').status_code,409)

 def test_legacy_mesh_native_scale_and_uv(self):
  from app.roblox_binary import mesh
  vertex=b'[2,0,0][0,1,0][.25,.75,0]'
  result=mesh(b'version 1.00\r\n1\r\n'+vertex*3)
  self.assertEqual(result['position'][0],[1,0,0]);self.assertEqual(result['uv'][0],[.25,.25])
  with self.assertRaises(ValueError):mesh(b'version 1.00\n2\n'+vertex*3)

 def test_visually_rejected_hair_is_not_claimed_compatible(self):
  from app.appearance import appearance
  from app.roblox_binary import UnsupportedAsset
  with self.assertRaises(UnsupportedAsset):
   asyncio.run(appearance({'asset_id':12980879256,'asset_type':41}))

 def test_real_face_reference_trailing_whitespace(self):
  from app.roblox_binary import asset_reference
  self.assertEqual(asset_reference('http://www.roblox.com/asset/?id=144080495 '),144080495)
