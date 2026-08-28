import { Injectable } from '@nestjs/common';
import { UsersService } from './users.service';

/** The slice of UsersService other modules are allowed to reach for. */
@Injectable()
export class UsersFacade {
  constructor(private readonly users: UsersService) {}

  getUserCard(userId: string) {
    return this.users.getUserCard(userId);
  }

  getPublicProfiles(userIds: string[]) {
    return this.users.getPublicProfiles(userIds);
  }

  setPresence(userId: string, online: boolean) {
    return this.users.setPresence(userId, online);
  }

  getPresence(userIds: string[]) {
    return this.users.getPresence(userIds);
  }

  resetAllPresence() {
    return this.users.resetAllPresence();
  }
}
