import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toast';
import Home from './pages/Home';
import ProjectOverview from './pages/ProjectOverview';
import FilesPage from './pages/FilesPage';
import ContentPage from './pages/ContentPage';
import SearchPage from './pages/SearchPage';
import DuplicatesPage from './pages/DuplicatesPage';
import PackagePage from './pages/PackagePage';
import ReportPage from './pages/ReportPage';
import PromptPage from './pages/PromptPage';

export default function App() {
  return (
    <ToastProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/projects/:projectId" element={<ProjectOverview />} />
          <Route path="/projects/:projectId/files" element={<FilesPage />} />
          <Route path="/projects/:projectId/files/:fileId" element={<ContentPage />} />
          <Route path="/projects/:projectId/search" element={<SearchPage />} />
          <Route path="/projects/:projectId/duplicates" element={<DuplicatesPage />} />
          <Route path="/projects/:projectId/package" element={<PackagePage />} />
          <Route path="/projects/:projectId/report" element={<ReportPage />} />
          <Route path="/projects/:projectId/prompt" element={<PromptPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </ToastProvider>
  );
}
