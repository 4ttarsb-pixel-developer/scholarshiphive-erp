import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WorkforceApp from '../../workforce/App.jsx';
import '../../workforce/styles.css';

const createClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      refetchOnWindowFocus: true,
      retry: (n, err) => (err && err.status >= 400 && err.status < 500 ? false : n < 2),
    },
  },
});

export default function WorkforceAnalyzer({ initialTab } = {}) {
  const [client] = useState(createClient);
  return (
    <div className="workforce-module">
      <QueryClientProvider client={client}>
        <WorkforceApp embedded initialTab={initialTab} />
      </QueryClientProvider>
      <div id="printroot" />
    </div>
  );
}
