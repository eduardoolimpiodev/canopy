# Estado da implantação — 29/10/2026

**Feito e verificado:** aplicação em https://canopy.eduardoolimpio.com/ na VPS `143.95.209.222`, com HTTPS válido, login e workspace. Novos cadastros e recuperação de senha estão indisponíveis até configurar SMTP.

| Item                 | Estado observado                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Versão               | `20261030-registration`                                                                                         |
| Imagem               | `sha256:cbe830babf0fde398225a1e0c7df1142ab29c657f3650741fe1dd2d60a83eee9`                                       |
| Pacote SHA-256       | `a7686ed467722c93380358cad26653d255c57238d940245152a4ba3667adb6de`                                              |
| Release              | `/opt/canopy/releases/20261030-registration`                                                                    |
| Contêiner            | `canopy-canopy-1`, saudável                                                                                     |
| Rede e volume        | `proxy-network` e `canopy_canopy-data`                                                                          |
| Porta na VPS         | `127.0.0.1:4313`; proxy acessa o backend na rede Docker                                                         |
| Recursos             | 768 MiB, uma CPU, usuário `node`, raiz somente leitura e logs limitados                                         |
| Configuração privada | `/opt/canopy/shared/production.app.env`, permissão `0600`                                                       |
| Resposta pública     | HTTP redireciona para HTTPS; aplicação HTTPS 200; API privada exige sessão                                      |
| TLS                  | Cadeia e hostname validados por cliente externo; renovador próprio habilitado                                   |
| Contas existentes    | Dois cadastros preservados, incluindo hashes das senhas e estado de confirmação                                 |
| E-mail               | `MAIL_MODE=disabled`; cadastro, recuperação e reenvio retornam 503 explícito                                    |
| Backup inicial       | `/opt/canopy/backups/20261029-initial.sqlite`, permissão `0600`, integridade e restauração separada verificadas |

O login de uma conta temporária chegou ao workspace pelo domínio público, com cookie Secure e persistência da sessão após recriar o contêiner. A exclusão dessa conta retornou 200 e sua sessão passou a retornar 401. A conta e as credenciais de teste foram removidas. Permaneceram os dois cadastros do proprietário. A auditoria automatizada do workspace não apontou violações nem verificações inconclusivas.

As contas importadas continuam exigindo confirmação com a senha original. Foram preparados links iniciais de uso único, com validade de 24 horas, guardados também de forma cifrada no banco para acesso operacional. Nenhum e-mail foi enviado. Não há senha padrão nem confirmação automática.

`npm run check` passou com 25 testes, incluindo MongoDB autenticado, SMTP TLS local, modo de e-mail indisponível e importação inicial real. Após preservar os links na mesma transação da importação, o teste focado e o lint passaram. A versão final também passou no build e na prova de login pelo navegador.

Somente o virtual host Canopy foi alterado no Nginx existente, com `nginx -t` antes do reload. A configuração anterior está em `/opt/canopy/shared/nginx.canopy-before-app.conf`. Os demais projetos e o firewall foram preservados. A prévia SSH anterior continua separada da produção.

A versão `20261030-registration` publica a seção `/#/criar-conta`, com nome, e-mail, senha e confirmação de senha, além dos links diretos para entrar e recuperar senha. A prova local criou uma conta real, recusou senhas divergentes, confirmou o e-mail com senha e abriu o workspace. A revisão independente encontrou uma orientação incorreta na recuperação; ela foi corrigida e conferida no navegador. O formulário passou a ter o título principal também no celular.

Na VPS, o HTML servido foi comparado com a imagem, a seção abriu por HTTPS e as auditorias em desktop e celular retornaram zero violações e zero verificações inconclusivas. O cadastro sem SMTP continua retornando 503. Backend e schema não foram alterados neste incremento. A configuração anterior está em `/opt/canopy/shared/production.compose.before-registration.env`, e a imagem anterior permanece disponível para retorno de versão.

Os registros MX de `eduardoolimpio.com` e `seutime.online` apontam para o Titan. A VPS conseguiu abrir conexão SMTP TLS validada com `smtp.titan.email:465` e recebeu EHLO 250. O proprietário informou a caixa `contato@seutime.online`; uma tentativa de autenticação SMTP foi recusada com EAUTH/535, e uma tentativa no webmail exibiu “E-mail ou senha incorretos”. A configuração de produção permaneceu inalterada, com permissão `0600` e fluxos de e-mail desativados. Nenhuma mensagem foi enviada. Corrigir a credencial da caixa antes de tentar novamente; entrega real permanece pendente.

## Pendências

Configurar e validar SMTP externo para abrir novos cadastros e recuperação de senha. Preparar backup recorrente e externo, retenção operacional, proteção de saída no host e prazo de resolução DNS SRV/TXT. O snapshot inicial não substitui essa operação recorrente. A paridade integral com Studio 3T segue pendente na matriz.

O timer `canopy-cert-renew.timer` está habilitado. A execução inicial terminou com sucesso e conferiu o certificado servido; uma renovação futura real não foi forçada. Consulte as [instruções de operação](README.md).
