import { subscribeRunsEvents } from "@/src/server/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  let unsubscribe: (() => void) | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const closeStream = () => {
        if (closed) {
          return;
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // Stream is already closed.
        }
      };

      unsubscribe = subscribeRunsEvents({
        write(event: string, data?: unknown) {
          if (closed) {
            return;
          }
          try {
            controller.enqueue(encoder.encode(`event: ${event}\n`));
            if (data !== undefined) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n`));
            }
            controller.enqueue(encoder.encode("\n"));
          } catch {
            closeStream();
          }
        },
        close() {
          closeStream();
        },
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
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
