import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// No <StrictMode> here: @reach/router's Redirect (and its history subscription) relies on
// class-component lifecycle timing that React 18's dev-mode double-invoking breaks — a
// redirect from "/" would silently never fire. See CLAUDE.md "Frontend" for the tradeoff.
createRoot(document.getElementById('root')!).render(<App />);
