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
  ],
});
