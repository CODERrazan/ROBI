from pathlib import Path
import json,struct,base64,os,copy
src=json.loads(Path('docs/dressing-audit/native-r15-data.json').read_text())
out=Path('Models');data=bytearray();views=[];access=[]
def attr(rows,kind,ctype=5126):
 global data
 while len(data)%4:data.append(0)
 off=len(data);fmt='f' if ctype==5126 else 'H'
 flat=[x for row in rows for x in (row if isinstance(row,(list,tuple)) else [row])]
 data.extend(struct.pack('<'+fmt*len(flat),*flat))
 views.append({'buffer':0,'byteOffset':off,'byteLength':len(data)-off})
 a={'bufferView':len(views)-1,'componentType':ctype,'count':len(rows),'type':kind}
 if kind=='VEC3':a.update(min=[min(row[j] for row in rows) for j in range(3)],max=[max(row[j] for row in rows) for j in range(3)])
 access.append(a);return len(access)-1
def meshread(b):
 st=b.index(b'\n')+1;hs,vs,fs,nv,nf=struct.unpack_from('<HBBII',b,st);v=[struct.unpack_from('<8f',b,st+hs+i*vs) for i in range(nv)]
 return {'position':[x[:3] for x in v],'normal':[x[3:6] for x in v],'uv':[x[6:8] for x in v],'faces':[struct.unpack_from('<3I',b,st+hs+nv*vs+i*fs) for i in range(nf)]}
src['meshes']['Head']=meshread(Path('docs/dressing-audit/native-head.mesh').read_bytes())
parts=src['parts'];origin=parts['HumanoidRootPart']['center'];ground=min(p['center'][1]-p['size'][1]/2 for n,p in parts.items() if n.endswith('Foot'))
def centered(p):return [p[0]-origin[0],p[1]-ground,p[2]-origin[2]]
parent={'Root':None,'HumanoidRootNode':'Root','LowerTorso':'HumanoidRootNode','UpperTorso':'LowerTorso','Head':'UpperTorso'}
for side in ['Left','Right']:
 for part,pa in [('UpperArm','UpperTorso'),('LowerArm',side+'UpperArm'),('Hand',side+'LowerArm'),('UpperLeg','LowerTorso'),('LowerLeg',side+'UpperLeg'),('Foot',side+'LowerLeg')]:parent[side+part]=pa
names=list(parent);pivots={'Root':[0,0,0],'HumanoidRootNode':centered(origin)}
for name in names[2:]:
 p=parts[name]
 att=('RootRigAttachment' if name=='LowerTorso' else 'WaistRigAttachment' if name=='UpperTorso' else 'NeckRigAttachment' if name=='Head' else name[:4 if name.startswith('Left') else 5]+('ShoulderRigAttachment' if name.endswith('UpperArm') else 'ElbowRigAttachment' if name.endswith('LowerArm') else 'WristRigAttachment' if name.endswith('Hand') else 'HipRigAttachment' if name.endswith('UpperLeg') else 'KneeRigAttachment' if name.endswith('LowerLeg') else 'AnkleRigAttachment'))
 offset=p['attachments'].get(att,[0,0,0]);pivots[name]=centered([p['center'][j]+offset[j] for j in range(3)])
nodes=[]
for name in names:
 pa=parent[name];xyz=pivots[name];rel=[xyz[j]-(pivots[pa][j] if pa else 0) for j in range(3)]
 nodes.append({'name':name,'translation':rel,'children':[names.index(n) for n in names if parent[n]==name]})
materials=[{'name':n,'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':0.85}} for n in ['Torso','LeftArm','RightArm','LeftLeg','RightLeg','Head']]
meshes=[]
for name,m in src['meshes'].items():
 p=parts[name];center=centered(p['center']);mins=[min(v[j] for v in m['position']) for j in range(3)];maxs=[max(v[j] for v in m['position']) for j in range(3)]
 positions=[[center[j]+(v[j]-(mins[j]+maxs[j])/2)*p['size'][j]/(maxs[j]-mins[j]) for j in range(3)] for v in m['position']]
 if name=='Head':
  transform=json.loads(Path('docs/dressing-audit/head-mesh-transform.json').read_text())
  positions=[[center[j]+v[j]*transform['scale'][j]+transform['offset'][j] for j in range(3)] for v in m['position']]
 group='Head' if name=='Head' else 'Torso' if 'Torso' in name else ('Left' if name.startswith('Left') else 'Right')+('Arm' if 'Arm' in name or 'Hand' in name else 'Leg')
 normals=m['normal'];uv=m['uv']
 ats={'POSITION':attr(positions,'VEC3'),'NORMAL':attr(normals,'VEC3'),'TEXCOORD_0':attr(uv,'VEC2'),'JOINTS_0':attr([[names.index(name),0,0,0] for v in positions],'VEC4',5123),'WEIGHTS_0':attr([[1,0,0,0] for v in positions],'VEC4')}
 indices=attr([i for face in m['faces'] for i in face],'SCALAR',5123)
 meshes.append({'name':name+'_Geo','primitives':[{'attributes':ats,'indices':indices,'material':[x['name'] for x in materials].index(group)}]})
 nodes.append({'name':name+'_Geo','mesh':len(meshes)-1,'skin':0,'extras':{'bodyRegion':group,'nativeMeshAssetId':m.get('asset_id')}})
inverses=[]
for n in names:
 x,y,z=pivots[n];inverses.append([1,0,0,0,0,1,0,0,0,0,1,0,-x,-y,-z,1])
ib=attr(inverses,'MAT4')
g={'asset':{'version':'2.0','generator':'ROBI native R15 conversion; original model files untouched'},'scene':0,'scenes':[{'nodes':[0]+list(range(len(names),len(nodes)))}],'nodes':nodes,'meshes':meshes,'materials':materials,'skins':[{'joints':list(range(len(names))),'skeleton':0,'inverseBindMatrices':ib}],'accessors':access,'bufferViews':views,'buffers':[{'byteLength':len(data),'uri':'data:application/octet-stream;base64,'+base64.b64encode(data).decode()}]}
(out/'ROBI_Classic_R15.gltf').write_text(json.dumps(g,separators=(',',':')),encoding='utf-8')
(out/'ClassicUV.json').write_text(json.dumps(src['compositors'],separators=(',',':')),encoding='utf-8')
Path('docs/dressing-audit/rig-conversion.json').write_text(json.dumps({'source':src['source'],'native_mesh_ids':{n:m.get('asset_id') for n,m in src['meshes'].items()},'joints':names,'meshes':len(meshes),'uv_mapping':'Roblox R15 compositor data: torso388x272, limbs264x284; native UVs unchanged','original_models_modified':False},indent=2),encoding='utf-8')
print('generated',len(meshes),'skinned meshes',len(names),'joints',len(data),'bytes')
