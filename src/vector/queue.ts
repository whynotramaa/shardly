/** Binary heap. compare(a, b) < 0 puts a before b. */
export class PriorityQueue<T> {
  private rows: T[] = [];
  constructor(private readonly compare: (a: T, b: T) => number) {}
  get size() { return this.rows.length; }
  peek() { return this.rows[0]; }
  push(row: T) {
    this.rows.push(row);
    let i = this.rows.length - 1;
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (this.compare(row, this.rows[parent]!) >= 0) break;
      this.rows[i] = this.rows[parent]!; i = parent;
    }
    this.rows[i] = row;
  }
  pop(): T | undefined {
    const first = this.rows[0], last = this.rows.pop();
    if (!this.rows.length) return first;
    let i = 0;
    while (i * 2 + 1 < this.rows.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.rows.length && this.compare(this.rows[child + 1]!, this.rows[child]!) < 0) child++;
      if (this.compare(last!, this.rows[child]!) <= 0) break;
      this.rows[i] = this.rows[child]!; i = child;
    }
    this.rows[i] = last!;
    return first;
  }
  sorted() { return [...this.rows].sort(this.compare); }
  clear() { this.rows = []; }
}

/** Bounded double-ended heap with periodic removal of stale references. */
export class BoundedQueue<T> {
  private readonly active = new Set<{ value: T }>();
  private readonly min: PriorityQueue<{ value: T }>;
  private readonly max: PriorityQueue<{ value: T }>;
  constructor(private capacity: number, private compare: (a: T, b: T) => number) {
    this.min = new PriorityQueue((a, b) => compare(a.value, b.value));
    this.max = new PriorityQueue((a, b) => compare(b.value, a.value));
  }
  get size() { return this.active.size; }
  push(value: T) {
    while (this.max.peek() && !this.active.has(this.max.peek()!)) this.max.pop();
    if (this.active.size >= this.capacity) {
      if (this.compare(value, this.max.peek()!.value) >= 0) return;
      this.active.delete(this.max.pop()!);
    }
    const row = { value }; this.active.add(row); this.min.push(row); this.max.push(row);
    this.compact();
  }
  pop(): T | undefined {
    while (this.min.peek() && !this.active.has(this.min.peek()!)) this.min.pop();
    const row = this.min.pop(); if (!row) return;
    this.active.delete(row); this.compact(); return row.value;
  }
  private compact() {
    if (this.min.size <= this.capacity * 2 && this.max.size <= this.capacity * 2) return;
    this.min.clear(); this.max.clear();
    for (const row of this.active) { this.min.push(row); this.max.push(row); }
  }
}
