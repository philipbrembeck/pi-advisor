export interface Item {
  name: string;
  value: number;
}
export function parseItems(input: string): Item[] {
  const order: string[] = [];
  const map = new Map<string, Item>();
  for (const line of input.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) {
      continue;
    }
    const name = line.slice(0, at).trim();
    const value = Number(line.slice(at + 1).trim());
    if (!(name && Number.isFinite(value))) {
      continue;
    }
    if (!map.has(name)) {
      order.push(name);
    }
    map.set(name, { name, value });
  }
  return order
    .map((name) => map.get(name))
    .filter((item): item is Item => item !== undefined);
}
