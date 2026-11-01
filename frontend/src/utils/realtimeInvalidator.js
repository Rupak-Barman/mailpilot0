/**
 * Debounced query invalidator for realtime events.
 * Aggregates bursts of event types and flushes invalidations
 * at most once per debounceMs (default 500ms).
 */
export class DebouncedInvalidator {
  constructor(queryClient, options = {}) {
    this.queryClient = queryClient;
    this.debounceMs = options.debounceMs ?? 500;
    this.pendingTypes = new Set();
    this.timer = null;
    this.onFlush = options.onFlush || null;
  }

  schedule(type) {
    if (!type) return;
    this.pendingTypes.add(type);

    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.debounceMs);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pendingTypes.size === 0) return;

    const types = new Set(this.pendingTypes);
    this.pendingTypes.clear();

    if (this.queryClient) {
      if (types.has("emailAction.changed")) {
        this.queryClient.invalidateQueries({ queryKey: ["email-actions"] });
        this.queryClient.invalidateQueries({ queryKey: ["email-action-summary"] });
        this.queryClient.invalidateQueries({ queryKey: ["email-action"] });
      }
      if (types.has("analytics.changed")) {
        this.queryClient.invalidateQueries({ queryKey: ["analytics"] });
      }
      if (types.has("sync.changed")) {
        this.queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      }
    }

    if (typeof this.onFlush === "function") {
      this.onFlush(Array.from(types));
    }
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingTypes.clear();
  }
}

export const createDebouncedInvalidator = (queryClient, options) =>
  new DebouncedInvalidator(queryClient, options);
