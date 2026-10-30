# Implantação na VPS

Destino autorizado: AlmaLinux na VPS `143.95.209.222`, SSH `22022`. O manifesto usa uma única instância, 768 MiB, uma CPU, filesystem somente leitura, volume de metadados e logs limitados. A porta da aplicação fica vinculada exclusivamente a `127.0.0.1`.

## Organização

- `/opt/canopy/releases/<versao>/`: manifesto e identificação da imagem implantada.
- `/opt/canopy/shared/`: configuração privada e chave de criptografia, com diretório `0700` e arquivos `0600`.
- Projeto Compose `canopy-stage`: prévia restrita por SSH, com volume próprio.
- Projeto Compose `canopy`: produção, com outro volume. Dois cadastros locais do proprietário foram importados explicitamente, preservando hashes e estado de confirmação. Não promover dados da prévia automaticamente.

A imagem é construída localmente e transferida por SSH; a VPS não executa `npm install` nem o build. Os outros projetos Docker, o proxy Nginx e o firewall do servidor ficam fora da implantação restrita.

## Prévia restrita

O arquivo `stage.app.env` define `NODE_ENV=development`, `MAIL_MODE=file` e `APP_ORIGIN=http://localhost:4312`. Ele não é um modo de publicação pública. Os e-mails ficam no volume local, sem envio para a caixa do destinatário.

O arquivo `stage.compose.env` define:

```dotenv
CANOPY_IMAGE=canopy-web:<versao>
CANOPY_ENV_FILE=/opt/canopy/shared/stage.app.env
CANOPY_BIND_PORT=4310
```

Suba a versão pelo manifesto da release:

```sh
docker compose --project-name canopy-stage --env-file /opt/canopy/shared/stage.compose.env -f /opt/canopy/releases/<versao>/compose.vps.yml up --detach --no-build --wait --wait-timeout 60
```

No computador do desenvolvedor, mantenha o túnel:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4312:127.0.0.1:4310 -p 22022 root@143.95.209.222
```

Abra `http://localhost:4312`. A origem inclui a porta; outro endereço exige configurar a origem correspondente no serviço. O healthcheck comprova disponibilidade HTTP, sem certificar envio SMTP nem conectividade a todos os bancos MongoDB.

## Produção

O domínio canônico atual é `https://canopyworkbench.com`, configurado em `APP_ORIGIN` na VPS. O vhost `nginx.canopyworkbench.conf` atende a aplicação e redireciona www. `nginx.canopy-app.conf` preserva o desafio ACME do domínio antigo e redireciona seu tráfego para o principal. O serviço `canopy-main-cert-renew.service` e seu timer renovam e verificam o novo certificado; o renovador antigo continua ativo para o domínio de redirecionamento. O `.com.br` depende de corrigir a falha de registro informada pela HostGator. A descrição abaixo registra a implantação anterior à troca de domínio.

O serviço está publicado em https://canopy.eduardoolimpio.com/. A configuração privada define `NODE_ENV=production`, `APP_ORIGIN=https://canopy.eduardoolimpio.com`, `MAIL_MODE=smtp` e `TRUSTED_PROXY_CIDRS=172.18.0.4`, o IP observado do proxy. Produção rejeita HTTP, e-mail em arquivo e exceções de rede MongoDB privada. A confirmação das contas existentes continua exigindo link válido e senha; novos cadastros, recuperação e reenvio estão habilitados.

`production.compose.env` aponta para a imagem imutável registrada em [STATUS.md](STATUS.md), `CANOPY_ENV_FILE=/opt/canopy/shared/production.app.env` e `CANOPY_BIND_PORT=4313`. A ativação usa os dois manifestos:

```sh
docker compose --project-name canopy --env-file /opt/canopy/shared/production.compose.env -f /opt/canopy/releases/20261030-registration/compose.vps.yml -f /opt/canopy/releases/20261030-registration/compose.public.yml up --detach --no-build --wait --wait-timeout 60
```

A rede externa `proxy-network` fornece o alias `canopy-api`. O virtual host sobrescreve os cabeçalhos de encaminhamento; a aplicação confia somente no proxy configurado. Se o IP do proxy mudar, confira o novo IP e atualize a configuração privada antes de recriar o serviço. O Nginx resolve o alias Docker dinamicamente.

SMTP externo e cadastro completo foram validados. Permanecem pendentes regras de saída no host, prazo de resolução SRV/TXT e operação recorrente de backups. O snapshot inicial já foi restaurado e conferido em diretório separado; backup recorrente e externo permanece pendente.

O servidor já usa o contêiner `nginx-proxy`, com configurações em `/apps/nginx/conf.d`. Acrescentar somente o virtual host aprovado, testar `nginx -t` e então recarregar o proxy. Não instalar outro serviço nas portas 80/443 e não reiniciar os demais projetos. A rede e a confiança no proxy precisam ser configuradas e verificadas antes de tornar a API acessível por ele.

## Envio pelo Titan da HostGator

A HostGator oferece Titan com SMTP, mas a contratação da VPS não comprova licença nem caixa ativa. Em 29/10/2026, os registros MX públicos de `eduardoolimpio.com` apontavam para `mx1.titan.email` e `mx2.titan.email`; isso comprova somente o apontamento DNS. Não trocar o registro A do Canopy para configurar e-mail.

A conexão SMTP da VPS com `smtp.titan.email:465` foi validada com cadeia e hostname TLS e resposta EHLO 250. Em 30/10/2026, após habilitar aplicativos externos no Titan, a autenticação passou e uma confirmação foi recebida e consumida no teste público.

No Portal do Cliente, acessar E-mails, Gerenciar e-mails do domínio, Contas de e-mail e Criar nova conta de e-mail. O proprietário informou a criação de `contato@seutime.online`; os MX desse domínio também apontam para o Titan. A caixa está habilitada para aplicativos externos e autenticada na VPS com credencial privada. Conferir os registros de autenticação exigidos pelo painel; não substituir configurações de correio existentes sem conferir o uso atual.

Configurar diretamente no arquivo privado da VPS, sem incluir a senha no Git ou em mensagens:

```dotenv
MAIL_MODE=smtp
MAIL_FROM=contato@seutime.online
SMTP_HOST=smtp.titan.email
SMTP_PORT=465
SMTP_TLS=tls
SMTP_USER=contato@seutime.online
SMTP_PASSWORD=<senha-da-caixa-configurada-diretamente-na-VPS>
```

Manter permissão `0600` e recriar somente o serviço Canopy pelos manifestos de produção. Validar um cadastro e o recebimento real da confirmação, consumo do link com senha e recuperação de conta. Um registro MX ou uma conexão SMTP aceita não prova entrega na caixa final. Se o envio falhar, registrar a causa segura e manter a indisponibilidade declarada, sem usar e-mail em arquivo em produção.

Instruções oficiais consultadas: [disponibilidade do Titan](https://suporte.hostgator.com.br/hc/pt-br/articles/30818814009619-Principais-d%C3%BAvidas-sobre-o-e-mail-Titan), [criar caixa](https://suporte.hostgator.com.br/hc/pt-br/articles/30807253108883-Como-criar-uma-conta-de-e-mail-profissional-com-o-Titan), [habilitar uso externo](https://suporte.hostgator.com.br/hc/pt-br/articles/30807156866067-Como-habilitar-o-e-mail-Titan-para-uso-externo) e [SMTP com SSL/TLS na porta 465](https://suporte.hostgator.com.br/hc/pt-br/articles/30813560087571-Como-enviar-e-receber-e-mails-Titan-por-aplicativos-externos).

## HTTPS do domínio Canopy

`nginx.canopy-http.conf` prepara HTTP-01 no webroot `/var/www/letsencrypt`. `nginx.canopy-https.conf` e `maintenance.html` foram usados na preparação. O arquivo ativo agora é `nginx.canopy-app.conf`, que redireciona HTTP e encaminha HTTPS para `canopy-api:4310`. Certificado e chave são gerenciados pelo Certbot em `/etc/letsencrypt/live/canopy.eduardoolimpio.com/`. A configuração anterior está em `/opt/canopy/shared/nginx.canopy-before-app.conf`.

O renovador `renew-canopy-cert.py` é instalado em `/opt/canopy/shared/`, com os arquivos `canopy-cert-renew.service` e `canopy-cert-renew.timer` em `/etc/systemd/system/`. O timer executa duas vezes ao dia, com atraso aleatório de até 30 minutos. O script renova somente a linhagem Canopy e compara o fingerprint do certificado em disco com o certificado efetivamente servido, validando cadeia e hostname. Recarrega o proxy somente quando necessário, após `nginx -t`, e falha se o novo certificado não for apresentado.

Consultar `systemctl status canopy-cert-renew.timer` e `journalctl -u canopy-cert-renew.service` para verificar agenda e resultados. A execução inicial comprovou o caminho de certificado já atualizado; uma renovação real futura não foi forçada. O vhost anterior à ativação de TLS foi preservado em `/opt/canopy/shared/nginx.canopy-before-https.conf`.

## Dados e retorno de versão

A chave de criptografia é gerada na VPS e preservada fora das releases. Nunca transferir o `.env`, `.data`, e-mails ou bancos locais dentro da imagem. Guardar a chave em backup separado, protegido, além do backup consistente do volume SQLite. A exclusão de uma release não deve excluir o volume ou a configuração compartilhada.

O backup inicial consistente está em `/opt/canopy/backups/20261029-initial.sqlite`, com permissão `0600`. A restauração isolada abriu o schema real e confirmou integridade e dois usuários. Esse arquivo não inclui a chave de criptografia nem substitui backups recorrentes e externos.

`import-initial-accounts.mjs` serve somente à instalação inicial com base vazia e e-mail desativado. Preserva os hashes de senha e gera links de confirmação de uso único por 24 horas. Os links ficam cifrados na fila com estado `operator`, gravados na mesma transação dos cadastros; esse estado não representa envio. O operador deve tratar a saída como segredo. Não executar novamente na base existente.

Para parar somente a prévia, use `docker compose` com o mesmo projeto, manifesto e arquivo de configuração, seguido de `stop`. Para trocar a imagem, preserve a identificação anterior e os metadados; em uma mudança de schema, restaurar uma cópia consistente em volume separado e validar a versão antiga antes de retornar. Não usar `down --volumes`, `docker system prune` ou limpeza global como parte do deploy.
