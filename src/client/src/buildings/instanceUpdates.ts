import type { InstancedBufferAttribute } from 'three';

/** Compare the actual Float32 values, not doubles, and upload only changed components.
 * Keep pending ranges until Three consumes them: a hidden/shadow-culled mesh may
 * go several frames without an upload. The range object is reused after consumption.
 */
export class InstanceUpdates {
  private first = Infinity;
  private end = 0;
  private range = { start: 0, count: 0 };
  readonly array: Float32Array;

  constructor(readonly attribute: InstancedBufferAttribute) {
    this.array = attribute.array as Float32Array;
  }

  set(index: number, value: number): void {
    value = Math.fround(value);
    if (Object.is(this.array[index], value)) return;
    this.array[index] = value;
    if (index < this.first) this.first = index;
    if (index >= this.end) this.end = index + 1;
  }

  write(offset: number, values: ArrayLike<number>): void {
    for (let i = 0; i < values.length; i++) this.set(offset + i, values[i]);
  }

  flush(): void {
    if (this.first === Infinity) return;
    const ranges = this.attribute.updateRanges;
    // We own the ranges on this attribute. Union with an unconsumed upload,
    // including writes to records that became inactive in the meantime.
    if (ranges.length) {
      const pending = ranges[0];
      const end = Math.max(pending.start + pending.count, this.end);
      pending.start = Math.min(pending.start, this.first);
      pending.count = end - pending.start;
    } else {
      this.range.start = this.first;
      this.range.count = this.end - this.first;
      ranges.push(this.range);
    }
    this.attribute.needsUpdate = true;
    this.first = Infinity;
    this.end = 0;
  }
}
