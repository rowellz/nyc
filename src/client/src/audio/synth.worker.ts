import { synthSamples } from './synth';
import { finishNow } from '../combat/init';

self.onmessage = (event: MessageEvent<number>) => {
  const samples = finishNow(synthSamples(event.data));
  const transfer = [...samples.noise.map(n => n.data.buffer), ...samples.ir.map(ch => ch.buffer), ...samples.irFar.map(ch => ch.buffer)] as ArrayBuffer[];
  self.postMessage(samples, { transfer });
};
