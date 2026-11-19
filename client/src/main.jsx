import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { LangProvider } from './lib/i18n.jsx';
import { ToastProvider, ConfirmProvider } from './components/ui.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { installGlobalHandlers } from './lib/errors.js';
import './styles/app.css';

installGlobalHandlers();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary full>
      <BrowserRouter>
        <LangProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </LangProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
