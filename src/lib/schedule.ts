// Places the classes of one timetable day on a grid of 12 sub-columns, so that
// classes can last several time slots (`span`) and the others fill the rest.
// public/admin/brochure.js has the same logic for the printed brochure.
export const SUB = 12;

export interface Placed { c: any; row: number; col: number; width: number; rows: number }

export function layoutDay(slots: any[]): Placed[] {
  const taken = slots.map(() => new Set<number>());
  const out: Placed[] = [];
  slots.forEach((s, r) => {
    if (s.isBreak || !s.classes?.length) return;
    const free = [...Array(SUB).keys()].filter((x) => !taken[r].has(x));
    const n = s.classes.length;
    s.classes.forEach((c: any, i: number) => {
      const cols = free.slice(Math.round((i * free.length) / n), Math.round(((i + 1) * free.length) / n));
      if (!cols.length) return;
      // a class may continue into the next slots, but never across a break
      let rows = 1;
      while (rows < (Number(c.span) || 1) && r + rows < slots.length && !slots[r + rows].isBreak) rows++;
      for (let j = 1; j < rows; j++) cols.forEach((x) => taken[r + j].add(x));
      out.push({ c, row: r, col: cols[0], width: cols.length, rows });
    });
  });
  return out;
}
