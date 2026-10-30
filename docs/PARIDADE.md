# Paridade funcional do Canopy com ferramentas MongoDB

**Estado:** análise e especificação feitas; implementação integral pendente. Referência documental: **29/10/2026**. [Fontes, divergências e limites da investigação](FONTES.md).

## Objetivo e regra de conclusão

O objetivo passa a ser oferecer no navegador o conjunto completo de capacidades MongoDB documentadas do **Studio 3T Desktop IDE**, considerando a união das funcionalidades de suas edições, sem restringir o escopo à edição gratuita. O Web IDE serve de referência para adaptação ao navegador. Recursos adicionais dos outros clientes aparecem como extensão identificada, sem atribuí-los indevidamente ao Studio 3T.

Fases definem ordem de execução; não retiram funcionalidades da meta. A primeira versão existente é a fundação do produto, não uma versão equivalente ao Studio 3T. Não há percentual de paridade calculado por contagem de botões: uma rotina SQL, um importador e uma opção visual têm custos e critérios diferentes.

Paridade exige uma linha rastreável para cada comportamento da versão de referência, teste contra banco real, comportamento de erro, permissões e adaptação web comprovados. Funcionalidade não confirmada na documentação atual permanece como investigação explícita; não desaparece do inventário.

## Comparação orientada ao produto

| Referência             | Capacidades que orientam o Canopy                                                                                               | Consequência                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Studio 3T Desktop      | Consultas visuais, shell, SQL, migrações, comparação, transformações, automação e produtividade. [S01–S25](FONTES.md#studio-3t) | Baseline principal de paridade.                                                          |
| Studio 3T Web + Access | Shell no servidor e catálogo de conexões governado. [S26–S31](FONTES.md#studio-3t)                                              | Execução no backend e autorização aplicada antes de acessar dados.                       |
| MongoDB Compass        | Operações nativas, validação, esquema, Explain e monitoramento. [C01–C04](FONTES.md#outros-produtos)                            | Testar semântica e permissões do MongoDB, incluindo recursos dependentes de versão.      |
| NoSQLBooster           | Assistência de código, depuração, scripts e formatos de saída. [C05/C06](FONTES.md#outros-produtos)                             | Editor e execução precisam de uma arquitetura própria, além de um textarea.              |
| Navicat                | Modelagem, BI, geração de dados, sincronização e colaboração. [C07/C08](FONTES.md#outros-produtos)                              | Registrar extensões sem confundir desenho de modelo com análise de esquema existente.    |
| DataGrip               | Inspeção de código, scripts em arquivos, SQL e ferramentas de desenvolvimento. [C09](FONTES.md#outros-produtos)                 | Arquivos, histórico e integração de consultas fazem parte da experiência.                |
| NoSQL Manager          | Administração, GridFS, observabilidade e cópias. [C10](FONTES.md#outros-produtos)                                               | Cobrir administração além de CRUD de documentos.                                         |
| DbGate e VS Code       | Referências complementares de web, arquivos e playgrounds. [C11/C12](FONTES.md#outros-produtos)                                 | Reutilizar padrões comprovados; não presumir que uma aplicação web já é um SaaS isolado. |

## Estado atual comprovável

Estado após o incremento F0 de contas, recuperação e auditoria, com execução dos testes e prova no navegador:

- `src/server/accounts.ts`, `mail.ts` e `store.ts`: confirmação de e-mail com senha, recuperação de conta, consumo atômico de tokens, fila persistida de e-mails e exclusão lógica da conta. `app.ts` aplica autorização após leitura do corpo e registra atividade sem conteúdo de consultas ou documentos.
- `src/server/mongo.ts`: conexões diretas restritas, SRV Atlas, limites de execução e lista de estágios permitidos. `$out`, `$merge` e JavaScript no servidor continuam bloqueados.
- `src/client/App.tsx` e `Results.tsx`: explorador, um editor de consulta por vez, tabela e JSON. A tabela mostra no máximo 16 campos; a edição substitui um documento inteiro.
- `tests/integration.test.ts`, `network.test.ts`, `accounts.test.ts`, `mail.test.ts` e `provision.test.ts`: 25 testes com MongoDB 8.0.5 autenticado, SCRAM-SHA-1/256, usuário limitado a uma coleção, SMTP TLS local e falhas reais de protocolo. Incluem HTTP com corpo atrasado durante reset, concorrência no consumo de token, reinício, migração de metadados, importação inicial e modo de e-mail indisponível. Não demonstram compatibilidade com todos os servidores e operadores nem entrega por um provedor SMTP externo.
- Navegador: cadastro, confirmação, solicitação de recuperação, senhas divergentes, redefinição, rejeição da senha antiga, novo login, atividade e exclusão da conta. A visualização de atividade ganhou acesso por teclado. As auditorias automatizadas finais não apontaram violações; no modal houve verificações de contraste inconclusivas em elementos recortados pela rolagem, sem certificação integral de acessibilidade.
- A aplicação está publicada em https://canopy.eduardoolimpio.com/ com login HTTPS, workspace e persistência de sessão após atualização verificados. O backup inicial teve restauração isolada conferida. Novos cadastros e recuperação estão indisponíveis enquanto SMTP não é configurado.
- A seção Criar conta tem link direto, confirmação de senha e estado explícito de indisponibilidade. A prova local no navegador criou uma conta, confirmou o e-mail com senha e abriu o workspace; cadastro permanece bloqueado na VPS até configurar o envio real.
- Download de JSON e conexão com um cluster Atlas real permanecem sem prova de ponta a ponta. SQLite e limitadores de concorrência são locais a uma instância.

## Como ler a matriz

**I** = implementado no recorte estreito indicado, com evidência existente; **P** = parcial ou restrito; **NV** = código presente sem prova suficiente; **F** = falta implementar; **V** = investigar suporte/versão antes de definir a implementação. “I” não certifica paridade de todo o módulo.

**Origem:** Sxx/Cxx/Txx remetem a [FONTES.md](FONTES.md); **W** é requisito do produto público pedido pelo usuário, não alegação sobre concorrente. O aceite é o resultado observável proposto para o Canopy. Metas de carga e latência serão fixadas com amostra e medição, antes da implementação de cada rotina cara.

O inventário contém **199 requisitos**: 10 implementados no recorte indicado, 21 parciais, 2 sem prova suficiente, 156 por implementar e 10 em investigação de suporte. Estes números descrevem as linhas deste documento; não medem percentual de paridade nem estimam esforço.

## F0 — Fundação para uso público

| ID    | Capacidade                                         | Estado | Aceite do Canopy                                                                                                                                                         | Origem |
| ----- | -------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| PUB01 | Cadastro, login e revogação de sessão              | I      | Credencial válida entra; cookie revogado perde acesso.                                                                                                                   | W      |
| PUB02 | Verificação de e-mail e recuperação de conta       | I      | Tokens com finalidade, expiração e consumo atômico; confirmação exige senha, reset revoga sessões. SMTP TLS local provado; provedor externo pendente.                    | W      |
| PUB03 | Isolamento por proprietário em todas as operações  | P      | Cobrir também futuros arquivos, tarefas, scripts, streams e compartilhamento.                                                                                            | W/S26  |
| PUB04 | Criptografia de credenciais e rotação de chave     | P      | Rotacionar sem perder conexões e sem registrar segredos.                                                                                                                 | W/S03  |
| PUB05 | Auditoria por usuário, alvo e operação             | I      | APIs atuais registram método, rota, ação tipada, alvo e status; até 1.000 eventos/30 dias por conta, sem corpo de consulta, URI ou documento.                            | W/S02  |
| PUB06 | Cotas e limites por usuário/workspace              | P      | Uma conta não esgota memória, conexões, execução ou armazenamento das demais.                                                                                            | W      |
| PUB07 | Armazenamento e coordenação entre instâncias       | F      | Duas instâncias mantêm sessões, permissões e limites consistentes.                                                                                                       | W      |
| PUB08 | Backup e restauração dos metadados da plataforma   | P      | Snapshot SQLite consistente e restauração isolada com duas contas verificados. Faltam operação recorrente, cópia externa, retenção e recuperação de segredos/conexões.   | W      |
| PUB09 | Exclusão de conta e retenção de artefatos          | P      | Exclusão lógica com senha/confirmação remove metadados próprios e preserva MongoDB. E-mails retidos até 24h; faltam política operacional de backups e artefatos futuros. | W      |
| PUB10 | HTTPS, proxies e saída de rede protegida           | P      | Origem e IP corretos; DNS lento e destinos privados não burlam o limite.                                                                                                 | W      |
| PUB11 | Falhas explícitas e resultados incertos de escrita | P      | Erro ou confirmação incerta nunca aparece como escrita confirmada.                                                                                                       | W      |
| PUB12 | Recuperação após queda durante operação longa      | F      | Registrar estado real, checkpoint e ação necessária após reinício.                                                                                                       | W/S22  |

## F1 — Conexões e espaço de trabalho

| ID    | Capacidade                                        | Estado | Aceite do Canopy                                                                                                                           | Origem  |
| ----- | ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| CON01 | Cadastro por URI e teste da conexão               | P      | Manter opções válidas e apontar erro de autenticação/rede sem expor a URI.                                                                 | S04     |
| CON02 | Formulário de conexão por campos                  | F      | Formulário e URI representam a mesma configuração sem perdas.                                                                              | S04     |
| CON03 | Standalone, replica set e cluster fragmentado     | P      | Selecionar membros/roteadores e recuperar de troca de primário.                                                                            | S04     |
| CON04 | SRV/TXT de provedores suportados                  | NV     | Validar DNS, TLS e timeout com cluster real; hoje só Atlas é aceito.                                                                       | S04     |
| CON05 | SCRAM-SHA-1 e SCRAM-SHA-256                       | I      | MongoDB 8.0.5 com usuários limitados a cada mecanismo; senha e authSource incorretos falham. Outros servidores ainda exigem prova própria. | S04/C10 |
| CON06 | Certificados de cliente e CA privada              | F      | Certificado correto conecta; expirado ou para outro host falha.                                                                            | S01/S04 |
| CON07 | LDAP e Kerberos                                   | F      | Identidade e renovação funcionam no ambiente corporativo de teste.                                                                         | S01/S32 |
| CON08 | OIDC para o MongoDB                               | F      | Concluir o fluxo sem tratar login do Canopy como login automático no banco.                                                                | S01/S02 |
| CON09 | Tunelamento SSH e perfis de credenciais           | F      | Renovar um perfil sem alterar o alvo ou divulgar chave para outro usuário.                                                                 | S04     |
| CON10 | Proxy HTTP/SOCKS e topologias especiais           | F      | Rota e descoberta respeitam política de saída; cobrir load balancing.                                                                      | S04     |
| CON11 | Grupos, cores, aliases, clonagem e edição         | F      | Identificar ambiente e reorganizar conexões sem perder associações.                                                                        | S03/S04 |
| CON12 | Importar/exportar configurações de conexão        | F      | Importar arquivo escolhido pelo usuário; segredos excluídos por padrão.                                                                    | S04     |
| CON13 | Remover uma conexão privada                       | I      | Remover metadados e consultas associadas, preservando os dados MongoDB.                                                                    | S04     |
| CON14 | Bloqueio de escrita por conexão                   | P      | Bloquear todos os caminhos de escrita, inclusive shell e tarefas futuros.                                                                  | S03/C02 |
| CON15 | Credenciais AWS e outros mecanismos do provedor   | V      | Confirmar mecanismos do servidor e executar cada integração declarada.                                                                     | C06/C10 |
| CON16 | Conector para localhost/VPN/rede privada          | F      | Acesso pela rede do dono sem abrir rota à rede interna da plataforma.                                                                      | W/S04   |
| UX01  | Abas independentes de consultas e resultados      | F      | Cada aba preserva alvo, editor, resultado e estado de execução.                                                                            | S03/S05 |
| UX02  | Renomear, ordenar e fechar grupos de abas         | F      | Operações de abas não descartam conteúdo alterado sem tratamento explícito.                                                                | S03     |
| UX03  | Painéis lado a lado e divisão horizontal/vertical | F      | Comparar dois resultados mantendo navegação por teclado.                                                                                   | S03     |
| UX04  | Destacar aba em outra janela                      | F      | Preservar sessão e contexto sem transferir credenciais ao browser.                                                                         | S03     |
| UX05  | Restaurar sessão de trabalho                      | F      | Reabrir editores e alvos; não reexecutar escrita ao restaurar.                                                                             | S03/S09 |
| UX06  | Nome completo do banco e cor do ambiente          | P      | Alvo de cada editor e confirmação de escrita ficam inequívocos.                                                                            | S03     |
| UX07  | Fonte, tamanho, tema e painéis configuráveis      | F      | Preferências persistem por usuário e mantêm contraste e foco visível.                                                                      | S03/C09 |
| UX08  | Atalhos configuráveis e importação do mapa        | P      | Executar, navegar e editar por teclado sem conflitos com atalhos reservados.                                                               | S23     |
| UX09  | Padrões por coleção e tela inicial                | F      | Aplicar consulta/visualização preferidas sem execução destrutiva implícita.                                                                | S03/S09 |

## F2 — Exploração, documentos e administração de objetos

| ID    | Capacidade                                                 | Estado | Aceite do Canopy                                                                                                               | Origem  |
| ----- | ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ | ------- |
| OBJ01 | Explorar bancos e coleções autorizados                     | I      | Usuário MongoDB restrito só lista o banco/coleção concedidos; consultas e escritas negadas também são recusadas pelo servidor. | S04/C01 |
| OBJ02 | Criar e remover bancos                                     | F      | Exigir permissão e confirmar o alvo; verificar o efeito no servidor.                                                           | C01/C10 |
| OBJ03 | Criar, renomear, limpar e remover coleções                 | F      | Distinguir limpeza de remoção, mantendo resultado e erro verificáveis.                                                         | S23/C10 |
| OBJ04 | Copiar documentos, coleções e bancos entre servidores      | F      | Preservar BSON, declarar conflitos e conferir o destino.                                                                       | S03     |
| OBJ05 | Views: criar, editar, consultar e remover                  | P      | Hoje a listagem pode mostrar views; falta gerenciamento e distinção de escrita.                                                | S03/C10 |
| OBJ06 | Validador JSON Schema e nível de validação                 | F      | Documento inválido é rejeitado pelo banco conforme a regra escolhida.                                                          | C02/C03 |
| OBJ07 | Coleções especiais e opções de criação                     | V      | Confirmar capped, time series, collation e recursos da versão alvo.                                                            | C01/C10 |
| OBJ08 | Estatísticas de banco e coleção                            | F      | Mostrar métricas reais com horário e permissão de coleta.                                                                      | S03/C10 |
| OBJ09 | Usuários e papéis do MongoDB                               | F      | Criar/alterar/remover apenas com privilégios suficientes no banco.                                                             | S24     |
| OBJ10 | Gerenciar buckets e arquivos GridFS                        | F      | Upload, leitura e remoção preservam conteúdo e metadados.                                                                      | S25     |
| OBJ11 | Administração de replica sets                              | V      | Confirmar escopo do produto e validar comandos em cluster descartável.                                                         | C10     |
| DOC01 | Resultado tabular                                          | P      | Campos heterogêneos, colunas e valores extensos sem perda de navegação.                                                        | S05/C01 |
| DOC02 | Árvore de objetos e arrays                                 | F      | Expandir nós, editar e localizar o caminho do valor.                                                                           | S05/C10 |
| DOC03 | Visualização JSON canônica                                 | I      | Exibir documentos preservando os tipos BSON já cobertos nos testes.                                                            | S05/C01 |
| DOC04 | Inserção, substituição e exclusão de um documento          | I      | Mudança afeta o banco e conflito de edição não sobrescreve atualização alheia.                                                 | S05/C01 |
| DOC05 | Edição de campo diretamente na tabela/árvore               | F      | Alterar somente o campo selecionado, incluindo caminho aninhado.                                                               | S05/C09 |
| DOC06 | Adicionar, remover e renomear campos em lote               | F      | Prévia de escopo, contagem e conflitos antes da alteração.                                                                     | S12/S23 |
| DOC07 | Editores especializados para todos os tipos BSON           | P      | Completar cobertura além de ObjectId, Date, Long e Decimal128.                                                                 | S06/C10 |
| DOC08 | Conteúdo binário, hexadecimal e imagem                     | F      | Prévia e edição com tamanho limitado e sem executar conteúdo.                                                                  | C08/C10 |
| DOC09 | Edição de strings multilinha e arrays                      | P      | Editor atual aceita documento completo; faltam editores por valor.                                                             | S03/C10 |
| DOC10 | Redimensionar, selecionar e ordenar colunas                | F      | Estado persistido e indicação explícita de valores truncados.                                                                  | S03/C06 |
| DOC11 | Referências e navegação entre documentos                   | F      | Abrir o documento referenciado sem perder a consulta de origem.                                                                | S23     |
| DOC12 | Seleção múltipla, cópia de valores/documentos e duplicação | F      | Conteúdo copiado mantém valor e tipo, inclusive campos ausentes.                                                               | S03/S23 |
| DOC13 | Representação geográfica de GeoJSON                        | F      | Distinguir geometria inválida e mostrar coordenadas corretamente.                                                              | C06     |
| DOC14 | Busca/substituição de conteúdo e tratamento de conflitos   | F      | Conferir afetados antes de aplicar; manter rastreio de falhas parciais.                                                        | C07/C08 |

## F2 — Consultas, construtores e produtividade

| ID    | Capacidade                                          | Estado | Aceite do Canopy                                                                  | Origem  |
| ----- | --------------------------------------------------- | ------ | --------------------------------------------------------------------------------- | ------- |
| QRY01 | Filtros find e ordenação                            | P      | Cobrir operadores, collation e opções do servidor declarado.                      | S06/C01 |
| QRY02 | Projeção, hint e opções de leitura                  | F      | Resultado e plano respeitam as opções sem alterar tipos.                          | S06/S10 |
| QRY03 | Paginação e limite configurável                     | P      | Hoje há skip até 10.000 e 200 itens/página; falta navegação de conjuntos maiores. | S03/C01 |
| QRY04 | Contagem e valores distintos                        | F      | Distinguir contagem exata/estimada e executar distinct no alvo correto.           | S07/C06 |
| QRY05 | Diagnóstico e sugestões durante edição              | F      | Exibir linha/posição, nomes e operadores conforme contexto.                       | S05/C09 |
| QRY06 | Formatação, comentários, snippets e busca no editor | P      | Hoje só há formatação JSON; ampliar sem alterar a semântica.                      | S03/C05 |
| QRY07 | Consultas salvas com alvo associado                 | I      | Salvar/carregar mantém conexão, banco, coleção e conteúdo.                        | S09     |
| QRY08 | Histórico automático, busca, pastas e favoritos     | F      | Recuperar execuções anteriores com retenção e autoria.                            | S09     |
| QRY09 | Consulta padrão por coleção                         | F      | Persistir configuração sem executar escrita ao abrir.                             | S03/S09 |
| QRY10 | Tags de data e fuso horário                         | F      | Intervalos relativos têm fronteiras reproduzíveis no fuso selecionado.            | S05     |
| QRY11 | Arquivos de consulta: abrir, salvar e importar      | F      | Troca por upload/download mantém conteúdo e formato.                              | S05/C09 |
| QRY12 | Execução em múltiplos alvos                         | F      | Resultados e falhas separados por alvo, sem confirmação global enganosa.          | C06/C09 |
| VQB01 | Condições por campo, operador e tipo                | F      | Interface gera filtro equivalente ao preenchido.                                  | S06     |
| VQB02 | Grupos AND/OR/NOR aninhados                         | F      | Conversão mantém precedência e agrupamento.                                       | S06     |
| VQB03 | Arrays e correspondência por elemento               | F      | Fixtures distinguem elementos diferentes no mesmo array.                          | S06     |
| VQB04 | Arrastar valor do resultado para filtro             | F      | Caminho e tipo seguem o valor arrastado.                                          | S06     |
| VQB05 | Projeção e ordenação visuais                        | F      | Inclusão/exclusão e ordem coincidem com o código gerado.                          | S06     |
| VQB06 | Alternância entre código e construtor               | F      | Round-trip sem perda; sintaxe não representável é sinalizada.                     | S34     |
| AGG01 | Pipeline em código                                  | P      | Hoje aceita apenas a lista explícita de estágios no backend.                      | S27     |
| AGG02 | Adicionar, duplicar e reordenar estágios            | F      | Resultado equivale à ordem exibida na interface.                                  | S27     |
| AGG03 | Ativar/desativar estágio                            | F      | Prévia e execução excluem somente os estágios desativados.                        | S03/S27 |
| AGG04 | Prévia de entrada e saída por estágio               | F      | Dados da prévia correspondem ao trecho executado, com limite visível.             | S27     |
| AGG05 | Editor visual por operador e autocomplete           | F      | Sugestões consideram campos produzidos por estágios anteriores.                   | S27/C05 |
| AGG06 | Importar/exportar pipeline e alternar código/visual | F      | Conservar operadores, ordem e tipos.                                              | S27     |
| AGG07 | Explain e opções de execução do pipeline            | F      | Hint, collation e plano apresentados correspondem à execução solicitada.          | S10/S27 |
| AGG08 | Estágios de escrita $out/$merge                     | F      | Caminho de escrita explícito, privilégio verificado e resultado auditável.        | S27/W   |
| AGG09 | Operadores de versão, Atlas Search e busca vetorial | V      | Detectar disponibilidade e não oferecer sem servidor/índice compatíveis.          | C01     |
| AGG10 | Abrir consulta em outra ferramenta                  | F      | Transferir contexto entre find, pipeline, SQL e shell sem perdas.                 | S03/S08 |

## F3 — Shell, SQL e geração de código

| ID     | Capacidade                                          | Estado | Aceite do Canopy                                                                         | Origem  |
| ------ | --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- | ------- |
| SH01   | Sessão mongosh com estado e contexto                | F      | Variáveis e banco persistem na sessão isolada correta.                                   | S05/S28 |
| SH02   | Executar script, seleção ou instrução no cursor     | F      | Executar somente o trecho solicitado, com saídas separadas.                              | S05     |
| SH03   | Saída textual transmitida e resultados estruturados | F      | Preservar ordem e erros com saída limitada.                                              | S05/S28 |
| SH04   | Query Assist e edição de resultado find             | F      | Consultas reconhecidas abrem resultado editável sem fingir suportar scripts arbitrários. | S05     |
| SH05   | Cancelar, reiniciar e limpar a sessão               | F      | Encerrar trabalho real e liberar recursos; limpar texto não simula cancelamento.         | S28     |
| SH06   | Versão e configurações de shell por conexão         | F      | Usar runtime suportado e rastreado, sem caminho executável arbitrário do visitante.      | S03/S05 |
| SH07   | Depuração com breakpoints, passos e variáveis       | F      | Inspecionar somente o processo isolado da própria sessão.                                | C05/C06 |
| SH08   | Helpers e módulos de scripts                        | F      | Registrar compatibilidade e restringir módulos conforme o isolamento implantado.         | C05/C06 |
| SQL01  | SELECT, projeção, filtros, ordenação e paginação    | F      | Comparar resultado SQL e MQL em fixtures idênticas.                                      | S07     |
| SQL02  | GROUP BY, HAVING, DISTINCT e funções                | F      | Conferir agregados e conjuntos vazios com precisão BSON.                                 | S07     |
| SQL03  | INNER/LEFT/CROSS JOIN, aliases e múltiplos joins    | F      | Testar cardinalidade, campos ambíguos e custo do produto cartesiano.                     | S07     |
| SQL04  | Objetos, arrays, datas e identificadores especiais  | F      | Distinguir null/ausente e preservar caminhos e tipos.                                    | S07     |
| SQL05  | Mostrar e reutilizar MQL gerado                     | F      | O código apresentado é o efetivamente executado.                                         | S07/S08 |
| SQL06  | Arquivos SQL e diagnóstico de sintaxe               | F      | Salvar/carregar e apontar construção não suportada antes de executar.                    | S07     |
| SQL07  | Subconsultas e extensões do tradutor                | V      | Separar o subconjunto Studio 3T das extensões de outros produtos.                        | C06/C09 |
| CODE01 | Código Mongo Shell e Node.js                        | F      | Exemplo gerado executa com resultado equivalente ao editor.                              | S08     |
| CODE02 | Código Java, C#, Python, PHP e Ruby                 | F      | Validar cada alvo e versão de driver declarados.                                         | S08     |
| CODE03 | Copiar consulta e abrir no editor correspondente    | F      | Conteúdo copiado mantém filtro, opções e contexto.                                       | S08/S03 |
| CODE04 | Outros alvos de linguagem e projetos de exemplo     | V      | Confirmar extensões relevantes, como Go, sem prometer compatibilidade não testada.       | C05/C06 |

## F2/F4 — Esquema, índices e desempenho

| ID     | Capacidade                                               | Estado | Aceite do Canopy                                                            | Origem  |
| ------ | -------------------------------------------------------- | ------ | --------------------------------------------------------------------------- | ------- |
| SCH01  | Inferência de esquema por amostra ou varredura           | F      | Informar tamanho, seleção e cobertura da amostra.                           | S12     |
| SCH02  | Frequência, tipos, ausências e anomalias                 | F      | Detectar campos heterogêneos em fixture conhecida.                          | S12     |
| SCH03  | Histogramas, valores frequentes e distribuições de datas | F      | Conferir agrupamentos com dados e fuso definidos.                           | S12     |
| SCH04  | Abrir documentos relacionados a uma anomalia             | F      | Filtro corresponde ao campo/tipo selecionado.                               | S12     |
| SCH05  | Comentários e resultados de análises salvos              | F      | Reabrir análise e distinguir snapshot de estado atual.                      | S12     |
| SCH06  | Documentação de esquema Word/CSV                         | F      | Relatório corresponde à amostra e aos comentários selecionados.             | S12     |
| IDX01  | Listar índices                                           | I      | Retornar os índices reais da coleção autorizada.                            | S11     |
| IDX02  | Criar e remover índices                                  | F      | Permissões e efeito conferidos no servidor.                                 | S11     |
| IDX03  | Tipos e opções de índices                                | F      | Cobrir combinações suportadas, incluindo compostos, TTL, únicos e parciais. | S11     |
| IDX04  | Ocultar, reexibir e medir uso                            | F      | Alteração e métricas refletem os índices reais.                             | S11     |
| IDX05  | Comparar índices entre coleções                          | F      | Distinguir nomes iguais com definições diferentes.                          | S11     |
| IDX06  | Sugestão de índice a partir de consulta                  | F      | Mostrar justificativa e validar com plano antes/depois.                     | C06     |
| PERF01 | Explain em JSON e diagrama                               | F      | Plano e métricas correspondem à consulta e às opções executadas.            | S10/C04 |
| PERF02 | Profiler e investigação de consultas lentas              | F      | Permissão explícita, custo informado e drill-down para a consulta.          | S10     |
| PERF03 | Operações em execução e encerramento seletivo            | F      | Identificar o alvo correto e impedir encerramento sem autorização.          | S03/C10 |
| PERF04 | Métricas de servidor e gráficos                          | F      | Exibir horário de coleta, unidade e erro de permissão.                      | S03/C02 |
| PERF05 | Logs, mongostat e mongotop                               | F      | Consulta e retenção limitadas, sem misturar servidores.                     | C06/C10 |
| PERF06 | Tempo decorrido e duração de consulta                    | P      | Há duração final; falta acompanhamento durante execução.                    | S10/S03 |

## F4 — Importação, exportação e movimentação

| ID     | Capacidade                                            | Estado | Aceite do Canopy                                                                   | Origem      |
| ------ | ----------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- | ----------- |
| IMP01  | Importação JSON/NDJSON e formatos MongoDB             | F      | Validar registros e preservar tipos sem usar eval.                                 | S13         |
| IMP02  | Importação CSV e clipboard                            | F      | Delimitador, cabeçalho, aspas e encoding reproduzem a prévia.                      | S13         |
| IMP03  | Restauração BSON: pasta e arquivo mongodump           | F      | Restaurar metadados e conteúdo em banco descartável.                               | S13         |
| IMP04  | Importação de tabela SQL                              | F      | Conversão de tipos e chaves corresponde ao mapeamento.                             | S13         |
| IMP05  | Importação de outra coleção                           | F      | Tratar duplicatas e destino conforme o modo escolhido.                             | S13         |
| IMP06  | Modo insert/upsert/substituição e tratamento de erros | F      | Contabilizar aplicados, rejeitados e efeito parcial.                               | S13         |
| IMP07  | Conversões de campos, datas, arrays e null            | F      | Resultado coincide com a prévia aprovada.                                          | S13         |
| EXP01  | Download JSON da página atual                         | NV     | Receber arquivo real e conferir conteúdo; cancelamento também ocorreu no controle. | S14         |
| EXP02  | Exportar coleção, view, consulta e seleção completas  | F      | Não confundir página carregada com total exportado.                                | S14         |
| EXP03  | Exportação CSV configurável                           | F      | Campos, ordem, delimitador e null correspondem à prévia.                           | S14         |
| EXP04  | Exportação Excel                                      | F      | Planilha abre e preserva valores segundo política de tipos declarada.              | S14         |
| EXP05  | Exportação BSON/mongodump                             | F      | Restaurar o artefato e comparar documentos e metadados.                            | S14         |
| EXP06  | Exportação SQL                                        | F      | Arquivo executa no dialeto selecionado e produz o resultado esperado.              | S14         |
| EXP07  | Exportação para coleção e clipboard                   | F      | Distinguir destino persistido de conteúdo apenas copiado.                          | S14         |
| EXP08  | Múltiplas unidades, nomes e prévia de saída           | F      | Cada unidade informa destino, efeito e falha separadamente.                        | S14         |
| EXP09  | Exportação incremental e retomada                     | F      | Checkpoint evita perda e explicita política para registros modificados.            | S14         |
| EXP10  | Formatos adicionais de extração                       | V      | Confirmar XML/HTML/texto como extensões de outros clientes.                        | C06/C09/C10 |
| DATA01 | Backup/restauração dos bancos do usuário              | F      | Distinguir de backup do Canopy; restaurar e verificar em alvo separado.            | C07/C10     |
| DATA02 | Operações longas com fluxo limitado de dados          | F      | Exportação/importação maior que a página não acumula tudo na memória.              | W/C11       |

## F5 — Comparação, migração, mascaramento e transformação

| ID     | Capacidade                                          | Estado | Aceite do Canopy                                                                   | Origem      |
| ------ | --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- | ----------- |
| CMP01  | Comparar coleções e bancos entre servidores         | F      | Diferenças conferidas em fixtures controladas.                                     | S15         |
| CMP02  | Chave de correspondência simples/composta           | F      | Duplicidade de chave aparece como ambiguidade.                                     | S15         |
| CMP03  | Filtros, projeção, seleção de campos e lotes        | F      | Relatório descreve exatamente o recorte comparado.                                 | S15         |
| CMP04  | Comparação numérica estrita ou tolerante            | F      | Política explícita distingue tipos e tolerância de ponto flutuante.                | S15/S03     |
| CMP05  | Diferenças por campo e por documento                | F      | Separar ausente, diferente e exclusivo de cada lado.                               | S15         |
| CMP06  | Sincronização seletiva e bidirecional               | F      | Prévia, direção e autorização verificadas antes de aplicar.                        | S15         |
| CMP07  | Exportar relatório e histórico da comparação        | F      | Artefato registra recorte, alvos, horário e diferenças.                            | S15/S03     |
| CMP08  | Remover documentos a partir da comparação           | F      | Confirmação referencia documento e lado corretos.                                  | S03         |
| MIG01  | SQL para MongoDB, tabelas e consultas como origem   | F      | Montar documentos conforme mapeamento aprovado.                                    | S16         |
| MIG02  | Relações, documentos aninhados e arrays             | F      | Conferir chaves, cardinalidade e registros sem relação.                            | S16         |
| MIG03  | MongoDB para SQL, coleções e views                  | F      | Gerar tabelas e relações conforme o mapeamento.                                    | S17         |
| MIG04  | Destinos/conexões SQL e scripts por dialeto         | F      | Cobrir os bancos documentados, com prova individual por conector.                  | S01/S17     |
| MIG05  | Mapeamentos visuais e prévia                        | F      | Alterar nomes/tipos e validar a transformação antes da carga.                      | S16/S17     |
| MIG06  | Importar modelos/mapeamentos e execução incremental | F      | Reabrir configuração e retomar com política de consistência explícita.             | S16/S14     |
| MASK01 | Mascaramento configurável por campo/tipo            | F      | Regra escolhida transforma somente o escopo aprovado.                              | S19         |
| MASK02 | Mascaramento na origem ou em nova coleção           | F      | Prévia identifica efeitos destrutivos e destino.                                   | S19         |
| MASK03 | Mascaramento combinado com importação/exportação    | F      | O artefato e o destino não recebem o valor original.                               | S13/S14/S19 |
| MASK04 | Política de consistência e avaliação de privacidade | F      | Validar relações e risco residual; não presumir anonimização por substituir texto. | W/S19       |
| RSC01  | Transformação visual de esquema                     | F      | Acrescentar, remover, renomear e converter conforme a prévia.                      | S18         |
| RSC02  | Achatar/extrair objetos e arrays                    | F      | Conferir cardinalidade e tratamento de valores ausentes.                           | S18         |
| RSC03  | Mesclar fontes e criar múltiplos destinos           | F      | Preservar as relações indicadas no mapeamento.                                     | S18         |
| RSC04  | Amostragem, prévia e execução incremental           | F      | Distinguir o que foi inferido da amostra e o que foi efetivamente processado.      | S18         |
| RSC05  | Salvar configuração e executar como tarefa          | F      | Mesma configuração produz o mesmo comportamento na execução agendada.              | S18/S20     |

MIG04 mantém como meta os conectores citados no catálogo Studio 3T: MySQL, PostgreSQL, Oracle, Microsoft SQL Server, IBM DB2 e Sybase. Cada conector tem seu aceite; suporte a um deles não será usado como prova dos demais. [S01](FONTES.md#studio-3t)

## F4/F6 — Automação, colaboração, IA e integrações

| ID     | Capacidade                                      | Estado | Aceite do Canopy                                                               | Origem    |
| ------ | ----------------------------------------------- | ------ | ------------------------------------------------------------------------------ | --------- |
| JOB01  | Salvar, editar, duplicar e remover tarefas      | F      | Configuração persistida conserva origem, destino e regras.                     | S20       |
| JOB02  | Executar manualmente e encadear unidades        | F      | Ordem e política de interrupção por erro são observáveis.                      | S20/S21   |
| JOB03  | Agendamento, fuso, pausa e retomada             | F      | Execução independe do navegador aberto e respeita o calendário.                | S20       |
| JOB04  | Painel de progresso e log de operações          | F      | Progresso real, efeito parcial e falha visíveis por unidade.                   | S22       |
| JOB05  | Cancelamento, checkpoint e reinício             | F      | Cancelamento interrompe o trabalho; falha não vira sucesso ou reexecução cega. | W/S22     |
| JOB06  | Tarefas de shell e saída em arquivo             | F      | Rodar em isolamento e produzir artefato da conta correta.                      | S21       |
| JOB07  | API/CLI para automações externas                | F      | Token tem escopo, revogação e autoria auditável.                               | C06/S20   |
| JOB08  | Artefatos: baixar, localizar e copiar logs      | F      | Acesso autorizado, expiração e retenção explícitos.                            | S03/S22   |
| TEAM01 | Pastas compartilhadas de consultas e scripts    | F      | Compartilhar, editar e revogar sem vazar conexões privadas.                    | W/S09     |
| TEAM02 | Workspaces, membros e papéis                    | F      | Mudança de workspace troca o catálogo e a autorização efetiva.                 | S26/S31   |
| TEAM03 | Restrições por conexão/banco/coleção            | F      | Aplicar também a lookup, union, tarefas, exportação, shell e MCP.              | S26/S31   |
| TEAM04 | Federação de identidade                         | F      | Concluir e revogar sessões com o provedor corporativo.                         | S02/S31   |
| TEAM05 | Compartilhar análises, modelos e configurações  | F      | Diferenciar configuração compartilhável de credencial pessoal.                 | S12/C07   |
| AI01   | Linguagem natural para find, pipeline e scripts | F      | Proposta editável com alvo explícito; geração não equivale a execução.         | S29/C05   |
| AI02   | Contexto de esquema e diagnóstico               | F      | Enviar somente o contexto autorizado e explicar o recorte utilizado.           | S29/C05   |
| AI03   | Provedores e chaves por workspace               | F      | Isolar segredos, tráfego e consumo por dono.                                   | W/S29/C05 |
| AI04   | Abrir resultado da IA nos editores              | F      | Transferir a proposta mantendo os limites e a revisão humana.                  | S29       |
| AI05   | Controle de exposição de dados e custo          | F      | Configuração explicita dados enviados, retenção e limites de consumo.          | W/C05     |
| MCP01  | Catálogo MCP de conexões e metadados            | F      | Cliente externo só descobre recursos autorizados.                              | S30       |
| MCP02  | Consultas e operações por MCP                   | F      | Mesmas permissões e limites da UI; sem expor credenciais MongoDB.              | S30/W     |
| MCP03  | Autorização, revogação e auditoria remotas      | F      | Revogar cliente sem afetar outras sessões ou usuários.                         | W/S30     |

## Compatibilidade e extensões identificadas

| ID     | Capacidade                                           | Estado | Aceite do Canopy                                                                 | Origem      |
| ------ | ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------- | ----------- |
| LEG01  | Map-Reduce e funções legadas                         | V      | Detectar versão e disponibilidade; apresentar indisponibilidade real.            | T02/S23/C10 |
| COMP01 | Matriz de versões MongoDB Community/Enterprise       | V      | Declarar apenas combinações realmente exercitadas.                               | S32/C10     |
| COMP02 | Atlas, Amazon DocumentDB e Cosmos DB                 | V      | Identificar diferenças de comandos e autenticação por provedor.                  | C07/C10     |
| COMP03 | Banco/driver/shell e formato de arquivos versionados | F      | Diagnóstico distingue incompatibilidade de erro de consulta.                     | S03/S04     |
| EXT01  | Modelagem visual e sincronização de estruturas       | F      | Modelo e alterações estruturais têm prévia e efeito verificável.                 | C07         |
| EXT02  | BI, gráficos e painéis sobre consultas               | F      | Gráfico remete à consulta, recorte e atualização usados.                         | C07/C08     |
| EXT03  | Gerador de dados de teste                            | F      | Produzir volume e distribuição declarados em alvo autorizado.                    | C06/C07     |
| EXT04  | Arquivos de projeto e integração com Git             | F      | Versionar consultas sem incluir segredos ou resultados sensíveis implicitamente. | C09/C12     |
| EXT05  | Arquivo NDJSON de dados e restauração                | F      | Ler e restaurar o formato com política explícita de tipos.                       | C11         |

## O que muda na arquitetura

**Decisão proposta para esta meta, ainda não implementada:** manter React/TypeScript e Node/Fastify, organizar o backend em módulos e acrescentar execução isolada para scripts e trabalhos longos. Migrar metadados para PostgreSQL antes de múltiplas instâncias públicas. Permanecer com um repositório e evitar uma rede de microserviços para uma equipe de um desenvolvedor.

Foram consideradas duas alternativas: ampliar o processo atual com SQLite e executores no próprio backend; ou separar API de execução e adotar persistência compartilhada. A segunda atende os caminhos concretos de falha de shell de terceiros, queda durante migração e sessões/limites em múltiplas instâncias. Esta é uma proposta de evolução; não há migração criada ou dado alterado nesta análise.

| Parte                 | Responsabilidade e restrição                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface React       | Abas, editor, grid virtualizado, árvore, construtores e painéis. Avaliar um editor adotado, como Monaco, e uma grade antes de escrever ambos do zero. Nenhuma dependência nova foi instalada nesta rodada.                                                                                                                                                                                                                                                                                          |
| API Node/Fastify      | Conta, catálogo, autorização, consultas estruturadas e acompanhamento das operações. Validar a entrada uma vez e carregar garantias para o restante do fluxo.                                                                                                                                                                                                                                                                                                                                       |
| PostgreSQL            | Contas, workspaces, permissões, tarefas, checkpoints, auditoria e coordenação. Usar uma fila persistida simples inicialmente; Redis só entra se uma limitação medida justificar.                                                                                                                                                                                                                                                                                                                    |
| Executor de trabalhos | Processar importações, exportações, comparações e migrações com lotes, cancelamento, checkpoints e resultado por unidade. Um trabalho precisa continuar sem a aba aberta.                                                                                                                                                                                                                                                                                                                           |
| Runtime de shell      | Sessão por usuário/trabalho, CPU/memória/tempo/saída limitados, filesystem efêmero e rede controlada. Scripts não podem ler/escrever arquivos do host/aplicação, segredos ou dados de outras sessões; não herdam credenciais da plataforma, não acessam o daemon de contêineres nem destinos de rede fora da concessão. Diretório temporário em processo filho não prova isolamento. `eval`, `new Function` e `node:vm` no processo da API não são isolamento. [T01](FONTES.md#restrições-técnicas) |
| Artefatos             | Upload/download autenticados, armazenamento com limite e retenção. Acesso por conta/workspace, nunca pasta de servidor indicada livremente pelo visitante.                                                                                                                                                                                                                                                                                                                                          |
| Conector privado      | Serviço na rede do proprietário, vínculo autenticado à conta e controle dos destinos. Não substituir por liberação global de IPs privados no SaaS.                                                                                                                                                                                                                                                                                                                                                  |
| SQL e transformação   | Parser e representação intermediária; traduções com testes de equivalência. Não resolver SQL com substituições de texto.                                                                                                                                                                                                                                                                                                                                                                            |

Shell completo e permissões granulares exigem uma decisão de execução: credenciais disponibilizadas ao runtime precisam ter papéis MongoDB compatíveis com a política aprovada. Não se garante “somente leitura” ou restrição por coleção analisando texto JavaScript ou ocultando botões. Quando a credencial não representar a restrição, será necessário um broker que autorize comandos/namespaces, ou indisponibilidade explícita do shell nesse modo até existir esse controle. Não entregar uma opção que pareça restrita e possa acessar dados além da concessão. O alerta do próprio Compass reforça esta diferença. [C02](FONTES.md#outros-produtos)

## Ordem de execução e prova de saída

| Marco                        | Resultado exigido                                                    | Prova antes de avançar                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0 — Público                 | Conta recuperável, isolamento completo, rede e metadados preparados. | Duas contas, falhas DNS, revogação, restauração e testes de abuso com limites definidos.                                                                         |
| F1 — Workspace               | Conexões completas, abas, contexto e produtividade.                  | Abrir dois bancos, restaurar trabalho sem reexecutar escrita e testar cada autenticação disponível.                                                              |
| F2 — Exploração profissional | Construtores, árvore, edição por campo, esquema e índices.           | Fixtures heterogêneas, round-trip visual/código, conflitos reais e planos de execução.                                                                           |
| F3 — Programação             | Shell isolado, subconjunto SQL e código por driver.                  | Provas negativas contra filesystem/ambiente/segredos do host, sessões alheias, daemon e rede fora da concessão; consultas SQL/MQL equivalentes no mesmo dataset. |
| F4 — Operação                | Arquivos completos, tarefas e acompanhamento persistente.            | Dados maiores que a página, queda do executor, retomada e falhas parciais sem perda oculta.                                                                      |
| F5 — Engenharia de dados     | Compare/sync, migração, mascaramento e Reschema.                     | Origem/destino descartáveis, chaves, tipos, direção e efeitos conferidos.                                                                                        |
| F6 — Equipes e integrações   | Workspaces, colaboração, IA, MCP e extensões.                        | Revogação imediata, escopos por comando e nenhum caminho que contorne a política.                                                                                |

Dependências de segurança, armazenamento e execução precedem ferramentas destrutivas; a ordem não é uma estimativa de duração. Não há prazo ou orçamento aprovado para completar o conjunto. Estimativas devem partir de uma amostra executável de cada rotina de alto risco.

## Adaptação do desktop ao navegador

- “Abrir no Explorer/Finder” vira acesso ao artefato autorizado e download; acesso automático ao filesystem local exige conector e consentimento específico.
- Importar conexões de outro cliente exige arquivo fornecido pelo usuário. O site não pode ler silenciosamente configurações de aplicativos instalados.
- Destacar e dividir janelas mantém o contexto, sem exigir reprodução literal da janela nativa ou dos mesmos atalhos reservados pelo navegador.
- Tarefas usam o executor do servidor/conector, e não timers da aba.
- Selecionar versão de shell significa escolher um runtime mantido e permitido; não executar qualquer arquivo informado em uma URI.
- Recursos removidos ou indisponíveis no servidor têm estado explícito. Uma funcionalidade de um cliente não reativa Map-Reduce onde o MongoDB não o oferece.

## Rastreamento das 50 dicas do manual histórico

Todas as dicas foram associadas ao inventário. A associação demonstra cobertura dos temas do manual de 2021, não valida suporte atual nem implementação no Canopy. A numeração e a página são da fonte S03.

| Dica | Página | IDs do inventário   |
| ---- | ------ | ------------------- |
| 1    | 2      | UX04                |
| 2    | 6      | CON11, UX06         |
| 3    | 7      | CON14               |
| 4    | 8      | PUB04               |
| 5    | 9      | DOC07, UX07         |
| 6    | 10     | AGG03               |
| 7    | 11     | UX06                |
| 8    | 13     | DOC10               |
| 9    | 14     | CMP02, CMP03        |
| 10   | 15     | CMP04               |
| 11   | 16     | OBJ05               |
| 12   | 17     | SCH04               |
| 13   | 18     | UX03                |
| 14   | 19     | UX07                |
| 15   | 20     | QRY07, QRY08        |
| 16   | 21     | QRY08               |
| 17   | 22     | AGG10               |
| 18   | 23     | DOC09               |
| 19   | 24     | CODE03, AGG10       |
| 20   | 25     | DOC12, OBJ04, EXT03 |
| 21   | 26     | JOB01, JOB02        |
| 22   | 27     | UX09, CON11         |
| 23   | 28     | QRY06, UX08         |
| 24   | 29     | JOB08               |
| 25   | 30     | QRY03               |
| 26   | 31     | OBJ04               |
| 27   | 32     | VQB01               |
| 28   | 33     | EXP08               |
| 29   | 34     | CMP06               |
| 30   | 35     | UX02                |
| 31   | 36     | UX07                |
| 32   | 37     | UX02                |
| 33   | 38     | CMP08               |
| 34   | 39     | MIG05               |
| 35   | 40     | UX08                |
| 36   | 42     | QRY09               |
| 37   | 43     | SH06                |
| 38   | 44     | UX09                |
| 39   | 45     | CON12               |
| 40   | 46     | CMP07               |
| 41   | 47     | CODE03, EXP07       |
| 42   | 48     | JOB08               |
| 43   | 49     | MIG05               |
| 44   | 50     | MIG01               |
| 45   | 51     | MIG03               |
| 46   | 52     | IDX03               |
| 47   | 53     | PERF03              |
| 48   | 54     | OBJ08               |
| 49   | 55     | PERF01              |
| 50   | 56     | PERF04              |

## Pontos que ainda precisam de confirmação

1. Fixar uma versão/edição executável do Studio 3T como referência de aceitação e revisar as mudanças posteriores ao manual. A documentação histórica de licenças diverge da nomenclatura posterior; não a usamos para cortar funcionalidades.
2. Validar detalhes que catálogos não especificam: operadores e atalhos completos, formatos de configuração, dialetos SQL, tolerância numérica, máscaras e conectores. Preservar como investigação, sem inventar comportamento.
3. O Desktop IDE, Web IDE, Access e 3TL Bridge são produtos distintos. A meta principal é o Desktop para MongoDB, complementada pela governança necessária ao nosso produto público. Uma plataforma CDC/ETL contínua do Bridge não foi confundida com o Reschema ou as tarefas do Desktop; sua inclusão integral precisa de escopo próprio.
4. Exercitar os aplicativos de referência, com contas/licenças e ambientes adequados, antes de certificar equivalência. Nesta rodada houve pesquisa documental e inspeção do Canopy, não benchmark dos concorrentes.

O próximo incremento recomendado é F0/F1, com abas persistidas e um catálogo de conexões mais completo, enquanto se prepara o isolamento que será necessário para o shell. A matriz permanece como compromisso de escopo; não como declaração de funcionalidades já entregues.
