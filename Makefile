# Єдина точка запуску перевірок (ADR-0008): кожна ціль — лише `npm run …`,
# логіка — у package.json. Перелік перевірок — standarts/checks.md.

.PHONY: install check format format-check lint hygiene typecheck boundaries build smoke \
	ai-trace pre-commit commit-msg pre-push

## Встановити залежності й підключити git-hook-и (крит. 6)
install:
	npm ci

## Усі перевірки C1–C3, C5–C8; зупиняється на першій помилці (крит. 5)
check: format-check lint hygiene typecheck boundaries build smoke

format:
	npm run format

format-check:
	npm run format:check

lint:
	npm run lint

hygiene:
	npm run hygiene

typecheck:
	npm run typecheck

boundaries:
	npm run boundaries

build:
	npm run build

smoke: build
	npm run smoke

ai-trace:
	npm run ai-trace

## Цілі для git-hook-ів (.husky/)
pre-commit:
	npm run pre-commit

commit-msg:
	npm run commit-msg -- "$(MSG)"

pre-push: typecheck boundaries build smoke
