import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom";
import { IdentityProvider, useIdentity } from "./context/IdentityContext";
import ChatPage from "./pages/ChatPage";
import DocumentsPage from "./pages/DocumentsPage";
import LoginPage from "./pages/LoginPage";
import UploadPage from "./pages/UploadPage";
import "./App.css";

function RequireIdentity({ children }: { children: React.ReactElement }) {
  const { identity } = useIdentity();
  if (!identity) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chat"
        element={
          <RequireIdentity>
            <ChatPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireIdentity>
            <UploadPage />
          </RequireIdentity>
        }
      />
      <Route
        path="/documents"
        element={
          <RequireIdentity>
            <DocumentsPage />
          </RequireIdentity>
        }
      />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <IdentityProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </IdentityProvider>
  );
}

export default App;
