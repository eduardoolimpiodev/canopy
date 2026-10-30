# Canopy — MongoDB Workbench

Primeira versão web de um workspace MongoDB com cadastro, login e conexões privadas por usuário. Aplicação publicada na VPS, com acesso restrito aos cadastros existentes enquanto SMTP está pendente.

A aplicação está em https://canopy.eduardoolimpio.com/ com HTTPS válido e login verificado. Consulte o [estado observado](deploy/STATUS.md) e as [instruções de operação](deploy/README.md). SMTP e abertura de novos cadastros continuam pendentes.

## Meta de paridade

A meta do produto é cobrir o conjunto completo de funcionalidades MongoDB do Studio 3T Desktop, considerando todas as edições. A [matriz de paridade](docs/PARIDADE.md) registra capacidades, estado atual, critérios de aceite e ordem de implementação; o [registro de fontes](docs/FONTES.md) distingue documentação atual, material histórico e pontos ainda sem confirmação. A análise documental está concluída neste recorte; a implementação integral e a certificação de equivalência estão pendentes.

## Stack

- React + TypeScript + Vite para a interface com explorador, consultas e resultados em tabela/JSON. React permite compor esses painéis sem impor a estrutura de uma aplicação Angular.
- Node.js 24 + Fastify + driver oficial MongoDB para sessões e acesso aos bancos. O backend precisa de conexões TCP; hospedagem apenas estática ou Sites Workers não atende ao driver.
- SQLite nativo para contas, sessões e metadados em **uma única instância**, com volume persistente. Foi escolhido para tornar a primeira versão executável sem um segundo servidor de dados. Várias réplicas exigirão rever armazenamento e limitadores; não escale horizontalmente esta versão. A API `node:sqlite` ainda é experimental no Node 24.14; runtime fixado e persistência exercitada nos testes.
- Zod na fronteira HTTP e da configuração; `mongodb-connection-string-url` para interpretar URIs; `ipaddr.js` para classificar destinos de rede. Plugins Fastify cuidam de cookies, limites HTTP, arquivos estáticos e cabeçalhos. Fontes são distribuídas localmente; Lucide fornece os ícones.
- Test runner nativo do Node + MongoDB real descartável em Docker. ESLint, TypeScript e Prettier verificam o código; agent-browser é usado na prova do fluxo no navegador.
- Nodemailer fornece SMTP com TLS obrigatório, prazos limitados e diagnóstico de protocolo. Essa dependência permite usar um provedor SMTP sem acoplar a recuperação de conta a uma API comercial específica.

## Executar

Requisitos: Node **24.14 ou superior na linha 24** e npm. Docker é necessário apenas para os testes e o empacotamento.

```powershell
npm ci
npm run setup
npm run build
npm start
```

Abra <http://localhost:4310> e crie sua conta. `setup` gera uma chave aleatória em `.env`, sem sobrescrever configuração existente. A aplicação falha se a chave estiver ausente ou inválida.

Para desenvolver com recarga automática, use `npm run dev` e abra <http://localhost:5174>. O serviço API permanece em `127.0.0.1:4310`; o script usa a origem correta para validar solicitações do Vite.

## Confirmação, recuperação e e-mail

Contas novas e contas anteriores precisam confirmar o e-mail antes de acessar conexões MongoDB. A migração acrescenta `email_verified_at` e preserva usuários, hashes de senha, sessões, conexões e consultas existentes. A tela oferece reenvio; contas anteriores não recebem uma confirmação automática sem solicitação.

Em desenvolvimento, `MAIL_MODE=file` grava os e-mails em `.data/mail/` (ou `DATA_DIR/mail`), fora do Git e sem endpoint público para ler links. Abra o arquivo JSON correspondente ao seu endereço e use o link de confirmação, informando a senha escolhida no cadastro. O link expira em 24 horas. A recuperação fica em **Esqueci minha senha**, com link válido por 30 minutos; ela encerra todas as sessões e exige novo login. Links são de uso único, ficam no fragmento da URL e são removidos da barra após captura. A tabela de tokens guarda hashes; o conteúdo de e-mails pendentes usa AES-GCM com vínculo à conta e à entrega.

Para enviar e-mails em produção, configure `MAIL_MODE=smtp`, `SMTP_HOST` e um `MAIL_FROM` autorizado pelo provedor. Use `SMTP_PORT=587`/`SMTP_TLS=starttls`, ou porta 465/`SMTP_TLS=tls`; `SMTP_USER` e `SMTP_PASSWORD` devem ser fornecidos juntos. O Compose da raiz exige credenciais SMTP. Os manifestos da VPS também permitem `MAIL_MODE=disabled`: login e confirmação por link inicial continuam disponíveis, mas cadastro, recuperação e reenvio ficam indisponíveis explicitamente. Produção rejeita e-mail em arquivo. Conexão SMTP TLS não pode ser desativada e certificados inválidos falham. Os detalhes seguem o [transporte SMTP oficial do Nodemailer](https://nodemailer.com/smtp). Nenhum provedor externo foi configurado ou validado nesta entrega.

O envio usa fila persistida, com uma execução por instância e até três tentativas totais; após falhas, os intervalos são de um e dois minutos. O reenvio de link tem intervalo mínimo de um minuto por conta/finalidade. O endpoint público de recuperação responde com o mesmo recibo para endereço existente ou ausente; isso confirma o registro da solicitação, não a entrega do e-mail. Falhas registram identificação da entrega e códigos seguros de protocolo, sem destinatário, corpo, senha ou link nos logs. O estado de envio da confirmação pode ser atualizado na tela; uma fila em estado final `failed` exige correção do operador e nova solicitação. O endpoint de saúde confirma HTTP disponível, sem certificar SMTP.

E-mails aceitos pelo SMTP perdem o conteúdo na fila; metadados de entrega e arquivos da caixa local expiram após 24 horas com o serviço ativo. Reinício pode repetir um envio interrompido antes do registro do aceite; ele não permite consumir o token duas vezes. Não há promessa de entrega exatamente uma vez nem de aceitação na caixa final. A recuperação aplica práticas de [tokens e revogação de sessões da OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Conta e atividade

O avatar abre **Minha conta**. O histórico mostra as últimas 1.000 operações autenticadas, com retenção de 30 dias e paginação de 50 eventos. Registra método, rota, ação de consulta/escrita, alvo e status HTTP, sem filtros, documentos ou URIs. Autorização e CSRF são conferidos depois de receber o corpo, impedindo que uma requisição incompleta continue com uma sessão revogada.

A exclusão exige a senha atual e a frase `EXCLUIR MINHA CONTA`. Remove logicamente a conta e, por cascata, sessões, conexões, consultas, tokens, fila e atividade próprios. Os bancos MongoDB e as outras contas permanecem intactos. Operações Mongo em andamento recebem cancelamento na recuperação/exclusão; escritas já confirmadas pelo banco não são revertidas. A exclusão não certifica apagamento físico das páginas SQLite/WAL nem remove cópias de backup do operador: a política operacional e os artefatos futuros continuam pendentes na matriz.

## Fluxos implementados

- Cadastro por e-mail/senha, login, retomada de sessão e logout com revogação no servidor.
- Confirmação de e-mail, recuperação de senha, atividade da conta e exclusão dos metadados próprios.
- Até 10 conexões por conta, testadas antes de salvar; nome/host visíveis e URI criptografada.
- Bancos e coleções autorizados pelo próprio usuário MongoDB, filtros `find`, ordenação, paginação e agregações de leitura.
- Resultados em tabela e Extended JSON canônico, preservando ObjectId, Int64, Decimal128 e datas; exportação **da página atual** para JSON.
- Inserção, substituição e exclusão de um documento em conexões criadas com escrita habilitada. Substituições/exclusões comparam o documento original e retornam conflito quando ele mudou.
- Consulta de índices e até 50 consultas salvas por conta, com conteúdo criptografado.

Não há shell JavaScript, SQL, construtor visual, importação em lote, histórico automático, múltiplas abas de consulta ou sincronização entre bancos nesta versão.

**Exportação implementada, download sem verificação:** o Chrome automatizado desta sessão cancelou tanto o download do aplicativo quanto um download de controle independente. A causa não foi determinada; o recebimento do arquivo precisa ser confirmado em outro ambiente antes de considerar esse fluxo verificado.

## Conexões e limites

Conexões públicas exigem TLS válido. A versão aceita `mongodb+srv://` do Atlas em `*.mongodb.net`, ou `mongodb://` de **um único host público na porta 27017**. Conexões diretas usam `directConnection`, sem descobrir outros membros de replica sets. SRV de outros provedores, certificados privados, túneis SSH e bancos por VPN ainda não são suportados.

Opções da URI permitidas: `authSource`, `replicaSet`, `readPreference`, `tls=true` e `appName`. Opções de arquivo, proxy, TLS inseguro e confirmação de escrita configurada pelo usuário são rejeitadas. Escritas exigem `majority` e journal, com retries automáticos desabilitados para não ocultar resultados incertos.

O IP de saída do servidor Canopy precisa estar autorizado no banco de destino. Credenciais MongoDB têm as permissões que o proprietário lhes concedeu; prefira um usuário dedicado por aplicação/ambiente.

A resolução DNS A/AAAA ocorre dentro do limite de concorrência com prazo de 1,5 segundo e uma tentativa por família. IPs privados, loopback, link-local, compartilhados e reservados são bloqueados; a resolução dos sockets é validada novamente para impedir rebinding. Limites: 8 operações Mongo simultâneas por processo, 2 por conta, 5 segundos de execução no Mongo, 10 segundos de timeout de operação do driver, 200 documentos por página, 1 MB de resultado e 256 KB de corpo HTTP. Metadados limitam coleções a 500 por banco. Pipelines têm até 30 estágios por lista e rejeitam escrita e JavaScript no servidor, inclusive pipelines aninhados.

**Limitação pendente de conectividade:** em conexões Atlas, SRV/TXT ainda são resolvidos pelo driver com os prazos e a retentativa próprios dele, antes da seleção do servidor. O limite A/AAAA e o timeout de operação não limitam essa etapa; em falha DNS ela pode manter slots de conexão ocupados por mais tempo. Validar e limitar esse caminho faz parte do endurecimento anterior à abertura pública. Não houve prova com um cluster Atlas real nesta sessão.

`MONGO_ALLOWED_LOCAL_HOSTS` permite **exceções explícitas apenas para desenvolvimento/teste**, por exemplo `127.0.0.1` para um contêiner local. Esse modo dispensa TLS naquele host e é rejeitado em produção. Não é uma configuração para disponibilização pública.

## Sessões, dados e implantação

Senhas usam scrypt com salt aleatório e custo N=131072/r=8/p=1; no máximo duas derivações rodam simultaneamente. Cookies de sessão usam HttpOnly/SameSite=Strict; produção acrescenta Secure e o prefixo `__Host-`. Só o hash do token fica no SQLite. Sessões expiram em 7 dias; cada conta mantém até 5 sessões.

Mutações validam a origem exata de `APP_ORIGIN`; após autenticação também exigem token CSRF. Todas as rotas de conexão e consulta verificam a propriedade no servidor. Dados e erros de API têm `Cache-Control: no-store`. URIs e consultas salvas usam AES-256-GCM com vínculo ao usuário e ao registro; não são incluídas nos logs. Uma falha de autenticação da criptografia aborta a operação.

`.data/` contém o banco e é ignorada pelo Git. Faça backup consistente do SQLite com a API de backup do SQLite ou com a aplicação parada, preservando também a chave de criptografia em armazenamento separado e protegido. Perder a chave impede recuperar as conexões. Não copie apenas o arquivo principal enquanto WAL estiver ativo.

`Dockerfile` e `compose.yml` preparam uma instância sem root, com volume persistente e retenção de logs. Para produção, configure `.env` com `APP_ORIGIN=https://seu-dominio`, chave e **IPs/CIDRs exatos dos proxies confiáveis** em `TRUSTED_PROXY_CIDRS`; depois execute `docker compose up --build -d` atrás de um terminador HTTPS. A porta fica vinculada a loopback. Não confie indiscriminadamente em `X-Forwarded-For`: proxies desconhecidos são ignorados. Sem configurar o proxy correto, visitantes compartilharão o limitador de IP do proxy.

O serviço foi publicado na VPS com domínio/HTTPS e login verificados. Antes de cadastro público irrestrito, faltam validar SMTP externo, operar backups recorrentes e externos com retenção, limitar o DNS SRV/TXT e proteger a saída na rede do host. O backup inicial teve integridade e restauração separada verificadas. A evolução para múltiplas instâncias segue pendente; a fila e os limitadores desta entrega permanecem locais à instância.

## Prova

```powershell
npm run check
npm run format:check
```

`npm test` cria um MongoDB 8.0.5 descartável com autenticação, executa 25 testes contra o backend real e encerra o contêiner. Se Docker não estiver disponível, falha explicitamente; não substitui o banco por mock nem pula os testes. Não usa conexões ou bancos do usuário.

Os testes visitam autenticação/CSRF, isolamento entre duas contas em oito rotas, consulta e paginação reais, agregações, índices, escrita e conflito de edição, preservação BSON, consultas salvas, reinício/persistência, logout e as restrições de conexão/criptografia/configuração.

O incremento F0 acrescenta expiração/finalidade/uso único de tokens, redefinição concorrente, revogação com corpo HTTP atrasado, exclusão com senha, isolamento/retenção de atividade, migração do schema SQLite, SCRAM-SHA-1 e SCRAM-SHA-256 com privilégios limitados, TLS SMTP local real e falha sem STARTTLS com três tentativas persistidas. O certificado e a chave em `tests/fixtures/smtp-*` são exclusivos do servidor de teste local; a confiança é instalada apenas no processo de teste e restaurada ao terminar.
