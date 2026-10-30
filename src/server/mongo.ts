import { Resolver } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { MongoClient, BSON, type Document, type MongoClientOptions } from 'mongodb';
import { ConnectionString } from 'mongodb-connection-string-url';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';
import type { Config } from './config.js';

export function isPublicAddress(address: string) {
  return ipaddr.isValid(address) && ipaddr.process(address).range() === 'unicast';
}

export function parseDocument(text: string): Document {
  let value: unknown;
  try {
    value = BSON.EJSON.parse(text, { relaxed: false });
  } catch {
    throw new AppError(
      400,
      'JSON inválido. Use JSON ou MongoDB Extended JSON, com chaves entre aspas.',
    );
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new AppError(400, 'Informe um documento JSON.');
  return value as Document;
}

function rejectServerJavascript(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['$where', '$function', '$accumulator'].includes(key) || child instanceof BSON.Code)
      throw new AppError(400, 'JavaScript no servidor não está disponível nesta versão.');
    rejectServerJavascript(child);
  }
}

export function parseFilter(text: string) {
  const filter = parseDocument(text);
  rejectServerJavascript(filter);
  return filter;
}

const stages = new Set([
  '$match',
  '$project',
  '$set',
  '$addFields',
  '$unset',
  '$group',
  '$sort',
  '$limit',
  '$skip',
  '$unwind',
  '$count',
  '$replaceRoot',
  '$replaceWith',
  '$sortByCount',
  '$sample',
  '$lookup',
  '$facet',
  '$bucket',
  '$bucketAuto',
  '$unionWith',
]);
export function parsePipeline(text: string): Document[] {
  let value: unknown;
  try {
    value = BSON.EJSON.parse(text, { relaxed: false });
  } catch {
    throw new AppError(400, 'Pipeline inválido. Informe uma lista JSON de estágios.');
  }
  const check = (pipeline: unknown): void => {
    if (!Array.isArray(pipeline) || pipeline.length > 30)
      throw new AppError(400, 'O pipeline deve ser uma lista com até 30 estágios.');
    for (const stage of pipeline) {
      if (
        !stage ||
        typeof stage !== 'object' ||
        Array.isArray(stage) ||
        Object.keys(stage).length !== 1
      )
        throw new AppError(400, 'Cada estágio precisa conter um único operador.');
      const [operator, expression] = Object.entries(stage)[0];
      if (!stages.has(operator))
        throw new AppError(400, `Estágio ${operator} não permitido nesta versão.`);
      if (operator === '$facet' && expression && typeof expression === 'object')
        for (const nested of Object.values(expression)) check(nested);
      if (
        ['$lookup', '$unionWith'].includes(operator) &&
        expression &&
        typeof expression === 'object' &&
        'pipeline' in expression
      )
        check(expression.pipeline);
    }
  };
  check(value);
  rejectServerJavascript(value);
  return value as Document[];
}

const allowedOptions = new Set(['authsource', 'replicaset', 'readpreference', 'tls', 'appname']);
async function resolveAddresses(host: string, family: number | 'IPv4' | 'IPv6' = 0) {
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  const requests: Promise<{ address: string; family: number }[]>[] = [];
  if (family !== 6 && family !== 'IPv6')
    requests.push(
      resolver.resolve4(host).then((values) => values.map((address) => ({ address, family: 4 }))),
    );
  if (family !== 4 && family !== 'IPv4')
    requests.push(
      resolver.resolve6(host).then((values) => values.map((address) => ({ address, family: 6 }))),
    );
  try {
    const results = await Promise.allSettled(requests);
    const addresses: { address: string; family: number }[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') addresses.push(...result.value);
      else if (!['ENODATA', 'ENOTFOUND'].includes(result.reason?.code))
        throw new AppError(502, 'Falha ou timeout ao resolver o host MongoDB.');
    }
    if (!addresses.length) throw new AppError(400, 'Não foi possível resolver o host MongoDB.');
    return addresses;
  } finally {
    resolver.cancel();
  }
}
export async function connectionPlan(uri: string, config: Pick<Config, 'localHosts'>) {
  let parsed: ConnectionString;
  try {
    parsed = new ConnectionString(uri);
  } catch {
    throw new AppError(400, 'URI MongoDB inválida.');
  }
  for (const [key] of parsed.searchParams)
    if (!allowedOptions.has(key.toLowerCase()))
      throw new AppError(400, `Opção de conexão não permitida: ${key}.`);
  if (!parsed.isSRV && parsed.hosts.length !== 1)
    throw new AppError(400, 'Use um único host para conexão direta, ou a URI SRV do Atlas.');
  let endpoint: URL;
  try {
    endpoint = new URL(`https://${parsed.hosts[0]}`);
  } catch {
    throw new AppError(400, 'Host MongoDB inválido. Sockets locais não são permitidos.');
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = config.localHosts.includes(hostname);
  if (!hostname || /[%/\\]/.test(hostname)) throw new AppError(400, 'Host inválido.');
  if (parsed.isSRV && (!hostname.endsWith('.mongodb.net') || !/^[a-z\d.-]+$/.test(hostname)))
    throw new AppError(
      400,
      'Nesta versão, conexões SRV são aceitas para MongoDB Atlas (*.mongodb.net).',
    );
  if (!local && endpoint.port && endpoint.port !== '27017')
    throw new AppError(400, 'Conexões públicas devem usar a porta 27017.');
  for (const [key, value] of parsed.searchParams)
    if (key.toLowerCase() === 'tls' && value !== 'true' && !local)
      throw new AppError(400, 'TLS é obrigatório para conexões públicas.');
  if (!parsed.isSRV && !local) {
    const addresses = isIP(hostname) ? [{ address: hostname }] : await resolveAddresses(hostname);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
      throw new AppError(400, 'Endereços privados, locais ou reservados não são permitidos.');
  }
  const safeLookup: LookupFunction = (host, options, callback) => {
    resolveAddresses(host, options.family).then(
      (addresses) => {
        if (
          !addresses.length ||
          (!config.localHosts.includes(host.toLowerCase()) &&
            addresses.some(({ address }) => !isPublicAddress(address)))
        ) {
          callback(new Error('Destino de rede bloqueado.'), [], 4);
          return;
        }
        if (options.all) callback(null, addresses, 4);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (error: Error) => callback(error, [], 4),
    );
  };
  const options: MongoClientOptions = {
    appName: 'Canopy',
    tls: !local,
    directConnection: !parsed.isSRV,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 8000,
    timeoutMS: 10000,
    maxPoolSize: 2,
    minPoolSize: 0,
    maxConnecting: 1,
    retryReads: false,
    retryWrites: false,
    writeConcern: { w: 'majority', journal: true },
    lookup: safeLookup,
  };
  return { uri: parsed.toString(), host: parsed.hosts[0], options };
}

export class MongoGateway {
  private active = 0;
  private owners = new Map<string, number>();
  private operations = new Map<string, Set<{ cancelled: boolean; client?: MongoClient }>>();
  constructor(private config: Pick<Config, 'localHosts'>) {}
  async cancelOwner(userId: string) {
    const operations = this.operations.get(userId);
    if (!operations) return;
    for (const operation of operations) operation.cancelled = true;
    const results = await Promise.allSettled(
      [...operations].map((operation) => operation.client?.close()),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  async use<T>(
    userId: string,
    uri: string,
    operation: (
      client: MongoClient,
      plan: Awaited<ReturnType<typeof connectionPlan>>,
    ) => Promise<T>,
  ): Promise<T> {
    if (this.active >= 8 || (this.owners.get(userId) ?? 0) >= 2)
      throw new AppError(429, 'Limite de operações simultâneas atingido.');
    this.active++;
    this.owners.set(userId, (this.owners.get(userId) ?? 0) + 1);
    const state: { cancelled: boolean; client?: MongoClient } = { cancelled: false };
    if (!this.operations.has(userId)) this.operations.set(userId, new Set());
    this.operations.get(userId)!.add(state);
    let client: MongoClient | undefined;
    try {
      const plan = await connectionPlan(uri, this.config);
      if (state.cancelled) throw new AppError(401, 'A sessão foi revogada durante a operação.');
      client = new MongoClient(plan.uri, plan.options);
      state.client = client;
      await client.connect();
      if (state.cancelled) throw new AppError(401, 'A sessão foi revogada durante a operação.');
      const result = await operation(client, plan);
      if (state.cancelled)
        throw new AppError(
          401,
          'Operação interrompida por revogação da sessão. Se houve escrita, confira o banco antes de repetir.',
        );
      return result;
    } finally {
      try {
        await client?.close();
      } finally {
        this.active--;
        this.operations.get(userId)!.delete(state);
        if (!this.operations.get(userId)!.size) this.operations.delete(userId);
        const count = this.owners.get(userId)! - 1;
        if (count) this.owners.set(userId, count);
        else this.owners.delete(userId);
      }
    }
  }
}
