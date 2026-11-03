// ROBI avatar configuration: schema, validation, immutable edits, and Roblox payload export.
// This is the single source of truth that both the web preview and the Roblox experience consume.
// NOTE: slot names below must be confirmed against the HumanoidDescription reference before shipping.

export const R15_PARTS = ['HumanoidRootPart','LowerTorso','UpperTorso','Head','LeftUpperArm','LeftLowerArm','LeftHand','RightUpperArm','RightLowerArm','RightHand','LeftUpperLeg','LeftLowerLeg','LeftFoot','RightUpperLeg','RightLowerLeg','RightFoot'];
export const R15_PARENT = { LowerTorso:'HumanoidRootPart', UpperTorso:'LowerTorso', Head:'UpperTorso',
  LeftUpperArm:'UpperTorso', LeftLowerArm:'LeftUpperArm', LeftHand:'LeftLowerArm',
  RightUpperArm:'UpperTorso', RightLowerArm:'RightUpperArm', RightHand:'RightLowerArm',
  LeftUpperLeg:'LowerTorso', LeftLowerLeg:'LeftUpperLeg', LeftFoot:'LeftLowerLeg',
  RightUpperLeg:'LowerTorso', RightLowerLeg:'RightUpperLeg', RightFoot:'RightLowerLeg' };

// multi = several items allowed in the slot
export const SLOTS = { hair:{multi:false}, hat:{multi:true}, face:{multi:false}, faceAccessory:{multi:true}, neckAccessory:{multi:true},
  shouldersAccessory:{multi:true}, frontAccessory:{multi:true}, backAccessory:{multi:true}, waistAccessory:{multi:true},
  shirt:{multi:false}, pants:{multi:false}, tshirt:{multi:false}, layered:{multi:true, needsType:true} };
export const BODY_COLOR_KEYS = ['head','torso','leftArm','rightArm','leftLeg','rightLeg'];
export const SCALE_KEYS = ['height','width','head','bodyType','proportion'];

export const emptyConfig = () => ({ version:1, rigType:'R15',
  bodyColors:Object.fromEntries(BODY_COLOR_KEYS.map(k => [k,'#E8B590'])),
  scales:{ height:1, width:1, head:1, bodyType:0, proportion:0 }, items:[] });

const HEX = /^#[0-9a-fA-F]{6}$/;
const key = it => it.source === 'roblox' ? `r:${it.assetId}` : `m:${it.mockId}`;

export function validateItem(it) {
  const e = [];
  if (!it || typeof it !== 'object') return ['item must be an object'];
  if (!SLOTS[it.slot]) e.push(`unknown slot "${it.slot}"`);
  if (typeof it.name !== 'string' || !it.name) e.push('name is required');
  if (it.source === 'roblox') {
    if (!Number.isSafeInteger(it.assetId) || it.assetId <= 0) e.push('roblox item needs a positive integer assetId');
    if (it.verified !== true) e.push('roblox item must be verified against the real catalog before use');
  } else if (it.source === 'mock') {
    if ('assetId' in it) e.push('mock item must not carry an assetId');
    if (typeof it.mockId !== 'string' || !it.mockId) e.push('mock item needs a mockId');
  } else e.push('source must be "roblox" or "mock"');
  if (SLOTS[it.slot]?.needsType && !it.accessoryType) e.push('layered item needs accessoryType');
  if (it.price !== undefined && (!Number.isFinite(it.price) || it.price < 0)) e.push('price must be a non-negative number');
  return e;
}

export function validateConfig(c) {
  const e = [];
  if (!c || c.version !== 1) e.push('unsupported version');
  if (c?.rigType !== 'R15') e.push('rigType must be R15');
  for (const k of BODY_COLOR_KEYS) if (!HEX.test(c?.bodyColors?.[k] ?? '')) e.push(`bodyColors.${k} must be #RRGGBB`);
  for (const k of SCALE_KEYS) if (!Number.isFinite(c?.scales?.[k])) e.push(`scales.${k} must be a number`);
  const seen = new Set(), singles = new Set();
  (c?.items ?? []).forEach((it, i) => {
    validateItem(it).forEach(m => e.push(`items[${i}]: ${m}`));
    if (seen.has(key(it))) e.push(`items[${i}]: duplicate item`);
    seen.add(key(it));
    if (SLOTS[it.slot] && !SLOTS[it.slot].multi) { if (singles.has(it.slot)) e.push(`items[${i}]: slot "${it.slot}" allows one item`); singles.add(it.slot) }
  });
  return { ok: e.length === 0, errors: e };
}

// Immutable edits: changing one slot never touches the others.
export function setItem(c, it) {
  const errs = validateItem(it); if (errs.length) throw new Error(errs.join('; '));
  const keep = c.items.filter(x => SLOTS[it.slot].multi ? key(x) !== key(it) : x.slot !== it.slot);
  return { ...c, items:[...keep, it] };
}
export const removeItem = (c, slot, id) => ({ ...c, items:c.items.filter(x => !(x.slot === slot && (id === undefined || key(x) === id))) });

// Only verified real items are exported; mock items are reported, never silently sent as real.
export function toRobloxPayload(c) {
  const v = validateConfig(c); if (!v.ok) return { ok:false, errors:v.errors };
  const real = c.items.filter(i => i.source === 'roblox'), excluded = c.items.filter(i => i.source === 'mock');
  return { ok:true, complete:excluded.length === 0, excluded,
    payload:{ rigType:c.rigType, bodyColors:c.bodyColors, scales:c.scales,
      items:real.map(i => ({ slot:i.slot, assetId:i.assetId, ...(i.accessoryType ? {accessoryType:i.accessoryType} : {}) })) } };
}
