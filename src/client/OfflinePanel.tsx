import { useEffect, useRef, useState } from 'react';
import { Upload, X, Table2 } from 'lucide-react';
import { CollectionBranch, SchemaDiagram, ViewSelector, type DataView } from './DataViews.js';
import { Results } from './Results.js';
import type { OfflineCollection } from './offline.js';

export function OfflinePanel({
  onClose,
  view,
  onViewChange,
}: {
  onClose: () => void;
  view: DataView;
  onViewChange: (view: DataView) => void;
}) {
  const [collections, setCollections] = useState<OfflineCollection[]>([]);
  const [selected, setSelected] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  function open(file: File) {
    worker.current?.terminate();
    setBusy(true);
    setError('');
    setCollections([]);
    setSelected(0);
    setPage(0);
    setSearch('');
    const current = new Worker(new URL('./offline.worker.ts', import.meta.url), { type: 'module' });
    worker.current = current;
    current.onmessage = (
      event: MessageEvent<{ error?: string; collections?: OfflineCollection[] }>,
    ) => {
      setBusy(false);
      if (event.data.error) setError(event.data.error);
      else setCollections(event.data.collections ?? []);
      current.terminate();
    };
    current.onerror = () => {
      setBusy(false);
      setError('Falha no leitor de arquivos. Selecione o arquivo novamente.');
      current.terminate();
    };
    current.postMessage(file);
  }
  const collection = collections[selected];
  const filtered =
    collection?.documents.filter(
      (document) =>
        !search ||
        JSON.stringify(document).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? [];
  return (
    <section className="offline-panel" aria-label="Análise offline">
      <header className="offline-heading">
        <div>
          <span className="profile-section-title">ARQUIVOS LOCAIS</span>
          <h2>Explore seu dump</h2>
          <p>
            Os arquivos são processados neste navegador. Fechar esta área descarta os dados
            carregados.
          </p>
        </div>
        <button className="secondary" onClick={onClose}>
          <X size={16} /> Fechar
        </button>
      </header>
      <label className="offline-upload">
        <Upload size={24} />
        <strong>{busy ? 'Lendo arquivo…' : 'Escolher arquivo MongoDB'}</strong>
        <span>JSON, JSON Lines, BSON ou archive · gzip aceito · até 20 MB e 20.000 documentos</span>
        <input
          type="file"
          accept=".json,.jsonl,.ndjson,.bson,.archive,.gz"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) open(file);
            event.target.value = '';
          }}
        />
      </label>
      {busy && (
        <button
          className="secondary"
          onClick={() => {
            worker.current?.terminate();
            setBusy(false);
          }}
        >
          Cancelar leitura
        </button>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {collections.length > 0 && (
        <>
          <nav className="offline-collection-tree" aria-label="Árvore de coleções do arquivo">
            <CollectionBranch name="Coleções do arquivo" selected>
              {collections.map((item, index) => (
                <button
                  key={item.name}
                  className={`collection-item ${selected === index ? 'selected' : ''}`}
                  aria-current={selected === index ? 'true' : undefined}
                  onClick={() => {
                    setSelected(index);
                    setPage(0);
                    setSearch('');
                  }}
                >
                  <Table2 size={15} />
                  <span>{item.name}</span>
                  <small>{item.documents.length}</small>
                </button>
              ))}
            </CollectionBranch>
          </nav>
          <div className="offline-toolbar">
            {view !== 'diagram' && (
              <label>
                Coleção
                <select
                  value={selected}
                  onChange={(event) => {
                    setSelected(Number(event.target.value));
                    setPage(0);
                    setSearch('');
                  }}
                >
                  {collections.map((item, index) => (
                    <option key={item.name} value={index}>
                      {item.name} ({item.documents.length})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {view !== 'diagram' && (
              <label>
                Buscar nos documentos
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Nome, valor ou campo…"
                />
              </label>
            )}
            <ViewSelector value={view} onChange={onViewChange} />
          </div>
          <p>
            {view === 'diagram'
              ? `${collections.length} coleções carregadas · visão da estrutura`
              : `${filtered.length} documentos · somente leitura`}
          </p>
          {view === 'diagram' ? (
            <SchemaDiagram collections={collections} />
          ) : (
            <Results
              result={{
                documents: filtered.slice(page * 50, (page + 1) * 50),
                hasMore: (page + 1) * 50 < filtered.length,
                durationMs: 0,
              }}
              view={view}
              skip={page * 50}
              writable={false}
              disabled={busy}
              onEdit={() => {}}
              onDelete={() => {}}
            />
          )}
          {view !== 'diagram' && (
            <div className="offline-pagination">
              <button className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Anterior
              </button>
              <span>
                Página {page + 1} de {Math.max(1, Math.ceil(filtered.length / 50))}
              </span>
              <button
                className="secondary"
                disabled={(page + 1) * 50 >= filtered.length}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
