SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: init up down ps logs logs-backend logs-frontend logs-postgres verify-s01 config

init:
	@test -f .env || cp .env.example .env
	@mkdir -p backend frontend
	@echo "Initialized local PassArk workspace."

up:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs --tail=100

logs-backend:
	$(COMPOSE) logs --tail=100 backend

logs-frontend:
	$(COMPOSE) logs --tail=100 frontend

logs-postgres:
	$(COMPOSE) logs --tail=100 postgres

config:
	$(COMPOSE) config

verify-s01:
	bash scripts/verify-s01.sh

backend-migrate:
	$(COMPOSE) run --rm backend alembic upgrade head

backend-test:
	$(COMPOSE) run --rm backend pytest backend/tests/test_health.py backend/tests/test_config.py

frontend-test:
	$(COMPOSE) run --rm frontend npm test -- --runInBand

frontend-lint:
	$(COMPOSE) run --rm frontend npm run lint
