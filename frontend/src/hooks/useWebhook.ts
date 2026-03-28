import { useEffect, useState } from "react";
import { WebhookPayload } from "../types/webhook";

export function useWebhook(url: string) {
  const [events, setEvents] = useState<WebhookPayload[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const parsedEvent: WebhookPayload = JSON.parse(event.data);
        setEvents((prev) => [...prev, parsedEvent]);
      } catch {
        setError("Failed to parse webhook event");
      }
    };

    eventSource.onerror = () => {
      setError("Failed to connect to webhook stream");
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [url]);

  return { events, error };
}
