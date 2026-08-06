import { RuleTester } from 'eslint';

import financialMutationPlugin from './financial-mutation.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const rule = financialMutationPlugin.rules['no-optimistic-financial-mutation'];

ruleTester.run('no-optimistic-financial-mutation', rule, {
  valid: [
    // A financial mutation with no onMutate at all — the common, correct
    // case for every hook this rule exists to protect.
    `useMutation({
      mutationFn: (input) => apiClient.post('/payments', input),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.lists() }),
    });`,
    `useMutation({ mutationFn: () => apiClient.post('/fees/generate') });`,
    `useMutation({ mutationFn: (input) => apiClient.post('/invoices', input) });`,
    `useMutation({ mutationFn: (input) => apiClient.patch('/enrollments/' + id, input) });`,
    // onMutate on a genuinely low-stakes, non-guarded endpoint is fine.
    `useMutation({
      mutationFn: (input) => apiClient.patch('/students/' + id, input),
      onMutate: async (input) => { /* optimistic snapshot */ },
    });`,
    // A call with no options argument, or a non-object first argument.
    `useMutation();`,
    `useMutation(mutationOptionsVariable);`,
    // A computed key isn't provably "onMutate" — see findOnMutateProperty's
    // own comment on why this is deliberately not flagged.
    `useMutation({
      mutationFn: (input) => apiClient.post('/payments', input),
      [dynamicKeyName]: () => {},
    });`,
  ],
  invalid: [
    {
      code: `useMutation({
        mutationFn: (input) => apiClient.post('/payments', input),
        onMutate: async (input) => { queryClient.setQueryData(paymentKeys.lists(), input); },
      });`,
      errors: [{ messageId: 'noOptimisticFinancial', data: { endpoint: '/payments' } }],
    },
    {
      code: `useMutation({
        mutationFn: (input) => apiClient.post('/payments/record-with-allocation', input),
        onMutate: () => {},
      });`,
      errors: [
        {
          messageId: 'noOptimisticFinancial',
          data: { endpoint: '/payments/record-with-allocation' },
        },
      ],
    },
    {
      code: `useMutation({
        mutationFn: () => apiClient.post('/fees/generate'),
        onMutate: () => {},
      });`,
      errors: [{ messageId: 'noOptimisticFinancial', data: { endpoint: '/fees/generate' } }],
    },
    {
      code: `useMutation({
        mutationFn: (input) => apiClient.post('/invoices', input),
        onMutate: () => {},
      });`,
      errors: [{ messageId: 'noOptimisticFinancial', data: { endpoint: '/invoices' } }],
    },
    {
      code: `useMutation({
        mutationFn: (input) => apiClient.patch('/enrollments/' + id, input),
        onMutate: () => {},
      });`,
      errors: [{ messageId: 'noOptimisticFinancial', data: { endpoint: '/enrollments/' } }],
    },
    {
      // Template-literal URL (path param interpolated into the string) —
      // the common, real-world shape for a by-id endpoint.
      code: `useMutation({
        mutationFn: (input) => apiClient.patch(\`/payments/\${id}\`, input),
        onMutate: () => {},
      });`,
      errors: [{ messageId: 'noOptimisticFinancial', data: { endpoint: '/payments/' } }],
    },
    {
      // `onMutate` written as a string-literal key, not an identifier —
      // still optimistic, must still be caught.
      code: `useMutation({
        mutationFn: (input) => apiClient.post('/invoices', input),
        'onMutate': () => {},
      });`,
      errors: [{ messageId: 'noOptimisticFinancial', data: { endpoint: '/invoices' } }],
    },
  ],
});
