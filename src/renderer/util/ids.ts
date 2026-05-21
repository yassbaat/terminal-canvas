let counter = 0;
const timestamp = Date.now().toString(36);

export function generateId(prefix = "tc"): string {
  counter++;
  return `${prefix}_${timestamp}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}
