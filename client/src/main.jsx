import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './theme-dark.css';
import { initTheme } from './lib/theme';

/* Sáng / tối và bảng màu của máy này — áp TRƯỚC khi vẽ trang cho khỏi nháy trắng */
initTheme();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
