import { RuleTester } from 'eslint';

import dataFetchingPlugin from './data-fetching.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const rule = dataFetchingPlugin.rules['no-fetch-in-effect'];

ruleTester.run('no-fetch-in-effect', rule, {
  valid: [
    // The correct shape this rule exists to push authors toward — data
    // fetching lives in useQuery's queryFn, not an effect.
    `useQuery({
      queryKey: studentKeys.list(filters),
      queryFn: () => apiClient.get('/students'),
    });`,
    // An effect that does no network work at all is untouched.
    `useEffect(() => {
      document.title = title;
    }, [title]);`,
    `useLayoutEffect(() => {
      const id = requestAnimationFrame(measure);
      return () => cancelAnimationFrame(id);
    }, []);`,
    // Calling a mutation's own trigger from an effect isn't a direct fetch
    // call — the mutation itself already goes through useMutation/apiClient
    // and is covered by that hook's own retry/cache behaviour.
    `useEffect(() => {
      mutate(input);
    }, [input]);`,
    // A request made through a local helper function rather than an inline
    // apiClient/axios/fetch call isn't caught — see the rule's own comment
    // on why this is a deliberate, best-effort tradeoff, not a gap to close
    // here.
    `useEffect(() => {
      loadStudent(id);
    }, [id]);`,
    // apiClient/fetch used outside an effect entirely — e.g. inside a plain
    // event handler — isn't this rule's concern.
    `function onClick() {
      apiClient.post('/students', input);
    }`,
    // A non-function first argument (already invalid React, but not this
    // rule's job to catch) shouldn't crash the rule.
    `useEffect(effectRef, []);`,
    `useEffect();`,
  ],
  invalid: [
    {
      code: `useEffect(() => {
        apiClient.get('/students').then(setStudents);
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
    {
      code: `useEffect(() => {
        apiClient.post('/students', input);
      }, [input]);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
    {
      code: `useLayoutEffect(() => {
        apiClient.get('/students');
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useLayoutEffect' } }],
    },
    {
      code: `useEffect(() => {
        fetch('/api/students').then((res) => res.json()).then(setStudents);
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
    {
      code: `useEffect(() => {
        window.fetch('/api/students');
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
    {
      code: `useEffect(() => {
        axios('/api/students');
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
    {
      code: `useEffect(() => {
        axios.get('/api/students');
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
    {
      // The common real-world shape: an async IIFE inside the effect,
      // rather than a bare top-level call — still caught, since the walk
      // covers the whole callback subtree, not just its top-level
      // statements.
      code: `useEffect(() => {
        async function load() {
          const students = await apiClient.get('/students');
          setStudents(students);
        }
        load();
      }, []);`,
      errors: [{ messageId: 'noFetchInEffect', data: { hookName: 'useEffect' } }],
    },
  ],
});
