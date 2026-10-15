/**
 * Turns a (possibly huge) async sequence of CSV text chunks into a download. The chunks are pulled one at a time as the browser takes them,
 * so nothing is held in memory beyond the chunk in flight, the download starts at once, and if the user cancels it the reading stops.
 */
export function csvDownloadResponse(chunks: AsyncGenerator<string>, filename: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\- ]+/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** A filename-safe stamp, e.g. 2026-10-15. */
export const todayStamp = () => new Date().toISOString().slice(0, 10);
