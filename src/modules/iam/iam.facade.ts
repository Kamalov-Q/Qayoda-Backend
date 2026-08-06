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
}
