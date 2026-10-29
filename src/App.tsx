import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './shell/AppShell';
import GroundView from './views/GroundView';
import CaptureView from './views/CaptureView';
import ThinkView from './views/ThinkView';
import RecallView from './views/RecallView';
import NotFoundView from './views/NotFoundView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/ground" replace />} />
          <Route path="ground" caseSensitive element={<GroundView />} />
          <Route path="capture" caseSensitive element={<CaptureView />} />
          <Route path="think" caseSensitive element={<ThinkView />} />
          <Route path="recall" caseSensitive element={<RecallView />} />
          <Route path="*" element={<NotFoundView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
