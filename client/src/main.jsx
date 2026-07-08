import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './styles/theme.css';
import './styles/base.css';
import './styles/app.css';
import './styles/store.css';
import './styles/social.css';

import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { SocialProvider } from './context/SocialContext.jsx';
import Layout from './components/Layout.jsx';
import Store from './pages/Store.jsx';
import GameDetail from './pages/GameDetail.jsx';
import Library from './pages/Library.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import ManifestDocs from './pages/ManifestDocs.jsx';
import StyleGuide from './pages/StyleGuide.jsx';
import NotFound from './pages/NotFound.jsx';

function RequireRole({ check, children }) {
  const auth = useAuth();
  if (auth.loading) return null;
  return check(auth) ? children : <Navigate to="/login" replace />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <SocialProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Store />} />
            <Route path="game/:slug" element={<GameDetail />} />
            <Route
              path="library"
              element={
                <RequireRole check={(a) => !!a.user}>
                  <Library />
                </RequireRole>
              }
            />
            <Route path="login" element={<Login />} />
            <Route path="register" element={<Register />} />
            <Route path="docs/manifest" element={<ManifestDocs />} />
            <Route
              path="dashboard"
              element={
                <RequireRole check={(a) => a.isStudent}>
                  <Dashboard />
                </RequireRole>
              }
            />
            <Route
              path="admin"
              element={
                <RequireRole check={(a) => a.isAdmin}>
                  <Admin />
                </RequireRole>
              }
            />
            <Route path="style-guide" element={<StyleGuide />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </SocialProvider>
    </AuthProvider>
  </React.StrictMode>,
);
