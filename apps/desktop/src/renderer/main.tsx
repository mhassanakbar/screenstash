import { createRoot } from 'react-dom/client';
import { APP_NAME } from '@screenstash/shared';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root is missing');
createRoot(root).render(
  <main>
    <p>Project foundation</p>
    <h1>{APP_NAME}</h1>
    <p>
      The Electron application is ready. Capture and authentication features are
      pending.
    </p>
  </main>,
);
