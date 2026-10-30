import { ChevronDown, Pencil, Search, Trash2 } from 'lucide-react';
import type { QueryResult } from './api.js';
import { DocumentTree, SchemaDiagram, type DataView } from './DataViews.js';

function formatCell(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['$oid', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal'])
      if (key in object) return String(object[key]);
    return JSON.stringify(value);
  }
  return String(value);
}

function cellClass(column: string, value: unknown) {
  if (column === '_id') return 'id-cell';
  if (typeof value === 'object') return 'object-cell';
  return '';
}

interface Props {
  result: QueryResult | null;
  view: DataView;
  skip: number;
  writable: boolean;
  disabled: boolean;
  onEdit: (document: Record<string, unknown>) => void;
  onDelete: (document: Record<string, unknown>) => void;
}

export function Results({ result, view, skip, writable, disabled, onEdit, onDelete }: Props) {
  if (!result)
    return (
      <div className="empty-results">
        <div>
          <Search size={25} />
        </div>
        <h3>Sua próxima descoberta começa aqui.</h3>
        <p>Escreva um filtro ou pipeline e execute a consulta.</p>
        <span>
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> para executar
        </span>
      </div>
    );
  if (!result.documents.length)
    return (
      <div className="empty-results">
        <Search size={28} />
        <h3>Nenhum documento encontrado.</h3>
        <p>Ajuste o filtro ou confira a página selecionada.</p>
      </div>
    );
  if (view === 'json')
    return (
      <pre className="json-results" tabIndex={0} aria-label="Documentos em JSON">
        {JSON.stringify(result.documents, null, 2)}
      </pre>
    );
  if (view === 'tree') return <DocumentTree documents={result.documents} skip={skip} />;
  if (view === 'diagram')
    return (
      <SchemaDiagram
        collections={[{ name: 'Resultado da consulta', documents: result.documents }]}
      />
    );
  const allColumns = [...new Set(result.documents.flatMap((document) => Object.keys(document)))];
  const columns = allColumns.slice(0, 16);
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Documentos da consulta">
      <table>
        <thead>
          <tr>
            <th className="row-number">#</th>
            {columns.map((column) => (
              <th key={column}>
                {column}
                <ChevronDown size={11} />
              </th>
            ))}
            {writable && <th>Ações</th>}
          </tr>
        </thead>
        <tbody>
          {result.documents.map((document, index) => (
            <tr key={index}>
              <td className="row-number">{skip + index + 1}</td>
              {columns.map((column) => (
                <td
                  key={column}
                  title={JSON.stringify(document[column])}
                  className={cellClass(column, document[column])}
                >
                  {formatCell(document[column])}
                </td>
              ))}
              {writable && (
                <td className="row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Editar documento ${index + 1}`}
                    disabled={disabled}
                    onClick={() => onEdit(document)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label={`Excluir documento ${index + 1}`}
                    disabled={disabled}
                    onClick={() => onDelete(document)}
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {allColumns.length > columns.length && (
        <p className="field-help">
          Tabela limitada a 16 campos. A visualização JSON e a exportação contêm todos os campos.
        </p>
      )}
    </div>
  );
}
