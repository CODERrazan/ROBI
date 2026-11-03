import test from 'node:test'; import assert from 'node:assert/strict';
import * as A from './avatarConfig.mjs';
// FIXTURE ids below are synthetic test data, NOT real catalog assets.
const real = (slot, assetId, extra={}) => ({ slot, source:'roblox', assetId, verified:true, name:'fixture '+slot, ...extra });
const mock = (slot, mockId) => ({ slot, source:'mock', mockId, name:'mock '+slot });

test('R15 hierarchy is a complete tree rooted at HumanoidRootPart', () => {
  assert.equal(A.R15_PARTS.length, 16);
  for (const p of A.R15_PARTS) { let n = p, d = 0; while (n !== 'HumanoidRootPart') { n = A.R15_PARENT[n]; assert.ok(n, p+' has no parent'); assert.ok(++d < 6) } }
});
test('empty config is valid', () => assert.ok(A.validateConfig(A.emptyConfig()).ok));
test('rejects unverified or malformed real items', () => {
  assert.ok(validateErr(real('hair', -5)));
  assert.ok(validateErr({ ...real('hair', 7), verified:false }));
  assert.ok(validateErr({ slot:'nope', source:'roblox', assetId:3, verified:true, name:'x' }));
});
const validateErr = it => A.validateItem(it).length > 0;
test('mock items cannot carry asset ids', () => assert.ok(validateErr({ ...mock('hair','m1'), assetId:5 })));
test('layered items need accessoryType', () => { assert.ok(validateErr(real('layered', 9))); assert.ok(!validateErr(real('layered', 9, { accessoryType:'Shirt' }))) });
test('changing hair keeps shirt and pants', () => {
  let c = A.setItem(A.emptyConfig(), real('shirt', 11)); c = A.setItem(c, real('pants', 12)); c = A.setItem(c, real('hair', 13)); c = A.setItem(c, real('hair', 14));
  assert.deepEqual(c.items.map(i => i.slot).sort(), ['hair','pants','shirt']); assert.equal(c.items.find(i => i.slot==='hair').assetId, 14);
});
test('accessory slots allow several items, no duplicates', () => {
  let c = A.setItem(A.emptyConfig(), real('hat', 21)); c = A.setItem(c, real('hat', 22)); c = A.setItem(c, real('hat', 22));
  assert.equal(c.items.length, 2); assert.ok(A.validateConfig(c).ok);
});
test('removeItem removes only the target', () => {
  let c = A.setItem(A.setItem(A.emptyConfig(), real('hat', 21)), real('shirt', 11));
  assert.deepEqual(A.removeItem(c, 'hat').items.map(i => i.slot), ['shirt']);
});
test('two single-slot items are invalid', () => {
  const c = { ...A.emptyConfig(), items:[real('shirt',1), real('shirt',2)] }; assert.ok(!A.validateConfig(c).ok);
});
test('payload excludes mock items and says it is incomplete', () => {
  const c = { ...A.emptyConfig(), items:[real('hair',31), mock('shirt','m-shirt')] }, r = A.toRobloxPayload(c);
  assert.ok(r.ok); assert.equal(r.complete, false); assert.equal(r.payload.items.length, 1); assert.equal(r.excluded.length, 1);
});
test('invalid config produces no payload', () => assert.equal(A.toRobloxPayload({ ...A.emptyConfig(), rigType:'R6' }).ok, false));
