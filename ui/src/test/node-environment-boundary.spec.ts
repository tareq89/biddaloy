import { render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

// The `node` project deliberately has no DOM — a component test belongs in
// the `jsdom` project (see vitest.config.ts's own comment). This is a
// permanent regression test, not a one-off manual check: if a future
// config change accidentally gave the node project a DOM (or dropped
// jsdom's own DOM), this would start failing for the *wrong* reason
// (assertion mismatch instead of the expected ReferenceError), which is
// exactly the signal that boundary broke.
describe('node project has no DOM', () => {
  it('cannot render a React component — there is no `document`', () => {
    expect(() => render(createElement('div', null, 'x'))).toThrowError(/document is not defined/);
  });
});
