import { Test, type TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('responde com o status ok @spec:AC-001', () => {
    expect(controller.getHealth()).toEqual({ status: 'ok' });
  });
});
