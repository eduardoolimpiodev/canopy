# Base de exemplo

Dados fictícios em Extended JSON, com clientes e pedidos relacionados por ObjectId.

No Canopy, abra **Analisar arquivo local** e escolha `clientes.json` ou `pedidos.json`. A leitura acontece no navegador e os documentos são descartados ao fechar o painel.

O leitor também aceita BSON concatenado e archives do `mongodump` versão 0.1, inclusive gzip. Cada arquivo pode ter até 20 MB, também após descompactar, e 20.000 documentos. Archives podem conter até 200 coleções. É possível selecionar coleções, buscar texto, paginar e alternar entre tabela e JSON. O fluxo é somente leitura e não restaura índices nem executa consultas MongoDB sobre os arquivos.

`pedidos.bson`, `pedidos.bson.gz` e `pedidos.archive.gz` são exemplos gerados a partir do JSON deste diretório. O archive é uma fixture criada conforme a especificação, não uma saída real do executável mongodump. A validação contra dumps reais continua pendente. O leitor usa a biblioteca oficial `bson` para preservar os tipos BSON em Extended JSON. JSON com inteiros fora da faixa segura é recusado e exige representação Extended JSON.

Importe em um banco de testes com MongoDB Database Tools:

```sh
mongoimport --uri "$MONGODB_URI" --db canopy_exemplo --collection clientes --file examples/loja/clientes.json --jsonArray
mongoimport --uri "$MONGODB_URI" --db canopy_exemplo --collection pedidos --file examples/loja/pedidos.json --jsonArray
```

Os comandos acrescentam documentos e não apagam coleções. Reimportar os mesmos identificadores gera erros de duplicidade.

Filtros para experimentar no Canopy:

```json
{ "status": "pago" }
```

```json
{ "total": { "$gte": 200 } }
```

Agregação na coleção pedidos:

```json
[{ "$group": { "_id": "$status", "quantidade": { "$sum": 1 }, "total": { "$sum": "$total" } } }]
```
