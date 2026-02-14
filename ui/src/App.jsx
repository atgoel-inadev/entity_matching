import { Routes, Route } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import DashboardPage from './pages/DashboardPage';
import ProfilesPage from './pages/ProfilesPage';
import ProfileDetailPage from './pages/ProfileDetailPage';
import EntitiesPage from './pages/EntitiesPage';
import ResolvePage from './pages/ResolvePage';
import SeedDataPage from './pages/SeedDataPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profiles" element={<ProfilesPage />} />
        <Route path="/profiles/:slug" element={<ProfileDetailPage />} />
        <Route path="/profiles/:slug/entities" element={<EntitiesPage />} />
        <Route path="/resolve" element={<ResolvePage />} />
        <Route path="/resolve/:slug" element={<ResolvePage />} />
        <Route path="/seed" element={<SeedDataPage />} />
      </Route>
    </Routes>
  );
}
