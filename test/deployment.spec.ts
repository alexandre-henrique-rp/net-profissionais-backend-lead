import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
const deployScript = readFileSync(resolve(root, 'deploy.sh'), 'utf8');
const nginxConfig = readFileSync(resolve(root, 'deploy/nginx.conf'), 'utf8');
const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');

describe('deploy Docker blue-green', () => {
  it('@spec:AC-212 a imagem runtime inclui o build e dependências e escuta na porta 3000', () => {
    expect(dockerfile).toContain('FROM node:24-alpine AS build');
    expect(dockerfile).toContain('RUN yarn build');
    expect(dockerfile).toContain(
      'FROM node:24-alpine AS production-dependencies',
    );
    expect(dockerfile).toContain('--production --ignore-scripts');
    expect(dockerfile).toContain('COPY --from=production-dependencies');
    expect(dockerfile).toContain(
      'COPY --from=build --chown=node:node /app/dist ./dist',
    );
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(dockerfile).toContain('CMD ["node", "dist/main.js"]');
    expect(dockerfile).toContain('/api/v1/health');
    expect(dockerignore).toContain('.env.*');
    expect(dockerignore).toContain('src/generated/prisma');
    expect(
      dockerfile
        .trim()
        .split('\n')
        .filter((line) => line.startsWith('FROM '))
        .at(-1),
    ).toBe('FROM node:24-alpine AS runtime');
  });

  it('@spec:AC-213 somente o proxy publica a porta 3000 do host', () => {
    const apiDefaults = compose.match(
      /x-api: &api\n([\s\S]*?)\n\nservices:/,
    )?.[1];
    const apiBlue = compose.match(/  api-blue:\n([\s\S]*?)\n  api-green:/)?.[1];
    const apiGreen = compose.match(
      /  api-green:\n([\s\S]*?)\n  api-migrate:/,
    )?.[1];
    const proxy = compose.match(/  proxy:\n([\s\S]*?)\n\nnetworks:/)?.[1];
    const publishedPorts = [...compose.matchAll(/^\s+- "(\d+:\d+)"$/gm)].map(
      (match) => match[1],
    );

    expect(apiDefaults).toContain('expose:');
    expect(apiDefaults).toContain('"3000"');
    expect(apiBlue).toContain('<<: *api');
    expect(apiBlue).not.toContain('ports:');
    expect(apiGreen).toContain('<<: *api');
    expect(apiGreen).not.toContain('ports:');
    expect(publishedPorts).toEqual(['3000:80']);
    expect(proxy).toContain('3000:80');
    expect(nginxConfig).toContain('proxy_pass http://backend_active');
  });

  it('@spec:AC-214 falha de healthcheck ou troca preserva o slot ativo', () => {
    const updateFlow = deployScript.slice(
      deployScript.indexOf('deploy_update()'),
      deployScript.indexOf('\nrollback()'),
    );

    expect(
      updateFlow.indexOf('wait_for_health "$candidate_service"'),
    ).toBeGreaterThan(-1);
    expect(
      updateFlow.indexOf('wait_for_health "$candidate_service"'),
    ).toBeLessThan(updateFlow.indexOf('switch_traffic "$candidate"'));
    expect(updateFlow).toContain('compose stop "$candidate_service"');
    expect(updateFlow).toContain('Slot atual $old_service continua atendendo.');
    expect(updateFlow.indexOf('switch_traffic "$candidate"')).toBeLessThan(
      updateFlow.indexOf('compose stop --timeout 30 "$old_service"'),
    );
  });

  it('@spec:AC-215 o slot anterior só para depois da candidata saudável e do proxy validado', () => {
    const updateFlow = deployScript.slice(
      deployScript.indexOf('deploy_update()'),
      deployScript.indexOf('\nrollback()'),
    );

    expect(
      updateFlow.indexOf('wait_for_health "$candidate_service"'),
    ).toBeLessThan(updateFlow.indexOf('switch_traffic "$candidate"'));
    expect(updateFlow.indexOf('switch_traffic "$candidate"')).toBeLessThan(
      updateFlow.indexOf('compose stop --timeout 30 "$old_service"'),
    );
    expect(deployScript).toContain('nginx -t');
    expect(deployScript).toContain('nginx -s reload');
    expect(deployScript).toContain('restaurando o upstream anterior');
  });

  it('@spec:AC-216 a limpeza só remove imagens antigas deste projeto sem containers', () => {
    const cleanup = deployScript.slice(
      deployScript.indexOf('cleanup_project_images()'),
      deployScript.indexOf('\ndeploy_update()'),
    );

    expect(cleanup).toContain('net-profissionais-backend-lead:*');
    expect(cleanup).toContain(
      'docker ps --all --quiet --filter "ancestor=$image_id"',
    );
    expect(cleanup).toContain('docker image rm "$ref"');
    expect(cleanup).not.toContain('docker image prune');
  });

  it('@spec:AC-217 o deploy padrão não aplica migrations automaticamente', () => {
    const updateFlow = deployScript.slice(
      deployScript.indexOf('deploy_update()'),
      deployScript.indexOf('\nrollback()'),
    );

    expect(updateFlow).not.toContain('prisma:deploy');
    expect(compose).toContain('api-migrate:');
    expect(compose).toContain('target: migrate');
    expect(compose).toContain('profiles:');
  });
});
