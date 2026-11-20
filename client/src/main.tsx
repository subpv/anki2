import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './App.tsx';

/** Re-renders the whole app when the language changes. */
function Root() {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const bump = () => setKey((k) => k + 1);
    window.addEventListener('langchange', bump);
    return () => window.removeEventListener('langchange', bump);
  }, []);
  return (
    <BrowserRouter>
      <App key={key} />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
