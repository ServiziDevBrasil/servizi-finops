# M.A.E Financeiro

PWA de despesas, comprovantes e reembolsos da Servizi, preparada para futura incorporação ao M.A.E — Matriz de Acompanhamento Estratégico. Substitui a interface do Google Apps Script por uma aplicação instalável, mantendo o Google Sheets como base oficial nesta fase da migração.

A identidade visual reutiliza o monograma original do M.A.E em verde-esmeralda, com um símbolo de dólar. Os SVGs editáveis ficam em `public/icons/mae-financeiro.svg` e `public/icons/mae-financeiro-maskable.svg`. O repositório e os Workers continuam com os identificadores técnicos `servizi-finops` e `servizi-finops-staging`.

## Funcionalidades V1

- PWA instalável em Android/desktop.
- Captura por texto ou print/foto com OpenAI Responses API.
- Lançamento manual simplificado: data, descrição, moeda, valor e projeto opcional.
- Competência e data prevista de reembolso automáticas pela regra do dia 25.
- Conversão USD/BRL e IOF lidos da aba `Config IA`.
- Fornecedor e fonte inferidos automaticamente.
- Detecção de duplicidade antes da gravação.
- `Inbox_Lancamentos` como trilha de auditoria.
- `Lancamentos` continua sendo a base oficial.
- Service worker e manifest para instalação.
- Cloudflare Worker + Static Assets no mesmo deploy.

## Arquitetura

`PWA -> Cloudflare Worker -> OpenAI + Google Sheets API`

O Worker usa uma service account do Google. Compartilhe a planilha **Consolidação de Custos Tech - Reembolsos** com o e-mail da service account como Editor.

## Segredos obrigatórios

No Cloudflare:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
```

Para staging, repita com `--env staging`. Configure também `ALLOWED_EMAIL`, `CF_ACCESS_TEAM_DOMAIN` (https://sua-equipe.cloudflareaccess.com) e `CF_ACCESS_AUD` (AUD da aplicação Access).

A chave privada deve ser o PEM completo da service account. Não coloque credenciais no GitHub.

## Configuração Google

1. Crie/seleciona um projeto Google Cloud.
2. Habilite **Google Sheets API**.
3. Crie uma **Service Account**.
4. Gere uma chave JSON.
5. Use `client_email` em `GOOGLE_CLIENT_EMAIL` e `private_key` em `GOOGLE_PRIVATE_KEY`.
6. Compartilhe a planilha com o `client_email` como Editor.

## Cloudflare

Cloudflare recomenda Workers Static Assets para novos projetos full-stack. O `wrangler.jsonc` está preparado para:

- produção: `servizi-finops`
- homologação: `servizi-finops-staging` (sem escrita por padrão)

Deploy local:

```bash
npm ci
npm run check
npm test
npm run build:check
npm run deploy
```

## Segurança

A API exige Cloudflare Access por padrão. Proteja o hostname completo do Worker em Zero Trust > Access > Applications, permitindo apenas o e-mail autorizado. Configure os três valores de Access acima no Worker. O backend verifica assinatura, emissor, audiência, expiração e e-mail do JWT; um cabeçalho de e-mail isolado não autentica.

`REQUIRE_ACCESS_EMAIL=0` é reservado ao desenvolvimento local controlado. Sem configuração de Access a API permanece fechada.

Homologação mantém `ALLOW_WRITES=0`: aprovação e lançamento manual ficam bloqueados antes de chamadas externas; análise pode consultar Sheets e IA, mas não escreve nem em `Inbox_Lancamentos`. A análise usa a API paga de IA quando as credenciais estão configuradas.

O cache offline contém apenas arquivos da interface. APIs financeiras, respostas de login e outros domínios não são armazenados pelo service worker. Registrar lançamentos exige conexão.

## Git workflow

- `main` = produção
- `develop` = homologação
- branches curtas + PR
- CI roda `check` + testes + build dry-run de produção/homologação em PRs e antes de qualquer deploy.
- Versões npm fixas e `package-lock.json` tornam o build reproduzível.
- O Worker está conectado ao GitHub por Cloudflare Workers Builds: `main` publica produção e outras branches geram prévias. Use `npm run check && npm test` como build command e `npx wrangler deploy --keep-vars` como deploy command.
- O comando de prévia é `npx wrangler preview`; o bloco `previews` no Wrangler mantém escrita desabilitada e autenticação obrigatória. Os segredos das prévias são configurados separadamente, sem herdar os segredos de produção.
- A publicação por GitHub Actions é uma alternativa: sem `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`, apenas esse job é pulado; o deploy nativo do Cloudflare continua funcionando.
- Evite ativar as duas rotas de publicação simultaneamente. Para usar Actions, configure os secrets, desative a publicação nativa e use Actions > Validate and deploy Cloudflare > Run workflow.
- O deploy preserva variáveis configuradas no dashboard com `--keep-vars`.

## Próxima etapa

Depois de validar a PWA, a camada de armazenamento pode migrar de Google Sheets para Supabase sem alterar a experiência do usuário.

## Estado de entrega e validação

A interface e os arquivos de instalação estão publicados em https://servizi-finops.dev-sbtechnology.workers.dev/. A operação financeira precisa de configuração externa de Access, Google service account, permissões da planilha e chave OpenAI. Não há credenciais reais no repositório. Testes locais usam serviços simulados; não substituem validação live de leitura/gravação na planilha.

## Referências

- [Cloudflare Access: validar JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Worker Previews: configuração](https://developers.cloudflare.com/workers/previews/configuration/)
