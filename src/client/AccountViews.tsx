import { useEffect, useState, type FormEvent } from 'react';
import { api, message, setCsrf, type User } from './api.js';

export interface AccountLink {
  kind: 'verify-email' | 'reset-password';
  token: string;
}
export function readAccountLink(): AccountLink | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  for (const kind of ['verify-email', 'reset-password'] as const) {
    const token = params.get(kind);
    if (token) return { kind, token };
  }
  return null;
}

export function RecoveryScreen({ link }: { link: AccountLink }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const reset = link.kind === 'reset-password';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (reset && data.get('password') !== data.get('confirmation')) {
      setError('As senhas devem ser iguais.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/auth/${link.kind}`, 'POST', {
        token: link.token,
        password: data.get('password'),
      });
      setDone(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <section className="account-card">
        <span className="eyebrow">CANOPY · SUA CONTA</span>
        <h1>{reset ? 'Redefinir sua senha' : 'Confirmar seu e-mail'}</h1>
        {done ? (
          <>
            <p role="status">
              {reset
                ? 'Senha alterada. Todas as sessões foram encerradas. Entre com sua nova senha.'
                : 'E-mail confirmado. Sua conta já pode acessar os bancos.'}
            </p>
            <a className="primary account-link" href="/">
              Continuar para o Canopy
            </a>
          </>
        ) : (
          <form className="account-form" onSubmit={submit}>
            <p>
              {reset
                ? 'Escolha uma nova senha com pelo menos 12 caracteres.'
                : 'Confirme para liberar o acesso às suas conexões.'}
            </p>
            {reset ? (
              <>
                <label>
                  Nova senha
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <label>
                  Confirmar nova senha
                  <input
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
              </>
            ) : (
              <label>
                Senha escolhida no cadastro
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
            )}
            {!reset && (
              <p>
                Se não reconhece este cadastro ou não sabe a senha, volte e use a recuperação de
                senha.
              </p>
            )}
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? 'Aguarde…' : reset ? 'Salvar nova senha' : 'Confirmar e-mail'}
            </button>
            <a href="/">Voltar para entrar ou solicitar outro link</a>
          </form>
        )}
      </section>
    </main>
  );
}

interface AccountState {
  user: User;
  csrf: string;
  verificationDelivery: { status: string; attempts: number } | null;
  mailChannel: 'file' | 'smtp' | 'disabled';
}
function verificationMessage(state: AccountState) {
  if (state.mailChannel === 'disabled')
    return 'O envio automático de e-mails está temporariamente indisponível. Use o link de confirmação inicial fornecido pelo responsável pela instalação e a senha do seu cadastro.';
  if (state.mailChannel === 'file')
    return 'Esta prévia não envia e-mails para sua caixa de entrada. As confirmações ficam na caixa local do servidor.';
  switch (state.verificationDelivery?.status) {
    case 'sent':
      return 'E-mail aceito pelo servidor de envio. Confira também a pasta de spam.';
    case 'pending':
    case 'sending':
      return 'Envio na fila. Use o botão abaixo para atualizar o estado.';
    case 'failed':
      return 'O envio falhou após três tentativas. O responsável pela instalação precisa corrigir o serviço de e-mail antes de você solicitar outro link.';
    default:
      return 'Solicite um novo link de confirmação.';
  }
}
export function VerificationScreen({
  user,
  onVerified,
  onLogout,
}: {
  user: User;
  onVerified: (user: User) => void;
  onLogout: () => void;
}) {
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState('');
  const [manage, setManage] = useState(false);
  const [canResend, setCanResend] = useState(false);
  async function refresh() {
    const state = await api<AccountState>('/auth/me');
    setCsrf(state.csrf);
    if (state.user.emailVerified) onVerified(state.user);
    setCanResend(state.mailChannel !== 'disabled');
    setDelivery(verificationMessage(state));
  }
  useEffect(() => {
    let active = true;
    api<AccountState>('/auth/me')
      .then((state) => {
        if (!active) return;
        setCsrf(state.csrf);
        if (state.user.emailVerified) onVerified(state.user);
        setCanResend(state.mailChannel !== 'disabled');
        setDelivery(verificationMessage(state));
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [onVerified]);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-page">
      <section className="account-card">
        <span className="eyebrow">CANOPY · CONFIRMAÇÃO</span>
        <h1>Confirme seu e-mail</h1>
        <p>
          Confirme o endereço <strong>{user.email}</strong> para acessar os bancos.
        </p>
        <p>{delivery}</p>
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <div className="account-actions">
          <button className="primary" disabled={busy} onClick={() => action(refresh)}>
            Já confirmei · atualizar
          </button>
          <button
            className="secondary"
            disabled={busy || !canResend}
            onClick={() =>
              action(async () => {
                const result = await api<{ message: string }>('/auth/resend-verification', 'POST', {
                  email: user.email,
                });
                setNotice(result.message);
              })
            }
          >
            Reenviar confirmação
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              action(async () => {
                await api('/auth/logout', 'POST');
                onLogout();
              })
            }
          >
            Sair
          </button>
          <button className="text-button" onClick={() => setManage(!manage)}>
            {manage ? 'Ocultar minha conta' : 'Gerenciar minha conta'}
          </button>
        </div>
        {manage && (
          <>
            <h2>Minha conta</h2>
            <AccountPanel user={user} onDeleted={onLogout} />
          </>
        )}
      </section>
    </main>
  );
}

interface Activity {
  id: number;
  method: string;
  route: string;
  action: string | null;
  databaseName: string | null;
  collectionName: string | null;
  status: number;
  createdAt: number;
}
export function AccountPanel({ user, onDeleted }: { user: User; onDeleted: () => void }) {
  const [events, setEvents] = useState<Activity[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    api<{ events: Activity[]; nextBefore: number | null }>(
      '/account/activity',
      'GET',
      undefined,
      abort.signal,
    )
      .then((data) => {
        setEvents(data.events);
        setBefore(data.nextBefore);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(message(failure));
      });
    return () => abort.abort();
  }, []);
  async function more() {
    setBusy(true);
    setError('');
    try {
      const data = await api<{ events: Activity[]; nextBefore: number | null }>(
        `/account/activity?before=${before}`,
      );
      setEvents([...events, ...data.events]);
      setBefore(data.nextBefore);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/account', 'DELETE', {
        password: data.get('password'),
        confirmation: data.get('confirmation'),
      });
      onDeleted();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-panel">
      <p>
        <strong>{user.name}</strong>
        <br />
        {user.email} · {user.emailVerified ? 'E-mail confirmado' : 'Confirmação pendente'}
      </p>
      <h3>Atividade da conta</h3>
      <p>
        Até 1.000 eventos dos últimos 30 dias. Consultas, documentos, senhas e URIs não entram neste
        histórico.
      </p>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <ol className="activity-list" aria-label="Atividade da conta" tabIndex={0}>
        {events.map((event) => (
          <li key={event.id}>
            <time dateTime={new Date(event.createdAt).toISOString()}>
              {new Date(event.createdAt).toLocaleString('pt-BR')}
            </time>
            <code>
              {event.action && `${event.action} · `}
              {event.method} {event.route}
            </code>
            {event.databaseName && (
              <span>
                {event.databaseName} / {event.collectionName}
              </span>
            )}
            <span>HTTP {event.status}</span>
          </li>
        ))}
      </ol>
      {before && (
        <button className="secondary" disabled={busy} onClick={more}>
          Carregar eventos anteriores
        </button>
      )}
      <div className="account-danger">
        <h3>Excluir sua conta</h3>
        <p>
          Remove sua conta, sessões, conexões salvas, consultas e histórico do Canopy. Os bancos
          MongoDB permanecem intactos. Cópias de segurança do operador seguem a retenção informada
          por ele.
        </p>
        {!deleting ? (
          <button className="danger-button" onClick={() => setDeleting(true)}>
            Excluir minha conta…
          </button>
        ) : (
          <form className="account-form" onSubmit={remove}>
            <label>
              Senha atual
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label>
              Digite EXCLUIR MINHA CONTA
              <input
                name="confirmation"
                autoComplete="off"
                pattern="EXCLUIR MINHA CONTA"
                required
              />
            </label>
            <button className="danger-button" disabled={busy}>
              {busy ? 'Excluindo…' : 'Excluir definitivamente'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
