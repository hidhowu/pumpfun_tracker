/** The exit styles of a live wallet (db/live/trading/styles.js): "own", "follow", and the cool-down styles "cd<seconds>". */
export function styleLabel(id: string): string {
  if (id === "own") return "Its own entry";
  if (id === "follow") return "Follow simulation";
  const seconds = Number(id.slice(2)) || 0;
  return `Cool-down ${seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`}`;
}
