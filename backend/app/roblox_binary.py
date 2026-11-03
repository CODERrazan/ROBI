"""Bounded, read-only decoding of rigid Roblox accessory data.
No scripts are executed. Unsupported encodings fail closed.
"""
from __future__ import annotations
import math,struct,xml.etree.ElementTree as ET
from urllib.parse import urlparse,parse_qs

class UnsupportedAsset(ValueError):pass

def asset_reference(value:str)->int:
 value=value.strip()
 if value.startswith('rbxassetid://'):value=value[13:]
 else:
  p=urlparse(value)
  if p.scheme not in ('https','http') or p.hostname not in ('www.roblox.com','roblox.com') or p.path.rstrip('/')!='/asset':raise ValueError('Invalid asset reference')
  value=parse_qs(p.query).get('id',[''])[0]
 if not value.isdecimal() or not 0<int(value)<2**53:raise ValueError('Invalid asset ID')
 return int(value)

def lz4(source:bytes,expected:int)->bytes:
 if not 0<=expected<=4_000_000:raise ValueError('Chunk too large')
 out=bytearray();p=0
 def extension(n):
  nonlocal p
  if n==15:
   while True:
    v=source[p];p+=1;n+=v
    if n>expected:raise ValueError('Invalid LZ4 length')
    if v!=255:break
  return n
 while p<len(source):
  token=source[p];p+=1;length=extension(token>>4)
  if p+length>len(source) or len(out)+length>expected:raise ValueError('Truncated LZ4')
  out.extend(source[p:p+length]);p+=length
  if p==len(source):break
  offset=int.from_bytes(source[p:p+2],'little');p+=2;length=extension(token&15)+4
  if not 0<offset<=len(out) or len(out)+length>expected:raise ValueError('Invalid LZ4 offset')
  for _ in range(length):out.append(out[-offset])
 if len(out)!=expected:raise ValueError('Invalid decompressed length')
 return bytes(out)

class Reader:
 def __init__(self,data):self.data=data;self.p=0
 def take(self,n):
  if n<0 or self.p+n>len(self.data):raise ValueError('Truncated asset')
  value=self.data[self.p:self.p+n];self.p+=n;return value
 def unpack(self,fmt):return struct.unpack(fmt,self.take(struct.calcsize(fmt)))
 def u32(self):return self.unpack('<I')[0]
 def string(self):return self.take(self.u32()).decode('utf-8')
 def interleaved(self,n,kind):
  data=self.take(n*4);values=[int.from_bytes(bytes(data[i+j*n] for j in range(4)),'big') for i in range(n)]
  if kind=='float':return [struct.unpack('<f',struct.pack('<I',(x>>1)|((x&1)<<31)))[0] for x in values]
  if kind=='int':return [(x>>1)^-(x&1) for x in values]
  return values
 def refs(self,n):
  values=self.interleaved(n,'int');total=0;out=[]
  for v in values:total+=v;out.append(total)
  return out
 def vectors(self,n):return list(map(list,zip(*(self.interleaved(n,'float') for _ in range(3)))))
 def frames(self,n):
  rotations=[]
  # Encoded axis-aligned CFrames: axis directions indexed X,Y,Z,-X,-Y,-Z.
  axes=[[1,0,0],[0,1,0],[0,0,1],[-1,0,0],[0,-1,0],[0,0,-1]]
  for _ in range(n):
   ident=self.take(1)[0]
   if ident==0:rotations.append(list(self.unpack('<9f')))
   else:
    a=(ident-1)//6;b=(ident-1)%6
    if a>=6 or abs(sum(axes[a][j]*axes[b][j] for j in range(3)))>0:raise ValueError('Invalid CFrame rotation')
    x,y=axes[a],axes[b];z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]]
    rotations.append([x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]])
  return [{'rotation':r,'position':p} for r,p in zip(rotations,self.vectors(n))]

def model(raw:bytes)->list[dict]:
 if not raw.startswith(b'<roblox!\x89\xff\r\n\x1a\n'):
  raise UnsupportedAsset('Only binary rigid accessory models are supported')
 if len(raw)>4_000_000:raise ValueError('Model too large')
 version,classes_count,count=struct.unpack_from('<HII',raw,14)
 if version!=0 or classes_count>64 or count>128:raise UnsupportedAsset('Unsupported model complexity')
 reader=Reader(raw[32:]);classes={};instances={};total=0
 while reader.p<len(reader.data):
  tag=reader.take(4).rstrip(b'\0');compressed,size,_=reader.unpack('<III')
  if size>4_000_000:raise ValueError('Chunk too large')
  chunk=reader.take(compressed or size);total+=size
  if total>8_000_000:raise ValueError('Model expansion limit')
  if compressed:
   if chunk.startswith(b'\x28\xb5\x2f\xfd'):raise UnsupportedAsset('Zstandard accessory encoding is not supported')
   chunk=lz4(chunk,size)
  r=Reader(chunk)
  if tag==b'INST':
   cid=r.u32();name=r.string();r.take(1);n=r.u32()
   if n>128:raise ValueError('Too many instances')
   refs=r.refs(n);classes[cid]=refs
   for ref in refs:instances[ref]={'class':name,'ref':ref,'properties':{}}
  elif tag==b'PROP':
   cid=r.u32();name=r.string();typ=r.take(1)[0];refs=classes[cid];n=len(refs)
   # Decode only the properties consumed by the rigid renderer.
   wanted={'Name','MeshId','TextureId','TextureID','Scale','Offset','VertexColor','size','Size','InitialSize','CFrame','AttachmentPoint','Value','MeshType','Transparency'}
   if name not in wanted:continue
   if typ==1:values=[r.string() for _ in range(n)]
   elif typ==4:values=r.interleaved(n,'float')
   elif typ==14:values=r.vectors(n)
   elif typ==16:values=r.frames(n)
   elif typ==18:values=r.interleaved(n,'uint')
   else:continue
   for ref,value in zip(refs,values):instances[ref]['properties'][name]=value
  elif tag==b'PRNT':
   if r.take(1)!=b'\0':raise ValueError('Unsupported hierarchy')
   n=r.u32()
   if n>128:raise ValueError('Hierarchy too large')
   children,parents=r.refs(n),r.refs(n)
   for child,parent in zip(children,parents):instances[child]['parent']=parent
  elif tag==b'END':break
 return list(instances.values())

def rigid_descriptor(raw:bytes)->dict:
 nodes=model(raw);by_id={x['ref']:x for x in nodes}
 if any(x['class'] in ('WrapLayer','WrapTarget','Bone','SurfaceAppearance') for x in nodes):raise UnsupportedAsset('Wrapping, deformable mesh or PBR surface is not supported')
 handles=[x for x in nodes if x['class'] in ('Part','MeshPart') and x['properties'].get('Name')=='Handle']
 if len(handles)!=1:raise UnsupportedAsset('Accessory must have one rigid Handle')
 handle=handles[0];props=handle['properties']
 if by_id.get(handle.get('parent'),{}).get('class')!='Accessory':raise UnsupportedAsset('Handle is not owned by an Accessory')
 if props.get('Transparency',0)!=0:raise UnsupportedAsset('Non-opaque Handle is not supported')
 attachments=[x for x in nodes if x['class']=='Attachment' and x.get('parent')==handle['ref']]
 if len(attachments)!=1:raise UnsupportedAsset('Accessory must have one supported attachment')
 attachment=attachments[0]['properties'];frame=attachment.get('CFrame')
 if not frame:raise UnsupportedAsset('Attachment transform unavailable')
 if handle['class']=='Part':
  meshes=[x for x in nodes if x['class']=='SpecialMesh' and x.get('parent')==handle['ref']]
  if len(meshes)!=1 or meshes[0]['properties'].get('MeshType')!=5:raise UnsupportedAsset('Only file-based rigid meshes are supported')
  p=meshes[0]['properties'];scale=p.get('Scale',[1,1,1]);offset=p.get('Offset',[0,0,0])
 else:
  p=props;initial=p.get('InitialSize');size=p.get('size',p.get('Size'))
  if not initial or not size or any(v<=0 for v in initial):raise UnsupportedAsset('MeshPart size information unavailable')
  scale=[size[j]/initial[j] for j in range(3)];offset=[0,0,0]
 if any(not math.isfinite(x) or abs(x)>20 for x in scale+offset+frame['position']+frame['rotation']) or any(x<=0 for x in scale):raise ValueError('Invalid accessory transform')
 r=frame['rotation']
 for row in range(3):
  if abs(sum(r[row*3+j]**2 for j in range(3))-1)>.01:raise ValueError('Non-orthogonal attachment')
 for row in range(3):
  for other in range(row):
   if abs(sum(r[row*3+j]*r[other*3+j] for j in range(3)))>.01:raise ValueError('Non-orthogonal attachment')
 determinant=r[0]*(r[4]*r[8]-r[5]*r[7])-r[1]*(r[3]*r[8]-r[5]*r[6])+r[2]*(r[3]*r[7]-r[4]*r[6])
 if abs(determinant-1)>.01:raise ValueError('Invalid attachment handedness')
 return {'mesh_asset_id':asset_reference(p.get('MeshId','')),'texture_asset_id':asset_reference(p.get('TextureId',p.get('TextureID',''))),
         'scale':scale,'offset':offset,'attachment':attachment['Name'],'attachment_frame':frame,
         'vertex_color':p.get('VertexColor',[1,1,1])}

def mesh(raw:bytes)->dict:
 line,_,rest=raw.partition(b'\n');line=line.rstrip(b'\r')
 if line in (b'version 1.00',b'version 1.01'):
  import re
  count,_,data=rest.partition(b'\n');nf=int(count)
  if not 1<=nf<=10000 or len(raw)>4_000_000:raise UnsupportedAsset('Legacy mesh exceeds geometry limits')
  groups=re.findall(rb'\[([^\[\]]+)\]',data)
  if len(groups)!=nf*9 or re.sub(rb'\[[^\[\]]+\]',b'',data).strip():raise ValueError('Invalid legacy mesh structure')
  vectors=[tuple(float(v) for v in group.split(b',')) for group in groups]
  if any(len(v)!=3 or any(not math.isfinite(x) or abs(x)>1000 for x in v) for v in vectors):raise ValueError('Invalid legacy mesh values')
  scale=.5 if line==b'version 1.00' else 1
  positions=[[x*scale for x in vectors[i]] for i in range(0,len(vectors),3)]
  normals=vectors[1::3];uv=[[v[0],1-v[1]] for v in vectors[2::3]]
  if any(abs(x)>2 for pair in uv for x in pair):raise UnsupportedAsset('Unsupported mesh UV range')
  return {'position':positions,'normal':normals,'uv':uv,'indices':list(range(nf*3)),'bounds':{'min':[min(v[j] for v in positions) for j in range(3)],'max':[max(v[j] for v in positions) for j in range(3)]},'version':line.decode()}
 if line in (b'version 4.00',b'version 4.01'):
  hs,lod_type,nv,nf,nlod,nb,nn,ns,hq,_=struct.unpack_from('<HHIIHHIHBB',rest)
  if hs!=24 or nb:raise UnsupportedAsset('Skinned accessory mesh is not supported')
  stride=40;face_size=12
 elif line==b'version 2.00':
  hs,stride,face_size,nv,nf=struct.unpack_from('<HBBII',rest);nlod=0
  if hs!=12 or stride not in (36,40) or face_size!=12:raise ValueError('Invalid mesh header')
 else:raise UnsupportedAsset('Unsupported accessory mesh version: '+line[:40].decode('ascii',errors='replace'))
 if not 3<=nv<=30000 or not 1<=nf<=40000:raise UnsupportedAsset('Accessory exceeds renderer geometry limits')
 start=hs+nv*stride;end=start+nf*12
 if end+nlod*4>len(rest):raise ValueError('Truncated mesh')
 faces=[struct.unpack_from('<3I',rest,start+i*12) for i in range(nf)]
 if nlod:
  lods=struct.unpack_from('<'+'I'*nlod,rest,end)
  if len(lods)<2 or lods[0]!=0 or not 0<lods[1]<=nf:raise ValueError('Invalid LOD data')
  faces=faces[:lods[1]]
 if stride==40 and any(rest[hs+i*stride+36:hs+i*stride+40]!=b'\xff\xff\xff\xff' for i in range(nv)):raise UnsupportedAsset('Per-vertex accessory coloring is not supported')
 vertices=[struct.unpack_from('<8f',rest,hs+i*stride) for i in range(nv)]
 if any(not math.isfinite(v) or abs(v)>1000 for row in vertices for v in row) or any(i>=nv for face in faces for i in face):raise ValueError('Invalid mesh values')
 if any(abs(row[6])>2 or abs(row[7])>2 for row in vertices):raise UnsupportedAsset('Unsupported mesh UV range')
 return {'position':[x[:3] for x in vertices],'normal':[x[3:6] for x in vertices],'uv':[x[6:8] for x in vertices],'indices':[i for f in faces for i in f],
         'bounds':{'min':[min(x[j] for x in vertices) for j in range(3)],'max':[max(x[j] for x in vertices) for j in range(3)]},'version':line.decode()}
