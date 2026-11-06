import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
const deployScript = readFileSync(resolve(root, 'deploy.sh'), 'utf8');
const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
const prismaSchema = readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');

const updateFlow = deployScript.slice(
	deployScript.indexOf('deploy_update()'),
	deployScript.indexOf('\nrollback()'),
);
const rollbackFlow = deployScript.slice(
	deployScript.indexOf('rollback()'),
	deployScript.indexOf('\nmenu()'),
);

describe('deploy Docker em container único', () => {
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
		expect(prismaSchema).toContain('generatedFileExtension = "ts"');
		expect(prismaSchema).toContain('importFileExtension    = "js"');
	});

	it('@spec:AC-213 o serviço único publica a porta 3000 no host, sem proxy interno nem slots', () => {
		const apiService = compose.match(/  api:\n([\s\S]*?)\n  api-migrate:/)?.[1];
		const publishedPorts = [
			...compose.matchAll(/^\s+- "(\d+:\d+)"$/gm),
		].map((match) => match[1]);

		expect(apiService).toContain('expose:');
		expect(apiService).toContain('"3000"');
		expect(apiService).toContain('3000:3000');
		expect(apiService).toContain('healthcheck:');
		expect(apiService).toContain('restart: unless-stopped');
		expect(publishedPorts).toEqual(['3000:3000']);
		expect(compose).not.toContain('api-blue');
		expect(compose).not.toContain('api-green');
		expect(compose).not.toContain('image: nginx');
		expect(compose).not.toContain('  proxy:');
	});

	it('@spec:AC-214 falha de healthcheck ou da porta restaura a release anterior', () => {
		expect(updateFlow.indexOf('compose build "$SERVICE"')).toBeLessThan(
			updateFlow.indexOf('wait_for_health'),
		);
		expect(updateFlow.indexOf('run_service')).toBeLessThan(
			updateFlow.indexOf('wait_for_health'),
		);
		expect(updateFlow).toContain('wait_for_http');
		expect(updateFlow).toContain('Restaurando a release anterior');
		expect(updateFlow).toContain('previous_tag');
		expect(updateFlow).toContain('docker image inspect');
		expect(
			updateFlow.indexOf('Restaurando a release anterior'),
		).toBeGreaterThan(updateFlow.indexOf('wait_for_health'));
	});

	it('@spec:AC-215 reverter sobe a imagem da release anterior registrada sem rebuild', () => {
		expect(rollbackFlow).toContain('previous_release');
		expect(rollbackFlow.indexOf('docker image inspect')).toBeLessThan(
			rollbackFlow.indexOf('run_service'),
		);
		expect(rollbackFlow.indexOf('run_service')).toBeLessThan(
			rollbackFlow.indexOf('wait_for_health'),
		);
		expect(rollbackFlow).toContain('write_releases');
		expect(rollbackFlow).not.toContain('compose build');
		expect(deployScript).toContain('.deploy/releases');
	});

	it('@spec:AC-216 a limpeza só remove imagens antigas deste projeto sem containers', () => {
		const cleanup = deployScript.slice(
			deployScript.indexOf('cleanup_project_images()'),
			deployScript.indexOf('\n# --remove-orphans'),
		);

		expect(cleanup).toContain('net-profissionais-backend-lead:*');
		expect(cleanup).toContain('previous_release');
		expect(cleanup).toContain(
			'docker ps --all --quiet --filter "ancestor=$image_id"',
		);
		expect(cleanup).toContain('docker image rm "$ref"');
		expect(cleanup).not.toContain('docker image prune');
	});

	it('@spec:AC-217 o deploy padrão não aplica migrations automaticamente', () => {
		expect(updateFlow).not.toContain('prisma:deploy');
		expect(compose).toContain('api-migrate:');
		expect(compose).toContain('target: migrate');
		expect(compose).toContain('profiles:');
	});
});
