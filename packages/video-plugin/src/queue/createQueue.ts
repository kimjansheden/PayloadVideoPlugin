import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

export type QueueHandles = {
  queue: Queue;
  events: QueueEvents;
};

export type QueueFactoryOptions = {
  name: string;
  redisUrl?: string;
};

/**
 * Create a BullMQ queue and accompanying QueueEvents instance that share a
 * Redis connection pool. Consumers are responsible for closing the queue when
 * the process exits.
 */
export const createQueue = ({
  name,
  redisUrl,
}: QueueFactoryOptions): QueueHandles => {
  const connection = redisUrl
    ? new IORedis(redisUrl, { maxRetriesPerRequest: null })
    : new IORedis({ maxRetriesPerRequest: null });

  const queue = new Queue(name, {
    connection,
  });

  const events = new QueueEvents(name, {
    connection: connection.duplicate(),
  });

  events.on("error", (error) => {
    console.error("[video-processor] QueueEvents error", error);
  });

  void events.waitUntilReady();

  return { queue, events };
};
