import { subscribeRunsEvents } from "@/src/server/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const unsubscribe = subscribeRunsEvents({
        write(event: string, data?: unknown) {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          if (data !== undefined) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n`));
          }
          controller.enqueue(encoder.encode("\n"));
        },
        close() {
          controller.close();
        },
      });
      return unsubscribe;
    },
    cancel() {
      // no-op; unsubscribe closes the stream.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
