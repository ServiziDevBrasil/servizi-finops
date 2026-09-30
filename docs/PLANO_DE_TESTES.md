# Plano de testes

## Verificação automatizada

`npm ci`, `npm run check`, `npm test`, `npm run build:check`.

18 cenários cobrem regras financeiras, autenticação JWT (assinatura, email, emissor, audiência e expiração), staging sem escrita, isolamento de cache e atualização/offline da interface. APIs de Google e OpenAI são simuladas. Build dry-run valida empacotamento de produção e staging sem publicação.

## Homologação live pendente

1. Configurar Cloudflare Access e secrets nos Workers de produção/staging.
2. Compartilhar a planilha com a service account e confirmar leitura do bootstrap.
3. Instalar no Android e desktop; conferir ícone, abertura standalone e interface offline.
4. Em staging, testar captura/IA e confirmar que nenhuma linha foi adicionada em Lancamentos ou Inbox_Lancamentos.
5. Em produção, com autorização, testar um lançamento controlado, verificar duplicidade e conferir a auditoria.
6. Atualizar uma versão e confirmar recebimento dos arquivos novos.

Não afirmar validação live antes de completar esses passos.
