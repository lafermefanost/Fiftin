// node functions/indexshards.test.js
const assert = require("assert");
const ix = require("./indexshards");
assert.strictEqual(ix.shardOf("abc"), ix.shardOf("abc"));
const counts = new Array(ix.INDEX_SHARDS).fill(0);
for (let i = 0; i < 20000; i++) counts[ix.shardOf("doc" + i.toString(36) + "x" + (i * 7919).toString(36))]++;
assert.ok(Math.max.apply(null, counts) < 20000 / ix.INDEX_SHARDS * 1.3, "répartition équilibrée : " + Math.max.apply(null, counts));
const d = ix.distribute([{id: "a", data: {n: 1}}, {id: "b", data: {n: 2}}]);
assert.strictEqual(d.length, ix.INDEX_SHARDS);
assert.deepStrictEqual(d[ix.shardOf("a")].a, {n: 1});
assert.deepStrictEqual(ix.staleKeys({a: 1, b: 2, c: 3}, {a: 1}), ["b", "c"]);
assert.deepStrictEqual(ix.staleKeys(undefined, {a: 1}), []);
console.log("indexshards : tous les tests passent");
