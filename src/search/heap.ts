/** A bounded heap. The least desirable row stays at the root. */
export class TopHeap<T> {
  private rows: T[] = [];
  constructor(
    private capacity: number,
    private compare: (a: T, b: T) => number,
  ) {}
  offer(row: T): void {
    if (!this.capacity) return;
    if (this.rows.length < this.capacity) {
      this.rows.push(row);
      let i = this.rows.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.compare(this.rows[i]!, this.rows[p]!) <= 0) break;
        [this.rows[i], this.rows[p]] = [this.rows[p]!, this.rows[i]!];
        i = p;
      }
    } else if (this.compare(row, this.rows[0]!) < 0) {
      this.rows[0] = row;
      let i = 0;
      for (;;) {
        let worst = i;
        for (const child of [i * 2 + 1, i * 2 + 2])
          if (
            child < this.rows.length &&
            this.compare(this.rows[child]!, this.rows[worst]!) > 0
          )
            worst = child;
        if (worst === i) break;
        [this.rows[i], this.rows[worst]] = [this.rows[worst]!, this.rows[i]!];
        i = worst;
      }
    }
  }
  sorted(): T[] {
    return this.rows.sort(this.compare);
  }
}
