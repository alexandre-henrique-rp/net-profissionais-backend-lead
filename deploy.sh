#!/usr/bin/env bash
# Atualização blue-green da API sem proxy interno.
#
# Cada slot publica uma porta no host (blue=3000, green=3001, apenas 127.0.0.1).
# A troca de tráfego reescreve .deploy/upstream.conf — arquivo que o Nginx
# DO SERVIDOR inclui (ver deploy/nginx-site.example.conf) — e recarrega o
# Nginx do host. Se o reload automático não for possível, a candidata fica
# apontada no upstream e o slot antigo segue rodando até a confirmação.
#
# Variáveis opcionais:
#   NGINX_RELOAD_CMD → comando para recarregar o Nginx do servidor
#                      (padrão: nginx -t && nginx -s reload, depois sudo -n)
#   DRAIN_SECONDS    → espera antes de parar o slot antigo (padrão: 10)
#   HEALTH_TIMEOUT   → espera máxima pela candidata saudável (padrão: 120)

set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PROJECT="net-profissionais-backend-lead"
DEPLOY_DIR="$ROOT/.deploy"
UPSTREAM_FILE="$DEPLOY_DIR/upstream.conf"
DRAIN_SECONDS="${DRAIN_SECONDS:-10}"
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
		echo "ERRO: curl é necessário para validar a saúde dos slots." >&2
		return 1
	}
	[[ -f "$ROOT/.env.prod" ]] || {
		echo "ERRO: crie backend/.env.prod no servidor; ele não é versionado." >&2
		return 1
	}
}

slot_port() {
	case "$1" in
		blue) echo 3000 ;;
		green) echo 3001 ;;
		*) return 1 ;;
	esac
}

current_slot() {
	if [[ -f "$UPSTREAM_FILE" ]]; then
		case "$(sed -nE 's/^[[:space:]]*server 127\.0\.0\.1:([0-9]+);.*/\1/p' "$UPSTREAM_FILE" | head -n 1)" in
			3000) echo blue ;;
			3001) echo green ;;
		esac
	fi
}

write_upstream() {
	local slot="$1" port tmp
	port="$(slot_port "$slot")"
	tmp="$UPSTREAM_FILE.tmp"
	printf 'upstream netprofissional_api {\n\tserver 127.0.0.1:%s;\n}\n' "$port" >"$tmp"
	mv "$tmp" "$UPSTREAM_FILE"
}

container_id() {
	compose ps --all --quiet "$1" 2>/dev/null | head -n 1
}

wait_for_health() {
	local service="$1"
	local timeout="$2"
	local elapsed=0
	local id state health

	while ((elapsed < timeout)); do
		id="$(container_id "$service")"
		if [[ -n "$id" ]]; then
			state="$(docker inspect --format '{{.State.Status}}' "$id" 2>/dev/null || true)"
			health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || true)"
			if [[ "$health" == "healthy" ]]; then
				return 0
			fi
			if [[ "$state" == "exited" || "$state" == "dead" || "$health" == "unhealthy" ]]; then
				echo "ERRO: $service não ficou saudável. Últimos logs:"
				compose logs --tail=60 "$service" || true
				return 1
			fi
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done

	echo "ERRO: timeout aguardando healthcheck de $service."
	compose logs --tail=60 "$service" || true
	return 1
}

wait_for_http() {
	local port="$1"
	local timeout="${2:-30}"
	local elapsed=0
	while ((elapsed < timeout)); do
		if curl --fail --silent --show-error --max-time 2 \
			"http://127.0.0.1:${port}/api/v1/health" >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done
	return 1
}

# Recarrega o Nginx do SERVIDOR. Códigos de retorno:
#   0 = recarregado · 1 = Nginx existe mas recusou/falhou · 2 = reload manual pendente
reload_host_nginx() {
	if [[ -n "${NGINX_RELOAD_CMD:-}" ]]; then
		eval "$NGINX_RELOAD_CMD"
		return $?
	fi
	if ! command -v nginx >/dev/null 2>&1; then
		return 2
	fi
	if nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1; then
		return 0
	fi
	if sudo -n true >/dev/null 2>&1 &&
		sudo -n nginx -t >/dev/null 2>&1 && sudo -n nginx -s reload >/dev/null 2>&1; then
		return 0
	fi
	return 1
}

# Troca o tráfego para o slot. Retorno:
#   0 = trocado e validado · 3 = upstream apontado, reload do Nginx pendente · 1 = falhou
switch_traffic() {
	local target="$1" port previous_config="" had_previous=0 rc
	port="$(slot_port "$target")"

	if [[ -f "$UPSTREAM_FILE" ]]; then
		previous_config="$(cat "$UPSTREAM_FILE")"
		had_previous=1
	fi

	write_upstream "$target"

	reload_host_nginx
	rc=$?
	if ((rc == 2)); then
		echo "AVISO: não consegui recarregar o Nginx do servidor automaticamente."
		echo "       O upstream já aponta para api-$target (:$port) em $UPSTREAM_FILE."
		echo "       Após conferir o include no site do Nginx, rode: nginx -t && nginx -s reload"
		return 3
	fi
	if ((rc == 1)); then
		echo "ERRO: o Nginx do servidor recusou a nova configuração; restaurando o upstream anterior."
		if ((had_previous)); then
			printf '%s\n' "$previous_config" >"$UPSTREAM_FILE"
			reload_host_nginx >/dev/null 2>&1 || true
		fi
		return 1
	fi

	if ! wait_for_http "$port"; then
		echo "ERRO: api-$target saudável no container mas não responde em 127.0.0.1:$port; restaurando o upstream anterior."
		if ((had_previous)); then
			printf '%s\n' "$previous_config" >"$UPSTREAM_FILE"
			reload_host_nginx >/dev/null 2>&1 || true
		fi
		return 1
	fi

	return 0
}

cleanup_project_images() {
	local ref image_id in_use
	while IFS= read -r ref; do
		[[ "$ref" == net-profissionais-backend-lead:* ]] || continue
		[[ "$ref" == "net-profissionais-backend-lead:$RELEASE_TAG" ]] && continue
		image_id="$(docker image inspect --format '{{.Id}}' "$ref" 2>/dev/null || true)"
		[[ -n "$image_id" ]] || continue
		in_use="$(docker ps --all --quiet --filter "ancestor=$image_id")"
		if [[ -z "$in_use" ]]; then
			echo "Removendo imagem antiga sem container: $ref"
			docker image rm "$ref" >/dev/null
		fi
	done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')
}

deploy_update() {
	local old_slot candidate old_service candidate_service old_id switch_rc

	require_tools
	echo "== 1/6 · Atualizando código (fast-forward) =="
	git pull --ff-only

	RELEASE_TAG="$(git rev-parse --short=12 HEAD)"
	export RELEASE_TAG
	mkdir -p "$DEPLOY_DIR"

	old_slot="$(current_slot)"
	if [[ "$old_slot" == "blue" ]]; then
		candidate="green"
	elif [[ "$old_slot" == "green" ]]; then
		candidate="blue"
	elif [[ -z "$old_slot" ]]; then
		candidate="blue"
	else
		echo "ERRO: upstream inválido em $UPSTREAM_FILE: $old_slot" >&2
		return 1
	fi

	candidate_service="api-$candidate"
	old_service=""
	if [[ -n "$old_slot" ]]; then
		old_service="api-$old_slot"
		old_id="$(container_id "$old_service")"
		if [[ -z "$old_id" ]] ||
			[[ "$(docker inspect --format '{{.State.Running}}' "$old_id")" != "true" ]] ||
			[[ "$(docker inspect --format '{{.State.Health.Status}}' "$old_id" 2>/dev/null || true)" != "healthy" ]]; then
			echo "ERRO: o slot atual $old_service não está saudável; atualização cancelada." >&2
			return 1
		fi
	fi

	echo "== 2/6 · Construindo imagem $RELEASE_TAG =="
	compose build "$candidate_service"

	echo "== 3/6 · Iniciando candidata no slot $candidate (porta $(slot_port "$candidate")) =="
	if ! compose up -d --no-deps --force-recreate "$candidate_service"; then
		echo "ERRO: candidata não iniciou; o slot atual não foi alterado." >&2
		return 1
	fi
	if ! wait_for_health "$candidate_service" "$HEALTH_TIMEOUT"; then
		compose stop "$candidate_service" >/dev/null 2>&1 || true
		echo "Slot atual preservado: ${old_service:-nenhum (primeira instalação)}."
		return 1
	fi

	echo "== 4/6 · Apontando o upstream do Nginx do servidor =="
	switch_traffic "$candidate"
	switch_rc=$?
	if ((switch_rc == 1)); then
		if [[ -n "$old_slot" ]]; then
			compose stop "$candidate_service" >/dev/null 2>&1 || true
			echo "Slot atual $old_service continua atendendo."
		fi
		return 1
	fi

	echo "$candidate" >"$DEPLOY_DIR/active-slot"
	if ((switch_rc == 3)); then
		echo "== 5/6 · Troca pendente de confirmação no Nginx do servidor =="
		if [[ -n "$old_service" ]]; then
			echo "O slot antigo $old_service segue rodando como fallback."
			echo "Depois do 'nginx -s reload', pare-o com: docker compose stop $old_service"
		fi
	elif [[ -n "$old_service" ]]; then
		echo "== 5/6 · Drenando conexões por ${DRAIN_SECONDS}s e parando $old_service =="
		sleep "$DRAIN_SECONDS"
		compose stop --timeout 30 "$old_service"
	else
		echo "== 5/6 · Primeira instalação; nenhum slot anterior para parar =="
	fi

	echo "== 6/6 · Limpando apenas imagens antigas não utilizadas deste projeto =="
	cleanup_project_images
	echo "✔ API no slot $candidate (porta $(slot_port "$candidate")); upstream em $UPSTREAM_FILE."
}

rollback() {
	local active previous active_service previous_service previous_id switch_rc
	require_tools
	active="$(current_slot)"
	case "$active" in
		blue) previous="green" ;;
		green) previous="blue" ;;
		*)
			echo "ERRO: não há slot ativo conhecido para reverter." >&2
			return 1
			;;
	esac
	active_service="api-$active"
	previous_service="api-$previous"
	previous_id="$(container_id "$previous_service")"
	if [[ -z "$previous_id" ]]; then
		echo "ERRO: não existe container anterior em $previous_service." >&2
		return 1
	fi

	echo "Iniciando e validando o slot anterior $previous (porta $(slot_port "$previous"))..."
	compose start "$previous_service"
	if ! wait_for_health "$previous_service" "$HEALTH_TIMEOUT"; then
		echo "Rollback cancelado; o slot atual $active continua atendendo."
		return 1
	fi
	switch_traffic "$previous"
	switch_rc=$?
	if ((switch_rc == 1)); then
		echo "Rollback não confirmado; o slot atual $active continua atendendo."
		return 1
	fi
	echo "$previous" >"$DEPLOY_DIR/active-slot"
	if ((switch_rc == 3)); then
		echo "Troca pendente no Nginx do servidor; $active_service segue rodando como fallback."
	else
		sleep "$DRAIN_SECONDS"
		compose stop --timeout 30 "$active_service"
	fi
	RELEASE_TAG="$(git rev-parse --short=12 HEAD)"
	cleanup_project_images
	echo "✔ Rollback concluído; slot ativo: $previous."
}

menu() {
	while true; do
		echo
		echo "┌──────────────────────────────────────────────────┐"
		echo "│   NetProfissional — Deploy da API                │"
		echo "└──────────────────────────────────────────────────┘"
		echo "  1) Atualizar (git pull → build → healthcheck → troca)"
		echo "  2) Reverter para o slot anterior"
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
