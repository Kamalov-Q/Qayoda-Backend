import { DefaultEventsMap, Socket } from 'socket.io';

export interface ChatSocketData {
  userId: string;
}

/** Typing `data` keeps `client.data.userId` a `string` instead of `any`. */
export type ChatSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  ChatSocketData
>;
