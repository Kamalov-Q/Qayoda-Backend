import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Qayoda API')
    .setDescription(
      [
        'Authentication and account endpoints.',
        '',
        '### Sign-up flow',
        '1. `POST /auth/otp/request` with purpose `REGISTER` → `requestId`',
        '2. `POST /auth/otp/verify` with the emailed code → `verificationToken`',
        '3. `POST /auth/register` with that token → session',
        '',
        '### Sign-in',
        'Either `POST /auth/login` (email + password), or the same OTP flow with purpose `LOGIN` followed by `POST /auth/login/otp`.',
        '',
        '### Password reset',
        'OTP flow with purpose `RESET_PASSWORD`, then `POST /auth/password/reset/confirm`.',
        '',
        '### Tokens',
        'Send the access token as `Authorization: Bearer <token>` (15 min). Refresh with `POST /auth/refresh`, which takes the refresh token **in the body** and rotates it — each refresh token works exactly once.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token returned by login, register, or refresh.',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(process.env.PORT ?? 3000, () => {
    console.log(`Server listening on port ${process.env.PORT ?? 3000}`);
    console.log(`Docs: http://localhost:${process.env.PORT ?? 3000}/docs`);
  });
}
bootstrap();
