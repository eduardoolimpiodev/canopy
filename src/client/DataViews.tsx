import { useState, type ReactNode } from 'react';
import {
  ChevronRight,
  Database,
  Table2,
  Braces,
  Network,
  ListTree,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';

export type DataView = 'table' | 'json' | 'tree' | 'diagram';
export function ViewSelector({
  value,
  onChange,
}: {
  value: DataView;
  onChange: (value: DataView) => void;
}) {
  return (
    <div className="data-view-selector" aria-label="Forma de visualização">
      {(
        [
          ['table', 'Tabela', Table2],
          ['json', 'JSON', Braces],
          ['tree', 'Árvore', ListTree],
          ['diagram', 'Diagrama', Network],
        ] as const
      ).map(([id, label, Icon]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}

function Branch({ label, value, depth = 0 }: { label: string; value: unknown; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (value === null || typeof value !== 'object')
    return (
      <div className="document-leaf">
        <strong>{label}</strong>
        <code>{JSON.stringify(value) ?? 'undefined'}</code>
      </div>
    );
  const keys = Array.isArray(value)
    ? Array.from({ length: Math.min(value.length, 200) }, (_, index) => String(index))
    : Object.keys(value);
  const count = Array.isArray(value) ? value.length : keys.length;
  const entries = keys
    .slice(0, 200)
    .map((key) => [key, (value as Record<string, unknown>)[key]] as const);
  if (depth >= 20)
    return (
      <div className="document-leaf">
        {label} · profundidade limitada a 20 níveis. Consulte o JSON.
      </div>
    );
  return (
    <details
      className="document-branch"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {label}{' '}
        <span>{Array.isArray(value) ? `Array · ${count} itens` : `Objeto · ${count} campos`}</span>
      </summary>
      {expanded && (
        <div>
          {entries.slice(0, 200).map(([key, item]) => (
            <Branch key={key} label={key} value={item} depth={depth + 1} />
          ))}
          {count > 200 && <p>Exibindo 200 campos. Consulte o JSON completo.</p>}
        </div>
      )}
    </details>
  );
}
export function DocumentTree({
  documents,
  skip,
}: {
  documents: Record<string, unknown>[];
  skip: number;
}) {
  return (
    <div className="document-tree">
      {documents.map((document, index) => (
        <Branch key={index} label={`Documento ${skip + index + 1}`} value={document} />
      ))}
    </div>
  );
}

export interface DiagramCollection {
  name: string;
  documents: Record<string, unknown>[];
}
function fieldType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    const wrappers = [
      '$oid',
      '$date',
      '$numberInt',
      '$numberLong',
      '$numberDouble',
      '$numberDecimal',
      '$binary',
      '$regularExpression',
      '$timestamp',
      '$minKey',
      '$maxKey',
    ];
    const bson = keys.length === 1 && wrappers.includes(keys[0]) ? keys[0].slice(1) : null;
    return bson ?? 'objeto';
  }
  return typeof value;
}
export function SchemaDiagram({ collections }: { collections: DiagramCollection[] }) {
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [order, setOrder] = useState<'name' | 'fields'>('name');
  const nodes = collections
    .map((collection) => {
      const fields = new Map<string, Set<string>>();
      for (const document of collection.documents.slice(0, 200))
        for (const [name, value] of Object.entries(document)) {
          if (!fields.has(name)) fields.set(name, new Set());
          fields.get(name)!.add(fieldType(value));
        }
      return { ...collection, fields: [...fields].sort(([a], [b]) => a.localeCompare(b)) };
    })
    .filter((node) =>
      `${node.name} ${node.fields.map(([field]) => field).join(' ')}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      order === 'name'
        ? a.name.localeCompare(b.name)
        : b.fields.length - a.fields.length || a.name.localeCompare(b.name),
    );
  return (
    <section className="schema-diagram" aria-label="Diagrama de estrutura">
      <div className="diagram-tools">
        <label>
          Buscar coleção ou campo
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ex.: pedidos, clienteId…"
          />
        </label>
        <button
          className="secondary"
          onClick={() => setOrder(order === 'name' ? 'fields' : 'name')}
        >
          Organizar por {order === 'name' ? 'campos' : 'nome'}
        </button>
        <button
          className="secondary"
          aria-label="Diminuir zoom"
          disabled={zoom <= 0.5}
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          <Minus size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className="secondary"
          aria-label="Aumentar zoom"
          disabled={zoom >= 2}
          onClick={() => setZoom(Math.min(2, zoom + 0.25))}
        >
          <Plus size={16} />
        </button>
        <button
          className="secondary"
          aria-label="Restaurar organização e zoom"
          onClick={() => {
            setOrder('name');
            setZoom(1);
            setSearch('');
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <p className="diagram-caption">
        Estrutura observada em até 200 documentos carregados por coleção. Campos podem variar entre
        documentos. Relações entre coleções não foram inferidas.
      </p>
      <div
        className="diagram-viewport"
        tabIndex={0}
        aria-label="Área do diagrama, use a rolagem para navegar"
      >
        <div className="diagram-canvas">
          <div
            className="diagram-layout"
            style={{
              zoom,
              gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, Math.ceil(Math.sqrt(nodes.length))))}, 270px)`,
            }}
          >
            {nodes.map((node) => (
              <article className="schema-node" key={node.name}>
                <header>
                  <Database size={17} />
                  <strong>{node.name}</strong>
                </header>
                <span className="schema-sample">
                  {Math.min(200, node.documents.length)} documentos analisados
                </span>
                <ul>
                  {node.fields.slice(0, 60).map(([name, types]) => (
                    <li key={name}>
                      <span>{name}</span>
                      <code>{[...types].join(' | ')}</code>
                    </li>
                  ))}
                </ul>
                {node.fields.length > 60 && <p>60 de {node.fields.length} campos exibidos.</p>}
                {!node.fields.length && <p>Sem documentos carregados.</p>}
              </article>
            ))}
          </div>
        </div>
        {!nodes.length && <p>Nenhuma coleção ou campo corresponde à busca.</p>}
      </div>
    </section>
  );
}

export function CollectionBranch({
  name,
  selected,
  onSelect,
  children,
}: {
  name: string;
  selected?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
}) {
  return (
    <details className="collection-branch" open={selected || undefined}>
      <summary onClick={() => onSelect?.()}>
        <ChevronRight size={14} />
        <Database size={15} />
        <span>{name}</span>
      </summary>
      <div>{children}</div>
    </details>
  );
}
