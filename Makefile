SHELL := /bin/bash
COMPOSE := docker compose
BACKEND_PYTHON ?= python3
BACKEND_PYTEST := cd backend && $(BACKEND_PYTHON) -m pytest
FRONTEND_NPM := npm --prefix frontend

.PHONY: init up down ps logs logs-backend logs-frontend logs-postgres verify-s01 verify-s02 verify-s03 config backend-migrate backend-test frontend-test frontend-lint quality-gates

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

verify-s02:
	bash scripts/verify-s02.sh

verify-s03:
	bash scripts/verify-s03.sh

backend-migrate:
	$(COMPOSE) run --rm backend alembic upgrade head

backend-test:
	$(BACKEND_PYTEST) tests/test_health.py tests/test_config.py tests/test_auth.py

frontend-test:
	$(FRONTEND_NPM) test -- --runInBand

frontend-lint:
	$(FRONTEND_NPM) run lint

quality-gates: backend-test frontend-test frontend-lint
