export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${m}`;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function countLines(text: string): number {
  return (text.match(/\n/g) || []).length + 1;
}

export function getFirstLine(text: string, maxChars = 60): string {
  const line = text.split("\n")[0] || "";
  return truncateText(line.trim(), maxChars);
}
