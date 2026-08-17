import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { ChatSocket } from '../types/chat-socket';

@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<ChatSocket>();
    if (!client.data?.userId) throw new WsException('Unauthorized');
    return true;
  }
}
