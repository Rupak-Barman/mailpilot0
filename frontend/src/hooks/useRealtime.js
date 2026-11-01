import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { API_URL } from "../utils/constants";
import { useAuth } from "./useAuth";
import { DebouncedInvalidator } from "../utils/realtimeInvalidator";

/**
 * useRealtime
 * Establishes an authenticated Server-Sent Events (SSE) connection
 * using @microsoft/fetch-event-source (sending Authorization header,
 * avoiding tokens in the URL).
 *
 * Listens for:
 * - "emailAction.changed" -> invalidates list, summary, detail queries
 * - "analytics.changed"   -> invalidates analytics queries
 * - "sync.changed"        -> invalidates sync-status query
 *
 * Debounces bursts to at most once per 500 ms.
 * Reconnects with exponential backoff and refetches on reconnect.
 */
export const useRealtime = () => {
  const queryClient = useQueryClient();
  const { token } = useAuth();
  const [status, setStatus] = useState("connecting"); // "connecting" | "live" | "reconnecting" | "disconnected"

  const reconnectAttemptRef = useRef(0);
  const hadConnectedRef = useRef(false);
  const abortControllerRef = useRef(null);
  const invalidatorRef = useRef(null);

  if (!invalidatorRef.current) {
    invalidatorRef.current = new DebouncedInvalidator(queryClient, { debounceMs: 500 });
  }

  useEffect(() => {
    const authToken = token || localStorage.getItem("sendora_token");
    if (!authToken) {
      setStatus("disconnected");
      return;
    }

    let isMounted = true;
    const ctrl = new AbortController();
    abortControllerRef.current = ctrl;

    const baseUrl = import.meta.env.VITE_API_URL || API_URL || "http://localhost:3000";
    const url = `${baseUrl}/events`;

    const connect = async () => {
      try {
        await fetchEventSource(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${authToken}`,
            Accept: "text/event-stream"
          },
          signal: ctrl.signal,
          async onopen(response) {
            if (response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
              if (isMounted) {
                setStatus("live");
                // One refetch after a successful reconnect
                if (hadConnectedRef.current) {
                  queryClient.invalidateQueries({ queryKey: ["email-actions"] });
                  queryClient.invalidateQueries({ queryKey: ["email-action-summary"] });
                  queryClient.invalidateQueries({ queryKey: ["analytics"] });
                  queryClient.invalidateQueries({ queryKey: ["sync-status"] });
                }
                hadConnectedRef.current = true;
                reconnectAttemptRef.current = 0;
              }
              return;
            } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
              if (isMounted) setStatus("disconnected");
              throw new Error(`Fatal auth error: ${response.status}`);
            } else {
              throw new Error(`SSE connect error with status ${response.status}`);
            }
          },
          onmessage(msg) {
            if (!msg.data) return;
            try {
              const event = JSON.parse(msg.data);
              if (event?.type) {
                invalidatorRef.current.schedule(event.type);
              }
            } catch {
              // Ignore ping / comments
            }
          },
          onclose() {
            if (isMounted) {
              setStatus("reconnecting");
            }
            throw new Error("Stream closed by server");
          },
          onerror(err) {
            if (ctrl.signal.aborted) return;
            if (isMounted) {
              setStatus("reconnecting");
            }
            reconnectAttemptRef.current += 1;
            // Exponential backoff with ceiling (1s, 2s, 4s, 8s, up to 16s)
            const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current - 1), 16000);
            return delay;
          }
        });
      } catch {
        if (!ctrl.signal.aborted && isMounted) {
          setStatus("reconnecting");
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      ctrl.abort();
      if (invalidatorRef.current) {
        invalidatorRef.current.cancel();
      }
    };
  }, [token, queryClient]);

  return { status };
};
