#!/usr/bin/env bash
# Deploy da API em container único na porta 3000.
#
# O tráfego público chega pelo Cloudflare Tunnel, que encaminha direto para
# a porta 3000 do host — não existe proxy interno nem slot alternado para
# trocar. Cada atualização recria o serviço `api` (a API fica alguns
# segundos fora enquanto o container novo sobe e passa no healthcheck).
#
# Rollback: toda release fica tagueada como
# net-profissionais-backend-lead:<sha do commit> e o registro das duas
# últimas fica em .deploy/releases (linha 1 = atual, linha 2 = anterior).
# `reverter` sobe a tag anterior SEM rebuild; se a nova release falha no
# healthcheck, o deploy tenta voltar a anterior sozinho.
#
# Variáveis opcionais:
#   HEALTH_TIMEOUT   → espera máxima pelo healthcheck (padrão: 120)

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT="net-profissionais-backend-lead"
IMAGE="net-profissionais-backend-lead"
SERVICE="api"
DEPLOY_DIR="$ROOT/.deploy"
RELEASES_FILE="$DEPLOY_DIR/releases"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
RELEASE_TAG=""

if docker compose version >/dev/null 2>&1; then
	COMPOSE=(docker compose --project-name "$PROJECT" --file "$ROOT/docker-compose.yml")
elif command -v docker-compose >/dev/null 2>&1; then
	COMPOSE=(docker-compose --project-name "$PROJECT" --file "$ROOT/docker-compose.yml")
else
	echo "ERRO: docker compose não foi encontrado." >&2
	exit 1
fi

compose() {
	RELEASE_TAG="$RELEASE_TAG" "${COMPOSE[@]}" "$@"
}

require_tools() {
	command -v curl >/dev/null 2>&1 || {
		echo "ERRO: curl é necessário para validar a saúde da API." >&2
		return 1
	}
	[[ -f "$ROOT/.env.prod" ]] || {
		echo "ERRO: crie backend/.env.prod no servidor; ele não é versionado." >&2
		return 1
	}
}

container_id() {
	compose ps --all --quiet "$SERVICE" 2>/dev/null | head -n 1
}

wait_for_health() {
	local timeout="${1:-$HEALTH_TIMEOUT}"
	local elapsed=0
	local id state health

	while ((elapsed < timeout)); do
		id="$(container_id)"
		if [[ -n "$id" ]]; then
			state="$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null || true)"
			health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true)"
			if [[ "$health" == "healthy" ]]; then
				return 0
			fi
			if [[ "$state" == "exited" || "$state" == "dead" || "$health" == "unhealthy" ]]; then
				echo "ERRO: $SERVICE não ficou saudável. Últimos logs:"
				compose logs --tail=60 "$SERVICE" || true
				return 1
			fi
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done

	echo "ERRO: timeout aguardando healthcheck de $SERVICE."
	compose logs --tail=60 "$SERVICE" || true
	return 1
}

# A porta publicada é o que o Cloudflare Tunnel usa: valida o caminho real
# host → container, não só o healthcheck interno do Docker.
wait_for_http() {
	local timeout="${1:-30}"
	local elapsed=0
	while ((elapsed < timeout)); do
		if curl --fail --silent --show-error --max-time 2 \
			"http://127.0.0.1:3000/api/v1/health" >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done
	return 1
}

current_release() {
	sed -n '1p' "$RELEASES_FILE" 2>/dev/null
}

previous_release() {
	sed -n '2p' "$RELEASES_FILE" 2>/dev/null
}

write_releases() {
	mkdir -p "$DEPLOY_DIR"
	printf '%s\n%s\n' "$1" "${2:-}" >"$RELEASES_FILE"
}

# Transição do antigo esquema blue-green: os containers api-blue/api-green
# seguram a porta 3000 e precisam sair antes do serviço único subir.
# Não faz nada quando eles já não existem — seguro para rodar em todo deploy.
remove_legacy_slots() {
	local legacy
	for legacy in api-blue api-green; do
		if docker rm -f "${PROJECT}-${legacy}-1" >/dev/null 2>&1; then
			echo "Removido container legado ${PROJECT}-${legacy}-1."
		fi
	done
	rm -f "$DEPLOY_DIR/upstream.conf" "$DEPLOY_DIR/active-slot"
}

cleanup_project_images() {
	local ref image_id in_use previous_tag
	previous_tag="$(previous_release)"
	while IFS= read -r ref; do
		[[ "$ref" == net-profissionais-backend-lead:* ]] || continue
		[[ "$ref" == "net-profissionais-backend-lead:$RELEASE_TAG" ]] && continue
		# A tag anterior fica para o rollback sem rebuild.
		[[ "$ref" == "net-profissionais-backend-lead:$previous_tag" ]] && continue
		image_id="$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null || true)"
		[[ -n "$image_id" ]] || continue
		in_use="$(docker ps --all --quiet --filter "ancestor=$image_id")"
		if [[ -z "$in_use" ]]; then
			echo "Removendo imagem antiga sem container: $ref"
			docker image rm "$ref" >/dev/null
		fi
	done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')
}

# --remove-orphans limpa restos de definições antigas do mesmo projeto.
run_service() {
	compose up -d --no-deps --force-recreate --remove-orphans "$SERVICE"
}

deploy_update() {
	local previous_tag

	require_tools
	echo "== 1/5 · Atualizando código (fast-forward) =="
	git pull --ff-only

	RELEASE_TAG="$(git rev-parse --short=12 HEAD)"
	export RELEASE_TAG
	previous_tag="$(current_release)"

	echo "== 2/5 · Construindo imagem $RELEASE_TAG =="
	compose build "$SERVICE"

	echo "== 3/5 · Liberando a porta 3000 e recriando o container =="
	remove_legacy_slots
	if ! run_service; then
		echo "ERRO: container não iniciou." >&2
		return 1
	fi

	echo "== 4/5 · Aguardando healthcheck e resposta na porta 3000 =="
	if ! wait_for_health "$HEALTH_TIMEOUT" || ! wait_for_http 30; then
		if [[ -n "$previous_tag" ]] &&
			docker image inspect "$IMAGE:$previous_tag" >/dev/null 2>&1; then
			echo "Restaurando a release anterior ($previous_tag)..."
			RELEASE_TAG="$previous_tag"
			if run_service && wait_for_health "$HEALTH_TIMEOUT"; then
				echo "Rollback automático concluído; API de volta na $previous_tag."
			else
				echo "ERRO: rollback automático também falhou — intervene manualmente." >&2
			fi
		fi
		return 1
	fi

	write_releases "$RELEASE_TAG" "$previous_tag"

	echo "== 5/5 · Limpando apenas imagens antigas não utilizadas deste projeto =="
	cleanup_project_images
	echo "✔ API atualizada para $RELEASE_TAG na porta 3000."
}

rollback() {
	local previous_tag current_tag

	require_tools
	previous_tag="$(previous_release)"
	if [[ -z "$previous_tag" ]]; then
		echo "ERRO: não há release anterior registrada em $RELEASES_FILE." >&2
		return 1
	fi
	if ! docker image inspect "$IMAGE:$previous_tag" >/dev/null 2>&1; then
		echo "ERRO: imagem $IMAGE:$previous_tag não existe mais localmente." >&2
		return 1
	fi

	current_tag="$(current_release)"
	echo "Revertendo para $previous_tag (atual: ${current_tag:-desconhecida})..."
	RELEASE_TAG="$previous_tag"
	export RELEASE_TAG
	if ! run_service; then
		echo "ERRO: container não iniciou." >&2
		return 1
	fi
	if ! wait_for_health "$HEALTH_TIMEOUT" || ! wait_for_http 30; then
		echo "ERRO: rollback não ficou saudável." >&2
		return 1
	fi
	write_releases "$previous_tag" "$current_tag"
	cleanup_project_images
	echo "✔ Rollback concluído; release ativa: $previous_tag."
}

menu() {
	while true; do
		echo
		echo "┌──────────────────────────────────────────────────┐"
		echo "│   NetProfissional — Deploy da API                │"
		echo "└──────────────────────────────────────────────────┘"
		echo "  1) Atualizar (git pull → build → recreate → healthcheck)"
		echo "  2) Reverter para a release anterior"
		echo "  3) Sair"
		echo
		read -r -p "Escolha uma opção [1-3]: " option
		case "$option" in
			1 | atualizar | update) deploy_update ;;
			2 | reverter | rollback) rollback ;;
			3 | sair | exit | quit | q) echo "Saindo."; return 0 ;;
			*) echo "Opção inválida — escolha 1, 2 ou 3." ;;
		esac
	done
}

case "${1:-menu}" in
	atualizar | update) deploy_update ;;
	reverter | rollback) rollback ;;
	sair | exit | quit) echo "Saindo." ;;
	menu | "") menu ;;
	*)
		echo "Uso: $0 [atualizar|reverter|sair]" >&2
		exit 2
		;;
esac
