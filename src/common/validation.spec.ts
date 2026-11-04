import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString } from 'class-validator';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validationPipeOptions } from './validation.js';

class ProbeDto {
  @IsString()
  name!: string;

  @Type(() => Number)
  @IsInt()
  count!: number;
}

@Controller('probe')
class ProbeController {
  @Post()
  handle(@Body() body: ProbeDto): ProbeDto {
    return body;
  }
}

describe('ValidationPipe global', () => {
  it('descarta campo desconhecido e converte o tipo declarado @spec:AC-003', async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();

    const app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions));
    await app.init();

    const response = await request(app.getHttpServer())
      .post('/probe')
      .send({ name: 'NetProfissional', count: '42', hacker: 'drop table' })
      .expect(201);

    // `whitelist` remove o campo desconhecido; `transform` converte "42" em 42.
    expect(response.body).toEqual({ name: 'NetProfissional', count: 42 });

    await app.close();
  });
});
