import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SchemaDiagram } from '../src/client/DataViews.js';

test('diagram distinguishes BSON wrappers from stored query operators', () => {
  const html = renderToStaticMarkup(
    createElement(SchemaDiagram, {
      collections: [
        {
          name: 'logs',
          documents: [
            {
              filter: { $gte: 5 },
              id: { $oid: '671000000000000000000001' },
              tags: ['a'],
              empty: null,
            },
          ],
        },
      ],
    }),
  );
  assert.match(html, /filter<\/span><code>objeto/);
  assert.match(html, /id<\/span><code>oid/);
  assert.match(html, /tags<\/span><code>array/);
  assert.match(html, /empty<\/span><code>null/);
});
