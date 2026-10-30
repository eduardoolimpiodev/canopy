import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileJson2,
  FolderOpen,
  KeyRound,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Play,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Table2,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  message,
  resourcePath,
  setCsrf,
  type Connection,
  type Query,
  type QueryResult,
  type SavedQuery,
  type User,
} from './api.js';
import { Results } from './Results.js';
import {
  AccountPanel,
  readAccountLink,
  RecoveryScreen,
  VerificationScreen,
} from './AccountViews.js';

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? 'brand-light' : ''}`}>
      <span className="brand-mark">
        <Leaf size={21} />
      </span>
      <span>
        canopy<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={16} aria-label="Carregando" />;
}
function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div className="error-banner" role="alert">
      {children}
    </div>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  dismissible = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      aria-labelledby="modal-title"
    >
      <div className="modal-heading">
        <div>
          <h2 id="modal-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Fechar"
          onClick={onClose}
          disabled={!dismissible}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function AuthScreen({
  onLogin,
  initialError,
}: {
  onLogin: (user: User) => void;
  initialError: string;
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const register = mode === 'register';
  const forgot = mode === 'forgot';
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [emailFlowsAvailable, setEmailFlowsAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    api<{ emailFlowsAvailable: boolean }>('/auth/options', 'GET', undefined, abort.signal)
      .then((options) => setEmailFlowsAvailable(options.emailFlowsAvailable))
      .catch((failure) => {
        if (!abort.signal.aborted) setError(message(failure));
      });
    return () => abort.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (forgot) {
        const result = await api<{ message: string }>('/auth/forgot-password', 'POST', {
          email: form.get('email'),
        });
        setNotice(result.message);
        return;
      }
      const result = await api<{ user: User; csrf: string }>(
        register ? '/auth/register' : '/auth/login',
        'POST',
        {
          email: form.get('email'),
          password: form.get('password'),
          ...(register ? { name: form.get('name') } : {}),
        },
      );
      setCsrf(result.csrf);
      onLogin(result.user);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand light />
        <div className="story-content">
          <span className="eyebrow">SEU MONGODB. SEU ESPAÇO.</span>
          <h1>
            Explore os dados.
            <br />
            <span>Encontre as respostas.</span>
          </h1>
          <p>
            Um espaço de trabalho para conectar, consultar e entender seus bancos. Direto do
            navegador.
          </p>
          <div className="story-window">
            <div className="window-bar">
              <span />
              <span />
              <span />
              <code>workspace / sua-coleção</code>
            </div>
            <div className="story-code">
              <span className="code-muted">// Comece com uma pergunta</span>
              <br />
              <span className="code-teal">db</span>.collection.
              <span className="code-blue">find</span>({'{'}
              <br />
              &nbsp;&nbsp;status: <span className="code-orange">"active"</span>
              <br />
              {'}'})
            </div>
            <div className="story-pills">
              <span>
                <Table2 size={14} /> Documentos
              </span>
              <span>
                <Braces size={14} /> Agregações
              </span>
              <span>
                <ShieldCheck size={14} /> Conexões privadas
              </span>
            </div>
          </div>
        </div>
        <div className="story-footer">
          <span className="status-dot" /> Feito para quem trabalha com dados.
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-top">
          <span>MongoDB workbench</span>
          <span className="version-tag">PRÉVIA · v0.1</span>
        </div>
        <div className="auth-form-wrap">
          <div className="auth-icon">
            <TerminalSquare size={25} />
          </div>
          <h2>
            {forgot
              ? 'Vamos recuperar sua conta.'
              : register
                ? 'Seu novo workspace começa aqui.'
                : 'Bom ter você por aqui.'}
          </h2>
          <p>
            {forgot
              ? 'Receba um link para escolher uma nova senha.'
              : register
                ? 'Crie sua conta e conecte seu primeiro banco.'
                : 'Entre para continuar de onde parou.'}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                Seu nome
                <input
                  name="name"
                  autoComplete="name"
                  placeholder="Como podemos chamar você?"
                  minLength={2}
                  maxLength={60}
                  required
                />
              </label>
            )}
            <label>
              E-mail
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="voce@empresa.com"
                maxLength={254}
                required
              />
            </label>
            {!forgot && (
              <label>
                Senha
                <input
                  type="password"
                  name="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder="Pelo menos 12 caracteres"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
            )}
            {error && <ErrorBanner>{error}</ErrorBanner>}
            {notice && <p role="status">{notice}</p>}
            <button className="primary auth-submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {forgot
                    ? 'Solicitar link de recuperação'
                    : register
                      ? 'Criar minha conta'
                      : 'Entrar no workspace'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>
          {emailFlowsAvailable === false && (
            <p role="status">
              Novos cadastros e recuperação de senha estão temporariamente indisponíveis. Entre com
              sua conta existente.
            </p>
          )}
          {mode === 'login' && emailFlowsAvailable === true && (
            <button
              className="text-button auth-recovery"
              onClick={() => {
                setMode('forgot');
                setError('');
                setNotice('');
              }}
            >
              Esqueci minha senha
            </button>
          )}
          {emailFlowsAvailable === true && (
            <p className="auth-switch">
              {register ? 'Já tem uma conta?' : 'Primeira vez por aqui?'}{' '}
              <button
                className="text-button"
                onClick={() => {
                  setMode(register || forgot ? 'login' : 'register');
                  setError('');
                  setNotice('');
                }}
              >
                {register || forgot ? 'Entrar' : 'Criar conta'}
              </button>
            </p>
          )}
          <div className="auth-note">
            <LockKeyhole size={16} />
            <p>
              Suas conexões pertencem à sua conta. Credenciais de banco são armazenadas com
              criptografia.
            </p>
          </div>
        </div>
        <footer>
          Canopy Workbench <span>Uma nova perspectiva sobre seus dados.</span>
        </footer>
      </section>
    </main>
  );
}

function ConnectionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (connection: Connection) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const result = await api<{ connection: Connection }>('/connections', 'POST', {
        name: form.get('name'),
        uri: form.get('uri'),
        readOnly: form.get('readOnly') === 'on',
      });
      onCreated(result.connection);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Nova conexão"
      subtitle="Conecte seu MongoDB ao workspace."
      onClose={onClose}
      dismissible={!busy}
    >
      <form onSubmit={submit} className="modal-form">
        <label>
          Nome da conexão
          <input autoFocus name="name" placeholder="Ex.: Desenvolvimento" required maxLength={60} />
        </label>
        <label>
          URI de conexão
          <div className="uri-field">
            <input
              name="uri"
              type={visible ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="mongodb+srv://usuario:senha@cluster.mongodb.net/"
              required
              maxLength={4096}
            />
            <button type="button" className="text-button" onClick={() => setVisible(!visible)}>
              {visible ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </label>
        <p className="field-help">
          Aceita Atlas via SRV ou um host público direto na porta 27017. TLS é obrigatório. Autorize
          o IP do servidor no seu banco.
        </p>
        <label className="checkbox-label">
          <input type="checkbox" name="readOnly" defaultChecked />
          <span>
            <strong>Somente leitura</strong>
            <small>Desabilita inserções, alterações e exclusões nesta conexão.</small>
          </span>
        </label>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="callout">
          <KeyRound size={18} />
          <span>A senha não será exibida novamente depois que você salvar a conexão.</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <>
                <Spinner /> Testando conexão…
              </>
            ) : (
              <>
                <Plus size={16} /> Testar e conectar
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DocumentModal({
  original,
  onClose,
  onSave,
}: {
  original: Record<string, unknown> | null;
  onClose: () => void;
  onSave: (document: string) => Promise<void>;
}) {
  const [text, setText] = useState(JSON.stringify(original ?? { campo: 'valor' }, null, 2));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={original ? 'Editar documento' : 'Inserir documento'}
      dismissible={!busy}
      subtitle="Use Extended JSON para preservar ObjectId, datas e tipos numéricos."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            JSON.parse(text);
            await onSave(text);
            onClose();
          } catch (failure) {
            setError(message(failure));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Documento
          <textarea
            autoFocus
            className="document-editor"
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            aria-label="Documento JSON"
          />
        </label>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? <Spinner /> : <Check size={16} />}Salvar documento
          </button>
        </div>
      </form>
    </Modal>
  );
}

const initialQuery: Query = { mode: 'find', text: '{}', sort: '{}', limit: 50, skip: 0 };

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [collectionsDatabase, setCollectionsDatabase] = useState('');
  const [collection, setCollection] = useState('');
  const [query, setQuery] = useState<Query>(initialQuery);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [pendingSaved, setPendingSaved] = useState<SavedQuery | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [resultContext, setResultContext] = useState('');
  const [view, setView] = useState<'table' | 'json'>('table');
  const [tab, setTab] = useState<'documents' | 'indexes'>('documents');
  const [indexes, setIndexes] = useState<unknown[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingRequests, setPendingRequests] = useState(0);
  const busy = pendingRequests > 0;
  const [loadingTree, setLoadingTree] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [editing, setEditing] = useState<{ document: Record<string, unknown> | null } | null>(null);
  const [search, setSearch] = useState('');
  const sequence = useRef(0);
  const selected = connections.find((connection) => connection.id === selectedId);
  const path = resourcePath(selectedId, database, collection);
  const canRun = !!selected && !!database && !!collection;
  let connectionHint = 'Nenhum banco disponível para este usuário MongoDB.';
  if (databases.length) connectionHint = 'Escolha um banco e uma coleção no explorador à esquerda.';
  if (loadingTree) connectionHint = 'Carregando bancos…';

  useEffect(() => {
    const abort = new AbortController();
    api<{ connections: Connection[] }>('/connections', 'GET', undefined, abort.signal)
      .then((data) => {
        setConnections(data.connections);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(message(failure));
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    sequence.current++;
    setDatabases([]);
    setDatabase('');
    setCollections([]);
    setCollection('');
    setResult(null);
    setIndexes(null);
    setSaved([]);
    setPendingSaved(null);
    setError('');
    if (!selectedId) {
      setLoadingTree(false);
      return;
    }
    const abort = new AbortController();
    setLoadingTree(true);
    Promise.all([
      api<{ databases: string[] }>(
        `/connections/${selectedId}/databases`,
        'GET',
        undefined,
        abort.signal,
      ),
      api<{ queries: SavedQuery[] }>(
        `/connections/${selectedId}/queries`,
        'GET',
        undefined,
        abort.signal,
      ),
    ])
      .then(([data, queries]) => {
        setDatabases(data.databases);
        setSaved(queries.queries);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingTree(false);
      });
    return () => abort.abort();
  }, [selectedId]);
  useEffect(() => {
    sequence.current++;
    setCollections([]);
    setCollectionsDatabase('');
    setCollection('');
    setResult(null);
    setIndexes(null);
    setError('');
    if (!selectedId || !database) {
      setLoadingTree(false);
      return;
    }
    const abort = new AbortController();
    setLoadingTree(true);
    api<{ collections: string[] }>(
      `/connections/${selectedId}/databases/${encodeURIComponent(database)}/collections`,
      'GET',
      undefined,
      abort.signal,
    )
      .then((data) => {
        setCollections(data.collections);
        setCollectionsDatabase(database);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(message(failure));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingTree(false);
      });
    return () => abort.abort();
  }, [selectedId, database]);
  useEffect(() => {
    sequence.current++;
    setResult(null);
    setIndexes(null);
    setQuery(initialQuery);
    setTab('documents');
    setError('');
  }, [collection]);
  useEffect(() => {
    if (
      !pendingSaved ||
      loadingTree ||
      database !== pendingSaved.database ||
      collectionsDatabase !== database
    )
      return;
    if (!collections.includes(pendingSaved.collection)) {
      setError('A coleção desta consulta salva não está disponível.');
      setPendingSaved(null);
      return;
    }
    if (collection !== pendingSaved.collection) {
      setCollection(pendingSaved.collection);
      return;
    }
    setQuery(pendingSaved.query);
    setTab('documents');
    setNotice(`Consulta "${pendingSaved.name}" carregada.`);
    setPendingSaved(null);
  }, [pendingSaved, loadingTree, database, collectionsDatabase, collections, collection]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function run(next = query) {
    if (!canRun) return;
    const current = ++sequence.current;
    setPendingRequests((count) => count + 1);
    setResult(null);
    setError('');
    setTab('documents');
    try {
      JSON.parse(next.text);
      JSON.parse(next.sort);
      const response = await api<QueryResult>(`${path}/query`, 'POST', next);
      if (current === sequence.current) {
        setResult(response);
        setResultContext(path);
        setQuery(next);
      }
    } catch (failure) {
      if (current === sequence.current) setError(message(failure));
    } finally {
      setPendingRequests((count) => count - 1);
    }
  }
  async function loadIndexes() {
    const current = ++sequence.current;
    setTab('indexes');
    setIndexes(null);
    setPendingRequests((count) => count + 1);
    setError('');
    try {
      const response = await api<{ indexes: unknown[] }>(`${path}/indexes`);
      if (current === sequence.current) setIndexes(response.indexes);
    } catch (failure) {
      if (current === sequence.current) setError(message(failure));
    } finally {
      setPendingRequests((count) => count - 1);
    }
  }
  async function removeConnection() {
    if (
      !selected ||
      !window.confirm(
        `Remover a conexão "${selected.name}" e suas consultas salvas? Os dados do MongoDB serão preservados.`,
      )
    )
      return;
    try {
      await api(`/connections/${selected.id}`, 'DELETE');
      setConnections(connections.filter((item) => item.id !== selected.id));
      setSelectedId('');
    } catch (failure) {
      setError(message(failure));
    }
  }
  async function saveQuery() {
    const name = window.prompt('Nome para esta consulta:');
    if (!name?.trim()) return;
    try {
      await api(`/connections/${selectedId}/queries`, 'POST', {
        name,
        database,
        collection,
        query,
      });
      const response = await api<{ queries: SavedQuery[] }>(`/connections/${selectedId}/queries`);
      setSaved(response.queries);
      setNotice('Consulta salva no seu workspace.');
    } catch (failure) {
      setError(message(failure));
    }
  }
  function exportResult() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result!.documents, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${collection}-${query.skip}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function mutate(
    action: 'insert' | 'replace' | 'delete',
    document?: string,
    original?: Record<string, unknown>,
  ) {
    const revision = sequence.current;
    await api(`${path}/documents`, 'POST', {
      action,
      document,
      ...(original
        ? { id: JSON.stringify({ _id: original._id }), original: JSON.stringify(original) }
        : {}),
    });
    setNotice(action === 'delete' ? 'Documento removido.' : 'Documento salvo.');
    if (revision === sequence.current) await run({ ...query, skip: 0 });
  }
  function loadSaved(item: SavedQuery) {
    setPendingSaved(item);
    setDatabase(item.database);
  }
  return (
    <div className="workspace">
      <aside className="rail" aria-label="Ferramentas e conta">
        <div className="rail-logo">
          <Leaf size={23} />
        </div>
        <button
          className="rail-button active"
          aria-label="Workspace"
          onClick={() => setSelectedId('')}
        >
          <Database size={21} />
        </button>
        <a
          className="rail-button"
          href="https://www.mongodb.com/docs/manual/reference/operator/query/"
          target="_blank"
          rel="noreferrer"
          aria-label="Documentação MongoDB"
        >
          <BookOpen size={20} />
        </a>
        <div className="rail-bottom">
          <button
            className="avatar"
            aria-label={`Gerenciar conta de ${user.name}`}
            title="Minha conta e atividade"
            onClick={() => setShowAccount(true)}
          >
            {user.name.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </aside>
      <aside className="sidebar" aria-label="Conexões e consultas">
        <div className="sidebar-brand">
          <Brand />
          <span className="version-tag">BETA</span>
        </div>
        <div className="sidebar-heading">
          <span>CONEXÕES</span>
          <button
            className="icon-button"
            aria-label="Nova conexão"
            onClick={() => setShowConnection(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="connection-list">
          {connections.map((connection) => (
            <button
              key={connection.id}
              className={`connection-item ${selectedId === connection.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(connection.id)}
            >
              <span className="connection-symbol">
                <Server size={17} />
              </span>
              <span>
                <strong>{connection.name}</strong>
                <small>{connection.host}</small>
              </span>
              {selectedId === connection.id && <span className="status-dot" />}
            </button>
          ))}
          {!connections.length && (
            <p className="sidebar-empty">
              Seus bancos aparecem aqui.
              <br />
              Adicione uma conexão para começar.
            </p>
          )}
        </div>
        <button className="add-connection" onClick={() => setShowConnection(true)}>
          <Plus size={16} /> Adicionar conexão
        </button>
        <div className="sidebar-divider" />
        <div className="sidebar-heading">
          <span>EXPLORADOR</span>
          {loadingTree && <Spinner />}
        </div>
        {selected ? (
          <>
            <label className="database-select">
              <Database size={15} />
              <select
                aria-label="Banco de dados"
                value={database}
                onChange={(event) => setDatabase(event.target.value)}
              >
                <option value="">Selecione um banco</option>
                {databases.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            {database && (
              <>
                <div className="collection-search">
                  <Search size={14} />
                  <input
                    aria-label="Buscar coleção"
                    placeholder="Buscar coleção…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="collection-list">
                  {collections
                    .filter((item) => item.toLowerCase().includes(search.toLowerCase()))
                    .map((item) => (
                      <button
                        key={item}
                        className={`collection-item ${collection === item ? 'selected' : ''}`}
                        onClick={() => setCollection(item)}
                      >
                        <Table2 size={15} />
                        <span>{item}</span>
                        {collection === item && <ChevronRight size={14} />}
                      </button>
                    ))}
                  {!loadingTree && !collections.length && (
                    <p className="sidebar-empty">Nenhuma coleção disponível.</p>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <p className="sidebar-empty">
            Selecione uma conexão
            <br />
            para explorar suas coleções.
          </p>
        )}
        <div className="sidebar-divider" />
        <div className="sidebar-heading">
          <span>CONSULTAS SALVAS</span>
          <span>{saved.length.toString().padStart(2, '0')}</span>
        </div>
        <div className="saved-list">
          {saved.map((item) => (
            <div className="saved-row" key={item.id}>
              <button onClick={() => void loadSaved(item)}>
                <FileJson2 size={15} />
                <span>{item.name}</span>
              </button>
              <button
                className="icon-button"
                aria-label={`Excluir consulta ${item.name}`}
                onClick={async () => {
                  try {
                    await api(`/connections/${selectedId}/queries/${item.id}`, 'DELETE');
                    setSaved(saved.filter((query) => query.id !== item.id));
                  } catch (failure) {
                    setError(message(failure));
                  }
                }}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {!saved.length && (
            <p className="sidebar-empty">
              Guarde as consultas
              <br />
              que você usa todo dia.
            </p>
          )}
        </div>
        <div className="sidebar-footer">
          <ShieldCheck size={16} />
          <span>
            Workspace privado<small>{user.email}</small>
          </span>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{selected?.name ?? 'Visão geral'}</strong>
            {database && (
              <>
                <ChevronRight size={14} />
                <span>{database}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <span className="preview-label">PRÉVIA DE DESENVOLVIMENTO</span>
            <button
              className="icon-button"
              aria-label="Sair"
              onClick={async () => {
                try {
                  await api('/auth/logout', 'POST');
                  onLogout();
                } catch (failure) {
                  setError(message(failure));
                }
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        {error && (
          <div className="workspace-error">
            <ErrorBanner>{error}</ErrorBanner>
          </div>
        )}
        {!canRun ? (
          <section className="welcome">
            <div className="welcome-heading">
              <span className="eyebrow">SEU ESPAÇO DE TRABALHO</span>
              <h1>
                Olá, {user.name.split(' ')[0]}
                <span className="brand-dot">.</span>
                <br />
                Vamos explorar seus dados?
              </h1>
              <p>
                Da primeira conexão à próxima descoberta.
                <br />
                Tudo o que você precisa, em um só lugar.
              </p>
            </div>
            <div className="welcome-orbit" aria-hidden="true">
              <div className="orbit-circle circle-one" />
              <div className="orbit-circle circle-two" />
              <div className="orbit-center">
                <Database size={44} />
              </div>
              <span className="orbit-node node-one">
                <Braces size={24} />
              </span>
              <span className="orbit-node node-two">
                <Table2 size={23} />
              </span>
              <span className="orbit-node node-three">
                <TerminalSquare size={23} />
              </span>
            </div>
            <div className="getting-started">
              <div className="section-title">
                <h2>Comece por aqui</h2>
                <span>01 — CONECTAR E EXPLORAR</span>
              </div>
              <div className="start-cards">
                <button className="start-card primary-card" onClick={() => setShowConnection(true)}>
                  <span className="card-icon">
                    <Plus size={22} />
                  </span>
                  <h3>Conecte seu MongoDB</h3>
                  <p>Adicione um banco e traga suas coleções para o workspace.</p>
                  <span className="card-action">
                    Nova conexão <ArrowRight size={16} />
                  </span>
                </button>
                <div className="start-card">
                  <span className="card-icon">
                    <TerminalSquare size={22} />
                  </span>
                  <h3>Consultas com contexto</h3>
                  <p>Explore documentos com filtros, ordenação e agregações em JSON.</p>
                  <span className="card-caption">Selecione uma coleção para começar</span>
                </div>
                <div className="start-card">
                  <span className="card-icon">
                    <ShieldCheck size={22} />
                  </span>
                  <h3>Seus dados, sob controle</h3>
                  <p>Conexões privadas e modo de leitura habilitado por padrão.</p>
                  <span className="card-caption">Proteção desde a primeira conexão</span>
                </div>
              </div>
            </div>
            {selected && (
              <div className="selected-overview">
                <div>
                  <Server size={18} />
                  <strong>{selected.name}</strong>
                  <span>{selected.readOnly ? 'Somente leitura' : 'Leitura e escrita'}</span>
                </div>
                <p>{connectionHint}</p>
                <button className="danger-text" onClick={() => void removeConnection()}>
                  <Trash2 size={14} /> Remover conexão
                </button>
              </div>
            )}
            <div className="welcome-bottom">
              <span>
                <LockKeyhole size={15} /> As credenciais das conexões são criptografadas no
                servidor.
              </span>
              <span>CANOPY / WORKBENCH</span>
            </div>
          </section>
        ) : (
          <>
            <div className="collection-heading">
              <div>
                <span className="eyebrow">COLEÇÃO</span>
                <h1>
                  <Table2 size={24} />
                  {collection}
                </h1>
                <p>
                  {database} <span>/</span> {selected!.name}
                </p>
              </div>
              <div className="connection-badge">
                <span className="status-dot" />
                {selected!.readOnly ? (
                  <>
                    <LockKeyhole size={13} /> Somente leitura
                  </>
                ) : (
                  'Leitura e escrita'
                )}
              </div>
            </div>
            <div className="workspace-tabs">
              <button
                className={tab === 'documents' ? 'active' : ''}
                onClick={() => setTab('documents')}
              >
                <Table2 size={15} /> Documentos
              </button>
              <button
                className={tab === 'indexes' ? 'active' : ''}
                onClick={() => void loadIndexes()}
                disabled={busy}
              >
                <KeyRound size={15} /> Índices
              </button>
            </div>
            {tab === 'documents' ? (
              <section className="query-workspace">
                <div className="query-panel">
                  <div className="query-toolbar">
                    <div className="mode-switch">
                      <button
                        className={query.mode === 'find' ? 'active' : ''}
                        onClick={() => {
                          setQuery({ ...initialQuery, mode: 'find' });
                          setResult(null);
                        }}
                      >
                        Find
                      </button>
                      <button
                        className={query.mode === 'aggregate' ? 'active' : ''}
                        onClick={() => {
                          setQuery({
                            ...initialQuery,
                            mode: 'aggregate',
                            text: '[\n  { "$match": {} }\n]',
                          });
                          setResult(null);
                        }}
                      >
                        Aggregate
                      </button>
                    </div>
                    <span className="editor-format">MongoDB Extended JSON</span>
                    <button
                      className="text-button"
                      onClick={() => {
                        try {
                          setQuery({
                            ...query,
                            text: JSON.stringify(JSON.parse(query.text), null, 2),
                          });
                        } catch (failure) {
                          setError(message(failure));
                        }
                      }}
                    >
                      <Braces size={14} /> Formatar
                    </button>
                  </div>
                  <div className="code-editor">
                    <div className="line-numbers" aria-hidden="true">
                      {query.text.split('\n').map((_, index) => (
                        <div key={index}>{index + 1}</div>
                      ))}
                    </div>
                    <textarea
                      aria-label={query.mode === 'find' ? 'Filtro JSON' : 'Pipeline de agregação'}
                      value={query.text}
                      spellCheck={false}
                      onChange={(event) =>
                        setQuery({ ...query, text: event.target.value, skip: 0 })
                      }
                      onKeyDown={(event) => {
                        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                          event.preventDefault();
                          if (!busy) void run({ ...query, skip: 0 });
                        }
                      }}
                    />
                  </div>
                  <div className="query-options">
                    {query.mode === 'find' && (
                      <label>
                        Ordenação
                        <input
                          aria-label="Ordenação JSON"
                          value={query.sort}
                          onChange={(event) =>
                            setQuery({ ...query, sort: event.target.value, skip: 0 })
                          }
                          spellCheck={false}
                        />
                      </label>
                    )}
                    <label>
                      Limite
                      <select
                        aria-label="Limite de resultados"
                        value={query.limit}
                        onChange={(event) =>
                          setQuery({ ...query, limit: Number(event.target.value), skip: 0 })
                        }
                      >
                        {[10, 25, 50, 100, 200].map((limit) => (
                          <option key={limit}>{limit}</option>
                        ))}
                      </select>
                    </label>
                    <div className="query-actions">
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => void saveQuery()}
                      >
                        <FolderOpen size={15} /> Salvar
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void run({ ...query, skip: 0 })}
                      >
                        {busy ? <Spinner /> : <Play size={14} fill="currentColor" />}Executar
                        <span className="keyboard-hint">Ctrl ↵</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="results-toolbar">
                  <div>
                    <h2>Resultados</h2>
                    {result && (
                      <>
                        <span className="result-count">{result.documents.length}</span>
                        <span className="query-duration">
                          <Clock3 size={13} />
                          {result.durationMs} ms
                        </span>
                      </>
                    )}
                  </div>
                  <div className="result-actions">
                    {!selected!.readOnly && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setEditing({ document: null })}
                      >
                        <Plus size={15} /> Inserir
                      </button>
                    )}
                    <button
                      className="text-button"
                      disabled={!result?.documents.length}
                      onClick={exportResult}
                    >
                      <Download size={15} /> Exportar página
                    </button>
                    <div className="view-switch">
                      <button
                        aria-label="Visualizar tabela"
                        className={view === 'table' ? 'active' : ''}
                        onClick={() => setView('table')}
                      >
                        <Table2 size={16} />
                      </button>
                      <button
                        aria-label="Visualizar JSON"
                        className={view === 'json' ? 'active' : ''}
                        onClick={() => setView('json')}
                      >
                        <Braces size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="results-content">
                  <Results
                    result={result}
                    view={view}
                    skip={query.skip}
                    writable={!selected!.readOnly && query.mode === 'find'}
                    disabled={busy || resultContext !== path}
                    onEdit={(document) => setEditing({ document })}
                    onDelete={async (document) => {
                      if (!window.confirm('Excluir permanentemente este documento?')) return;
                      try {
                        await mutate('delete', undefined, document);
                      } catch (failure) {
                        setError(message(failure));
                      }
                    }}
                  />
                </div>
                <footer className="results-footer">
                  <span>
                    {result
                      ? `${result.documents.length} documentos nesta página · limite de 1 MB por resposta`
                      : 'Pronto para consultar'}
                    <span className="footer-dot">·</span>Máximo de 200 documentos por página
                  </span>
                  <div>
                    <button
                      className="secondary"
                      disabled={busy || !result || !query.skip}
                      onClick={() =>
                        void run({ ...query, skip: Math.max(0, query.skip - query.limit) })
                      }
                    >
                      Anterior
                    </button>
                    <span>Página {Math.floor(query.skip / query.limit) + 1}</span>
                    <button
                      className="secondary"
                      disabled={busy || !result?.hasMore}
                      onClick={() => void run({ ...query, skip: query.skip + query.limit })}
                    >
                      Próxima
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </footer>
              </section>
            ) : (
              <section className="indexes-panel">
                <div className="section-title">
                  <h2>Índices da coleção</h2>
                  <span>CONSULTA DE METADADOS</span>
                </div>
                {busy ? (
                  <Spinner />
                ) : (
                  <pre className="json-results" tabIndex={0} aria-label="Índices em JSON">
                    {JSON.stringify(indexes, null, 2)}
                  </pre>
                )}
              </section>
            )}
          </>
        )}
      </main>
      {showAccount && (
        <Modal
          title="Minha conta"
          subtitle="Acesso, atividade e dados da conta"
          onClose={() => setShowAccount(false)}
        >
          <AccountPanel user={user} onDeleted={onLogout} />
        </Modal>
      )}
      {showConnection && (
        <ConnectionModal
          onClose={() => setShowConnection(false)}
          onCreated={(connection) => {
            setConnections([connection, ...connections]);
            setSelectedId(connection.id);
            setShowConnection(false);
            setNotice('Conexão testada e salva.');
          }}
        />
      )}
      {editing && (
        <DocumentModal
          original={editing.document}
          onClose={() => setEditing(null)}
          onSave={(text) =>
            mutate(editing.document ? 'replace' : 'insert', text, editing.document ?? undefined)
          }
        />
      )}
    </div>
  );
}

export function App() {
  const [link, setLink] = useState(readAccountLink);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = () => setLink(readAccountLink());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (link)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    const abort = new AbortController();
    api<{ user: User; csrf: string }>('/auth/me', 'GET', undefined, abort.signal)
      .then((data) => {
        setCsrf(data.csrf);
        setUser(data.user);
      })
      .catch((failure) => {
        if (!abort.signal.aborted && !(failure instanceof ApiError && failure.status === 401))
          setError(message(failure));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    const expired = () => {
      setCsrf('');
      setUser(null);
      setError('Sua sessão expirou. Entre novamente.');
    };
    window.addEventListener('session-expired', expired);
    return () => {
      abort.abort();
      window.removeEventListener('session-expired', expired);
    };
  }, [link]);
  if (link) return <RecoveryScreen key={link.token} link={link} />;
  if (loading)
    return (
      <div className="loading-page">
        <Brand />
        <Spinner />
      </div>
    );
  const logout = () => {
    setCsrf('');
    setUser(null);
    setError('');
  };
  if (user && !user.emailVerified)
    return <VerificationScreen user={user} onVerified={setUser} onLogout={logout} />;
  return user ? (
    <Workspace user={user} onLogout={logout} />
  ) : (
    <AuthScreen onLogin={setUser} initialError={error} />
  );
}
