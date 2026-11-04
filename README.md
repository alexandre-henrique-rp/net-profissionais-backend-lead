<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Run tests

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Docker deployment (blue-green)

The API runs in two Docker slots (`api-blue` and `api-green`), each publishing
a distinct published host port: blue on `3000` and green on
`3002`. There is **no internal proxy container** — the Nginx already
installed on the server does the reverse proxy.

The traffic switch works through an upstream file: `deploy.sh` rewrites
`.deploy/upstream.conf` pointing to the healthy slot's port and prints the
command to reload the host Nginx (`sudo nginx -t && sudo systemctl reload
nginx`). The Nginx reload is **manual** — the script asks for confirmation
before stopping the old slot; without it, the old slot keeps running as
fallback until you reload Nginx and stop it with `docker compose stop
api-<slot>`. A failed build or candidate healthcheck leaves the currently
routed slot running.

### Host Nginx setup (one-time)

`deploy/nginx-site.example.conf` is a ready server block for the host Nginx.
Copy it into `sites-available`/`conf.d`, adjust `server_name` and the
**absolute path** of `include .../.deploy/upstream.conf`, enable the site and
run `nginx -t && nginx -s reload`. Every later update only rewrites the
included upstream file, so an `nginx` reload is all the switch needs.

PostgreSQL and Redis remain external services; this Compose file does not
create or reset either database. Prepare a production environment file on the
server:

```bash
cp .env.example .env.prod
```

Edit `.env.prod` with production values before deploying. At minimum, configure
reachable `DATABASE_URL`, `REDIS_URL`, and a persistent `JWT_SECRET`. Database
and Redis hostnames must be reachable **from a Docker container**; `localhost`
inside `.env.prod` means the API container itself. Set `CORS_ORIGIN` to the
frontend's public origin. Never commit `.env.prod` or copy it into the image:
Compose injects it at runtime, and `.gitignore`/`.dockerignore` exclude it.

On the server, clone this repository, configure `.env.prod`, and run:

```bash
chmod +x deploy.sh
./deploy.sh
```

The menu offers **Atualizar**, **Reverter** and **Sair**. You can also invoke
the actions directly:

```bash
./deploy.sh atualizar
./deploy.sh reverter
```

Updating uses `git pull --ff-only`, builds a release-tagged image, starts the
inactive slot on its own port, and repoints the Nginx upstream only after the
candidate healthcheck passes. The previous slot's container is retained
stopped for one rollback. Cleanup removes only old
`net-profissionais-backend-lead` images that no container references; it does
not run a global Docker prune.

Check status and logs with:

```bash
docker compose --project-name net-profissionais-backend-lead ps
docker compose --project-name net-profissionais-backend-lead logs -f api-blue
docker compose --project-name net-profissionais-backend-lead logs -f api-green
```

### Database migrations

The regular deploy deliberately does **not** modify the database. Review a
migration for compatibility with both the currently active and candidate API,
take a database backup according to your operations policy, then explicitly
run:

```bash
RELEASE_TAG="$(git rev-parse --short=12 HEAD)" \
  docker compose --project-name net-profissionais-backend-lead \
  --profile migration run --rm api-migrate
```

For zero-downtime releases, use expand-and-contract migrations: first add
backward-compatible schema, deploy code that can use it, and defer destructive
column/type removal until no running release depends on the old schema.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. To connect it, run this and approve the code it prints at [observe.nestjs.com/link](https://observe.nestjs.com/link) - signing up for free if you have no account:

```bash
$ npx @nestjs/observe link
```

It writes the app key and secret into `.env` and makes every `nest start` script (`start`, `start:dev`, `start:debug`) load it. In production, set `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment instead.

Or do it by hand: create an application and an API key at [observe.nestjs.com](https://observe.nestjs.com), and set the pair as `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` in the environment the app runs in.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
