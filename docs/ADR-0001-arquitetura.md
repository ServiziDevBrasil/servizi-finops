# ADR-0001 — PWA FinOps em Cloudflare Worker

## Decisão

Migrar a interface do Google Apps Script para uma PWA hospedada em Cloudflare Workers Static Assets, mantendo temporariamente o Google Sheets como fonte oficial.

## Motivos

- instalação real como PWA;
- código versionado e auditável no GitHub;
- frontend e API no mesmo domínio;
- segredos fora do cliente;
- caminho simples para Cloudflare Access e posterior migração do banco.

## Consequências

- exige service account Google para acessar Sheets;
- OpenAI API passa a ser chamada apenas pelo Worker;
- Apps Script atual pode permanecer como fallback durante a homologação.
