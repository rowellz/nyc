import assert from 'node:assert/strict';
import { createSceneryTransport } from '../static/world/assets/scenery-transport.js';
const workers=[];
const transport=createSceneryTransport(()=>{const worker={sent:[],stopped:false,postMessage(m){this.sent.push(m)},terminate(){this.stopped=true}};workers.push(worker);return worker;});
const controller=new AbortController();
const first=transport.load('/first','0_0','mid',controller.signal);
const w=workers[0],request=w.sent[0];
controller.abort();await assert.rejects(first,/cancelled/);
assert.deepEqual(w.sent[1],{type:'cancel',id:request.id});
w.onmessage({data:{id:request.id,chunk:{stale:true}}});
const next=transport.load('/next','1_0','far',new AbortController().signal);
w.onmessage({data:{id:w.sent.at(-1).id,chunk:{key:'1_0'}}});
assert.deepEqual(await next,{key:'1_0'});
const failed=transport.load('/failed','2_0','far',new AbortController().signal);
w.onerror();await assert.rejects(failed,/worker failed/);assert(w.stopped);
const retry=transport.load('/retry','2_0','far',new AbortController().signal);
assert.equal(workers.length,2,'failed workers are recreated on retry');
transport.dispose();await assert.rejects(retry,/disposed/);assert(workers[1].stopped);
await assert.rejects(transport.load('/late','0_0','mid',new AbortController().signal),/cancelled/);
console.log('PASS scenery worker transport: cancellation, late replies, errors, retry and disposal');

// Reject an inflated payload while streaming; never join an oversized buffer.
const {readSceneryBuffer}=await import('../static/world/assets/scenery-format.js');
let cancelled=false;
const oversized=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(80));},cancel(){cancelled=true;}});
await assert.rejects(readSceneryBuffer(oversized,100),/decode budget/);assert(cancelled);
const exact=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4]));c.close();}});
assert.deepEqual([...new Uint8Array(await readSceneryBuffer(exact,4))],[1,2,3,4]);
console.log('PASS inflated scenery limit rejects oversized streams before joining buffers');
