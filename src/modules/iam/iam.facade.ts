import { Injectable } from '@nestjs/common';
import { IamService } from './iam.service';

@Injectable()
export class IamFacade {
  constructor(private readonly iamService: IamService) {}

  async getPublicProfile(userId: string) {
    const user = await this.iamService.getById(userId);

    return {
      id: user.id,
      name: user.name,
      surname: user.surname,
      email: user.email,
    };
  }

  getUserCard(userId: string) {
    return this.iamService.getUserCard(userId);
  }

  setPresence(userId: string, online: boolean) {
    return this.iamService.setPresence(userId, online);
  }

  getPresence(userIds: string[]) {
    return this.iamService.getPresence(userIds);
  }

  getPublicProfiles(userIds: string[]) {
    return this.iamService.getPublicProfiles(userIds);
  }

  resetAllPresence() {
    return this.iamService.resetAllPresence();
  }
}
