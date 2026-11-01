// services/events.service.js
import { EventEmitter } from "node:events";

class UserEventBus extends EventEmitter {
  constructor() {
    super();
    // Allow multiple concurrent active connections per user
    this.setMaxListeners(100);
  }

  getUserChannel(userId) {
    return `user:${String(userId)}`;
  }

  publishUserEvent(userId, event) {
    if (!userId || !event || !event.type) return;
    const payload = {
      type: event.type,
      ...(event.threadId ? { threadId: String(event.threadId) } : {}),
      at: event.at || Date.now()
    };
    this.emit(this.getUserChannel(userId), payload);
  }

  subscribeUserEvents(userId, listener) {
    if (!userId || typeof listener !== "function") return () => {};
    const channel = this.getUserChannel(userId);
    this.on(channel, listener);
    return () => {
      this.off(channel, listener);
    };
  }

  getSubscriberCount(userId) {
    const channel = this.getUserChannel(userId);
    return this.listenerCount(channel);
  }
}

export const eventBus = new UserEventBus();
export const publishUserEvent = (userId, event) => eventBus.publishUserEvent(userId, event);
export const subscribeUserEvents = (userId, listener) => eventBus.subscribeUserEvents(userId, listener);
export const getSubscriberCount = (userId) => eventBus.getSubscriberCount(userId);

export default eventBus;

