import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Is this process serving, and can it reach what it needs?
 *
 * Served at `/health`, outside the `/api` prefix (see the `exclude` in
 * main.ts) so an uptime monitor or a load balancer has one fixed path that
 * does not move when the API is versioned.
 *
 * It checks the database rather than only answering 200, because a Nest
 * process stays perfectly able to reply long after Postgres has gone away —
 * and an endpoint that says "ok" through an outage is worse than none, since
 * it is the one thing nobody re-checks.
 *
 * Unauthenticated on purpose: a monitor cannot hold a token. Nothing here
 * names a version, a host or a dependency's address, so there is nothing to
 * learn from it beyond "up" or "not up".
 */
@ApiTags('health')
// A monitor polling every few seconds must not be rate-limited into
// reporting an outage that is not happening.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @ApiOperation({
    summary: 'Liveness and database readiness',
    description:
      'Returns 200 while the process is serving AND the database answers. Returns 503 when the database does not, so a monitor reads the status code rather than having to parse the body.',
  })
  @ApiOkResponse({
    schema: {
      example: { status: 'ok', db: 'up', uptimeSec: 3721 },
    },
  })
  @ApiServiceUnavailableResponse({
    schema: { example: { status: 'degraded', db: 'down', uptimeSec: 12 } },
  })
  @Get()
  async check() {
    const uptimeSec = Math.floor(process.uptime());

    try {
      // The cheapest round trip that proves the pool hands out a live
      // connection — `SELECT 1` touches no table and takes no lock.
      await this.dataSource.query('SELECT 1');
    } catch {
      // 503, not a 200 carrying bad news: every uptime monitor, nginx health
      // check and container probe reads the status code and nothing else.
      throw new ServiceUnavailableException({
        status: 'degraded',
        db: 'down',
        uptimeSec,
      });
    }

    return { status: 'ok', db: 'up', uptimeSec };
  }
}
